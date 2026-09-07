/**
 * The platform's frontend: design tokens, the shared types, and the components and views that
 * are about the SHAPE of an answer rather than about any corpus.
 *
 * ## What decided the boundary
 *
 * A file-by-file diff of the reference application against a fork of it for a health-claims
 * corpus: **6,202 shared lines, 425 different — 6.9%**.
 *
 *     types.ts            477 lines    0 differing
 *     charts.tsx          355 lines    0
 *     MatterCard.tsx      268 lines    0
 *     Term.tsx             80 lines    0
 *     DealTerms.tsx       256 lines    2   (both renames made later in the original)
 *     FacetRail.tsx        88 lines    2   ("matters" -> "claims")
 *     Explore.tsx         386 lines   13
 *
 * That is the argument for moving them, and it is the opposite of what a word-count suggests.
 * Counting legal TERMS in these files says they are deeply domain-coupled — `MatterCard` has 60.
 * But the fork needed to change none of them to serve a completely different corpus. It kept
 * every one, and shipped a claims application with a tab labelled "Deal Terms", because
 * changing a noun meant editing code.
 *
 * So the legal words in these files were never a coupling. They were a defect that a strings
 * contract fixes, and counting them was measuring the wrong thing.
 *
 * ## What stays with the domain
 *
 * The narrative. `Ask.tsx` (190 of 377 lines differing), `Overview.tsx` (44 of 207),
 * `journeys.ts` (30 of 105) and `overviewDiagrams.tsx` (18 of 249) are the pages that explain
 * what THIS corpus is and why it is worth querying. Those genuinely differ per domain, and a
 * shared version would be a worse page for both.
 */

// ── design system ────────────────────────────────────────────────────────────────────────
export { EVIDENCE_TAB_IDS, TAB_IDS } from './strings'
export type { Glossary, QuorumStrings, TabId } from './strings'

// ── primitives ───────────────────────────────────────────────────────────────────────────
export { ResultsSkeleton } from './components/Skeleton'
export { SessionCost } from './components/SessionCost'
export { Term } from './components/Term'
export { ExplainerPanel } from './components/ExplainerPanel'
export { formatLatency, formatTokens, formatUsd } from './components/usage'
export { ignoreAbort, isAbortError, useAbortOnUnmount } from './components/abort'
export { useKeyboard } from './useKeyboard'

// ── charts and diagrams ──────────────────────────────────────────────────────────────────
export { BarChart, ChartFrame, Legend, StackedBar, StatTiles } from './components/charts'
export { RollupDiagram } from './components/diagrams'
export { LoopDiagram } from './components/LoopDiagram'
export { RoutingDiagram } from './components/RoutingDiagram'

// ── the product's own shapes ─────────────────────────────────────────────────────────────
export { RecordCard } from './components/RecordCard'
export { Shell } from './components/Shell'
export type { ShellProps, ShellSearch, ShellStatus } from './components/Shell'
export { FacetRail } from './components/FacetRail'
export { AskBox } from './components/AskBox'
export { Grading } from './components/Grading'
export { IngestStatus, LogViewer } from './components/operator'

// ── views ────────────────────────────────────────────────────────────────────────────────
export { Rollup } from './views/Rollup'
export { Explore } from './views/Explore'
export { Label } from './views/Label'
export { Trust } from './views/Trust'

export * from './types'
