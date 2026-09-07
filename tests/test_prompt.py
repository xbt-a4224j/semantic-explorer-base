"""The templated prompt must reproduce the benchmarked one exactly.

This is the strongest test in the repo, and it exists because the prompt IS the implementation.
That is measured, not asserted: a tidied rewrite of this text — same content reflowed, one clause
folded into another paragraph — scored 23/24 in the harness and then answered "what's the average
deal size in dollars" with **152** in production.

So extracting the prompt into a template is exactly the kind of change that silently breaks
things. Byte-equality against the text that scored 20/27 turns "probably behaviour-preserving"
into "provably". If a future edit changes a single character, this fails, and the benchmark has
to be re-run before the change is believed.

`tests/fixtures/benchmarked_prompt.txt` is the artefact: the literal string the reference
implementation shipped when it scored 20 of 27 on `docs/eval/ask_questions.json`.
"""

from __future__ import annotations

import pathlib
import re
from typing import ClassVar

import pytest

from semantic_explorer_base.agent.prompt import build
from semantic_explorer_base.domain import Domain

BENCHMARKED = (pathlib.Path(__file__).parent / "fixtures" / "benchmarked_prompt.txt").read_text()

#: The reference domain's nouns, and nothing else. Everything structural in the prompt comes
#: from the platform.
LEGAL_STRINGS = {
    "records": "agreements",
    "record": "agreement",
    "subject": "deal point",
    "subject_title": "ABA deal point",
    "subject_heading": "DEAL POINT",
    # Separate from `records` on purpose: the example phrasings are how a USER speaks ("how many
    # deals"), while the shape definitions describe what is counted ("how many agreements").
    "colloquial": "deals",
    "corpus_description": "public-target merger agreements",
    "terms_of_art": [
        "no-shop",
        "fiduciary out",
        "MAE carve-out",
        "bringdown",
        "tail period",
    ],
    # Full phrases, because the benchmarked text repeats "no" before each.
    "absent": ["no deal values in dollars", "no fee amounts", "no adviser names"],
    # The four grammatical variants of "deal point" the prompt needs, plus its units and one
    # scope example. These lived hardcoded inside prompt.py until a second domain read the
    # assembled prompt and found itself being told about "negotiated terms" and "agreements";
    # the values here are the exact words the benchmarked text used, which is why that fixture
    # still matches byte-for-byte.
    "subject_generic": "term",
    "subject_generic_plural": "terms",
    "subject_qualifier": "negotiated",
    "subject_short": "point",
    "numeric_units_phrase": "days, months or percent",
    "scope_example": "healthcare",
}


def _domain(**overrides) -> Domain:
    base = {
        "name": "clause-explorer",
        "corpus": "maud-public-target-merger-agreements",
        "subject_axis": "deal_points.deal_point_name",
        "answer_dimension": "deal_points.position",
        "count_measure": "deal_points.n",
        "record_count": "comparable_deals.n",
        "strings": LEGAL_STRINGS,
    }
    base.update(overrides)
    return Domain(**base)


def test_the_reference_domain_reproduces_the_benchmarked_prompt_exactly() -> None:
    """20 of 27 was measured against this string. Any drift invalidates that number."""
    assert build(_domain()) == BENCHMARKED


class TestOnlyNounsChangeBetweenDomains:
    """A different domain changes the nouns and nothing structural. If a domain could alter a
    shape definition or a null rule, each domain would be running a different algorithm and the
    platform's measured behaviour would mean nothing."""

    ALIEN: ClassVar[dict] = {
        "records": "premises",
        "record": "premises",
        "subject": "violation",
        "subject_title": "violation code",
        "subject_heading": "VIOLATION",
        "colloquial": "premises",
        "corpus_description": "city health inspections",
        "terms_of_art": ["cold holding", "handwashing"],
        "absent": ["no inspector names", "no fine amounts"],
        "subject_generic": "violation",
        "subject_generic_plural": "violations",
        "subject_qualifier": "cited",
        "subject_short": "violation",
        "numeric_units_phrase": "days or counts",
        "scope_example": "downtown",
    }

    def test_the_structural_sentences_survive_unchanged(self) -> None:
        alien = build(_domain(strings=self.ALIEN))
        for sentence in (
            "distribution — DEFAULT.",
            "the answer is the split of positions with counts",
            # These two used to be asserted with MAUD's word "term" baked in, which passed only
            # because the platform was hardcoding it — the exact bug this file exists to catch.
            # The SHAPE of the sentence is platform; the noun inside it is the domain's.
            "Only use count or coverage when NO violation is named.",
            "median — a typical NUMBER for a violation measured in days or counts.",
            "Return null for BOTH, too, when the question asks to compare",
            "Also return `covers_the_question`",
        ):
            assert sentence in alien, f"the platform lost {sentence!r} for a different domain"

    def test_the_nouns_do_change(self) -> None:
        alien = build(_domain(strings=self.ALIEN))
        assert "premises" in alien
        assert "deal point" not in alien
        assert "merger" not in alien

    def test_no_word_from_the_reference_domain_survives_into_another(self) -> None:
        """The check that was missing, and the reason it mattered.

        `test_the_nouns_do_change` looked for exactly two MAUD words, so it passed for a year
        while the prompt hardcoded six others. A claims domain read its own assembled prompt and
        found itself being told to look for "a negotiated TERM" in "agreements" — the platform
        asserting M&A vocabulary at a corpus of car crashes.

        Every word below was hardcoded in `prompt.py` until 2026-09-07. `healthcare` and
        `cash deal` were worse: they were added the same week, in the SCOPE block, by someone
        (me) copying the reference domain's own examples into shared code.
        """
        alien = build(_domain(strings=self.ALIEN)).lower()
        # "terms of art" is generic English — every specialist field has them — so it stays
        # platform prose. Removed before the check rather than dropped from it, so the bare
        # word "term" is still caught everywhere else.
        alien = alien.replace("terms of art", "«idiom»")
        for leaked in (
            "negotiated",
            "agreement",
            "deal",
            "term",
            "point",
            "healthcare",
            "months or percent",
        ):
            assert not re.search(rf"\b{leaked}", alien), (
                f"{leaked!r} is the reference domain's word, not the platform's — "
                f"it must come from strings, or this prompt is lying to every other corpus"
            )

    def test_a_domain_with_no_terms_of_art_omits_that_line(self) -> None:
        """Not every corpus has terms of art. An empty list must not leave a dangling heading
        with nothing under it."""
        bare = build(_domain(strings={**self.ALIEN, "terms_of_art": []}))
        assert "Terms of art map to their violation" not in bare
        assert "distribution — DEFAULT." in bare


@pytest.mark.parametrize("missing", ["records", "subject", "corpus_description"])
def test_a_missing_noun_degrades_rather_than_crashing(missing: str) -> None:
    """A half-filled manifest should produce a clumsy prompt, not a KeyError at request time."""
    strings = {k: v for k, v in LEGAL_STRINGS.items() if k != missing}
    assert build(_domain(strings=strings))
