import { useEffect, useState } from 'react'
import type { SubjectDetail, CorpusRecord, RecordDetail } from '../types'
import { ignoreAbort } from '../index'
import type { QuorumStrings } from '../strings'

/**
 * One record from the corpus, with drill-through to the source text behind it.
 *
 * ## What is shared and what is slotted
 *
 * This component was `MatterCard`, and it is byte-identical between the reference application
 * and a fork of it for an entirely different corpus. Every rule it encodes is about the SHAPE
 * of an answer rather than about mergers:
 *
 * 1. **Inferred is never silent.** A field derived by a classifier rather than read from an
 *    expert label carries a marker, and the server writes the word into the copied text too —
 *    because a copied paragraph leaves the app and loses the badge.
 * 2. **Missing text says why.** A fact with no located span renders its reason, not an empty
 *    box. An empty box reads as "no source text"; the truth is "no range was located".
 *
 * What is NOT shared is which fields make a record's identity. A merger corpus shows
 * `target ← acquirer`; a claims corpus shows something else entirely. Those arrive as the
 * `render` slots rather than as knowledge this file has, which is the line between a primitive
 * and a fork.
 */

/** How a domain draws its own record. Everything else about the card is the platform's. */
export interface RecordRenderers {
  /** The record's identity, e.g. `target ← acquirer`. Falls back to the id when absent. */
  title?: (record: CorpusRecord) => React.ReactNode
  /** Chips and dates beside the title — category, period, whatever the corpus is faceted on. */
  meta?: (record: CorpusRecord) => React.ReactNode
  /** A line under the fact list, e.g. "deal value not available". */
  footnote?: (detail: RecordDetail) => React.ReactNode
  /**
   * Which subject carries the answer for a filtered dimension, so the card can show the
   * evidence behind a facet the user filtered on. Omit a dimension and the card shows no link
   * rather than inventing one: on the reference corpus only consideration has an answer behind
   * it, because industry and year come from enrichment rather than from an expert label.
   */
  evidenceFor?: Readonly<Record<string, string>>
  /** The record's title in the source citation line, if different from `source_title`. */
  cite?: (detail: RecordDetail) => React.ReactNode
}

