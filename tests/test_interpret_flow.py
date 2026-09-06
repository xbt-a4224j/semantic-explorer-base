"""The pipeline, end to end, with the model call stubbed.

What this pins is the FLOW: that a question becomes a governed selection through two closed
choices, that declining is a first-class outcome, and that the shapes which mix vocabularies
without a subject cannot be produced at all.

Deliberately no live calls. The accuracy of the two choices is an eval question graded against
a label space; this is the wiring, and wiring is what silently broke three times during the
extraction.

Ported from the reference implementation with the legal nouns replaced by a Domain. The port
found a real defect on the way — see `TestAMedianCarriesItsOwnDenominator`.
"""

from __future__ import annotations

import pytest

import dataclasses

from semantic_explorer_base.agent.interpret import (
    interpret,
    interpretation_schema,
    resolve_scope,
)
from semantic_explorer_base.domain import Domain, InvalidDomain

LEGAL = Domain(
    name="clause-explorer",
    corpus="maud-public-target-merger-agreements",
    subject_axis="deal_points.deal_point_name",
    answer_dimension="deal_points.position",
    count_measure="deal_points.n",
    record_count="comparable_deals.n",
    numeric_measures=("deal_points.median_numeric_value",),
    numeric_count="deal_points.numeric_n",
)

SUBJECTS = [
    "Knowledge Definition-Answer",
    "Ordinary course efforts standard-Answer",
    "Tail Period Length-Answer",
]


def _run(question, shape, subject, covers=None, domain=LEGAL, scope=()):
    """One injected chooser: the winning strategy makes both choices in a single call, so the
    test seam is one function rather than two.

    `covers` defaults to "true when a subject was found" — the model does not mark a real pick
    as not covering the question. Pass it explicitly to exercise the decline paths.
    """
    covers = subject is not None if covers is None else covers
    return interpret(question, domain, choose=lambda q: (shape, subject, covers, scope)).selection


class TestALawyersQuestionBecomesASelection:
    def test_is_knowledge_actual_or_constructive(self) -> None:
        s = _run(
            "is knowledge actual or constructive",
            "distribution",
            "Knowledge Definition-Answer",
        )
        assert s["measures"] == ["deal_points.n"]
        assert s["dimensions"] == ["deal_points.position"]
        assert s["filters"][0]["values"] == ["Knowledge Definition-Answer"]

    def test_the_efforts_standard_question_that_used_to_return_percentiles(
        self,
    ) -> None:
        """Measured against the free-form path, this question produced median + p25 + p75 over
        seven dimensions. The shape makes that unreachable."""
        s = _run(
            "what's the ordinary course efforts standard",
            "distribution",
            "Ordinary course efforts standard-Answer",
        )
        assert not any("numeric" in m for m in s["measures"])
        assert s["dimensions"] == ["deal_points.position"]


class TestAMedianCarriesItsOwnDenominator:
    """The defect the port surfaced, and the reason a contract beats a rename.

    Parameterising `median` naively reads the subject's count measure — the obvious choice,
    since every other shape uses it. It is wrong. Only answers whose text carries a parseable
    number are in a percentile's sample: **809 of 12,937** rows on the reference corpus. A
    median rendered beside `n=12,937` claims a sample sixteen times the one it came from, in a
    product whose whole discipline is that every figure carries its denominator.

    The reference implementation had this right and had it hardcoded, so the requirement was
    invisible until a second domain had to state it. `numeric_count` is now part of the
    contract and a domain declaring percentiles without one fails at load.
    """

    def test_the_median_is_reported_against_the_numeric_count(self) -> None:
        s = _run("what's the typical tail period", "median", "Tail Period Length-Answer")
        assert s["measures"] == [
            "deal_points.median_numeric_value",
            "deal_points.numeric_n",
        ]
        assert "deal_points.n" not in s["measures"], (
            "the subject's own count is 16x the percentile's sample on this corpus"
        )
        assert s["filters"][0]["values"] == ["Tail Period Length-Answer"]

    def test_percentiles_without_a_denominator_are_rejected_at_load(self) -> None:
        with pytest.raises(InvalidDomain, match="numeric_count"):
            Domain(
                name="x",
                corpus="x",
                subject_axis="a.b",
                answer_dimension="a.c",
                count_measure="a.n",
                record_count="b.n",
                numeric_measures=("a.median",),
            ).validate()

    def test_a_domain_with_no_percentiles_needs_no_extra_field(self) -> None:
        """The distinction cannot arise where there is nothing to take a median of, and a
        contract that demands a field for it anyway is a tax on every simple domain."""
        plain = Domain(
            name="x",
            corpus="x",
            subject_axis="a.b",
            answer_dimension="a.c",
            count_measure="a.n",
            record_count="b.n",
        )
        plain.validate()
        assert plain.percentile_denominator == "a.n"


class TestDecliningIsAnAnswer:
    def test_a_question_the_corpus_cannot_answer_returns_none(self) -> None:
        """ "What's the average deal size" — deal_value_usd is NULL on all 152 matters. The
        free-form path answered it with `4`, the median of months, business days and percent."""
        assert _run("what's the average deal size", None, None) is None

    def test_a_shape_that_needs_a_subject_declines_without_one(self) -> None:
        assert _run("what is market", "distribution", None) is None

    def test_only_count_survives_without_a_subject(self) -> None:
        """ "How many agreements are loaded" is the `count` shape and needs no term.

        `coverage` without one used to be allowed and should not be: unfiltered it returns
        12,937, the number of labelled ROWS, which reads as an agreement count and is not one.
        A shape that silently changes what it counts is worse than a decline.
        """
        assert (
            interpret(
                "how many agreements do we have",
                LEGAL,
                choose=lambda q: ("count", None, True, ()),
            ).selection
            is not None
        )
        assert _run("how many have an answer", "coverage", None) is None


