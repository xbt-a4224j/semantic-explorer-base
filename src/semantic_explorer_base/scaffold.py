"""`quorum init` — write the skeleton a domain fills in by hand, or by following a spec.

## What this used to do, and why it stopped

This file used to read the files already in `data/`, guess which column was the record id from
its name, guess whether records and facts were CSV or JSONL from their content, and write a
`quorum.yaml` that looked finished. It was deleted on instruction, and the reason is not
hypothetical: the guesser's own `_id$` pattern was matched with `re.match`, which anchors at the
START of a string, so it never matched `citation_id` — the exact column the third worked-example
corpus used to prove the platform was domain-free. It produced a manifest with no records file
and raised nothing. A confident wrong guess is worse than an honest blank, because a blank gets
read.

## What replaced it

`docs/specs/` in this repository — SPEC-01 (corpus intake) through SPEC-05 (frontend naming).
Onboarding a domain is now: run `quorum init` for the skeleton and a template with every
placeholder marked, then work through the specs — by hand, or in an agent session that reads
them — to turn each placeholder into a real decision. `quorum check` is what verifies the result,
not this file.

This file's only remaining job is mechanical: make the directories, write a template that will
not silently pass as configuration (every guessable field is a bracketed placeholder, not a
plausible-looking default), and never overwrite something a person already started filling in.
"""

from __future__ import annotations

import pathlib
import re


def manifest_text(name: str) -> str:
    """The starting `quorum.yaml`. Nothing in it is inferred from data — see SPEC-01."""
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-") or "corpus"
    return f"""\
# Written by `quorum init`. Every <bracketed> value is a decision this file does not make for
# you — read docs/specs/SPEC-01-corpus-intake.md in the platform repo before filling one in.
# The most consequential is `subject_axis`: get it wrong and the app answers nothing, and the
# symptom (every question declining) looks like a model problem rather than this file.

name: {name}
corpus: {slug}

# THE dimension nearly every question is about. Ask: "if a person asked this corpus ten
# questions, what noun would most of them name?" That is the SUBJECT — usually finer-grained
# than the record it lives on, and a different dimension from it. See SPEC-01's worked example.
subject_axis: <cube>.<dimension>
# How the subject's answer came out, grouped to make a distribution.
answer_dimension: <cube>.<dimension>

# Two DIFFERENT grains. count_measure is at the subject's own grain (one row per answer);
# record_count is at the record's grain (one row per record). They differ on every corpus with
# sub-record structure — 89x on the reference corpus — and conflating them is what let a slice
# of one clear a k-anonymity threshold of five. `quorum check` refuses if these are equal.
count_measure: <cube>.<measure>
record_count: <cube>.<measure>

# EVERY count measure the min_n gate should read, widest grain first. Must include
# count_measure. List more than two if a third grain exists (a numeric-answer count, an
# explicit distinct-record count) — a count the gate cannot see is a count it cannot gate on.
count_measures:
  - <cube>.<measure>
  - <cube>.<measure>

# Percentile measures over the subject's numeric answers, and the ONE thing that must travel
# with them: numeric_count, the percentile's own denominator. Most subjects are categorical, so
# this is smaller than count_measure — 809 of 12,937 on the reference corpus — and `quorum
# check` refuses to load numeric_measures with no numeric_count declared.
numeric_measures: []
numeric_count: ""

selectable:
  - <cube>
excluded_measures: []

# The prompt's nouns — NOT the frontend's words (those are strings.ts, SPEC-05). This block is
# narrower: it exists to fill in the selection prompt, and a wrong word here changes the prompt
# without changing its byte-identity test, silently. See SPEC-01 for the two traps already hit:
# `colloquial` must differ from `records` (a user SAYS "deals", the shapes COUNT "agreements"),
# and `absent` items need full phrases because the prompt repeats "no" before each one.
strings:
  record: <singular noun for one row>
  records: <plural>
  subject: <singular noun for the subject axis>
  subject_title: <slightly more formal form>
  subject_heading: <ALL CAPS, for a prompt section header>
  colloquial: <how a USER says "records" in conversation>
  corpus_description: <one phrase, what this corpus IS>
  terms_of_art: []
  absent: []
  scope_reason: <why an unscoped percentile is refused, in this corpus's own units>
  analyst: <who is asking — e.g. "an analyst", "a reviewer">

# Facts about this corpus's DOCUMENTS, not this deployment — see SPEC-01. Leave at 0 (disabled)
# until you have a real measurement of this corpus's span lengths; a wrong threshold renders a
# labelled answer as an excerpt of the wrong thing, which reads as a correct answer and is not.
max_clause_chars: 0
excerpt_chars: 1200

# Only for a domain with no parser of its own. `format` is required per entry and is a decision,
# never sniffed — see SPEC-02. Delete this whole block if you are writing your own ingest.
# ingest:
#   records: {{path: data/records.csv, format: csv, map: {{id: <column>}}}}
#   facts:   {{path: data/facts.csv,   format: csv, map: {{record_id: <column>, subject: <column>, position: <column>}}}}
"""


