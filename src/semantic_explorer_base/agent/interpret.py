"""One question -> a governed selection, via two small constrained choices.

The free-form path asks a single model call to choose measures, dimensions and filters at once
from a 29-name vocabulary, and measured 0 of 10 on real questions. This path asks two much
smaller questions instead:

    1. what SHAPE is this?      four options
    2. which SUBJECT?           the corpus's own values, enum-locked, null allowed

Both are enum-constrained, so neither can name something that does not exist, and both are
gradeable offline as label prediction — which the free-form selection never really was, because
"is this the right combination of measures and dimensions" has no single answer key.

Declining is a first-class outcome. "What's the average deal size" has no answer on the
reference corpus: deal value is NULL on all 152 matters. Saying so beats returning a count of
records, which is what the free-form path did.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from semantic_explorer_base.agent.pick_value import PICK_MODEL, pick_value
from semantic_explorer_base.agent.resolve import UnresolvedValue, resolve_against
from semantic_explorer_base.agent.prompt import build
from semantic_explorer_base.agent.shape import SHAPES, selection_for
from semantic_explorer_base.domain import Domain
from semantic_explorer_base.logging import get_logger

log = get_logger()


@dataclass(frozen=True)
class Interpretation:
    """What one question was understood to mean.

    A single type rather than three return shapes. This was `dict | None | CANNOT_ANSWER`,
    where the last was a module-level sentinel dict — so every caller had to know that `None`
    and one particular dict meant different things, and the bench had to reverse-engineer the
    shape back out of the selection it was handed.

    The distinction the sentinel carried is real and survives as a field: `cannot_answer` means
    the CORPUS has nothing for this question and a caller must not fall back to a wider path,
    while a null `selection` without it means only that none of the four shapes fit. Conflating
    them is how "what's the average deal size in dollars" came back as 152.
    """

    selection: dict[str, Any] | None = None
    shape: str | None = None
    subject: str | None = None
    cannot_answer: bool = False
    #: The record-level slices, once resolved — (("comparable_deals.label", "Health Care
    #: Industry"),) for a question about healthcare deals. Carried so a caller can SHOW the
    #: reader which slices were applied; a scope silently applied is barely better than one
    #: silently dropped. A question may name more than one.
    scope: tuple[tuple[str, str], ...] | None = None
    #: Set when the question named a slice this corpus does not carry. Distinct from
    #: `cannot_answer`, which is about the question; this is about one word in it.
    unresolved_scope: str | None = None

    def __bool__(self) -> bool:
        return self.selection is not None


def subject_field(domain: Domain | None = None) -> str:
    """The JSON name the model fills in with its choice, in the domain's own noun.

    Not a cosmetic detail. The field name is part of the prompt as far as the model is
    concerned — it reads `deal_point` and answers a question about deal points. Renaming it to
    a generic `subject` during extraction would have changed the measured configuration while
    the prompt text stayed byte-identical, which is the most misleading kind of drift: the
    thing being pinned looks untouched.

    So it is derived from the domain's own word. `deal point` -> `deal_point` reproduces the
    benchmarked call exactly; `violation` -> `violation` reads naturally for another corpus.
    """
    word = (getattr(domain, "strings", {}) or {}).get("subject", "subject") if domain else "subject"
    return "_".join(word.lower().split())


def interpretation_schema(
    glosses: dict[str, list[str]],
    domain: Domain | None = None,
) -> tuple[dict[str, Any], dict[str, str]]:
    """The structured-output schema, and the map back to real subject names.

    Pure, so the guarantee it encodes can be asserted without a network call: the subject enum
    is built from the corpus's own values, which makes a name the corpus does not carry
    undecodable rather than merely discouraged.

    `strict: true` rejects a `"` inside an enum literal with a 400, and 16 of the reference
    corpus's 92 names contain one — `"Ability to consummate" concept is subject to MAE
    carveouts`. Sanitised here and resolved through the returned map.
    """
    field = subject_field(domain)
    safe = {n.replace('"', "'"): n for n in glosses}
    properties: dict[str, Any] = {
        "shape": {"type": ["string", "null"], "enum": [*SHAPES, None]},
        field: {"type": ["string", "null"], "enum": [*safe, None]},
        "covers_the_question": {"type": "boolean"},
    }
    # The asymmetry `agent.resolve` is built around, made explicit in the schema: the DIMENSION
    # is enum-locked, so a slice this corpus cannot take is undecodable; the VALUE is free text,
    # because a person says "healthcare" where the data holds "Health Care Industry". Locking
    # the value to the corpus's own strings would mean listing every industry, year and band in
    # the schema, and would still not accept the word people actually type.
    scope_dims = list(getattr(domain, "scope_dimensions", ()) or ()) if domain else []
    if scope_dims:
        # A LIST, because "how many healthcare deals signed in 2021" names two slices and a
        # single-valued field made the model choose one and drop the other in silence — the
        # same failure this whole field exists to close, one layer in.
        properties["scopes"] = {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "dimension": {"type": "string", "enum": scope_dims},
                    "value": {"type": "string"},
                },
                "required": ["dimension", "value"],
                "additionalProperties": False,
            },
        }
    schema: dict[str, Any] = {
        "type": "object",
        "properties": properties,
        "required": list(properties),
        "additionalProperties": False,
    }
    return schema, safe


def choose_interpretation(
    question: str,
    domain: Domain,
    api_key: str | None = None,
    usage: list[tuple[int, int]] | None = None,
    *,
    glosses: dict[str, list[str]] | None = None,
    cube_url: str = "",
) -> tuple[str | None, str | None, bool, list[tuple[str, str]]]:
    """Shape, subject and any record-level slice, in one enum-constrained call, with a self-check.

    The self-check is structural rather than a sterner prompt, and that distinction was
    measured. Telling the model to be strict about null fixed the four questions the taxonomy
    cannot answer and cost five real answers (20/20 -> 15/20). Asking it to choose and then
    separately state whether the choice covers the question kept 19-20 of the answers AND got
    all four declines: a concrete pairing is easier to audit than caution is to calibrate.

    Naming the missing terms in the prompt would have scored better still and would be
    overfitting — it would not survive a term nobody thought of.
    """
    if not api_key:
        return None, None, False, []

    from openai import OpenAI

    gloss = glosses if glosses is not None else subject_glosses(domain, cube_url=cube_url)
    schema, safe = interpretation_schema(gloss, domain)
    listing = "\n".join(f"{n} :: {' | '.join(v)}" for n, v in sorted(gloss.items()))
    heading = domain.strings.get("subject_heading", "SUBJECT").title()
    response = OpenAI(api_key=api_key).chat.completions.create(
        model=PICK_MODEL,
        # Not sampled. The same question must give the same selection — a figure a partner
        # cannot reproduce is worth less than one they can. (Temperature 0 narrows the spread
        # and does not eliminate it; three identical runs of this scored 23, 21, 22 of 24.)
        temperature=0,
        messages=[
            {"role": "system", "content": build(domain)},
            {
                "role": "user",
                "content": f"{question}\n\n{heading}s, with the answers each takes:\n{listing}",
            },
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "interpretation", "schema": schema, "strict": True},
        },
    )
    out = json.loads(response.choices[0].message.content or "{}")
    if response.usage and usage is not None:
        usage.append((response.usage.prompt_tokens, response.usage.completion_tokens))

    field = subject_field(domain)
    shape = out.get("shape") if out.get("shape") in SHAPES else None
    subject = safe.get(out.get(field)) if out.get(field) else None
    covers = bool(out.get("covers_the_question"))
    if not covers:
        subject = None
    # Raw, unresolved: "healthcare", not a value the corpus carries. Resolution is `interpret`'s
    # job because it is the layer that may decline, and a decline is an answer.
    scope = [
        (item["dimension"], item["value"])
        for item in (out.get("scopes") or [])
        if item.get("dimension") and item.get("value")
    ]
    log.info(
        "interpretation",
        question=question,
        shape=shape,
        subject=subject,
        covers=covers,
        scope=scope,
    )
    return shape, subject, covers, scope


def subject_glosses(
    domain: Domain, values: Any = None, *, cube_url: str = ""
) -> dict[str, list[str]]:
    """Each subject value with the answers it actually takes.

    The single biggest accuracy lever measured. The reference corpus's names are cryptic —
    `W/N/A/F applies to-Answer`, `A/P/C application to-Answer` — while their ANSWERS say
    plainly what the question is: `Actual knowledge | Constructive knowledge`. Adding them took
    the interpreter from 18/20 to 20/20 on answerable questions.

    Free, in the sense that it costs nothing new to compute: the same grouping already feeds the
    facet rail. It is not free in tokens — it roughly triples the prompt, from ~1,400 to ~4,300
    — which is $0.0007 a question rather than $0.0002.
    """
    from semantic_explorer_base.cube.client import query as cube_query

    payload = {
        "dimensions": [domain.subject_axis, domain.answer_dimension],
        "measures": [domain.count_measure],
        "limit": 1000,
    }
    rows = values(payload) if values else cube_query(payload, cube_url)
    grouped: dict[str, list[tuple[str, int]]] = {}
    for r in rows:
        name, position = r.get(domain.subject_axis), r.get(domain.answer_dimension)
        if name and position:
            grouped.setdefault(str(name), []).append((str(position), int(r[domain.count_measure])))
    # the five commonest answers, most frequent first — enough to say what the question IS
    return {n: [p for p, _ in sorted(v, key=lambda t: -t[1])[:5]] for n, v in grouped.items()}


def interpret(
    question: str,
    domain: Domain,
    api_key: str | None = None,
    *,
    choose: Any = None,
    resolve: Any = None,
    usage: list[tuple[int, int]] | None = None,
    cube_url: str = "",
) -> Interpretation:
    """The selection this question means, or a decline when the corpus cannot answer it.

    ONE model call making two enum-constrained choices at once, plus a self-check. That
    combination won a measured comparison of six strategies over 24 questions with a written
    answer key; the reference implementation's `docs/results/ask-strategies.md` has the numbers.

    Deciding shape and subject together beat deciding them in sequence, at half the calls and
    half the latency — they are not independent, and knowing a question is about a tail period
    tells you it wants a number.

    `choose` and `resolve` are injectable so the pipeline is testable with no key and no
    network — one seam per model call.
    """
    usage = usage if usage is not None else []
    choose = choose or (
        lambda q: choose_interpretation(q, domain, api_key, usage, cube_url=cube_url)
    )
    resolve = resolve or (
        lambda dim, raw: resolve_scope(domain, dim, raw, api_key, cube_url=cube_url)
    )

    shape, subject, covers, raw_scope = choose(question)

    # No shape at all, and the model says the corpus has nothing: final.
    if shape is None:
        if not covers:
            log.info("interpret_cannot_answer", question=question)
            return Interpretation(cannot_answer=True)
        log.info("interpret_declined", question=question, reason="no shape")
        return Interpretation()

    # `count` is the one shape that legitimately needs no subject — "how many records are
    # loaded" — but only when the model affirms the corpus can answer. Without that it ran
    # unfiltered and returned the corpus size in reply to questions about deal value.
    if subject is None:
        if shape == "count" and covers:
            pass
        elif shape == "count":
            log.info("interpret_cannot_answer", question=question, shape=shape)
            return Interpretation(cannot_answer=True)
        else:
            log.info(
                "interpret_declined",
                question=question,
                shape=shape,
                reason="no subject",
            )
            return Interpretation()

    scope_filters: list[dict[str, Any]] = []
    scope: tuple[tuple[str, str], ...] = ()
    for dimension, raw_value in raw_scope:
        try:
            resolved = resolve(dimension, raw_value)
        except UnresolvedValue as exc:
            # The word is in the question and the corpus has nothing by that name. Declining is
            # the whole point: answering corpus-wide here returns a real number for a question
            # nobody asked, which is what "cash-only deals in healthcare" did before this.
            log.info("interpret_unresolved_scope", question=question, raw=exc.raw)
            return Interpretation(unresolved_scope=str(exc))
        scope = (*scope, (dimension, resolved))
        scope_filters.append({"member": dimension, "operator": "equals", "values": [resolved]})

    log.info("interpret", question=question, shape=shape, subject=subject, scope=scope)
    return Interpretation(
        selection=selection_for(domain, shape, subject, scope_filters),
        shape=shape,
        subject=subject,
        scope=scope or None,
    )


def resolve_scope(
    domain: Domain,
    dimension: str,
    raw_value: str,
    api_key: str | None,
    *,
    cube_url: str = "",
    values: Any = None,
) -> str:
    """One record-level slice, resolved against what the dimension actually holds.

    Split out so it can be exercised without the model call above it, and so the two-tier ladder
    in `agent.resolve` is reached from exactly one place rather than reimplemented per caller.
    """
    from semantic_explorer_base.agent.dimension_values import dimension_values

    candidates = values(dimension) if values else dimension_values(dimension, cube_url=cube_url)
    return resolve_against(
        raw_value,
        candidates,
        pick=lambda raw, options: pick_value(raw, options, api_key) if api_key else None,
    ).resolved
