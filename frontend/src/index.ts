/**
 * The platform's frontend surface: design tokens, and the components that are about the SHAPE
 * of an answer rather than about any corpus.
 *
 * ## What is here, and the measurement behind it
 *
 * A fork of the reference app for a different corpus diverged on the frontend ALMOST ENTIRELY
 * IN STRINGS. One thing that measurement killed outright: `git diff -- frontend/src/styles/`
 * between the two repos was EMPTY, so per-domain colour themes — which had been assumed —
 * turned out to be a feature nobody needed. `tokens.css` ships here as one palette.
 *
 * The mechanism colours travel with it deliberately. `--mech-governed`, `--mech-exact` and
 * `--mech-meaning` encode WHICH MECHANISM produced a figure — the semantic layer, literal term
 * matching, or embeddings — and that is platform semantics, not decoration. A domain that
 * re-picked those colours would be re-deciding what a reader is being told.
 *
 * ## What is deliberately NOT here yet
 *
 * The views. `MatterCard`, `Explore` and `DealTerms` carry 60, 42 and 39 references to legal
 * vocabulary, most of it prose inside JSX rather than labels a `strings` object can supply.
 * Moving them is real work; moving them badly ships a legal product that reads like a generic
 * one, which is worse than a slower split. `QuorumStrings` is the contract they will move onto.
 */

export { ResultsSkeleton } from './components/Skeleton'
export { SessionCost } from './components/SessionCost'
export { RoutingDiagram } from './components/RoutingDiagram'
export { formatLatency, formatTokens, formatUsd } from './components/usage'
export { ignoreAbort, isAbortError, useAbortOnUnmount } from './components/abort'
export { TAB_IDS } from './strings'
export type { QuorumStrings, TabId } from './strings'
