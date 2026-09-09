"""What was computed, and from how little the model actually chose.

Extracted from claims-explorer 2026-09-08, unchanged in substance. It was domain-free already
and nobody had noticed: it reads Cube's `/sql` and `/meta`, and the only domain knowledge it
touches is the manifest's two count-measure names, which the platform already owns.

The panel this feeds argues **by size**. The model's entire output is a handful of names drawn
from a closed vocabulary; what runs is a multi-line statement whose parameters arrive bound
rather than concatenated. Nobody reads those two halves side by side and concludes the model
wrote the SQL, which is the claim the whole product rests on and was previously only asserted
in prose.

It is also a debugging surface: a question whose filter was silently dropped shows a WHERE that
does not mention it, which is how a confidently wrong answer becomes a visible one.

Every lookup here is **best-effort and never fatal**. A receipt is evidence about an answer, not
the answer — if `/sql` is down the figure above it is still correct and still governed, so the
panel is absent rather than taking the response with it.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import Any, Protocol

from pydantic import BaseModel


class ValueResolution(BaseModel):
    """One free-text value, and how it became a value the corpus carries."""

    raw: str
    resolved: str
    method: str


class Receipt(BaseModel):
    measures: list[str]
    dimensions: list[str]
    filters: list[dict[str, Any]]
    #: Every enum name the model emitted: each measure, each dimension, and each filter's
    #: member AND value. The count is the honest size of the model's decision.
    choice_count: int
    sql: str
    params: list[str]
    cache_key_queries: list[str]
    resolutions: list[ValueResolution] = []
    descriptions: dict[str, str] = {}
    #: The same filters counted with the OTHER gated count measure.
    #:
    #: A domain whose records and subjects are different grains has two true counts of different
    #: things, and only one answers the question. Showing both is the point: choosing between
    #: them is the mistake a generated query makes silently.
    other_grain: dict[str, Any] | None = None


class _Domain(Protocol):
    record_count: str
    count_measure: str


def member_descriptions(names: set[str], *, meta: Callable[[], dict[str, Any]]) -> dict[str, str]:
    """Definitions for the members this answer used, read live rather than checked in.

    A stale copy would let the catalog and the model disagree, and then any dispute about a
    number becomes a dispute about which list was authoritative.
    """
    try:
        doc = meta()
    except Exception:  # noqa: BLE001 - evidence is best-effort
        return {}
    found: dict[str, str] = {}
    for cube in doc.get("cubes", []):
        for kind in ("measures", "dimensions"):
            for member in cube.get(kind, []):
                if member.get("name") in names and member.get("description"):
                    found[member["name"]] = member["description"]
    return found


def other_grain(
    selection: dict[str, Any],
    *,
    domain: _Domain,
    query: Callable[[dict[str, Any]], list[dict[str, Any]]],
) -> dict[str, Any] | None:
    """The pair the platform actually defines: `record_count` against `count_measure`.

    Deliberately not "any other gated count". A domain may define a third count designed to
    EQUAL one of these as a safety net, and offering that one shows 352 against 352 and
    demonstrates nothing.
    """
    used = set(selection.get("measures", []))
    pair = {domain.record_count: domain.count_measure, domain.count_measure: domain.record_count}
    asked = next((m for m in pair if m in used), None)
    if asked is None:
        return None
    other = pair[asked]
    if other == asked:
        return None
    try:
        rows = query(
            {"measures": [other], "dimensions": [], "filters": selection.get("filters", [])}
        )
    except Exception:  # noqa: BLE001 - evidence is best-effort
        return None
    if not rows:
        return None
    return {"measure": other, "value": str(rows[0].get(other)), "asked": asked}


def build(
    selection: dict[str, Any],
    resolutions: tuple[Any, ...] = (),
    *,
    domain: _Domain,
    sql: Callable[[dict[str, Any]], dict[str, Any]],
    meta: Callable[[], dict[str, Any]],
    query: Callable[[dict[str, Any]], list[dict[str, Any]]],
) -> Receipt | None:
    """The receipt for one selection, or None when Cube could not compile it.

    The cube callables are injected rather than imported so each domain's own client, URL and
    timeout apply — the platform does not know where anyone's Cube lives.
    """
    try:
        compiled = sql(selection)
    except Exception:  # noqa: BLE001 - evidence is best-effort by design
        return None
    measures = list(selection.get("measures", []))
    dimensions = list(selection.get("dimensions", []))
    filters = list(selection.get("filters", []))
    return Receipt(
        measures=measures,
        dimensions=dimensions,
        filters=filters,
        choice_count=len(measures) + len(dimensions) + 2 * len(filters),
        sql=compiled["sql"],
        params=[str(p) for p in compiled["params"]],
        cache_key_queries=compiled.get("cache_key_queries", []),
        resolutions=[
            ValueResolution(
                raw=getattr(r, "raw", ""),
                resolved=getattr(r, "resolved", ""),
                method=getattr(r, "method", ""),
            )
            for r in resolutions
        ],
        descriptions=member_descriptions(
            {*measures, *dimensions, *(f.get("member", "") for f in filters)}, meta=meta
        ),
        other_grain=other_grain(selection, domain=domain, query=query),
    )
