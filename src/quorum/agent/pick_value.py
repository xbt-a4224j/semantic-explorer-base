"""A constrained chooser: given free text and a dimension's real values, pick one or decline.

This is the second model call in the Ask pipeline, and it exists because of an asymmetry the
first one cannot fix. Measure and dimension NAMES are enum-locked at decode time, so an invalid
name is unrepresentable. Filter VALUES could not be, so they travelled as the model's own text
and a near-miss returned zero rows — which reads as "we have no comparable deals" rather than
"you named something we do not carry".

Giving the model the dimension's own values as an enum extends the decode-time guarantee to the
half of the selection that never had one. `'Healthcare'` stops being a plausible string and
becomes undecodable.

Measured 2026-09-06 on 16 legal terms of art against the 92 ABA deal points, gpt-4o-mini:
14/16, zero false positives, and correct `null` on all four terms MAUD has no deal point for
(go-shop, ticking fee, appraisal rights, reverse termination fee). Embeddings scored 12/16 on
the same set with one outright wrong match. The two the model missed it declined rather than
got wrong.
"""

from __future__ import annotations

import json

from quorum.logging import get_logger

log = get_logger()

#: Same model as selection, named once so the price table and the call site cannot disagree.
PICK_MODEL = "gpt-4o-mini"

SYSTEM_PROMPT = (
    "You map a user's phrase to exactly one value from a controlled vocabulary. "
    "The vocabulary is the complete set of values this field holds in the corpus. "
    "Return null when the corpus genuinely has no value for the phrase — that is a correct "
    "answer, not a failure. Never pick a near-miss to avoid returning null."
)


def _schema(candidates: list[str]) -> tuple[dict[str, object], dict[str, str]]:
    """The enum, and the map back.

    `strict: true` structured outputs reject a `"` inside an enum literal with a 400, and 16 of
    the 92 ABA deal-point names contain one — `"Ability to consummate" concept is subject to
    MAE carveouts`. Sanitising the enum and resolving through a map keeps the hard guarantee
    without renaming anything in the corpus.
    """
    safe = {c.replace('"', "'"): c for c in candidates}
    schema = {
        "type": "object",
        "properties": {"value": {"type": ["string", "null"], "enum": [*safe, None]}},
        "required": ["value"],
        "additionalProperties": False,
    }
    return schema, safe


def pick_value(
    raw: str,
    candidates: list[str],
    api_key: str | None = None,
    task: str | None = None,
    usage_sink: list[tuple[int, int]] | None = None,
) -> str | None:
    """The chosen value, or None when the vocabulary has nothing for `raw`.

    Returns None rather than raising when no key is configured, so the caller falls through to
    its own refusal path with candidates attached instead of surfacing a 500.
    """
    key = api_key
    if not key or not candidates:
        return None

    from openai import OpenAI

    schema, safe = _schema(candidates)
    response = OpenAI(api_key=key).chat.completions.create(
        model=PICK_MODEL,
        messages=[
            {"role": "system", "content": task or SYSTEM_PROMPT},
            {"role": "user", "content": raw},
        ],
        response_format={
            "type": "json_schema",
            "json_schema": {"name": "value_pick", "schema": schema, "strict": True},
        },
    )
    chosen = json.loads(response.choices[0].message.content or "{}").get("value")
    usage = response.usage
    if usage_sink is not None and usage:
        # Real counts from the response, never estimated: CLAUDE.md forbids a plausible
        # invented number anywhere a figure is published, and this one is rendered to the user.
        usage_sink.append((usage.prompt_tokens, usage.completion_tokens))
    log.info(
        "value_pick",
        raw=raw,
        offered=len(candidates),
        chosen=chosen,
        tokens=usage.total_tokens if usage else None,
    )
    return safe.get(chosen) if chosen else None
