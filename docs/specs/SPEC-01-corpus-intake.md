# SPEC-01 — Corpus Intake

Produces: `quorum.yaml` at the domain repo root.
Depends on: nothing. This is where the chain starts.
Read [SPEC-00](SPEC-00-master.md) first if you haven't.

## The one judgment call that matters most

Every other field in this file is naming. This one is architecture: **which Cube dimension is
the subject axis** — the thing nearly every question in this domain will be about.

On the reference corpus, pinning `subject_axis: deal_points.deal_point_name` took the app from
answering **0 of 20** real lawyer questions to **16 of 20** — the single largest measured
improvement in the project's history. Every one of the four question shapes downstream
(`distribution`, `median`, `count`, `coverage`) is built around this one axis being right.
Get it wrong and the symptom is every question declining, which reads as a broken model when it
is actually one line in this file.

**How to find it:** ask "if a person asked ten questions about this corpus, what noun would
most of those questions name?" On the reference corpus that is a deal point ("is there a
fiduciary out", "what's the tail period"). It is not `matters` — a matter is the record the
subject lives on, not the subject itself. If your corpus's answer is "the record itself, there
is no finer-grained subject," say so explicitly (see "Known gaps" below) rather than picking a
dimension that happens to exist.

## Fields, in the order a person actually decides them

```yaml
name: <application name>
corpus: <a slug, stable, never renamed once ingest has stamped it>

subject_axis: <cube>.<dimension>       # SEE ABOVE. Decide this first.
answer_dimension: <cube>.<dimension>   # how the subject's answer is recorded
count_measure: <cube>.<measure>        # count at the SUBJECT's own grain
record_count: <cube>.<measure>         # count at the RECORD's grain — see below
```

### The two grains, and why conflating them is the nastiest bug in this file

`count_measure` and `record_count` are **not interchangeable**, and the reference corpus proves
it expensively: `deal_points.n` (one row per answer) and `comparable_deals.n` (one row per
agreement) differ by **~89x** on the same filtered slice. A `min_n` gate reading the inflated
one let a slice of exactly one real agreement clear a threshold of five — the k-anonymity
control failing exactly where it exists to protect.

The test: **would grouping by the subject axis multiply this count?** If yes, it is
`count_measure`, not `record_count`. If your domain's subject and record happen to be the same
grain (no sub-record structure — one row is one answer is one record), `count_measure` and
`record_count` may be identical, and `Domain.validate()` will refuse that with a specific
message, because in every domain seen so far identical values meant a copy-paste rather than a
real design. If your domain is a genuine exception, that is worth stating in "Known gaps," not
routing around silently.

```yaml
count_measures:      # EVERY count measure the min_n gate should read, widest grain first
  - <record-grain measure>
  - <subject-grain measure>
  # add more if a third grain exists — see below
```

The reference corpus needed **four** entries, not two, because a third bug was hiding in the
same field: both Cube namespaces name their count measure `n`, so a single hardcoded key
silently disabled the gate on whichever namespace was NOT read — a slice of one came back
carrying named counterparty text with `refused: false`. List every count measure that could
possibly appear in a selection the gate has to check. Missing one is invisible until a thin
slice slips through, which is the worst time to find out.

```yaml
numeric_measures:    # percentile measures — median, p25, p75 — over the subject's numeric answers
  - <cube>.median_x
numeric_count: <cube>.<measure>   # THE denominator for those percentiles. See below.
```

### `numeric_count` is not optional if you have `numeric_measures`

`Domain.validate()` enforces this at load: declaring a percentile with no `numeric_count` is
rejected outright, because the failure mode is silent otherwise. On the reference corpus only
809 of 12,937 rows carry a parseable number — most subjects are categorical — so reporting a
median beside the subject's own row count claims a sample **sixteen times** larger than the one
it actually came from. This was hardcoded correctly in the original implementation and became a
visible requirement only when a second domain had to state it explicitly — which is exactly why
it is enforced in code now rather than left as a paragraph someone might skip.

```yaml
selectable:          # the ONLY cubes/views the agent may choose from
  - <cube>
excluded_measures:   # measures that exist in the model but must never be agent-selected
  - <measure>        # e.g. a mean kept beside a median for a dashboard to show divergence
```

`excluded_measures` exists because deleting the measure from the Cube model is the wrong fix
when a dashboard still legitimately wants it — the agent should never see it; a human reading a
chart still might.

```yaml
strings:
  record: <singular noun for one row of the corpus>          # "agreement"
  records: <plural>                                          # "agreements"
  subject: <singular noun for the subject axis>               # "deal point"
  subject_title: <slightly more formal form>                  # "ABA deal point"
  subject_heading: <all-caps, for a prompt section header>     # "DEAL POINT"
  colloquial: <how a USER says "records" in conversation>      # "deals"
  corpus_description: <one phrase, what this corpus IS>        # "public-target merger agreements"
  terms_of_art:        # phrases that name exactly one subject value — worth real accuracy
    - <term>
  absent:              # what this corpus does NOT hold, as full phrases (see below)
    - <full phrase, e.g. "no fee amounts">
  scope_reason: >-
    <why an unscoped percentile is refused, in THIS corpus's own units>
  analyst: <who is asking — "a lawyer", "a claims analyst">
```

