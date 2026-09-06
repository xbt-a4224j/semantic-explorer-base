# SPEC-03 — Cube Metadata

Produces: `cube/model/*.yml`.
Depends on: [SPEC-01](SPEC-01-corpus-intake.md) (the members you write here must match what
`quorum.yaml` names) and [SPEC-02](SPEC-02-schema-and-ingest.md) (you're writing SQL against
columns that have to already exist in Postgres).

## This file is an API, not a schema

The agent reads these names live from `/meta` and selects from them; the eval harness uses them
as its label space. **Renaming a measure breaks eval fixtures the same way renaming an endpoint
breaks callers.** Add a new one, deprecate an old one — do not quietly rename, and do not write
`description` for a human browsing a data dictionary. The agent is the reader: say what the
measure counts, what its denominator is, and when *not* to use it, because that sentence is the
only thing standing between a right question and a plausible wrong answer.

## One cube per grain, at minimum

You already named these grains in SPEC-01. Now define them:

- one cube at the **subject's own grain** (`subject_axis`, `answer_dimension`, `count_measure`
  live here) — the reference corpus's `deal_points` cube, one row per (record, subject) pair
- one cube or view at the **record's grain** (`record_count` lives here)

```yaml
cubes:
  - name: <subject-grain cube>
    sql_table: public.facts
    description: >-
      One row per <record> per <subject>. The grain for every "what was negotiated / found /
      answered" question. Filter by <subject dimension> first — an unfiltered count mixes every
      subject together and means nothing.

    # Explicit, on every cube, never Cube's default. Measured end to end on the reference
    # corpus: query, INSERT directly into Postgres, poll with nothing restarted — new data
    # appeared within ~11 seconds. Ingest is careful never to bump updated_at on a row whose
    # content did not change, so a no-op re-ingest invalidates nothing.
    refresh_key:
      sql: SELECT MAX(updated_at) FROM public.facts

    dimensions:
      - name: <subject_axis's name>
        sql: subject          # the physical column is the platform's generic name — see below
        type: string
        description: >-
          <what this axis IS, an example value, how many distinct values, and the ALWAYS-FILTER
          warning: an unfiltered count over this dimension is a total across every subject at
          once, not a sample size for any one of them>
        meta:
          # Required. Without it, filter-value resolution (SPEC-04) has nothing to resolve a
          # user's phrase against, and a near-miss returns zero rows that read as "there is
          # nothing like that" rather than "you named something we do not carry".
          closed_vocabulary: true
```

**The member name and the physical column are allowed to differ, deliberately.** The reference
corpus's dimension is named `deal_point_name` — legal vocabulary, what a reader selects on — but
its `sql:` points at the generic `subject` column the platform's schema actually has. That gap
is the indirection working: the Cube layer speaks this domain's words, the table underneath
speaks the platform's, and neither has to compromise for the other.

## Percentiles: three rules, each one already broken once

**There is no `type: median` in Cube, and `type: avg` is not a substitute — it is the single
most dangerous measure that could sit in this file.** It returns a number of the right
magnitude, in the right units, that is simply the wrong statistic. Measured on the reference
corpus, one subject's numeric answers have mean 2.54 and median 2.0 — a reader quoting "about
2.5 is typical" is quoting an artefact of the tail, not what most records actually show. Use
`PERCENTILE_CONT`:

```yaml
      - name: median_<x>
        type: number
        sql: "PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY {CUBE}.numeric_value)"
        description: >-
          Median. Use this, never an average. Filter by <subject dimension> first or this mixes
          every subject's units into one meaningless number. Report with <numeric_n below>.
```

**The percentile's denominator is its own measure, never the subject's overall count.** Only
answers that carry a parseable number are in a percentile's sample — 809 of 12,937 rows
corpus-wide on the reference corpus, because most subjects are categorical. This is
`numeric_count` from SPEC-01, and it has to be a real Cube measure, not a reused one:

```yaml
      - name: numeric_n
        type: count
        filters:
          - sql: "{CUBE}.numeric_value IS NOT NULL"
        description: THE DENOMINATOR FOR EVERY PERCENTILE ABOVE. Never report one without it.
```

**Numerator and denominator are always separate measures**, never a pre-divided ratio. The UI
has to be able to render "6 of 8"; a ratio measure forces "75%", which claims a precision an n
of 8 does not support (the discipline SPEC-00 names first — counts below threshold, percentages
above):

```yaml
      - name: n                # THE DENOMINATOR
        type: count
      - name: present_count     # THE NUMERATOR for "how many have this at all"
        type: count
        filters:
          - sql: "{CUBE}.position NOT IN ('None', 'No', 'N/A')"
```

## A measure that exists but must never be selected

Sometimes a dashboard legitimately wants the mean beside the median, to show a reader the two
diverge. Do not delete it; name it so its own title argues against selecting it, and list it in
`quorum.yaml`'s `excluded_measures` so the agent never can:

```yaml
      - name: mean_numeric_value_do_not_use_for_market
        title: "Mean (do not quote as market)"
        type: avg
```

## Never `count_distinct_approx`

HyperLogLog is approximate, and this platform's whole claim is defensible numbers. The reference
repo has a real test enforcing this — `test_no_count_distinct_approx_anywhere_in_the_model`,
grepping every `cube/model/*.yml` for the string — and it is worth copying verbatim into a new
domain's own test suite, not just remembering as a rule.

## Views: a curated join, when the agent's natural query already is one

A `views:` block pre-joins across cubes and names exactly which members to expose, with
`includes:`. Reach for one when a question naturally spans two cubes — the reference corpus's
`comparable_deals` view joins the record-grain cube to its category, so "healthcare deals" is
one selection rather than the agent having to reconstruct the join itself:

```yaml
views:
  - name: <record-grain view>
    description: The Explore surface's query source. Agents should prefer this over the raw
      cubes — it is the curated selection.
    cubes:
      - join_path: <subject-grain cube's own record dimension>
        includes: [id, <enrichment fields>, n]
      - join_path: <record cube>.<category cube>
        includes: [code, label]
```

## No pre-aggregations, until you have measured a slow query

The reference corpus — 152 records, 12,937 facts — answers every question in milliseconds
directly from Postgres. A pre-aggregation adds a build step, turns a sub-second refresh window
into one measured in minutes, and adds a second place for a number to be wrong, for no
measurable gain at that scale. Do not add one speculatively. If a query is ever actually slow,
measure it and record the evidence before reaching for this — the same discipline as SPEC-02's
warning against building a hierarchy you can't yet justify.

## Acceptance

- [ ] `quorum check`'s online half passes: every member `quorum.yaml` names —
      `subject_axis`, `answer_dimension`, `count_measure`, `record_count`, every entry in
      `count_measures` and `numeric_measures`, `numeric_count`, every `selectable` cube — exists
      in live `/meta`.
- [ ] `subject_axis` carries `meta: {closed_vocabulary: true}`. `quorum check` fails this
      specifically, separately from mere existence, because it is a behavioural gap invisible
      to a name-matching check.
- [ ] A grep for `count_distinct_approx` across `cube/model/*.yml` finds nothing — ideally
      enforced by a copied test, not just a one-time check.
- [ ] Every percentile measure has a paired `_n` (or equivalently named) denominator measure,
      and that measure — not the subject's own count — is what `quorum.yaml` names as
      `numeric_count`.
- [ ] You can point at one real query and its measured latency before adding any
      pre-aggregation; "none yet, corpus is small" is a valid, honest answer.

## Known gaps

*(none yet)*
