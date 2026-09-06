"""The `min_n` gate — a slice too small to characterise is refused, not answered.

Domain-free, and that is the interesting part. It reads like a legal-ethics feature: an attorney
who can filter until n=1 has extracted one client's negotiated term through the analytics layer,
around the ethical wall, without ever retrieving a document. A health-claims corpus needs exactly
the same control under a different regulation, and a compensation corpus under a third. The
control generalises even though the justification does not.

It does three jobs at once, and it is worth being able to say all three: statistical honesty (a
median over three records is not a market), extraction-confidence gating, and k-anonymity.

## Two defects this had, both real, both shipped

**It read one hardcoded measure name.** `rows[0].get("deal_points.n")` — so any selection over
the other namespace returned None, `if n is not None` short-circuited, and the refusal never
ran. Not lenient: absent. A grouped query then returned three named counterparties at n=1 each
with `refused: false`.

**It read only `rows[0]`.** A grouped result is a set of independent claims and the gate protects
each one. Reading the first row served a fourth cell of n=3 behind a first cell of 89.

Both are why `n_from` takes the minimum across every row AND every count measure. The minimum
matters on the second axis too: a subject-grain count and a record-grain count can differ by
~89x on the same slice, and reading the inflated one lets a slice of one clear a threshold of
five.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class GateResult:
    """What the gate decided. `rows` is what may be shown."""

    rows: list[dict[str, Any]]
    n: int | None
    refused: bool = False
    suppressed: int = 0
    threshold: int | None = None
    message: str | None = None


def n_from(rows: list[dict[str, Any]], count_measures: tuple[str, ...]) -> int | None:
    """The smallest count anywhere in the result, or None when none was selected.

    None is a real answer: a selection of only a median has no denominator to gate on, and
    inventing one would be a claim about a sample size nobody measured.
    """
    counts = [int(row[m]) for row in rows for m in count_measures if row.get(m) is not None]
    return min(counts) if counts else None


def apply(
    rows: list[dict[str, Any]],
    *,
    count_measures: tuple[str, ...],
    min_n: int,
    grouped: bool,
) -> GateResult:
    """Refuse an ungrouped thin result; suppress thin cells in a grouped one.

    The distinction is deliberate and was measured against the alternative. Taking the minimum
    across rows made a legitimate four-cell distribution refuse outright because its fourth cell
    was n=3 — killing three good cells to protect one. Published deal-point studies do the
    opposite: report the categories with enough sample and say the rest were too thin.

    The cost, stated rather than hidden: a reader can infer that a suppressed cell exists and is
    small. That is inherent to publishing a suppression notice at all, and it is the trade every
    disclosure-control system makes.
    """
    if grouped:
        kept = [r for r in rows if _clears(r, count_measures, min_n)]
        dropped = len(rows) - len(kept)
        if dropped and kept:
            return GateResult(
                rows=kept,
                n=n_from(kept, count_measures),
                threshold=min_n,
                suppressed=dropped,
                message=(
                    f"{dropped} of {len(rows)} rows suppressed: below the threshold of "
                    f"{min_n}. The remaining rows are unchanged; the distribution shown is "
                    f"therefore incomplete."
                ),
            )
        rows = kept or rows

    n = n_from(rows, count_measures)
    if n is not None and n < min_n:
        # Refusal is its own shape, never an empty row list with a 200. "We will not answer
        # this" and "there is nothing here" are different statements about different things,
        # and collapsing them teaches a reader to distrust every empty result they ever see.
        return GateResult(
            rows=[],
            n=n,
            refused=True,
            threshold=min_n,
            message=(
                f"n={n} — insufficient to characterize (threshold {min_n}). The same gate "
                f"applies to the dashboard and to a direct API call."
            ),
        )
    return GateResult(rows=rows, n=n, threshold=min_n)


def _clears(row: dict[str, Any], count_measures: tuple[str, ...], threshold: int) -> bool:
    """Whether one cell is big enough to characterise.

    A row carrying no count clears: there is no denominator to gate on, and inventing one to
    suppress by would be a claim about a sample size nobody measured.
    """
    n = n_from([row], count_measures)
    return n is None or n >= threshold
