/**
 * The words a domain supplies, and the context that gets them to a component without threading
 * a prop through six layers.
 *
 * ## The measurement this is built on
 *
 * A fork of the reference application for a health-claims corpus was diffed against it, file by
 * file: **6,202 shared lines, 425 of them different — 6.9%**. `types.ts` (477 lines),
 * `charts.tsx`, `Term.tsx`, `LoopDiagram.tsx` and `ExplainerPanel.tsx` were byte-identical.
 * `MatterCard.tsx` (268 lines) differed by nothing at all, and `DealTerms.tsx` by two lines,
 * both of them renames done later in the original. They are `RecordCard` and `Rollup` here.
 *
 * That number is the whole argument. These are not legal components that need generalising;
 * they are platform components that were shipped with one corpus's nouns baked in, and the fork
 * kept the nouns because changing them was manual. A claims application with a tab called "Deal
 * Terms" is not evidence that the tab is legal — it is evidence that nobody could rename it
 * without editing code.
 *
 * ## How a component gets them
 *
 * As a prop, from the domain's composition root. Four components need words and the deepest is
 * two levels down, so there is nothing here that an injection mechanism would save.
 */

export interface Glossary {
  readonly [term: string]: { readonly short: string; readonly long: string }
}

export interface QuorumStrings {
  /** The application's own name. */
  readonly appName: string
  /** One line saying what the corpus is. */
  readonly corpusDescription: string

  /** One row of the corpus: "matter", "claim", "citation". Lowercase singular. */
  readonly record: string
  /** Plural. Not derived — English plurals are not a function you can write. */
  readonly records: string

  /** What questions are about: "deal point", "claim finding", "violation". */
  readonly subject: string
  readonly subjects: string

  /**
   * How a user says `records` in conversation, which is often not what is counted. A partner
   * says "deals" while the thing being counted is "agreements"; collapsing the two puts the
   * wrong noun in half the sentences on the page.
   */
  readonly colloquial: string

  /**
   * What a fact's source text is called. "clause" in a contracts corpus, "note" in a clinical
   * one. It labels the toggle that reveals the quoted span, so a wrong word here tells the
   * reader they are looking at something they are not.
   */
  readonly sourceText: string

  /**
   * One sentence naming the held-out set on the Label tab: how many, and what makes them gold.
   * On the reference corpus: "Every item queued here is one of the 20 held-out matters —
   * documents MAUD already has a lawyer's answer for." A corpus-specific fact about the
   * calibration split, not a word the platform can supply.
   */
  readonly heldOutClaim: string

  /**
   * Why a labelling item has no quotable source span, in this corpus's own words. On the
   * reference corpus: "No quotable clause: this deal point is answered from the agreement as a
   * whole. Open the matter for the surrounding text." — MAUD's annotation is sometimes an
   * envelope rather than a quotation, and explaining that is a fact about MAUD, not the
   * platform's to phrase generically.
   */
  readonly noSpanReason: string

  /** An example question, pre-filled into the Ask box so a first-time visitor can press Enter
   *  rather than compose a question cold. The one string here that is genuinely content rather
   *  than vocabulary — a bad example teaches the wrong thing about the corpus. */
  readonly exampleQuestion: string

  /**
   * Explore's search placeholder. Optional; defaults to naming the record.
   *
   * A placeholder is a promise about what the search DOES, and the hardcoded one made a promise
   * only the reference corpus could keep: "Describe the deal in front of you…" invites a
   * sentence, which is right for hybrid retrieval over document prose and wrong for a corpus
   * whose search is a keyword match over structured fields. The second domain rendered it
   * verbatim, in an app with no deals and no prose, and it made the search feel broken when it
   * was working exactly as designed.
   */
  readonly searchPlaceholder?: string

  /**
   * This corpus's terms of art, with their definitions. Rendered by `Term` on hover.
   *
   * Here rather than in the platform because a shared glossary is either wrong for every other
   * corpus or so generic it defines nothing — "MAUD" and "fiduciary out" mean something to one
   * reader and nothing to the next.
   */
  readonly glossary: Glossary

  /** Tab labels and hints, keyed by the platform's generic id. */
  readonly tabs: Readonly<Record<TabId, { readonly label: string; readonly hint: string }>>
}

/**
 * The tabs, named by what they DO.
 *
 * `terms` was `deal-terms`, and that id shipped into the health-claims fork and stayed there.
 * An id lives in URLs, tests and key bindings, so it outlives the label somebody remembered to
 * rename — which is exactly why the id is the part that has to be generic.
 */
export const TAB_IDS = ['overview', 'ask', 'explore', 'terms', 'trust', 'label'] as const

export type TabId = (typeof TAB_IDS)[number]

/**
 * Where the tab bar splits: the product an analyst uses, and the evidence that its answers can
 * be trusted. This grouping is the same call for any corpus — trust and label are always the
 * evidence for whatever precedes them — so it lives here rather than being re-decided per
 * domain the way `tabs.ts`'s `group` field made it look.
 */
export const EVIDENCE_TAB_IDS: ReadonlySet<TabId> = new Set(['trust', 'label'])

/**
 * There is no registry, no context and no hook. `QuorumStrings` is a plain interface and a
 * domain passes an instance down from its own composition root.
 *
 * The earlier version registered the strings globally so components could reach them without a
 * prop. It cost 107 test failures the moment a render happened outside the registration, and it
 * bought nothing: the value is constant for the life of the process and is needed by four
 * components. Nine call sites do not justify an injection mechanism.
 */
