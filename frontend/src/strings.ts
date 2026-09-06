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
 * ## Why a registry and not props or context
 *
 * Passing `strings` down through every view to every row is 6,000 lines of signature churn to
 * move a noun. Context avoids that but makes every render site — including every test that
 * renders one component — responsible for supplying a provider, which is 100+ wrappers for a
 * value that is constant for the life of the process.
 *
 * There is exactly ONE set of strings per application and it never changes at runtime, so it is
 * registered once at startup. `useStrings` still throws when nothing has registered: a default
 * noun rendering silently into a real product reads as a data bug rather than as a missing
 * call, and that is the failure this is here to prevent.
 */

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

  /** An example question, for the Ask placeholder. The one string here that is genuinely
   *  content rather than vocabulary — a bad example teaches the wrong thing about the corpus. */
  readonly exampleQuestion: string

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

let registered: QuorumStrings | null = null

/** Called once at startup with the domain's own words. */
export function configureStrings(strings: QuorumStrings): void {
  registered = strings
}

/**
 * The domain's words. Throws when nothing has registered them rather than falling back.
 *
 * No defaults on purpose. A fallback like "record" renders silently into a legal product and
 * reads as a bug in the data; a thrown error is found the first time anyone opens the page.
 */
export function useStrings(): QuorumStrings {
  if (!registered) {
    throw new Error(
      'configureStrings() has not been called. Every shared component reads the domain\'s ' +
        'nouns from it, and there is deliberately no fallback: a default noun rendered into a ' +
        'real product reads as a data bug rather than as missing configuration.',
    )
  }
  return registered
}
