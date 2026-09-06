# SPEC-04 — Facets & Filter-Value Resolution

Produces: the facet-rail endpoint, and every `closed_vocabulary` dimension wired through the
platform's resolution ladder.
Depends on: [SPEC-01](SPEC-01-corpus-intake.md), [SPEC-03](SPEC-03-cube-metadata.md) — this spec
consumes `closed_vocabulary` declarations SPEC-03 wrote and cannot start before they exist.

## What the platform already gives you

Filter *value* resolution — the two-tier ladder, exact then a constrained model choice — is
already a platform primitive: `quorum.agent.resolve.resolve_against` and
`quorum.agent.pick_value.pick_value`. It is already domain-free and already measured: on 16
terms of art against 92 subject values, the pick tier scored **14/16 with zero false
positives**; an embedding-similarity tier scored 12/16 with **one outright wrong match**. The
embedding tier is not kept as a fallback — a second, undocumented behaviour that fires only when
a key is missing and silently scores worse is worse than not having it.

**What this spec asks you to build is not the ladder. It is applying the ladder to every
dimension that needs it, and the facet rail that surfaces those dimensions to a user.** Read as:
the mechanism exists; the wiring and the UI do not, yet, on the platform side.

## The bug this spec exists to close for good

Measured live against the reference application, after its first model-facing release:

```
$ curl -s -X POST localhost:8000/agent/ask -d '{"question":"all cash healthcare deals..."}'
  comparable_deals.consideration_type   raw='cash'  ->  'cash'  via verbatim
```

The corpus held `All Cash`. The model wrote `cash`. Resolution had been wired for exactly one
dimension (industry); every other closed-vocabulary dimension passed the model's raw text
straight to Cube **unresolved and unvalidated**. Cube accepted it, Postgres matched nothing, and
the user got an empty result reading as "we have no comparable deals" rather than "you asked for
a value that does not exist."

The fix that generalizes, and the whole point of this spec: **iterate `/meta` for every
dimension carrying `closed_vocabulary: true`, and route every one of them through
`resolve_against` before a selection reaches Cube.** Not one hardcoded dimension with everything
else passing verbatim. **No value is ever passed through unresolved.** Either it resolves, or
the selection is blocked and the near-misses are listed — `method: "verbatim"` should not exist
in a response.

## A known gap in the reference implementation itself

The reference domain's own `resolve_filter_value.py` predates the platform's measurement and
still runs the **older, worse-performing** ladder — exact, then embedding-nearest — with a real
documented false positive in its own comments (`'not a real industry at all'` resolved to `Real
Estate, Rental and Leasing` at a similarity of 0.493). It has not yet been migrated onto
`resolve_against`/`pick_value`. **Do not copy that file as the worked example for this spec.**
Use the platform's `resolve_against` directly; it is the version that measured better, and the
reference domain migrating onto it is tracked, not done.

## Non-text dimensions: reject, don't coerce

A boolean-shaped dimension accepts only recognizable true/false forms and rejects anything else
with the reason — never silently coerces `"y"` or `"1"` into a guess. A numeric or date
dimension is parsed and rejected loudly on a parse failure, never passed through as text that
happens to look right. The principle is the same one driving the rest of this spec: a wrong
value that *looks* like it might have worked is worse than one that visibly failed.

## The facet rail

One group per filterable dimension: every distinct value the corpus carries, each with its own
count. Two properties, both non-negotiable:

**A null value is its own facet value, never hidden and never invented.** The reference corpus
renders it `unclassified` — a real bucket with a real count, not silently dropped from the rail
and not assigned a fabricated category. Treat `unclassified`/`unknown` values as **uninformative
for any total or ranking**, while still rendering the bucket's own count honestly. A real bug
this distinction fixed: a facet group's `total_n` summed every bucket *including*
`unclassified`, so one dimension reported `n=152` — the whole corpus — directly above prose
saying nothing on that dimension was filterable, because all 152 records sat in the
unclassified bucket. The total and the prose were each correct on their own terms and
contradicted each other, because "how many records" and "how many records have a real value
here" are different questions one number was being asked to answer.

**Each group's counts are narrowed by every OTHER selected filter, never by itself.** Standard
faceted search: selecting "Health Care" under Industry must not make the Industry facet's own
counts collapse to just that value — a reader needs to see what else they *could* pick. Every
other facet group, though, narrows by the Industry selection, because that's what "filtering"
means.

## Facet counts are not gated by `min_n`

This is a real, deliberate asymmetry, not an oversight: a facet count of 1 is shown as 1, not
suppressed. The count itself already carries its own denominator — `n=1` is not ambiguous about
its sample size the way a *characterization* of that slice would be. `min_n` gates the rollup
you'd get by **selecting** that facet value and asking a question about it; it does not gate the
navigational fact "one record in this corpus has this value." Suppressing facet counts below
threshold would make the rail lie about what the corpus contains, which is a worse failure than
a small number being visible.

## Acceptance

- [ ] Every dimension marked `closed_vocabulary: true` in the Cube model is resolved through
      `resolve_against` before reaching a selection — checked by grep, not by memory: search the
      selection/filter path for anywhere a value is used without having passed through
      resolution first.
- [ ] `method: "verbatim"` does not appear anywhere in a resolved filter's response for a
      closed-vocabulary dimension. Either resolved or blocked with candidates.
- [ ] The regression case from the bug that motivated this spec has a named test: a phrase that
      is a real near-miss for a real value (not the exact string) resolves correctly or blocks —
      it never silently reaches Cube unresolved.
- [ ] One test per dimension *kind*: a value that resolves exactly, one that resolves via the
      pick tier, one that resolves to nothing and blocks with the candidate list attached.
- [ ] The facet rail renders a null value as its own named bucket with a real count, and that
      bucket is excluded from any "largest value" or ranking logic elsewhere on the page.
- [ ] Selecting a value under one facet group does not change that same group's own counts —
      only every other group's.

## Known gaps

- The reference domain's own filter-value resolution has not yet migrated from its
  embedding-based ladder onto the platform's measured-better `resolve_against`. Anyone
  completing that migration should update this section rather than leave the gap implicit.

*(add more below as they're found)*
