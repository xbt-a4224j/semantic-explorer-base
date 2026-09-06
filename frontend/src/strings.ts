/**
 * What a domain must say about itself for these components to render.
 *
 * The measured finding this exists for: a fork of the reference app for a different corpus
 * diverged on the frontend ALMOST ENTIRELY IN STRINGS. `git diff -- frontend/src/styles/`
 * between the two repos was empty — colour themes turned out not to be domain-specific at all,
 * which killed the idea of per-domain themes before it was built.
 *
 * So the boundary is: components are shared, words are not. The tell that a fork has not really
 * been generalised is a tab labelled "Deal Terms" in a health-claims application, which is
 * exactly what the first one shipped.
 *
 * ## Why an interface rather than a translation file
 *
 * A key that a domain forgets is a `undefined` rendered into the page. An interface makes the
 * omission a type error at build time, in the domain repo, before anyone sees it. There is no
 * fallback text on purpose — a default like "record" that silently survives into a legal
 * product is worse than a build failure.
 */

export interface QuorumStrings {
  /** The application's own name, for the header and the document title. */
  readonly appName: string

  /** One row of the corpus. "matter", "claim", "citation". Lowercase, singular. */
  readonly record: string
  /** Plural of `record`. Not derived — English plurals are not a function you can write. */
  readonly records: string

  /** What every question is about. "deal point", "claim finding", "violation". */
  readonly subject: string
  readonly subjects: string

  /** How a user says `records` in conversation, which is often not what is counted. On the
   *  reference corpus a lawyer says "deals" while the count is over "agreements". */
  readonly colloquial: string

  /** Tab labels and hints, keyed by the platform's generic tab id. A domain renames the
   *  LABEL freely — "Deal Terms", "Findings", "Violations" — while the id stays generic. */
  readonly tabs: Readonly<Record<TabId, { readonly label: string; readonly hint: string }>>

  /** One line under the app name saying what the corpus is. */
  readonly corpusDescription: string
}

/**
 * The tabs, by what they DO rather than by what one corpus calls them.
 *
 * `terms` was `deal-terms`, which shipped into a health-claims fork and stayed there — the id
 * is in URLs, in tests and in keyboard shortcuts, so it outlives the label that was renamed.
 * An id is the part nobody thinks to change, which is why it is the part that has to be generic.
 */
export const TAB_IDS = ['overview', 'ask', 'explore', 'terms', 'trust', 'label'] as const

export type TabId = (typeof TAB_IDS)[number]