def cube_model_text() -> str:
    """The starting Cube model. Two cubes, the members SPEC-01's manifest already commits you
    to, every `sql:` a placeholder — see SPEC-03 for how each one gets filled in."""
    return """\
# Written by `quorum init`. Fill in every <placeholder> against docs/specs/SPEC-03-cube-metadata.md
# in the platform repo. The member NAMES here must match what quorum.yaml names — `quorum
# check` verifies that once both files are real.
cubes:
  - name: records
    sql_table: public.records
    measures:
      - name: n
        type: count
        title: Records
        description: One row per record. The denominator for anything about records.
    dimensions:
      - name: id
        sql: id
        type: string
        primary_key: true
      - name: category
        sql: category_code
        type: string
        meta:
          # Required if this dimension is ever a filter. Without it, filter-value resolution
          # (SPEC-04) has nothing to resolve against, and a near-miss returns zero rows that
          # read as "we have no records like that" rather than "you named something we do not
          # carry".
          closed_vocabulary: true

  - name: facts
    sql_table: public.facts
    joins:
      - name: records
        relationship: many_to_one
        sql: "{CUBE}.record_id = {records}.id"
    measures:
      - name: n
        type: count
        title: Answers
        description: >-
          One row per ANSWER, not per record. Never the denominator for a claim about
          records — see SPEC-01's count_measure vs record_count.
      - name: count_distinct_records
        type: count_distinct
        sql: record_id
        description: Records with an answer on the selected subject.
      # Uncomment only if this corpus has numeric answers, and pair with numeric_count in
      # quorum.yaml — see SPEC-03 for why the denominator must be its own measure.
      # - name: numeric_n
      #   type: count
      #   filters: [{sql: "{CUBE}.numeric_value IS NOT NULL"}]
      # - name: median_numeric_value
      #   type: number
      #   sql: "PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY {CUBE}.numeric_value)"
    dimensions:
      - name: subject
        sql: subject
        type: string
        meta:
          closed_vocabulary: true
      - name: position
        sql: position
        type: string
        meta:
          closed_vocabulary: true
"""


def scaffold(root: pathlib.Path, name: str) -> list[pathlib.Path]:
    """Write the template manifest and model. Never overwrites — re-running is always safe."""
    root = pathlib.Path(root)
    written: list[pathlib.Path] = []

    (root / "data").mkdir(parents=True, exist_ok=True)
    (root / "cube" / "model").mkdir(parents=True, exist_ok=True)

    manifest = root / "quorum.yaml"
    if not manifest.exists():
        manifest.write_text(manifest_text(name))
        written.append(manifest)

    model = root / "cube" / "model" / "quorum.yml"
    if not model.exists():
        model.write_text(cube_model_text())
        written.append(model)

    return written
