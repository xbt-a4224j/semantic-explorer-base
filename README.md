# semantic-quorum

A governed-answer layer for analytical questions over a domain corpus.

> **quorum**, *n.* — the minimum number required for a decision to be valid.

The model never reads the data and never states a figure. It selects from a versioned vocabulary
read live from a semantic layer; the warehouse computes; and a slice too thin to characterise is
refused rather than answered.

## How a domain consumes it

As a **submodule**, checked out at `platform/` inside the domain repo:

```bash
git submodule add git@github.com:xbt-a4224j/semantic-quorum.git platform
pip install -e platform/          # backend
# vite.config.ts aliases @quorum -> platform/frontend/src
```

One mechanism for both halves. A pip package plus an npm package would be two package managers,
two pin formats and two failure modes — and, decisively, `pip install -e ../semantic-quorum`
cannot work at all here: the domain repos build with `context: .`, so a sibling directory is
outside the Docker build context and cannot be `COPY`d. A submodule is inside it.

The pointer bump is a feature rather than a chore: it records exactly which platform commit a
domain was demoed against.

## What a domain provides

One manifest, one ingest parser, one Cube model, one strings file.

```yaml
# quorum.yaml
name: clause-explorer
corpus: maud-public-target-merger-agreements

# The subject axis: the dimension nearly every question names. Pinning it is what took the
# reference implementation from answering 0 of 20 real questions to 16 of 20.
subject_axis: deal_points.deal_point_name
answer_dimension: deal_points.position
count_measure: deal_points.n
record_count: comparable_deals.n
```

Everything else — the selection pipeline, the `min_n` gate, hybrid retrieval, the eval harness,
the React views — comes from here.

## Why it exists

Two applications on the same architecture: `clause-explorer` (public-target merger agreements)
and `claims-explorer` (synthetic health claims). A file-level survey of the two found **215
non-data files, 142 byte-identical, and exactly one genuinely new source file**. The platform
boundary was measured, not assumed — and it landed somewhere surprising: the `min_n` gate reads
like a legal-ethics feature (k-anonymity around the ethical wall) and is entirely domain-free,
while the Cube model looks like infrastructure and is entirely domain.

## Status

Extraction in progress. See the issues.
