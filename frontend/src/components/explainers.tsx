import { Term } from './Term'
import { useStrings } from '../strings'

/**
 * The standing per-tab explanation (#35, cut to size in #45).
 *
 * Each body is two paragraphs and about a hundred words: **what the tab is for**, and **the
 * one honest limit**. It was five or six paragraphs per tab — roughly 2,900 words of essay
 * across the app, more than the README — which put a document in front of the instrument on
 * every tab. The argument that was cut is not gone: it moved to `docs/walkthrough.md`, under
 * "Why it is built this way", where a reader who wants it can read all of it at once.
 *
 * Jargon still expands on first use through `<Term>`, on every tab, because someone who lands
 * on Ask first should not have to visit Explore to learn what MAUD is. The definitions
 * live in the glossary rather than in prose, which is most of what made the cut affordable.
 *
 * Every number below traces to a command in `docs/walkthrough.md` or `docs/results/`.
 */

export function ExploreExplainer() {
  const strings = useStrings()
  return (
    <>
      <p>
        <strong>What this tab is for.</strong> Finding deals that look like the one in front of
        you. Faceted search over 152 real merger agreements from <strong><Term>MAUD</Term></strong>{' '}
        — public SEC filings, not any firm&rsquo;s own matter history. Type a description or press{' '}
        <code>/</code> for the search box, narrow with the rail, and the counts recompute against
        whatever is left. Industry filtering joins on a{' '}
        <strong><Term>SIC crosswalk</Term></strong> code rather than a display label, so a
        near-miss cannot return zero rows that read as &ldquo;no comparable {strings.records}&rdquo;.
      </p>
      <p>
        <strong>The limit.</strong> The corpus spans 20 months (March 2020 – November 2021), not
        five years, and deal value is empty for all 152 agreements, so size filtering does not
        work yet. Every industry is <em><Term>inferred</Term></em> from a coarse SEC code: 134 of
        152 resolved, and a hand check of 20 found 3 carrying the acquirer&rsquo;s industry rather
        than the target&rsquo;s.
      </p>
    </>
  )
}

export function DealTermsExplainer() {
  return (
    <>
      <p>
        <strong>What this tab is for.</strong> Answering &ldquo;what did we negotiate across
        these?&rdquo; without reading eight agreements side by side. Each row is one{' '}
        <Term>deal point</Term> — a provision written as a question with a fixed answer set, the
        way the ABA&rsquo;s Public Target Deal Points Study asks it — with its prevalence across
        the set you picked in Explore. Click a row for the clause language, with the file and
        character offsets it was read from.
      </p>
      <p>
        <strong>The limit.</strong> It answers only the ABA&rsquo;s 92 questions; a provision
        outside that set is invisible here, not absent from the agreements. Below a sample of 30 a
        row renders &ldquo;6 of 8&rdquo;, never &ldquo;75%&rdquo; — a percentage claims precision
        eight deals cannot support.
      </p>
    </>
  )
}
