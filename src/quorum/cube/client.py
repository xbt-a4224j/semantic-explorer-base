"""The only place the API talks to Cube (#19).

One client so every Cube query is logged the same way — measures, dimensions, filters, row
count, latency (CLAUDE.md's logging contract) — and so nothing in the product can reach past
the semantic layer to write its own SQL. If a number needs computing, it gets a measure in
`cube/model/*.yml`; it does not get a query built here.
"""

from __future__ import annotations

import json
import time
from typing import Any

import httpx

from explorer.api.logging import get_logger
from explorer.api.settings import settings

log = get_logger()


class CubeUnavailable(RuntimeError):
    """Cube could not answer. Surfaced as 503, never as an empty result set — an empty facet
    rail and a dead semantic layer look identical in the UI."""


# Cube long-polls: when a query outruns its initial wait it answers 200 with
# `{"error": "Continue wait"}` and expects the SAME request to be re-issued until data comes
# back. Treating that as a failure — the obvious reading of a body with "error" in it — turns
# every cold-start query into a 503. It cost a live 503 on the first facet request here.
CONTINUE_WAIT = "Continue wait"
MAX_WAITS = 10


def query(payload: dict[str, Any], timeout: float = 20.0) -> list[dict[str, Any]]:
    started = time.perf_counter()
    url = f"{settings.cube_api_url}/load"
    params = {"query": json.dumps(payload)}

    body: dict[str, Any] = {}
    for attempt in range(MAX_WAITS):
        try:
            response = httpx.get(url, params=params, timeout=timeout)
            response.raise_for_status()
            body = response.json()
        except Exception as exc:  # one failure mode for the caller: CubeUnavailable
            log.warning(
                "cube_query_failed", error=type(exc).__name__, measures=payload.get("measures")
            )
            raise CubeUnavailable(
                "The semantic layer (Cube) did not answer. Facet counts and deal-term rollups "
                "come from it, so this is reported rather than shown as zero results."
            ) from exc

        if body.get("error") != CONTINUE_WAIT:
            break
        log.info("cube_continue_wait", attempt=attempt + 1, measures=payload.get("measures"))
    else:
        raise CubeUnavailable(
            f"Cube kept asking to wait after {MAX_WAITS} attempts. The query is still building; "
            "this is reported rather than shown as zero results."
        )

    if "error" in body:
        log.warning("cube_query_error", error=str(body["error"])[:200])
        raise CubeUnavailable(f"Cube rejected the query: {str(body['error'])[:200]}")

    rows = body.get("data", [])
    log.info(
        "cube_query",
        measures=payload.get("measures"),
        dimensions=payload.get("dimensions"),
        filters=payload.get("filters"),
        row_count=len(rows),
        duration_ms=round((time.perf_counter() - started) * 1000, 1),
    )
    return list(rows)


def meta(timeout: float = 20.0) -> dict[str, Any]:
    """Cube's `/meta` — the vocabulary a selection may draw from.

    Read live rather than checked in: a copy would drift from `cube/model/*.yml` silently,
    and the eval grades against exactly this list. A catalog that disagrees with the models
    turns every selection failure into an unfalsifiable argument about which list was right.
    """
    started = time.perf_counter()
    try:
        response = httpx.get(f"{settings.cube_api_url}/meta", timeout=timeout)
        response.raise_for_status()
        body: dict[str, Any] = response.json()
    except Exception as exc:
        log.warning("cube_meta_failed", error=type(exc).__name__)
        raise CubeUnavailable(
            "The semantic layer (Cube) did not return its metadata, so the set of measures "
            "the agent may select from is unknown. Reported rather than shown as empty."
        ) from exc

    log.info(
        "cube_meta",
        cubes=len(body.get("cubes", [])),
        duration_ms=round((time.perf_counter() - started) * 1000, 1),
    )
    return body
