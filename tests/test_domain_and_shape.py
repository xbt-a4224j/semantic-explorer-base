"""The contract, and the proof that one shape module serves two corpora.

These two manifests are the real ones: the legal domain names the members clause-explorer's Cube
model actually declares, and the health domain names claims-explorer's. If a single `shape.py`
produces correct selections for both from the same code path, the extraction is real. If it
needs a branch, it is not.
"""

from __future__ import annotations

import pytest

from semantic_explorer_base.agent.shape import SHAPES, UnscopedShape, selection_for
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
    strings={"subject": "deal point", "records": "agreements"},
)

# The REAL claims manifest, not a plausible one. The member names look legal in a claims
# application because the schema and Cube model still carry the names the first domain gave
# them — `deal_point_name` holds "Duration-Band" here. Stating that rather than inventing
# tidier names is the point: it shows the platform never knew what a deal point was, and that
# the rename tracked at claims-explorer#1 buys legibility rather than function.
HEALTH = Domain(
    name="claims-explorer",
    corpus="synthea-synthetic-claims",
    subject_axis="deal_points.deal_point_name",
    answer_dimension="deal_points.position",
    count_measure="deal_points.n",
    record_count="comparable_claims.n",
    numeric_measures=("deal_points.median_numeric_value",),
    numeric_count="deal_points.numeric_n",
    strings={"subject": "claim finding", "records": "claims"},
)


@pytest.mark.parametrize("domain", [LEGAL, HEALTH], ids=["legal", "health"])
class TestOneModuleServesBoth:
    def test_a_distribution_groups_by_the_answer_and_pins_the_subject(self, domain) -> None:
        s = selection_for(domain, "distribution", "anything")
        assert s["measures"] == [domain.count_measure]
        assert s["dimensions"] == [domain.answer_dimension]
        assert s["filters"][0]["member"] == domain.subject_axis

    def test_a_median_carries_its_denominator(self, domain) -> None:
        """A median with no n is a figure nobody can weigh — and it must be the PERCENTILE's n.

        This used to assert `count_measure` and passed for the wrong reason: both fixtures left
        `numeric_count` unset, so the denominator fell back to the subject's count and the
        assertion could not fail. Only answers carrying a parseable number are in a percentile's
        sample, 809 of 12,937 on the reference corpus, so the two differ by 16x.
        """
        s = selection_for(domain, "median", "anything")
        assert domain.percentile_denominator in s["measures"]
        assert domain.count_measure not in s["measures"], "16x the real sample"

    def test_a_count_uses_the_record_grain_not_the_subject_grain(self, domain) -> None:
        """The distinction that let a slice of one clear a threshold of five: the two counts
        differ by ~89x on the same slice, because a row means something different in each."""
        s = selection_for(domain, "count", None)
        assert s["measures"] == [domain.record_count]
        assert s["filters"] == []

    def test_a_count_with_a_subject_scopes_to_it(self, domain) -> None:
        """The live failure of 2026-09-05: "how many deals were cash-only buyouts" resolved the
        subject correctly, `count` discarded it, and the app answered with the corpus total —
        152 where the answer was 89. A count and a resolved subject contradict each other and
        the subject wins."""
        s = selection_for(domain, "count", "anything")
        assert s == selection_for(domain, "distribution", "anything")
        assert s["filters"], "a resolved subject must reach the selection"

    def test_every_shape_builds(self, domain) -> None:
        for shape in SHAPES:
            assert selection_for(domain, shape, "anything")["measures"]

    @pytest.mark.parametrize("shape", ["distribution", "median"])
    def test_a_shape_needing_the_subject_refuses_without_one(self, domain, shape) -> None:
        """The message serves two readers and must satisfy both.

        A lawyer reading "needs a value for deal_points.deal_point_name" routes around the
        refusal; one reading "needs a deal point" fixes the question. A developer needs the
        member to know which axis. Naming only the member is what this originally did, and
        naming only the noun is the over-correction — an over-refusal people route around gets
        the gate switched off rather than fixed.
        """
        with pytest.raises(UnscopedShape) as raised:
            selection_for(domain, shape, None)
        message = str(raised.value)
        assert domain.subject_axis in message, "a developer needs the member"
        assert domain.strings["subject"] in message, "a user needs their own word"


class TestTheManifestFailsLoudlyAtLoad:
    """A domain whose subject axis is wrong answers nothing, and the symptom — every question
    declining — looks like a model problem rather than a configuration one."""

    def test_a_bare_member_name_is_rejected(self) -> None:
        with pytest.raises(InvalidDomain, match="fully qualified"):
            Domain(
                name="x",
                corpus="x",
                subject_axis="deal_point_name",
                answer_dimension="a.b",
                count_measure="a.n",
                record_count="b.n",
            ).validate()

    def test_the_two_counts_must_differ(self) -> None:
        with pytest.raises(InvalidDomain, match="threshold of five"):
            Domain(
                name="x",
                corpus="x",
                subject_axis="a.subject",
                answer_dimension="a.answer",
                count_measure="a.n",
                record_count="a.n",
            ).validate()

    def test_grouping_a_dimension_by_itself_is_rejected(self) -> None:
        with pytest.raises(InvalidDomain, match="by itself"):
            Domain(
                name="x",
                corpus="x",
                subject_axis="a.b",
                answer_dimension="a.b",
                count_measure="a.n",
                record_count="b.n",
            ).validate()

    def test_an_unknown_key_is_not_ignored(self, tmp_path) -> None:
        """A typo'd `subject_axis:` silently ignored leaves the app answering nothing."""
        from semantic_explorer_base.domain import load

        (tmp_path / "quorum.yaml").write_text(
            "name: x\ncorpus: x\nsubject_axes: a.b\nanswer_dimension: a.c\n"
            "count_measure: a.n\nrecord_count: b.n\n"
        )
        with pytest.raises(InvalidDomain, match="subject_axes"):
            load(tmp_path)
