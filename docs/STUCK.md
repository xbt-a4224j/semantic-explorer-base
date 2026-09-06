# Open questions and things that blocked

Written as they were hit, so the three sessions do not rediscover them.

## Blocked / needs a decision

**The `interpret` prompt is domain text, and the prompt is the implementation.**
A reworded prompt is untested code — measured: a tidied rewrite of the shipped prompt scored
23/24 in the harness and then answered "what is the average deal size in dollars" with **152** in
production. So the domain cannot simply be handed a free-text prompt string. Current proposal
(issue #1): the platform owns the STRUCTURE — shape definitions, the null instruction, the
self-check — and the domain supplies only nouns. Unresolved: whether the domain's nouns can
change the score enough that each domain needs its own benchmark run before it is trusted.
Probably yes, which means the eval harness is not optional for a new domain.

**Two grains, and only one of them is obvious.** `count_measure` and `record_count` differ by
~89x on the same slice in the reference corpus, because a row means something different in each.
A domain author will get this wrong. `Domain.validate()` catches them being identical; it cannot
catch them being swapped. `quorum check` (issue #3) should query both against a known slice and
warn when the "record" count exceeds the "subject" count, which is almost always the swap.

**The claims Cube model may not have the members its manifest would need.** The manifests in
`tests/test_domain_and_shape.py` use `findings.question` / `findings.answer` for the health
domain — those are *plausible*, not verified. claims-explorer's model still uses the legal member
names (`deal_points.deal_point_name`), because the domain rename was never finished. Verify
before wiring, or the second domain's manifest is fiction.

## Decided, with the reasoning, so it is not relitigated

**Submodule, not pip-from-sibling.** The domain repos build with `context: .`, so
`../semantic-quorum` is outside the Docker build context and cannot be `COPY`d. A submodule at
`platform/` is inside it. This is decisive and was missed in the first design pass, which
recommended pip and was wrong. One mechanism also serves both halves; pip + npm is two.

**Platform is the dependency, not the parent.** The original proposal had the platform as the
parent repo with both domains as submodules of it. That means no domain deploys without cloning
the platform and dragging the other domain along, and nobody else can adopt the platform without
inheriting these two apps.

**The boundary test judges behaviour, not prose.** Platform docstrings may cite the corpus they
were extracted from — that is provenance and it is the most valuable part of those comments. What
they may not have is an identifier, string literal or import that only makes sense for one
corpus. Drawing the line at prose produces a test people learn to silence.

**Colour themes are not domain-specific.** `git diff -- frontend/src/styles/` between the two
apps was empty. The "each domain gets a theme" idea was in the original plan and the data killed
it. Dropped until a domain actually needs one.

## Known bad, tracked elsewhere

- The schema is legal-named in both domains (`matters`, `deal_points`, `CLAUSE_EXPLORER_DB`) —
  issue #5 here, claims-explorer#1 downstream.
- claims-explorer still ships the legal ingest, FOLIO, and the SIC crosswalk.
- `ask_bench.py` is 525 lines holding eight strategies, six of which lost. The results are in
  `docs/results/ask-strategies.md`; the code does not need all eight.