class TestTheChoicesAreClosed:
    def test_the_subject_enum_is_built_from_the_corpus(self) -> None:
        """The guarantee, asserted on the schema itself with no call made: the model chooses
        from the corpus's own values, so one that does not exist is undecodable."""
        schema, _ = interpretation_schema({n: ["Yes", "No"] for n in SUBJECTS})
        enum = schema["properties"]["subject"]["enum"]
        assert set(SUBJECTS) <= set(enum)
        assert None in enum, "declining must remain expressible"

    def test_a_quoted_name_is_sanitised_and_maps_back(self) -> None:
        """`strict: true` rejects a double-quote inside an enum literal with a 400, and 16 of
        the reference corpus's 92 names contain one."""
        quoted = 'War, terrorism, natural disasters, "acts of God" or force majeure-Answer'
        schema, safe = interpretation_schema({quoted: ["Yes", "No"]})
        enum = [e for e in schema["properties"]["subject"]["enum"] if e]
        assert all('"' not in e for e in enum), "a quote in the enum is a 400 from the API"
        assert safe[enum[0]] == quoted, "and it must map back to the real name"


class TestAQuestionTheCorpusCannotAnswerNeverReturnsANumber:
    """Caught on the deployed stack, not by the benchmark, which is the point.

    "What's the average deal size in dollars" came back as **152**. The model could find no
    subject (correct — deal value is NULL on all 152 matters), said so, and then the `count`
    shape ran anyway with no filter and returned the corpus size. A number in answer to a
    question the corpus cannot answer is worse than a refusal, because it looks like an answer.

    The benchmark missed it because it graded the subject and ignored the shape. A metric that
    reads half the output certifies half the system.
    """

    def test_the_average_deal_size_question_declines_rather_than_counting(self) -> None:
        """A FINAL refusal, distinct from "no shape fit" — which is the whole fix. A plain
        decline lets a caller fall back to a wider path, and that is what answered this with
        152, the size of the corpus."""
        result = interpret(
            "what's the average deal size in dollars",
            LEGAL,
            choose=lambda q: ("count", None, False, ()),
        )
        assert result.cannot_answer
        assert result.selection is None

    def test_a_genuine_count_question_still_answers(self) -> None:
        """The flag is about whether the CORPUS can answer, not whether a subject exists."""
        result = interpret(
            "how many agreements are loaded",
            LEGAL,
            choose=lambda q: ("count", None, True, ()),
        )
        assert result.selection is not None
        assert result.selection["measures"] == ["comparable_deals.n"]

    def test_a_shape_with_no_subject_and_no_coverage_declines(self) -> None:
        for shape in ("distribution", "median", "coverage"):
            assert _run("unanswerable", shape, None) is None, shape


class TestAQuestionCanNameASliceAsWellAsASubject:
    """The gap that let "what are the cash-only deals in healthcare?" answer corpus-wide.

    The subject resolved correctly every time; there was simply nowhere for `healthcare` to go,
    so it was dropped and the 152-agreement split came back looking like the answer to a
    question about 26 of them.
    """

    SCOPED = dataclasses.replace(LEGAL, scope_dimensions=("comparable_deals.label",))

    def _interpret(self, shape, subject, scope, *, values=("Health Care Industry", "Information Industry")):
        return interpret(
            "q",
            self.SCOPED,
            api_key="k",
            choose=lambda q: (shape, subject, True, scope),
            # No key: only the exact tier runs, so this test never reaches the network.
            # The model-pick tier has its own tests in test_resolve.
            resolve=lambda dim, raw: resolve_scope(
                self.SCOPED, dim, raw, None, values=lambda _d: list(values)
            ),
        )

    def test_a_named_slice_reaches_the_selection(self) -> None:
        out = self._interpret("distribution", "Type of Consideration-Answer",
                              [("comparable_deals.label", "Health Care Industry")])
        members = [f["member"] for f in out.selection["filters"]]
        assert "comparable_deals.label" in members
        assert out.scope == (("comparable_deals.label", "Health Care Industry"),)

    def test_a_count_with_a_slice_is_no_longer_the_corpus_total(self) -> None:
        """`count` is where a dropped slice was most dangerous: it returned a real number."""
        out = self._interpret("count", None, [("comparable_deals.label", "Health Care Industry")])
        assert out.selection["filters"], "a count naming a slice must not return the corpus total"

    def test_two_slices_both_survive(self) -> None:
        """"how many healthcare deals signed in 2021" named two and kept one, silently."""
        both = dataclasses.replace(
            LEGAL, scope_dimensions=("comparable_deals.label", "comparable_deals.signing_year")
        )
        out = interpret(
            "q",
            both,
            api_key="k",
            choose=lambda q: ("count", None, True, [
                ("comparable_deals.label", "Health Care Industry"),
                ("comparable_deals.signing_year", "2021"),
            ]),
            resolve=lambda dim, raw: raw,
        )
        members = [f["member"] for f in out.selection["filters"]]
        assert members == ["comparable_deals.label", "comparable_deals.signing_year"]

    def test_a_slice_the_corpus_does_not_carry_declines(self) -> None:
        """Loudly. Answering corpus-wide here is the silent wrong answer, not a graceful one."""
        out = self._interpret("distribution", "Type of Consideration-Answer",
                              [("comparable_deals.label", "Cryptocurrency")], values=("Health Care Industry",))
        assert not out
        assert out.unresolved_scope and "Cryptocurrency" in out.unresolved_scope
