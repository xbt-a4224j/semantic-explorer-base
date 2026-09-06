# semantic-quorum

A governed-answer layer for analytical questions over a domain corpus.

> **quorum**, *n.* — the minimum number required for a decision to be valid.

The model never reads the data and never states a figure. It selects from a versioned vocabulary
read live from a semantic layer; the warehouse computes; and a slice too thin to characterise is
refused rather than answered.

## How a domain consumes it

One command, about a second:

```bash
make platform-sync      # in the domain repo
```

It builds a wheel from your local `semantic-quorum` checkout, installs it into the domain's venv,
and writes `platform.lock`. The wheel lands in `vendor/` (gitignored, rebuilt on demand); the lock
is committed.

**Why not a submodule.** It was the other candidate and lost on the thing that matters here: a
submodule lets you edit in place only in the domain you are standing in, and propagating a
platform change to the *second* domain needs commit, push and pull over the network. This needs
none of that — edit the platform, uncommitted even, run one command in either domain.

**Why not `pip install -e ../semantic-quorum`.** The domain repos build with `context: .`, so a
sibling directory is outside the Docker build context and cannot be `COPY`d. It works on a
laptop and breaks every container build. A wheel written into `vendor/` is inside the context.

**Why the lock is committed and the wheel is not.** Committing wheels versions build artifacts,
and this project has already lost the ability to push a repo by committing generated files.
`platform.lock` records the platform commit — and whether its tree was dirty, because a figure
produced against uncommitted platform code cannot be reproduced by anyone else and that should
be visible rather than inferred.

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
