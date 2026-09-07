"""Assembling the interpretation prompt: platform structure, domain nouns.

**The prompt is the implementation**, which is why this file exists rather than a `prompt:` key
in the manifest. That is not a stylistic claim — it was measured. A tidied rewrite of the shipped
prompt, same content reflowed with one clause folded into another paragraph, scored 23/24 in the
harness and then answered "what's the average deal size in dollars" with **152** in production.
Handing a domain a free-text prompt would hand it that failure mode with no way to see it coming.

So the split is: the platform owns every sentence that encodes a decision, and the domain
supplies only nouns.

    platform    the four shapes and their definitions; `distribution` being DEFAULT and the
                phrasings that reach it; both null rules; the covers_the_question self-check
    domain      what a record is, what a subject is, which terms of art name one, and what the
                corpus does not contain

Each platform sentence was measured. Naming `distribution` the DEFAULT and listing its phrasings
took the benchmark from 7/27 to 17/27 — described merely as "the usual case", the model chose
`count` or `coverage` for two thirds of the answerable questions and the app returned the corpus
size instead of the split. The second null rule (inexpressible COMPUTATION, as distinct from
absent DATA) took it to 20/27.

## The gate on this file

`build()` against the reference domain must produce a string byte-identical to the prompt that
scored 20/27. A test asserts it. That makes this port provably behaviour-preserving rather than
probably — and if a future edit changes the text, the test fails and the benchmark must be re-run
before the change is believed.
"""

from __future__ import annotations

from semantic_explorer_base.domain import Domain


def _oxford(items: tuple[str, ...] | list[str]) -> str:
    items = list(items)
    if len(items) <= 1:
        return "".join(items)
    return ", ".join(items[:-1]) + ", and " + items[-1]


def build(domain: Domain) -> str:
    """The system prompt for this domain.

    Every sentence here is platform except the nouns pulled from `domain.strings`, and the
    structure below is deliberately assembled in the same order and wording that was
    benchmarked. Reordering it is a code change, not a formatting one.
    """
    s = domain.strings
    records = s.get("records", "records")
    subject = s.get("subject", "subject")
    corpus = s.get("corpus_description", records)
    terms = s.get("terms_of_art") or ()
    absent = s.get("absent") or ()

    # Four grammatical variants of one noun, because English. The shape definitions need a bare
    # lowercase form ("a negotiated TERM", "one term"), its plural ("negotiated terms only"), and
    # a short form for the two sentences that say "point" where `subject` would read "deal point".
    # These were hardcoded MAUD words until a second domain read the assembled prompt end to end
    # and found it telling a claims analyst about "negotiated terms" and "agreements".
    #
    # Defaults keep a domain that omits them working — it gets `subject` everywhere, which reads
    # correctly, just more repetitively than the benchmarked text.
    generic = s.get("subject_generic", subject)
    generic_plural = s.get("subject_generic_plural", s.get("subjects", f"{generic}s"))
    qualifier = s.get("subject_qualifier", "")
    short = s.get("subject_short", subject)
    # A space only when there is an adjective, so a domain with none does not get "a  FINDING".
    qualified = f"{qualifier} " if qualifier else ""
    units = s.get("numeric_units_phrase", "days, months or percent")

    # The slice a question is asked OF, distinct from the subject it is asked ABOUT. Added
    # after "what are the cash-only deals in healthcare?" returned the corpus-wide split: the
    # subject resolved, the word `healthcare` had nowhere to go, and the answer looked right.
    # Only emitted when the domain declares scope dimensions, so a corpus with none keeps the
    # benchmarked prompt byte-for-byte.
    scope_block = ""
    if getattr(domain, "scope_dimensions", ()):
        # `scope_example` is one value a person might name as a slice, in this domain's own
        # words. It was hardcoded to 'healthcare' — and the second sentence to 'is a cash deal
        # market for healthcare' — which told a claims analyst about M&A. The instruction the
        # example carries ("verbatim, do not guess the data's spelling") is worth a concrete
        # word, so it is supplied rather than dropped.
        example = s.get("scope_example", "")
        verbatim = (
            f"the words the question used, verbatim: write '{example}', not a guess at how the "
            "data spells it"
            if example
            else "the words the question used, verbatim, not a guess at how the data spells it"
        )
        scope_block = (
            "\n\nSCOPE\n"
            f"A question may also name SLICES of the corpus — which {records} to look at, "
            f"rather than which {subject} to look at. Return one entry in `scopes` for EACH "
            f"slice named, with `dimension` (one of the listed members) and `value` ({verbatim}). "
            "Return an empty list when the question names no slice.\n"
            "Return every slice you see, INCLUDING one you doubt this corpus carries. Whether "
            "the value exists is checked afterwards against the real column, and a slice you "
            "leave out is not checked at all — it is silently ignored, and the answer then "
            "describes the whole corpus while appearing to answer the narrower question.\n"
            "Slices are INDEPENDENT of the shape: a question can name a slice and still be any "
            "of the four shapes — a count with a scope, or a distribution with a scope."
        )

    term_line = (
        f"Terms of art map to their {short}: {', '.join(repr(t) for t in terms)} each name one.\n\n"
        if terms
        else ""
    )
    absent_line = (
        # Full phrases, not bare nouns: the benchmarked text repeats "no" before each item
        # ("no deal values in dollars, no fee amounts, and no adviser names"). A template that
        # prefixes one "no" and joins reads differently, and a prompt that reads differently is
        # a prompt whose score is unknown.
        f" — it records {qualified}{generic_plural} only, and holds {_oxford(absent)}."
        if absent
        else "."
    )

    return (
        f"You read a question about a corpus of {corpus} and return two "
        f"things: the SHAPE of the answer, and which {s.get('subject_title', subject)} it is about.\n\n"
        "SHAPE\n"
        # DEFAULT is load-bearing: 7/27 -> 17/27. Described as merely "the usual case", the
        # model chose count or coverage for two thirds of the answerable questions.
        f"distribution — DEFAULT. Use this whenever the question names or implies a {qualified}"
        # `colloquial` is separate from `records` on purpose: the prompt's example phrasings
        # are how a USER would say it ("how many deals"), while the shape definitions describe
        # what is counted ("how many agreements"). Collapsing them changes the examples, and
        # the examples are the part that took this from 7/27 to 17/27.
        f"{generic.upper()}, however it is phrased. 'How many {s.get('colloquial', records)} have X', "
        f"'do {records} include X', "
        f"'is X usually A or B' and 'what is market for X' are ALL distribution: "
        "the answer is the split of positions with counts. Only use count or coverage when NO "
        f"{generic} is named.\n"
        f"median — a typical NUMBER for a {generic} measured in {units}.\n"
        f"count — how many {records}, with NO {generic} named.\n"
        f"coverage — how many {records} we have an answer for on one {generic}.\n\n"
        f"{s.get('subject_heading', subject.upper())}\n"
        f"{term_line}"
        f"Return null for BOTH when this corpus cannot answer the question{absent_line}\n\n"
        # The second kind of unanswerable: not absent DATA but absent COMPUTATION. Worth 3 of
        # the 27 — before it, "which of these is most off-market" returned the corpus size.
        f"Return null for BOTH, too, when the question asks to compare {records} with one "
        f"another, rank them, score one overall, or find {s.get('colloquial', records)} where two different {generic_plural} "
        "both hold. Those are real questions and none of them can be answered here.\n\n"
        f"Also return `covers_the_question`: true only if the {subject} you chose actually "
        f"answers what was asked. Choosing the closest available {short} and marking it false is "
        "the right response when this taxonomy does not cover the question."
        + scope_block
    )
