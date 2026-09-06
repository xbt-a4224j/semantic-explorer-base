"""The values a dimension actually holds — the vocabulary resolution picks from.

Cube's `/meta` carries names, types and descriptions and NOT values, which is correct: a
dimension's vocabulary is data, not metadata. You get it by querying grouped by that dimension,
which is what this does.

**Which** dimensions have a closed vocabulary IS metadata, though, and it now lives in the Cube
model as `meta.closed_vocabulary` rather than in a constant here. That matters: this file used
to carry a hardcoded frozenset of six member names, which is a second source of truth about the
model that nothing keeps in step with it. Renaming a dimension in YAML would have silently
stopped it resolving, and the failure would have looked like the model getting worse.

A dimension whose values grow with the corpus — a target name, a signing date — has no
vocabulary to lock and must never be resolved this way; the caller carries those through
verbatim and says so.
"""

from __future__ import annotations

from typing import Any

from semantic_explorer_base.cube.client import meta as cube_meta
from semantic_explorer_base.cube.client import query as cube_query

#: Above this a vocabulary is not sendable as an enum and the dimension is not closed in any
#: useful sense. Nothing in this corpus approaches it — the largest is 92 deal points — and the
#: guard exists so that the day one does, resolution refuses loudly rather than building a
#: 40,000-token prompt.
MAX_VOCABULARY = 500


def closed_dimensions(meta: dict[str, Any] | None = None, *, cube_url: str = "") -> frozenset[str]:
    """Members the MODEL declares closed, read live from `/meta`.

    Cube surfaces a member's `meta:` block verbatim, so the declaration and the definition
    travel together and cannot drift. `meta` is injectable so this is testable without a
    running Cube.
    """
    doc = meta if meta is not None else cube_meta(cube_url)
    names: set[str] = set()
    for cube in doc.get("cubes", []):
        for dim in cube.get("dimensions", []):
            if (dim.get("meta") or {}).get("closed_vocabulary"):
                names.add(str(dim["name"]))
    return frozenset(names)


def dimension_values(dimension: str, *, cube_url: str = "") -> list[str]:
    """Distinct non-null values, sorted. Empty when the dimension is not closed."""
    if dimension not in closed_dimensions(cube_url=cube_url):
        return []
    rows = cube_query({"dimensions": [dimension], "limit": MAX_VOCABULARY + 1}, cube_url)
    values = sorted({str(r[dimension]) for r in rows if r.get(dimension) is not None})
    return [] if len(values) > MAX_VOCABULARY else values
