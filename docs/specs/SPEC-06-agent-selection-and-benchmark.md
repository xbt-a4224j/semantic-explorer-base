# SPEC-06 — Agent Selection & Benchmark

Produces: your own eval question set + answer key, and a measured, honest benchmark score
against the platform's selection pipeline.
Depends on: [SPEC-01](SPEC-01-corpus-intake.md) (`subject_axis`, the manifest's `strings:`),
[SPEC-03](SPEC-03-cube-metadata.md) (`closed_vocabulary`, `numeric_count`),
[SPEC-04](SPEC-04-facets-and-resolution.md) (filter-value resolution — the second model call
this pipeline sometimes needs).

## What this spec is, and is not

Unlike SPEC-01 through SPEC-05, this one asks you to fill in nothing. The four-shape selection
architecture, the one-call design, the structural self-check, and the `min_n` gate's reading of
a selection are **already built, domain-free platform mechanism** —
`quorum.agent.shape`, `quorum.agent.interpret`, `quorum.gates.min_n`. You write none of it.

What you have to do is harder to skip than filling in a template: **understand why each piece is
shaped the way it is, precisely enough to recognize whether your corpus is walking into one of
the failure modes that already cost real iterations here — then build the evidence, specific to
your own corpus, that it isn't.**

This correction is itself worth stating: an earlier draft of the master spec called this
"validation... not new construction." That was wrong, and this spec exists partly to say so. A
real question set with a real answer key, for a corpus nobody has asked real questions of yet,
*is* construction — construction of evidence rather than of code, and just as capable of being
done badly.

## Three separate measurements exist in this codebase. Do not conflate them.

Each answers a different question, on different data, and citing the wrong one for the wrong
claim is itself a mistake worth naming:

| Measurement | What it tested | Result |
|---|---|---|
| Pinning `subject_axis` at all | An interpreter with the subject axis correctly identified, vs. one without | **0 of 20 → 16 of 20** |
| Shapes vs. free choice, 10 questions | A four-value shape enum vs. free choice over 11 measures | **0 of 10 → correct** (exact count not separately tracked at this step) |
| Six selection strategies, 24-then-27 questions | Free-form / two-call / one-call / +glosses / +strict-null / +self-check | **4 → 23 (broken metric) → 20 (honest)** |

The third is the headline number ("20 of 27"), and it needed a correction before it was honest —
see below.

## Four shapes, chosen from a closed enum, not a free choice over every measure

A single model call given a free choice over eleven measures answered **0 of 10** real
questions correctly. Every failure shared one cause: given freedom, the model picks a *plausible*
measure that does not answer the question asked —

```
"what percentage of deals is cash-only"        -> a bare count, no denominator
"what's the largest deal value by dollar"      -> a bare count, not a maximum
"what's the ordinary course efforts standard"  -> median + p25 + p75 over seven dimensions
```

A real number, correctly computed, for a question nobody asked — harder to catch than an
obvious error, because it looks like an answer. Choosing the shape from a four-value enum first
means the model never reaches for the wrong measure; the whole class of failure becomes
unreachable rather than merely caught downstream.

**`distribution` is DEFAULT, and that word was measured too.** Described merely as "the usual
case," the model chose `count` or `coverage` for two thirds of the answerable questions and the
app returned the corpus size instead of the split. Naming it the default and listing its
phrasings — *"how many X have Y", "do records include Y", "is Y usually A or B"* — took the
benchmark from **7/27 to 17/27** on its own. This is very likely the single highest-leverage
sentence in the entire prompt, on any corpus: check that your domain's version of this phrasing
list actually names how your users ask "what's typical here."

## Shape and subject are decided together, in ONE call, not two

The measured comparison, all six strategies against the same 24-question answer key:

| strategy | calls | total /24 | answerable /20 |
|---|---|---|---|
| free-form, free choice over 11 measures | 1 | 4 | 0–1 |
| shape, then subject | 2 | 15–16 | 12–13 |
| subject, then shape | 2 | 19 | 16 |
| one call, both enum-constrained | 1 | 20–21 | 17–18 |
| + each subject listed with its answers | 1 | 22 | **20** |
| + strict-null prompt instead | 1 | 19 | 15 |
| + answers AND a self-check | 1 | **23** | 19 |

Deciding both together beat deciding them in sequence, **at half the calls and half the
wall-clock** — they are not independent. Knowing a question is about a tail period already tells
you it wants a number rather than a distribution; splitting the decision throws that signal away
and makes each half guess without the other. If you are tempted to simplify this pipeline by
splitting shape and subject into two smaller, "more focused" calls, this table is the reason not
to.

## Subject glosses were the single biggest lever measured

Listing each subject with the answers it actually takes moved the benchmark **18/20 → 20/20** on
answerable questions. Subject names are often cryptic (the reference corpus's ABA taxonomy has
names like `W/N/A/F applies to-Answer`); their *answers* say plainly what the question is:

```
Knowledge Definition-Answer             :: Constructive knowledge | Actual knowledge
Ordinary course efforts standard-Answer :: Flat covenant | Commercially reasonable | Reasonable best
```

This costs tokens, not new work — the grouping already feeds the facet rail (SPEC-04) — and
roughly triples the prompt (~1,400 → ~4,300 tokens on the reference corpus, **$0.0007 a question
instead of $0.0002**, not a real cost). If your domain's subjects have equally opaque names,
expect this to matter as much here as it did on the reference corpus. If your subjects are
already self-explanatory in their own names, measure whether this lever still helps before
assuming it will — this is the one number in this spec that is closest to being corpus-specific
rather than universal.

## A structural self-check beat a stricter prompt

Telling the model to be strict about null fixed all four impossible questions and **cost five
real answers** (20/20 → 15/20). Asking it to choose *and then separately state whether the
choice covers the question* kept 19–20 answers **and** caught all four declines. The lesson:
**the model is markedly better at auditing one concrete pairing than at calibrating caution in
the abstract.** If your prompt needs a null/decline behavior, reach for a second boolean field
the model fills in about its own answer, not a sterner adjective in the system prompt.

**Do not name the specific missing terms in the prompt** as a shortcut to a higher score — it
was tried, would have scored higher, and is overfitting: it does not survive a term nobody
thought of when writing the prompt, and it is the kind of change that looks like a result and
is not one.

## Declining is a first-class outcome — and conflating its two meanings is how a real bug shipped

`Interpretation` is one type with a `cannot_answer` flag, not `dict | None | some-sentinel`. The
distinction is real: `cannot_answer=True` means **the corpus has nothing for this question**, and
a caller must not fall back to a wider path. A null `selection` with `cannot_answer=False` means
only that none of the four shapes fit — a different, narrower kind of "no."

Collapsing these two is exactly how "what's the average deal size in dollars" once returned
**152** — the corpus size — instead of declining. The model correctly found no subject (deal
value is NULL on all 152 matters), said so, and a `count` shape ran anyway with no filter because
the two null-meanings had been merged into one sentinel upstream. **A number in answer to a
question the corpus cannot answer is worse than a refusal — it looks like an answer.**

## The gate reads the selection YOUR shape produced — two ways this was already defeated

`min_n` is domain-free mechanism, but it can only gate what it's told to look at. Two real
defects, both shipped, both worth checking for on a new domain:

**A hardcoded measure name.** An early version read one literal count-measure key from a
selection's rows; a selection from the *other* namespace returned `None` for that key, the
refusal never ran, and a grouped query returned named counterparties at `n=1` with
`refused: false`. This is why `quorum.yaml`'s `count_measures` (SPEC-01) lists **every** count
measure the gate might need to read, not just the obvious one.

**Reading only the first row.** A grouped result is a set of independent claims; the gate has to
protect each one. Reading `rows[0]` alone let a fourth cell of `n=3` hide behind a first cell of
89. Confirm your own selection paths return every row to the gate, not a summary of the first.

## The Ask tab is the pivotal feature. Your question set is not just an internal eval file.

Everything above exists to make one product surface work: a person types a real question in
their own words and gets back a governed, quantified answer or an honest decline. That surface —
Ask — is what the rest of this platform is *for*. Treat the question set below as a
product asset with two consumers, not one:

1. **The benchmark** (this spec) — scored, graded, re-run to catch regressions.
2. **The product's own examples** — `strings.ts`'s `exampleQuestion` (SPEC-05), the Overview
   tab's worked journeys, anything shown to a person who has never used this corpus before.

Pick your **headline example** — the one that appears in the product itself — with more care
than any other question in the set. It should demonstrate the full discipline in one shot: a
real number, its denominator stated (`n=X`), and ideally a visible contrast between an answer
and a refusal so a newcomer sees *both* halves of what "governed" means without reading a single
line of code. A generic, safely-answerable question that could be about any corpus wastes the
one chance a first-time reader gives a product to show them what makes it different from a
search box. If your best example needs a paragraph of setup to make sense, it is not yet your
best example.

## Building your own benchmark

**Write your own question set and answer key**, in your own corpus's vocabulary — do not adapt
the reference corpus's 27 questions. A useful split, taken from the reference set's own shape:
roughly 20 questions this corpus genuinely can answer, and a handful (4–7) it genuinely
**cannot**, so the benchmark measures declining correctly, not just answering correctly. Write
the answer key against your domain's own taxonomy, not against any particular implementation —
so a future prompt change is graded against the same fixed target.

**Grade the shape, not just the subject.** This is the single most important correction in this
codebase's own history: an early benchmark checked only whether the right subject was chosen and
ignored the shape entirely. A strategy that found the right subject and then picked `coverage`
instead of `distribution` scored as *correct*, while the deployed app returned the size of the
corpus instead of the actual split. **A metric that reads half the output certifies half the
system.** Build your grader to check both from the start; do not discover this the way the
reference implementation did — by shipping a broken metric, publishing a wrong headline number,
and correcting it in public afterward.

**Temperature 0 is not determinism.** Three identical runs of the same strategy, same prompt,
same model, scored 23, 21, 22 out of 24 on the reference corpus. Report a single run's score and
you have reported a sample, not a measurement — run at least three times and report the range,
or note explicitly that you have not yet.

**Report your honest baseline, including what still fails.** The reference corpus's own honest
number is 20 of 27, not a rounder or more flattering figure, and its results file states plainly
what still fails at that score (one subject confusion, two median/distribution mixups, three of
seven declines). A benchmark that only ever reports success is a benchmark nobody should trust;
match that discipline on your own corpus rather than report only the number that looks good.

## Acceptance

- [ ] A question set exists in this domain's own vocabulary — not adapted from the reference
      corpus's 24/27 questions — with roughly 20 answerable and several that must decline.
- [ ] The answer key is written against this corpus's own taxonomy, independent of any one
      implementation of the prompt.
- [ ] Grading checks **shape and subject both**. A test exists proving the grader would have
      caught the reference implementation's own metric bug (a `coverage`-shaped answer to a
      `distribution` question must NOT score as correct).
- [ ] The benchmark ran at least three times; the reported score is a range, or a single run
      explicitly labeled as such rather than presented as *the* number.
- [ ] The results are written down with what still fails, not only the passing score.
- [ ] If subject names in this domain are already self-explanatory, you measured whether subject
      glosses still help rather than assumed the reference corpus's 18/20→20/20 lever transfers
      unchanged.
- [ ] A headline example question is chosen from this set — not written separately — and it
      demonstrates a real number with its denominator, ideally beside a visible refusal, in a
      form a first-time reader understands with no other context.

## Known gaps

- No spec yet exists for calibrating an *extraction* pipeline against held-out gold labels (the
  reference corpus's separate calibration/Trust-tab work) — this spec covers selection
  (turning a question into a governed query), not extraction (turning raw text into structured
  facts). If a new domain needs the latter, that is a gap to name here, not to solve silently.