export function RecordCard({
  record,
  strings,
  render = {},
  focused,
  expanded,
  activeFilter,
  onFocus,
  onToggle,
}: {
  record: CorpusRecord
  /** The domain's nouns. Passed, not injected — see strings.ts. */
  strings: QuorumStrings
  /** The domain's own way of drawing this record. See `RecordRenderers`. */
  render?: RecordRenderers
  /** e.g. `{ dimension: 'consideration_type', value: 'All Cash' }`, when one is applied */
  activeFilter?: { dimension: string; value: string } | null
  focused: boolean
  expanded: boolean
  onFocus: () => void
  onToggle: () => void
}) {
  const [detail, setDetail] = useState<RecordDetail | null>(null)
  const evidenceName = activeFilter ? (render.evidenceFor?.[activeFilter.dimension] ?? null) : null
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!expanded || detail) return
    // #38
    const controller = new AbortController()
    setError(null)

    fetch(`/api/records/${encodeURIComponent(record.record_id)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload?.error?.message ?? `could not load ${strings.subjects}`)
        // a 200 whose body is not a record detail (a misrouted proxy, a stale worker) would
        // otherwise crash on .map and take the whole result list down with it
        if (!Array.isArray(payload?.facts)) {
          throw new Error(`The response did not contain ${strings.subjects} for this ${strings.record}.`)
        }
        return payload as RecordDetail
      })
      .then(setDetail)
      .catch(ignoreAbort((e) => setError(e.message)))

    return () => controller.abort()
  }, [expanded, detail, record.record_id])

  async function copySummary() {
    if (!detail) return
    await navigator.clipboard.writeText(detail.summary)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  return (
    <li
      className={`card${focused ? ' is-focused' : ''}`}
      data-testid={`record-${record.record_id}`}
      aria-current={focused ? 'true' : undefined}
    >
      <button
        type="button"
        className="card__hit"
        onClick={onToggle}
        onFocus={onFocus}
        aria-expanded={expanded}
      >
        <span className="card__title">{render.title?.(record) ?? record.record_id}</span>

        <span className="card__meta">{render.meta?.(record)}</span>

        {/* Its own column, not the tail of the meta run. Sitting last among "IL · incident in
            NY · $64,100" it read as one more attribute of the claim rather than as how this
            ranker scored it — and the SHAPE of the column is the point: a top-25 spanning
            1.000→0.966 means the ranker found nothing in particular, one spanning 1.000→0.756
            found real separation. That comparison is unreadable unless the numbers line up. */}
        {record.score !== null && (
          <span className="card__score" title="rank score within the filtered set, 1.000 = best">
            {record.score.toFixed(3)}
          </span>
        )}
      </button>

      {expanded && (
        <div className="card__detail">
          {/* why this record ranked where it did — kept beside the drill-through so the
              ranking is as inspectable as the clauses are */}
          {record.score !== null && (
            <dl className="card__scores">
              <dt>hybrid</dt>
              <dd>{record.score.toFixed(3)}</dd>
              <dt>vector</dt>
              <dd>{record.vector_score?.toFixed(3) ?? '—'}</dd>
              <dt>bm25</dt>
              <dd>{record.bm25_score?.toFixed(3) ?? '—'}</dd>
            </dl>
          )}

          {error && (
            <div className="state state--error" role="alert">
              <h4 className="state__title">{strings.subjects} unavailable</h4>
              <p className="state__body">{error}</p>
            </div>
          )}

          {!error && !detail && (
            <div className="card__loading" aria-label={`loading ${strings.subjects}`}>
              {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="skeleton skeleton--row" />
              ))}
            </div>
          )}

          {detail && (
            <>
              <div className="card__toolbar">
                <p className="card__provenance">
                  <span className="mono">
                    {detail.located_count} of {detail.subject_count}
                  </span>{' '}
                  {strings.subjects} traced to a source span
                  {render.footnote?.(detail)}
                </p>
                <button type="button" className="card__copy" onClick={copySummary}>
                  {copied ? 'Copied' : 'Copy summary'}
                </button>
              </div>

              <p className="card__cite">
                {render.cite?.(detail) ?? detail.source_title}{' '}
                <span className="mono muted">{detail.source_file}</span>
              </p>

              <ul className="dps">
                {orderedFacts(detail.facts, evidenceName).map((dp) => (
                  <Fact
          strings={strings}
                    key={dp.subject}
                    dp={dp}
                    sourceFile={detail.source_file}
                    evidenceFor={
                      dp.subject === evidenceName && activeFilter
                        ? activeFilter.value
                        : undefined
                    }
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </li>
  )
}

/**
 * One deal point: the answer always, the clause on request.
 *
 * A card rendered every clause for every deal point at once. Measured on `contract_1`, that is
 * 89 deal points carrying **221,045 characters**, so the answer a reader came for was buried in
 * a fifth of a megabyte of contract prose. The answer is the finding; the clause is the evidence
 * for it, and evidence is something you ask to see.
 *
 * `evidenceFor` marks the deal point that justifies a filter the reader has applied. Filtering
 * to All Cash and then not being shown the consideration clause is the product failing its own
 * claim that every figure drills through to the language beneath it, so that one opens by
 * default and says why it is open.
 */
/** The deal point answering the active filter sorts first; the rest keep their order. */
function orderedFacts(dps: SubjectDetail[], evidenceName: string | null): SubjectDetail[] {
  if (!evidenceName) return dps
  const hit = dps.filter((d) => d.subject === evidenceName)
  return hit.length ? [...hit, ...dps.filter((d) => d.subject !== evidenceName)] : dps
}

function Fact({
  strings,
  dp,
  sourceFile,
  evidenceFor,
}: {
  dp: SubjectDetail
  sourceFile: string | null
  evidenceFor?: string
  strings: QuorumStrings
}) {
  const [open, setOpen] = useState(Boolean(evidenceFor))
  return (
    <li
      className={`dp${evidenceFor ? ' dp--evidence' : ''}`}
      data-testid={`dp-${dp.subject}`}
    >
      {evidenceFor && (
        <p className="dp__evidence" data-testid="dp-evidence">
          matched on <strong>{evidenceFor}</strong>
        </p>
      )}
      <div className="dp__head">
        <span className="dp__name">{dp.subject}</span>
        <span className="dp__position">
          {dp.position}
          {dp.is_inferred && (
            <span className="tag__inferred" title="extractor output, not a MAUD expert label">
              inferred
            </span>
          )}
        </span>
      </div>

      {dp.clause_text ? (
        <>
          <button
            type="button"
            className="dp__toggle"
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
          >
            {open ? `hide the ${strings.sourceText}` : `show the ${strings.sourceText}`}
            <span className="mono muted"> · {dp.clause_text.length.toLocaleString('en-US')} chars</span>
          </button>
          {open && (
            <>
              {/* the clause scrolls inside its own box; the page must never scroll sideways */}
              <blockquote className="dp__clause">{dp.clause_text}</blockquote>
              <p className="dp__span mono muted">
                {sourceFile} [{dp.source_span_start}, {dp.source_span_end})
              </p>
            </>
          )}
        </>
      ) : (
        <p className="dp__missing">{dp.text_unavailable}</p>
      )}
    </li>
  )
}
