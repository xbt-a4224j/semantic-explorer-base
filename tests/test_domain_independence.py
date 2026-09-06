"""Prove the platform carries no domain around inside it.

The two real applications cannot prove this. `clause-explorer` and `claims-explorer` share a root
commit, a database schema and 142 byte-identical files, and claims-explorer's Cube model still
uses the LEGAL member names — `deal_points.deal_point_name` holding "Duration-Band". A platform
that had quietly hardcoded those names would pass against both and fail on the first genuinely new
corpus.

So the fixture below shares nothing with either: different cubes, different members, different
vocabulary. If the platform serves restaurant inspections without a branch, it is not carrying
merger agreements around inside it.

This is the test that would fail first if someone reintroduces a domain assumption, which is why
it is separate from the grep-based boundary test. That one catches a NAME leaking into platform
code; this one catches an ASSUMPTION leaking into platform behaviour — the harder and quieter of
the two.
"""

from __future__ import annotations

import pathlib

import pytest

from quorum.agent.shape import SHAPES, selection_for
from quorum.domain import load
from quorum.gates.min_n import apply

FIXTURES = pathlib.Path(__file__).parent / "fixtures"
ALIEN = load(FIXTURES / "restaurant-inspections")


class TestAThirdDomainNeedsNoPlatformChange:
    @pytest.mark.parametrize("shape", SHAPES)
    def test_every_shape_builds_from_its_own_members(self, shape: str) -> None:
        subject = None if shape == "count" else "VIOL-COLD-HOLDING"
        selection = selection_for(ALIEN, shape, subject)
        flat = str(selection)
        assert "deal_point" not in flat, "the platform reached for a member this domain lacks"
        assert "premises" in flat or "violations" in flat

    def test_the_distribution_uses_this_domains_axes(self) -> None:
        s = selection_for(ALIEN, "distribution", "VIOL-COLD-HOLDING")
        assert s["measures"] == ["violations.n"]
        assert s["dimensions"] == ["violations.severity"]
        assert s["filters"][0]["member"] == "violations.code"

    def test_count_uses_the_record_grain(self) -> None:
        """`premises.n`, not `violations.n`. Conflating the two grains is what let a slice of
        one clear a threshold of five in the reference implementation."""
        assert selection_for(ALIEN, "count", None)["measures"] == ["premises.n"]


class TestTheGateIsDomainFreeToo:
    """It reads like a legal-ethics feature — an attorney filtering to n=1 has extracted one
    client's term around the ethical wall. A health-inspection corpus needs the same control for
    a different reason: a single premises is identifiable."""

    def test_a_thin_slice_of_premises_is_refused(self) -> None:
        result = apply(
            [{"violations.n": "2"}],
            count_measures=(ALIEN.count_measure, ALIEN.record_count),
            min_n=5,
            grouped=False,
        )
        assert result.refused
        assert result.n == 2
        assert result.rows == []

    def test_thin_cells_are_suppressed_and_declared(self) -> None:
        rows = [
            {"violations.severity": "critical", "violations.n": "48"},
            {"violations.severity": "major", "violations.n": "31"},
            {"violations.severity": "minor", "violations.n": "3"},
        ]
        result = apply(
            rows,
            count_measures=(ALIEN.count_measure, ALIEN.record_count),
            min_n=5,
            grouped=True,
        )
        assert not result.refused
        assert len(result.rows) == 2
        assert result.suppressed == 1
        assert "suppressed" in (result.message or "")

    def test_it_reads_whichever_count_is_smaller(self) -> None:
        """Two grains on one row: 40 violations across 1 premises is a slice of one."""
        result = apply(
            [{"violations.n": "40", "premises.n": "1"}],
            count_measures=(ALIEN.count_measure, ALIEN.record_count),
            min_n=5,
            grouped=False,
        )
        assert result.refused, "the gate read the inflated grain"
        assert result.n == 1
