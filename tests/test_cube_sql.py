"""`/sql` — the statement a selection compiles to, without running it.

Promoted from the reference application (#12, item 4), whose own docstring said why it was
sitting in a domain repo: *"Not in the platform's client because nothing there needed it."* That
is a statement about which domain got built first, not about where the code belongs. `/meta` and
`/load` are already here; `/sql` is the third endpoint of the same API and knows nothing about
any corpus. Any domain that wants to show a reader the query behind an answer needs it.

The shape of the return value carries the argument: the statement and its bound parameters come
back SEPARATELY. A receipt panel that displayed a single interpolated string would be showing the
reader something the warehouse never ran, and would quietly teach whoever maintains it that
concatenating filter values into SQL is how this works.
"""

from __future__ import annotations

from typing import Any

import pytest

from semantic_explorer_base.cube import client

CUBE = "http://cube:4000/cubejs-api/v1"

#: A real `/sql` body, trimmed. Cube nests the payload under "sql" and puts the statement and its
#: parameters in a two-element list — an interface worth pinning in a test, because it is the
#: kind of shape that changes across versions and fails by returning None rather than by raising.
BODY = {
    "sql": {
        "sql": [
            "SELECT count(*) FROM records WHERE category_code = $1",
            ["HC"],
        ],
        "cacheKeyQueries": [["SELECT MAX(updated_at) FROM facts", [], {}]],
    }
}


class FakeResponse:
    def __init__(self, body: dict[str, Any]) -> None:
        self._body = body
        self.raised = False

    def raise_for_status(self) -> None:
        self.raised = True

    def json(self) -> dict[str, Any]:
        return self._body


@pytest.fixture
def captured(monkeypatch: pytest.MonkeyPatch) -> dict[str, Any]:
    seen: dict[str, Any] = {}
    body: dict[str, Any] = dict(BODY)

    def fake_get(url: str, params: dict[str, Any] | None = None, timeout: float = 0) -> Any:
        seen["url"] = url
        seen["params"] = params
        return FakeResponse(seen.get("body", body))

    monkeypatch.setattr(client.httpx, "get", fake_get)
    return seen


def test_it_asks_the_sql_endpoint_of_the_configured_cube(captured: dict[str, Any]) -> None:
    client.sql({"measures": ["records.n"]}, CUBE)
    assert captured["url"] == f"{CUBE}/sql"


def test_the_selection_travels_as_a_json_query_parameter(captured: dict[str, Any]) -> None:
    import json

    client.sql({"measures": ["records.n"]}, CUBE)
    assert json.loads(captured["params"]["query"]) == {"measures": ["records.n"]}


def test_the_statement_and_its_bound_parameters_come_back_separately(
    captured: dict[str, Any],
) -> None:
    """The injection argument, made visible in the return shape rather than in a comment."""
    out = client.sql({}, CUBE)
    assert out["sql"] == "SELECT count(*) FROM records WHERE category_code = $1"
    assert out["params"] == ["HC"]
    assert "HC" not in out["sql"]


def test_the_freshness_probes_come_back_as_statements(captured: dict[str, Any]) -> None:
    """`cacheKeyQueries` are the MAX(updated_at) probes that decide whether a cached answer is
    still current. A receipt that omits them describes how the answer WOULD be computed and not
    what actually decided to serve it."""
    assert client.sql({}, CUBE)["cache_key_queries"] == ["SELECT MAX(updated_at) FROM facts"]


def test_a_body_with_no_sql_in_it_yields_empty_strings_rather_than_a_traceback(
    captured: dict[str, Any],
) -> None:
    """Cube answers 200 with a body shaped differently on some errors. A receipt panel is a
    secondary surface: it must degrade to showing nothing, never take the answer down with it."""
    captured["body"] = {}
    out = client.sql({}, CUBE)
    assert out == {"sql": "", "params": [], "cache_key_queries": []}


def test_it_never_reads_a_setting_of_its_own(captured: dict[str, Any]) -> None:
    """Same contract as `query` and `meta`: the URL is an argument. A platform module that read
    a deployment's environment would be undeployable twice on one machine."""
    import inspect

    source = inspect.getsource(client.sql)
    assert "settings" not in source
    assert "cube_url" in inspect.signature(client.sql).parameters
