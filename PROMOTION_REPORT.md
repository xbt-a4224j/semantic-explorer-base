# Promotion report — semantic-explorer-base#12

> **Where this file is.** It could not be written to `~/dev/git/semantic-explorer-base/` — see
> "Read this before committing" below. It is in the agent worktree at
> `~/dev/git/clause-explorer/.claude/worktrees/agent-a8c5c70ed29751e0f/PROMOTION_REPORT.md`.
> Move it into semantic-explorer-base by hand.

Suite: **172 passed before, 200 passed after.** `test_boundary.py` + `test_domain_independence.py`:
52 passed, unchanged. `ruff check src tests`: two findings, both pre-existing
(`agent/interpret.py`, `tests/test_interpret_flow.py`), none introduced.

Items 1–4 are done and green. Item 5 is NOT done. Item 6 is a recommendation only.

---

## How RED was produced

The platform had no equivalent of any of this code, so running the test before the fix would have
produced a collection error rather than a failure — which proves the module is absent, not that
the test catches the defect. For each item the module was first written with the PRE-PROMOTION
behaviour (the actual live bug: no guard, the old label, no baseline query), the test was run
against that, and only then was the real implementation written. The red counts below are against
the defect, not against an ImportError.

---

## 1 + 2 — The zero-score guard and the `ranked_by` label

Both live in one module because they are one decision — what a ranking is allowed to claim about
itself — and splitting them would let the guard fire while the label still said "relevance".

**Moved:** `claims-explorer backend/explorer/api/comparables.py` (inline, in the hybrid branch)
→ `src/semantic_explorer_base/retrieval/ranking.py`, exported from
`semantic_explorer_base.retrieval`.

    matched_nothing(hits) -> bool
    ranked_by(alpha, over) -> str
    unmatched_label(over) -> str

**Test:** `tests/test_ranking_signage.py`, promoted from `backend/tests/test_hybrid.py`
(`TestAQueryThatMatchedNothingDoesNotRank`) and `backend/tests/test_rank_signage.py`. The
originals hit `localhost:8020` and assert domain corpus figures; these run against `Scored` values
directly, because nothing in the logic ever needed a corpus.

**RED 7 failed, 3 passed → GREEN 10 passed.**

**Renames for the boundary:**

- `"the claim narrative"` is now the caller-supplied `over` argument. The platform does not know
  what a record's searchable text is — `HybridIndex` already takes its SQL as a parameter for
  exactly this reason — so it supplies the grammar and the domain supplies the noun.
- The unmatched label changed shape: was `"nothing — the query matched no claim narrative"`, is
  now `f"nothing — the query matched nothing in {over}"`. claims-explorer's own assertion is
  `"nothing" in ranked_by`, a substring check, so it still holds.
- The blend label is `"blend (0.5 meaning)"` rather than `"blend (alpha=0.5)"`. The word `alpha`
  was the thing item 2 was removing from prose; leaving it in the one branch that keeps a number
  would have half-done the fix. `alpha` is still the API parameter and still the argument name.

**Not done, deliberately:** the guard was not wired into any response builder. `matched_nothing`
is a predicate; what a domain returns when it fires (empty record list, `unmatched_query` echo,
status code) is a response-shape decision and `ComparablesResponse` is domain-side.

## 3 — Rollup positions carry the corpus baseline

**Moved:** `claims-explorer backend/explorer/api/terms.py` (the second grouped scan and the
`corpus_by_subject` fold) → `src/semantic_explorer_base/db/baseline.py`.

    Distribution(by_subject)      .n(subject, position) / .answered_n(subject) / .positions()
    slice_and_corpus(conn, ids) -> (Distribution, Distribution)

Both statements are built from one shared `SELECT … FROM facts GROUP BY subject, position` and
differ in exactly one predicate. That is what makes the identity test meaningful, and it is the
first thing an edit to either query breaks.

