# SPEC-05 — Frontend Naming & Narrative

Produces: this domain's `strings.ts`, `glossary.ts`, tab copy, and the corpus-specific prose
slots (`corpusStrip`, `recordRenderers`, `Rollup`'s diagram/scope text, `Trust`'s chart copy).
Depends on: [SPEC-01](SPEC-01-corpus-intake.md) for the base nouns; the shared components these
words plug into already exist in the platform (`@quorum/ui`) — this spec does not write them.

## Two different noun sets, and why they don't merge

`quorum.yaml`'s `strings:` block (SPEC-01) and this spec's `strings.ts` look like the same idea
and are not. The manifest's block is narrow and feeds the *agent's selection prompt* — a wrong
word there changes a prompt that is benchmarked byte-for-byte. `strings.ts` is broad and feeds
*everything a person reads* — tab labels, the corpus provenance line, a glossary entry's
definition, an example placeholder. They share some values (both need a singular noun for one
row of the corpus) but they are filled in for different reasons and checked by different means.
Do not try to generate one from the other; fill in both from SPEC-01's decisions.

## What "generic" actually meant here, measured

Before this spec existed as a document, a file-by-file diff of two real domains built on this
platform found **6,202 shared frontend lines, 425 differing — 6.9%**. Several files were
byte-identical: a record card, a term-glossary component, a chart renderer. The 425 that did
differ were almost never mechanism; they were this spec's job — nouns and narrative — done by
hand, inconsistently, because there was no contract forcing the words out of the component and
into one place. That measurement is the argument for everything below: **do not touch the
components. Fill in the words.**

## The contract: `QuorumStrings`

One object, passed as a prop from your app's composition root — not injected through a registry
or context. An earlier version of the platform used a global registry (`configureStrings`/
`useStrings`); it cost 107 test failures the first time a component rendered before
registration, for a value that is constant for the process's entire lifetime, needed by four
components. Nine call sites did not justify the mechanism. Pass it down by hand.

```ts
const STRINGS: QuorumStrings = {
  appName: "<your app's name>",
  corpusDescription: "<one phrase, what this corpus is>",
  record: "<singular noun for one row>",       // matches quorum.yaml's strings.record
  records: "<plural>",
  subject: "<singular noun for the subject axis>",
  subjects: "<plural>",
  colloquial: "<how a user SAYS 'records' in conversation>",
  sourceText: "<what a fact's quoted source span is called — 'clause', 'note', 'excerpt'>",
  exampleQuestion: "<a real, good example for the Ask placeholder — see below>",
  heldOutClaim: "<one full sentence, see below>",
  noSpanReason: "<one full sentence, see below>",
  glossary: GLOSSARY,
  tabs: { overview: {label, hint}, ask: {label, hint}, explore: {label, hint}, terms: {label, hint}, trust: {label, hint}, label: {label, hint} },
}
```

**No fallback values, anywhere.** A default noun like `"record"` rendering silently into a real
product reads as a data bug, not as a missing configuration — the whole reason `useStrings`'s
predecessor threw rather than returned a placeholder.

## Tab ids are generic; tab labels are not

`TAB_IDS` — `overview`, `ask`, `explore`, `terms`, `trust`, `label` — are the platform's fixed
vocabulary and never renamed. `terms` used to be `deal-terms` in an earlier version, and that id
shipped into a second domain's fork and stayed there for months: an id lives in URLs, tests, and
keyboard bindings, so it outlives the label somebody meant to rename. Only the **label** is this
domain's word — `terms` can read "Deal Terms" in one domain and "Findings" in another, same id
underneath.

## Two kinds of full-sentence slots, and why they're sentences and not words

Some things are one word (`strings.record`). Some things are a whole claim about this specific
corpus, and trying to build that claim out of single-word substitutions produces a sentence that
reads like a form letter. Two examples, both real:

**`heldOutClaim`** — the Label tab's held-out-set explanation. On the reference corpus: *"Every
item queued here is one of the 20 held-out matters — documents MAUD already has a lawyer's
answer for."* The number (20), the corpus name (MAUD), and the professional (a lawyer) are all
specific facts about this domain's calibration split. A generic version — "one of the N held-out
records" — is not wrong, it is just not a claim anyone can check.

**`noSpanReason`** — why a labelling item sometimes has no quotable source span. On the
reference corpus: *"No quotable clause: this deal point is answered from the agreement as a
whole. Open the matter for the surrounding text."* This is a fact about how the annotation
process works (an envelope, not always a quotation) — mechanism-shaped, but specific enough to
this corpus's annotation style that no generic wording says the same true thing.

The test for "is this a word or a sentence": **if you had to explain the fact to someone new to
this corpus, would you say one noun or a full clause?** A full clause is a `strings.ts` sentence
field, not five word-substitutions stitched together.

## Slots that take real numbers, not a paraphrase

`Trust`'s `accuracyChartCopy` is the pattern for the hardest version of this: the domain supplies
the *words*, the platform supplies the *numbers*, and the function signature has to carry both
or it becomes possible to silently drop one:

```ts
accuracyChartCopy: (stats: { heldOut: number; reportable: number; total: number }) => ({
  title: "Which questions could run without a lawyer?",
  note: <>...{stats.reportable} of {stats.total} questions could be answered by machine...</>,
})
```

A first version of this callback returned prose that said "a share of questions" instead of
`{reportable} of {total}` — the real numbers, quietly dropped because the words were more
convenient to write without them. That is worse than the sentence never being generalized at
all: a vaguer number that reads as intentional is harder to catch than a missing one. When you
write a slot like this, check that every number the platform passes in actually appears in what
you return.

## The example question is content, not vocabulary

`exampleQuestion` isn't a noun substitution problem — it's the one field in this whole spec that
is genuinely *content*. A bad example teaches a reader the wrong thing about what the corpus can
answer. Write a question this corpus can actually answer well, using its own terms of art from
SPEC-01, not a generic Mad-Lib built from the nouns above.

## What stays a shared component, and the two things that don't

Almost everything a record card, a chart, a glossary tooltip, or a rollup row does is already
built and shared. Two things are legitimately per-domain and arrive as render props, not as
strings:

- **`recordRenderers`** — which fields identify a record to a reader (`target ← acquirer` on a
  merger; something else entirely on another corpus). The card owns everything else: expansion,
  scores, drill-through, the provenance line.
- **`corpusStrip`** — the Explore provenance line naming which sources fed this corpus, what's
  inferred, what date range. A claim about this specific corpus's data lineage, not a template.

## Acceptance

- [ ] `STRINGS` has no field left as a placeholder — grep for a bracketed `<...>` in the
      compiled object and find nothing.
- [ ] Tab **ids** used anywhere in code are from the platform's fixed `TAB_IDS`; only `label`
      values differ.
- [ ] `heldOutClaim` and `noSpanReason` (or whatever full-sentence slots your app's components
      require) are complete, checkable sentences — not five word-substitutions concatenated.
- [ ] Every numeric parameter a render-prop callback receives (like `accuracyChartCopy`'s
      `stats`) actually appears in what the callback returns. Read your own returned JSX against
      the parameter list before trusting it.
- [ ] `exampleQuestion` is a real question this corpus answers well, phrased with this domain's
      own terms of art — not a generic placeholder with the nouns swapped in.
- [ ] The platform's frontend boundary test still finds zero domain vocabulary in
      `semantic-quorum` after this domain exists — this is the check that actually verifies the
      whole chain, not just this spec.

## Known gaps

- Not every domain's narrative shape will match the reference corpus's exactly (a `heldOutClaim`
  assumes a held-out calibration set exists at all). A domain with no calibration loop should
  say so here rather than force a value into a field that doesn't apply, and the platform's
  `QuorumStrings` may need an optional variant of such fields — record that need, don't
  route around it silently in the domain repo.
