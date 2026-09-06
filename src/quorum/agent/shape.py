"""Question shape — pick the skeleton, then only the subject.

This file is the extraction's proof of concept. In `clause-explorer` it carried 19 references to
legal vocabulary and contains no legal logic whatsoever: it builds four Cube selections, and
every one of them names the same three members. Parameterising those against `Domain` makes it
domain-free without changing a line of its behaviour — the same four skeletons now serve merger
agreements and health claims.

## Why shapes at all

Measured on ten questions a transactional lawyer would actually ask, a single model call with a
free choice over eleven measures produced **0 of 10** answers to the question asked. The failures
shared one cause — given a free choice, the model picks a plausible measure that does not answer
the question:

    "what percentage of deals is cash-only"        -> a bare count, no denominator
    "what's the largest deal value by dollar"      -> a bare count, not a maximum
    "what's the ordinary course efforts standard"  -> median + p25 + p75 over seven dimensions

A real number, correctly computed, for a question nobody asked — which is harder to catch than
an obvious error, because it looks like an answer.

Almost every "what is market" question has ONE skeleton: count the records, grouped by the
answer they gave, filtered to a single subject. Choosing the shape from a four-value enum first
means the model never picks the measure in that case, and the whole class stops being reachable
rather than being caught downstream.

`distribution` is named DEFAULT for a reason that was measured too. Described merely as "the
usual case", the model chose `count` or `coverage` for two thirds of the answerable questions
and the app returned the corpus size instead of the split. Naming it the default and listing the
phrasings took the benchmark from 7/27 to 17/27.
"""

from __future__ import annotations

from typing import Any

from quorum.domain import Domain

#: The closed set. Deliberately four — a fifth would mean a question the corpus answers that
#: none of these covers, which is a modelling finding worth having rather than an enum to extend
#: quietly.
SHAPES: tuple[str, ...] = ("distribution", "median", "count", "coverage")


class UnscopedShape(ValueError):
    """A shape that needs the subject axis pinned, without one."""


def _pin(domain: Domain, subject: str) -> list[dict[str, Any]]:
    return [{"member": domain.subject_axis, "operator": "equals", "values": [subject]}]


def selection_for(domain: Domain, shape: str, subject: str | None) -> dict[str, Any]:
    """The Cube selection this shape means for this domain.

    Raises `KeyError` for an unknown shape and `UnscopedShape` when a shape that needs the
    subject axis is given none. Both are the same failure in different clothes: the answer
    dimension across every subject value mixes unrelated answer vocabularies into one column,
    exactly as an unscoped percentile mixes months, business days and percent.
    """
    if shape not in SHAPES:
        raise KeyError(f"{shape!r} is not one of {SHAPES}")

    if shape in ("distribution", "median") and not subject:
        # Named in the domain's own word. A refusal reading "needs a deal point" is one a
        # lawyer acts on; "needs a value for deal_points.deal_point_name" is one they route
        # around, and an over-refusal people route around gets the gate switched off.
        noun = (domain.strings or {}).get("subject", "subject")
        raise UnscopedShape(
            f"the {shape!r} shape needs a {noun} ({domain.subject_axis}) — without one it "
            f"aggregates across every {noun} in the corpus, which mixes unrelated answer "
            f"vocabularies into a single column"
        )

    if shape == "distribution":
        # The workhorse. "6 of 8 had a fiduciary out" is this, and returning the full answer
        # distribution rather than a headline is what stops it hiding the disagreement — which
        # is usually the thing the question was actually about.
        assert subject
        return {
            "measures": [domain.count_measure],
            "dimensions": [domain.answer_dimension],
            "filters": _pin(domain, subject),
        }

    if shape == "median":
        # The count travels with the percentile because a median with no denominator is a
        # figure nobody can weigh, and because the scope guard would reject the percentile
        # without the pin anyway. It is the PERCENTILE's denominator, not the subject's: most
        # answers are categorical, so the two differ by 16x on the reference corpus.
        assert subject
        return {
            "measures": [*domain.numeric_measures[:1], domain.percentile_denominator],
            "dimensions": [],
            "filters": _pin(domain, subject),
        }

    if shape == "coverage":
        # "How many records do we even have an answer for on this point" — the denominator
        # question asked on its own. Thin coverage is a finding, not an empty result.
        return {
            "measures": [domain.count_measure],
            "dimensions": [],
            "filters": _pin(domain, subject) if subject else [],
        }

    # count: how many records, with no subject named.
    return {"measures": [domain.record_count], "dimensions": [], "filters": []}
