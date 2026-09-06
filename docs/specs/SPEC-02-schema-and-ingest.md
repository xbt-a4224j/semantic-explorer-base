# SPEC-02 — Schema & Ingest

Produces: `db/domain.sql` (if needed) + real rows in `records`/`facts`/`categories`.
Depends on: [SPEC-01](SPEC-01-corpus-intake.md) — the grain decisions here assume `quorum.yaml`
already names `subject_axis`, `count_measure` and `record_count`.

## What is fixed, and what you decide

The schema spine — `records`, `facts`, `categories`, plus `corpus_claim` and the touch triggers
— is `quorum/db/spine.sql` in the platform. Nothing about it is a decision this spec asks you to
make. It applies before anything in this file, every statement `CREATE TABLE IF NOT EXISTS`, and
it is the same for every domain.

What you decide is narrower than it looks: **does this corpus have fields the spine doesn't
name, and if so, do they earn a real column or land in `records.attributes` JSONB?**

## The column-vs-JSONB test

Not "does this field matter" — everything you bothered to ingest matters. The actual test,
taken directly from the reference corpus's own `db/domain.sql`:

> **Does a query filter on this field TOGETHER with others, in a shape you already know?**

The reference corpus's nine enrichment fields (`deal_value_usd`, `signing_date`,
`acquirer_name`, …) could have gone in `attributes` and needed no file at all. They are columns
because the facet rail filters on three of them — category, size band, date — *together*, and a
composite index over three JSONB expressions is a worse answer than an index over three columns
once you already know the shape. That is a real, working index in the reference domain's file:

```sql
CREATE INDEX IF NOT EXISTS idx_records_facets ON records (category_code, deal_size_band, signing_date);
```

**If you have not yet decided your corpus's shape, skip this file.** `attributes` costs nothing
to add to later and a wrong column choice costs a migration. This is not a corner being cut —
the reference domain's own comment says exactly this: "a new domain that has not decided its
shape yet should use `attributes` and skip this file entirely."

## The shape of `db/domain.sql` itself

Every statement is `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, never `CREATE TABLE`. The table
already exists — it belongs to the platform's spine, applied first — and `quorum migrate` runs
this file second, every time, so re-running must be free.

```sql
-- Columns this corpus has that the spine does not name.
ALTER TABLE records ADD COLUMN IF NOT EXISTS <field> <type>;

-- One boolean per field that can be a classifier's output rather than an expert label. This is
-- not optional if such a field exists: presenting an inferred value as ground truth is the
-- discipline SPEC-00 names first, and the flag has to live in the schema to survive into the UI
-- rather than a code comment nobody reads at render time.
ALTER TABLE records ADD COLUMN IF NOT EXISTS is_inferred_<field> BOOLEAN NOT NULL DEFAULT FALSE;

-- Only if you actually filter on a combination of these together.
CREATE INDEX IF NOT EXISTS idx_records_<name> ON records (<col>, <col>, <col>);
```

## Writing the loader: your own parser, or the generic one

**Write your own parser** when the source format has structure a generic reader cannot guess —
nested documents, a format that isn't flat rows. The reference corpus does this: MAUD ships as
nested JSON of expert annotations per contract, and no generic reader could sensibly parse that
into `records`/`facts` rows without knowing MAUD's own schema.

**Use the generic loader** (`quorum.ingest.load_records`/`load_facts`) when the source is already
row-shaped — a CSV or JSON export. Declare it in `quorum.yaml`:

```yaml
ingest:
  records: {path: data/records.csv, format: csv, map: {id: <column>, source_title: <column>}}
  facts:   {path: data/facts.jsonl, format: jsonl, map: {record_id: <column>, subject: <column>,
                                                          position: <column>}}
```

**`format` is a decision, not a guess.** The platform used to sniff it from content; that code
is gone, on instruction, after it and a sibling column-name guesser both failed silently on
their own worked examples. Declare `csv`, `tsv`, `json`, or `jsonl` explicitly, and **verify the
declaration by reading real output** — run `quorum ingest`, then look at a few actual rows in
Postgres. A wrong format declaration for JSON-vs-JSONL does not silently mismap columns; it
either raises (a JSONL file declared `json` is invalid JSON, so `json.load` fails loudly) or
reads correctly. But a right format with a wrong column *mapping* fails silently — the row loads
with nulls where real data was — which is exactly why `map` is checked by looking, not assumed
from a clean `quorum ingest` exit code.

`map` follows the same rule as before: explicit, never inferred. A reader that guessed which
column identified a record would be wrong on some corpus silently, with no test to catch a
plausible-but-wrong guess.

## Two lessons from the reference corpus's own ingest issues

**Check which party a joined record actually names.** The reference corpus's EDGAR enrichment
(#9) originally resolved to the *filer's* CIK rather than the *target's* (#42) — the join was
correct, the field chosen from the joined record was not. If your ingest enriches one source
from another by a shared key, confirm which side of that join you actually want before trusting
the values, not after a downstream number looks wrong.

**Don't build a hierarchy you can't yet justify.** The reference corpus loaded a full ontology
(FOLIO, #6) for industry categories — parent/child concept relationships — then deleted it
entirely in favor of a flat crosswalk (#49), keeping only the property that mattered (a stable
*code*, not a display *label*, is what a filter joins on). If you're modeling a hierarchy,
name the query that needs the hierarchy specifically, before building it. "It seems like the
right shape for this kind of data" is exactly the reasoning that shipped and then had to be
un-shipped here.

## Idempotency, because ingest is re-run constantly

Every write is an upsert, and `updated_at` moves **only when something actually changed**:

```sql
ON CONFLICT (id) DO UPDATE SET <col> = EXCLUDED.<col>, ...
WHERE records.<col> IS DISTINCT FROM EXCLUDED.<col> OR ...
```

This is not a style preference. Cube's `refresh_key` reads `updated_at`; an unconditional touch
on every re-run makes every ingest look like new data arrived, which defeats the caching the
refresh_key exists to provide. The generic loader already does this — `load_records`/
`load_facts` in `quorum.ingest` — so a domain using it gets the property for free. A domain
writing its own parser has to earn it, and the reference domain's own test suite is the pattern
to copy: run every source twice, assert row counts are stable, assert `updated_at` does not
move on the second run, then make one real change and assert it does.

## Acceptance

- [ ] `quorum migrate` runs cleanly against an empty database.
- [ ] `quorum ingest` (or your own parser) loads real rows — check counts in Postgres directly,
      not just a clean exit code.
- [ ] Re-running loads the same row counts and does not move `updated_at` on any row that did
      not actually change.
- [ ] `corpus_claim` is stamped with the name from `quorum.yaml`'s `corpus:` field — pointing a
      second corpus's ingest at the same database refuses before writing anything (this is the
      platform's `claim_corpus`, not something this spec asks you to build).
- [ ] Every enrichment field that can be a classifier's output rather than an expert label has
      an `is_inferred_*` flag beside it in the schema.
- [ ] If you wrote `db/domain.sql`: every statement is `ADD COLUMN IF NOT EXISTS`, and you can
      name the query that justifies each composite index — not "it seemed useful."

## Known gaps

*(none yet)*