**These are not the frontend's words.** `strings.ts` (SPEC-05) is a much larger set covering UI
labels, tab copy, and rendered prose. This block is smaller and narrower: it exists only to fill
in the selection prompt's nouns, and `tests/test_prompt.py` in the platform pins the assembled
result byte-for-byte against the string that was benchmarked at 20/27. Get one of these words
wrong and you have changed the prompt — which is code here — without re-running the benchmark
that measures it.

Two traps already hit writing this block for the reference corpus, worth naming so the next
domain does not repeat them:

- **`colloquial` is deliberately separate from `records`.** A user says "deals"; the shape
  definitions in the prompt describe what is counted, "agreements." Collapsing the two puts the
  wrong noun into half the prompt's example phrasings, silently, because both read as plausible
  English.
- **`absent` items need full phrases, not bare nouns**, because the benchmarked prompt text
  repeats the word "no" before each one — `"no deal values in dollars"`, not `"deal values in
  dollars"`. A bare noun there doubles the "no" and reads wrong to the model in a way no test
  caught until someone read the assembled prompt end to end.

```yaml
max_clause_chars: <int>    # above this, a source span is shown as an excerpt, not the full text
excerpt_chars: <int>       # how much of an excerpt is shown
```

Facts about this corpus's *documents*, not this *deployment* — they do not belong beside a
database URL, and they are not env-overridable, because they are the same on every machine. On
the reference corpus these are derived from a real measurement (median span 4,658 characters,
90th percentile 238,949) — not guessed. If you do not yet have that measurement, leave these at
their defaults (0 disables excerpting) rather than pick a number that feels right; a wrong
threshold here produces a specific, embarrassing failure — a labelled answer rendered as "the
clause" that is actually the whole document, which reads as a wrong answer that looks correct.

```yaml
ingest:
  records: {path: <glob>, map: {id: <column>, source_title: <column>}}
  facts:   {path: <glob>, map: {record_id: <column>, subject: <column>, position: <column>}}
```

Only for a domain with no parser of its own — see SPEC-02. Column names map explicitly, never
inferred by pattern: a reader that guessed which column identified a record would be wrong on
some corpus, silently, and no test anyone writes catches a wrong-but-plausible guess.

## Worked example: the reference corpus's actual manifest

```yaml
name: Clause Explorer
corpus: maud-public-target-merger-agreements
subject_axis: deal_points.deal_point_name
answer_dimension: deal_points.position
count_measure: deal_points.n
record_count: comparable_deals.n
count_measures:
  - comparable_deals.n
  - deal_points.count_distinct_matters
  - deal_points.n
  - deal_points.numeric_n
numeric_measures:
  - deal_points.median_numeric_value
  - deal_points.p25_numeric_value
  - deal_points.p75_numeric_value
numeric_count: deal_points.numeric_n
selectable: [comparable_deals, deal_points]
excluded_measures: [deal_points.mean_numeric_value_do_not_use_for_market]
strings:
  record: agreement
  records: agreements
  subject: deal point
  subject_title: ABA deal point
  subject_heading: DEAL POINT
  colloquial: deals
  corpus_description: public-target merger agreements
  terms_of_art: [no-shop, fiduciary out, MAE carve-out, bringdown, tail period]
  absent: ["no deal values in dollars", "no fee amounts", "no adviser names"]
  scope_reason: >-
    it averages a column that holds several units at once — tail periods in months,
    matching-rights periods in business days, ownership thresholds in percent — so an unscoped
    percentile mixes them into a number with no unit
max_clause_chars: 6000
excerpt_chars: 1200
```

(The full committed file also carries `rollup_tab` and the reason-comments above each field;
see `~/dev/git/clause-explorer/quorum.yaml` directly rather than trust a copy pasted here.)

## Acceptance

- [ ] `quorum check` (offline half — no Cube needed) passes: every required field present,
      `subject_axis != answer_dimension`, `count_measure != record_count`, and
      `numeric_count` present whenever `numeric_measures` is non-empty.
- [ ] You can state, in one sentence, what a person would ask this corpus ten questions about,
      and `subject_axis` names that thing.
- [ ] Every `strings` field is filled with this corpus's own word, not a platform placeholder —
      grep the file for the word "TODO" or a bracketed `<...>` and find nothing.
- [ ] **Validation for real**, deferred to SPEC-06 (not yet written): once SPEC-03's Cube model
      exists, `quorum check`'s online half must also pass — every member this file names must
      exist in the live model, and `subject_axis` must be declared `closed_vocabulary: true`.
      This spec's acceptance is necessary, not sufficient; SPEC-03 closes the loop.

## Known gaps

Space for the next domain to record where this spec's guidance did not fit cleanly — a corpus
with no finer subject than the record itself, a third grain the four-entry `count_measures`
pattern did not anticipate, a `strings` field that has no natural answer. Add a dated entry
below rather than silently picking something plausible in the domain repo.

*(none yet)*