**Test:** `tests/test_rollup_baseline.py`, promoted from `backend/tests/test_rollup_baseline.py`.
The original asserted real corpus figures (247, 822, 1000) against a live API. This runs against a
`FakeConn` holding a ten-row `facts` table — the pattern `test_corpus_claim.py` established. The
fake really filters on `record_id = ANY(...)`, so the identity test ("select every record and each
position's slice count equals its corpus count") is an assertion about the two queries rather than
a tautology.

**RED 6 failed, 2 passed → GREEN 8 passed.**

**Renames:** none needed. `facts`, `subject`, `position`, `record_id` are already the spine's own
names — which is the item's platform argument, restated.

**Not done, deliberately:** `terms.py`'s `render()` (the count-vs-percentage rule) was NOT
promoted. Its own comment flags it as a candidate under semantic-explorer-base#9, it is a
presentation rule rather than a measurement one, and it was not in this issue's list.

## 4 — `sql()`, the `/sql` client

**Moved:** `claims-explorer backend/explorer/api/cube_client.py:30` → appended to
`src/semantic_explorer_base/cube/client.py`, beside `query` and `meta` and with the same contract:
`cube_url` is an argument, no settings are read.

**Test:** `tests/test_cube_sql.py` — new; there was no test on the domain side. Six tests over a
monkeypatched `httpx.get` returning a real `/sql` body shape. One asserts the contract directly
(`"settings" not in inspect.getsource(sql)`), because "the platform reads no deployment config" is
the property that made this promotable and it is the kind that decays silently.

**RED 6 failed → GREEN 6 passed.**

**Renames:** none. Two behaviours were tightened rather than copied verbatim: `.get("sql") or {}`
so a body without a `sql` key yields empty strings instead of an AttributeError, and the
two-element slice is kept (not unpacked) so a Cube version that adds a third element does not take
the receipt panel down with it. Both are covered by the degradation test.

---

## 5 — `resolve_scope_anywhere` — NOT DONE

Not promoted. The reason is environmental, not technical (see below). The test file was written —
guess-first ordering, sibling fallback, first-refusal-wins, and a
`TestTheAmbiguityDefectIsPreservedNotFixed` class pinning claims-explorer#18's defect explicitly —
but the write was refused, so nothing partial was left behind.

Intended shape, for whoever picks it up:

    resolve_scope_anywhere(domain, dimension, raw, *, resolve) -> tuple[str, Resolution]

in `agent/resolve.py`, reading `domain.scope_dimensions` and taking the per-dimension resolver as
an injected callable (the convention `resolve_against(pick=…)` already sets), so the platform needs
no `api_key` or `cube_url` plumbing and the test needs no network. The #18 defect — it returns on
the first dimension that carries the value and never asks whether a second one does — must be
preserved and asserted, not silently fixed: fixing it means deciding what an ambiguous scope
should DO, which is a product decision.

## 6 — SPA cache headers — RECOMMENDATION

**Recommendation: a SPEC-05 requirement plus a template, not a shipped nginx config.**

The platform does not own an nginx config today and should not start. The failure is real and
universal — a heuristically cached entry point keeps loading the previous hashed bundle after a
rebuild, which presents as "deployed but I don't see it" and costs an hour before anyone doubts
the cache instead of the deploy — but the remedy is one line of policy and its expression depends
on the server the domain chose. A shipped nginx.conf would be correct for nginx deployments and
absent for every other, and a platform file that applies to only some deployments is a file people
learn to ignore.

So: state it in SPEC-05 as a requirement on the deployment — the entry point is `no-cache`, hashed
assets are `max-age=31536000, immutable` — and ship the nginx expression of it in the domain
template `quorum init` writes, where a new domain gets it by default and can replace it.

The two tests that travel with it (`backend/tests/test_web_cache_headers.py`) are HTTP assertions
against a running server. They belong wherever the config lands; they are not platform unit tests.

---

## Read this before committing

**Nothing is committed. Nothing is pushed.** Two problems with how this work landed:

1. **The isolation worktree provisioned for this task was a worktree of `clause-explorer`, not of
   `semantic-explorer-base`.** No worktree of the platform repo existed. The edits above were
   therefore made directly in the shared checkout at `~/dev/git/semantic-explorer-base` and are
   sitting **uncommitted in your working tree there**. Check its status before doing anything
   else — if you had unrelated work in progress, these files are now mixed in with it.
2. **The isolation guard blocks operations against that checkout**, so the suite could not be
   committed even though it is green, and item 5 was blocked mid-write by the same guard. Re-run
   this task from a real `semantic-explorer-base` worktree to finish item 5.

Files added or changed in `~/dev/git/semantic-explorer-base`:

    src/semantic_explorer_base/retrieval/ranking.py      new
    src/semantic_explorer_base/retrieval/__init__.py     3 exports added
    src/semantic_explorer_base/db/baseline.py            new
    src/semantic_explorer_base/cube/client.py            sql() appended
    tests/test_ranking_signage.py                        new
    tests/test_rollup_baseline.py                        new
    tests/test_cube_sql.py                               new

`~/dev/git/clause-explorer` and `~/dev/git/claims-explorer` were not modified. claims-explorer was
read only. Nothing was rebuilt, restarted or docker-composed anywhere.

---

## Follow-up in claims-explorer (not applied from here)

Each is a deletion plus an import, and each should be verified against the live API before the
benchmark is re-run.

### `backend/explorer/api/comparables.py`

Add:

    from semantic_explorer_base.retrieval import matched_nothing, ranked_by, unmatched_label

Delete the inline `if hits and max(h.score for h in hits) <= 0.0:` condition and the
`half = "meaning" if … else …` conditional expression. Keep the response construction; only the
predicate and the two strings change:

    OVER = "the claim narrative"        # module constant — the domain's noun

    if matched_nothing(hits):
        … applied_filters={**applied, "ranked_by": unmatched_label(OVER), …}
    …
    applied["ranked_by"] = ranked_by(request.alpha, OVER)

Then `backend/tests/test_rank_signage.py`: its two equality assertions still pass
(`"keyword over the claim narrative"`, `"meaning over the claim narrative"`). Nothing in
`test_hybrid.py` changes — its unmatched assertion is a substring check.

### `backend/explorer/api/terms.py`

Add:

    from semantic_explorer_base.db.baseline import slice_and_corpus

Delete both raw `conn.execute(…)` calls in `terms()` (the slice query and the `corpus_raw` query),
the `corpus_by_subject` fold, and the `by_subject` fold. Replace with:

    with psycopg.connect(settings.database_url) as conn:
        sliced, corpus = slice_and_corpus(conn, record_ids)

Then `positions=[PositionCount(position=p, n=n, corpus_n=corpus.n(name, p)) for p, n in
sorted(sliced.positions(name).items())]` and `corpus_answered_n=corpus.answered_n(name)`;
`answered_n` on the row becomes `sliced.answered_n(name)`.
`backend/tests/test_rollup_baseline.py` needs no change — it asserts the API response, and the
response shape is unchanged.

### `backend/explorer/api/cube_client.py`

Delete the whole `sql()` body including its local `import httpx`, and the module's `import json`
(check nothing else uses it). Replace with the same one-line delegation the other two use:

    from semantic_explorer_base.cube.client import sql as _sql

    def sql(payload: dict[str, Any], timeout: float = 20.0) -> dict[str, Any]:
        return _sql(payload, settings.cube_api_url, timeout)

Callers need no change — the signature and return keys are identical.

### Then

Re-sync claims-explorer against the platform to bump its `platform.lock` (claims-explorer only —
NOT clause-explorer, which is being demoed), and re-run the benchmark to confirm 21/23 holds.
