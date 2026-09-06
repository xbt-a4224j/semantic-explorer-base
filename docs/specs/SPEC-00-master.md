# SPEC-00 — Master: how a domain gets built on quorum

Read this first, every time. It contains no domain judgment of its own — it sequences the
specs that do, and states the discipline all of them inherit.

## Who this is for

An agent (or a human) standing up a new domain on the platform: `claims-explorer` on
health-claims data, or any future one. Each spec below asks you to make a judgment call the
platform cannot make for you — which column is the record id, which measures matter, which
words a reader sees — and each spec names what "done" means before you move to the next.

This replaced a version of `quorum init` that guessed those calls with column-name regexes.
The regex failed on its own worked example (`citation_id` didn't match `_id$` under
`re.match`), silently, with no error — a manifest with a missing file and nobody told. A
judgment call needs judgment, not a pattern list that runs out.

## The reference example

Every spec below points at **clause-explorer** (`~/dev/git/clause-explorer`) — 152 public-target
merger agreements, MAUD-labelled, 92 ABA deal points. Not because merger agreements are special,
but because it is the one domain that has already been built, argued about, and fixed in public.
Its issue tracker is 64 issues of exactly the judgment calls this spec chain exists to guide:

- **#8** parsed MAUD into `matters` + `deal_points`, long not wide — the shape decision SPEC-02
  is built around.
- **#9**, **#42** enriched from EDGAR and then found the enrichment was reading the wrong
  company's filing — the CIK of the filer, not the target. A fact worth stating even though the
  fix is domain-specific: *check which party a joined record actually names.*
- **#6**, **#49** loaded a full ontology (FOLIO) for industry categories, then deleted it in
  favor of a flat crosswalk — the ontology added a hierarchy nothing used and a categorization
  the corpus didn't need. SPEC-02's warning against modeling structure you can't yet justify is
  this issue, not a hypothetical.
- **#23**, **#25**, **#55** are k-anonymity, filter-value resolution, and the still-open ticket
  asking for the general form of #25 ("resolve every filter value against its own dimension, not
  just industry") — SPEC-04 exists to close that ticket for every future domain at once.
- **#34**, **#35**, **#39**, **#57** are the frontend admitting it explains nothing — the facet
  rail states counts with no source, Ask's chips are unreadable, there is no landing tab. SPEC-05
  is the fix generalized.

When a spec says "on the reference corpus," it means: this ran, this is what happened, here is
the issue number. Not a plausible illustration.

## The discipline every spec inherits

Restated per-spec where it bears on that spec's decision, but stated once here because it is
one discipline, not five:

1. **Every figure carries its sample size.** A number with no `n` is not a number this platform
   produces. `min_n` refuses rather than characterizes a slice too thin (#23).
2. **Refusal is a first-class state, not an empty result.** "We will not answer this" and "there
   is nothing here" are different claims and must render differently (#57).
3. **A near-miss must fail loudly, never silently.** A filter value, a Cube member, a manifest
   field that does not match: raise, name what was expected, name what was given. An empty
   result where a name should have resolved reads as "the corpus has nothing," which is a claim
   about data when the truth is a claim about spelling (#25, #55).
4. **Inferred is never presented as gold.** Wherever a value comes from a classifier rather than
   an expert label, that fact travels with the value into the UI, not just into a code comment
   (#9's industry crosswalip is the running example).
5. **No fabricated numbers, ever.** A count, a percentile, a benchmark score — computed from a
   command that ran, or not written at all.

A spec that asks you to weaken one of these to make a domain's onboarding easier is a spec bug.
Fix the spec; do not carry the exception into the domain.

## The chain

Run in this order. Each spec names its own acceptance check; do not start the next until the
current one's check passes.

| # | Spec | Produces | Depends on |
|---|---|---|---|
| 01 | [Corpus Intake](SPEC-01-corpus-intake.md) | `quorum.yaml` | — |
| 02 | Schema & Ingest | `db/domain.sql`, a loading plan, real rows in Postgres | 01 |
| 03 | Cube Metadata | `cube/model/*.yml` | 01, 02 |
| 04 | Facets & Resolution | facet rail config, filter-value resolution | 01, 03 |
| 05 | Frontend Naming & Narrative | `strings.ts`, `glossary.ts`, tab copy, corpus prose | 01, 04 |
| 06 | [Agent Selection & Benchmark](SPEC-06-agent-selection-and-benchmark.md) | your own eval question set + answer key, a measured score | 01, 03, 04 |

The dependency is real, not procedural: spec 03 writes Cube dimensions against columns spec 02
put in Postgres; spec 04 declares `closed_vocabulary` on dimensions spec 03 defined; spec 05
writes prose about facets spec 04 built; spec 06 needs 04's filter-value resolution wired before
a real benchmark question involving a filter can be graded honestly. Working out of order means
guessing at a shape the earlier spec hasn't fixed yet, which is exactly the coupling this chain
exists to avoid.

**Spec 06 is construction, not validation — an earlier draft of this document said otherwise,
and that was wrong.** The four-shape selection architecture, the one-call design, and the
`min_n`-gate integration are pre-built platform mechanism; a real question set with a real
answer key for a corpus nobody has asked questions of yet is not something that pre-exists for
you to check against. It is evidence you have to build, and it is exactly as capable of being
built badly — see SPEC-06 for the actual mistake (a benchmark that graded half its output and
published a wrong headline number) this correction is naming from experience, not caution.

## What "done" means for the whole chain

Not "the app boots." **`quorum check` passes, `quorum ask` answers a real question correctly,
and the platform's own boundary test still finds zero domain vocabulary in `semantic-explorer-base`
after the domain is built.** The third condition is the one existing specs cannot verify for
you — it is checked by running the platform's test suite, not by re-reading a manifest.

## Where you get stuck, say so

If a spec's acceptance check cannot pass — a corpus with no natural subject axis, a Cube
measure that has no sane percentile denominator — that is a finding about the spec, and it goes
in that spec's own "Known gaps" section, not silently worked around in the domain repo. The
platform gets better by a spec failing loudly once, not by every domain quietly patching around
the same missing case.
