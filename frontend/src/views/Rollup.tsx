import { useEffect, useState } from 'react'
import type React from 'react'
import type { RollupRow, RollupResponse, DrillRecord } from '../types'
import { ignoreAbort, isAbortError, useAbortOnUnmount } from '../index'
import { ExplainerPanel } from '../components/ExplainerPanel'
import type { QuorumStrings } from '../strings'

/**
 * Deal Terms — what was negotiated across the selected set (#21).
 *
 * The rendering rule is the product claim: **"6 of 8", never "75%"**. The server decides which
 * form applies and sends the string pre-rendered, so the rule lives in exactly one place and
 * cannot drift between a table cell, a tooltip and a pasted paragraph. This view does not
 * divide two numbers anywhere — if you find yourself adding a `/`, the rule has already been
 * broken.
 *
 * A deal point nobody in the set negotiated stays on screen as `0 of 8`. "We checked and it is
 * not there" and "we did not check" are indistinguishable once the row disappears.
 */
export function Rollup({
  selection,
  diagram,
  scopeFallback,
  strings,
  explainer,
}: {
  selection: string[]
  /** The domain's nouns. Passed, not injected — see strings.ts. */
  strings: QuorumStrings
  /** This corpus's own explanation of the rollup. Prose about a corpus is the one thing a
   *  shared view cannot supply. */
  explainer?: React.ReactNode
  /** This corpus's own rollup diagram — what a row is, what a new question costs, why 30 is
   *  the threshold. A description of THIS corpus's mechanism. */
  diagram?: React.ReactNode
  /**
   * Said if the server ever omits `scope_note`. A claim about what "comparable" means for
   * THIS corpus — public records vs. a firm's own history, on the reference corpus — so it
   * cannot default to anything generic without reading as a data bug the day it fires.
   */
  scopeFallback: string
}) {
  const [data, setData] = useState<RollupResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (selection.length === 0) return
    // #38
    const controller = new AbortController()
    setData(null)
    setError(null)

    fetch('/api/terms', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ record_ids: selection }),
      signal: controller.signal,
    })
      .then(async (response) => {
        const payload = await response.json()
        if (!response.ok) throw new Error(payload?.error?.message ?? 'rollup failed')
        return payload as RollupResponse
      })
      .then(setData)
      .catch(ignoreAbort((e) => setError(e.message)))

    return () => controller.abort()
  }, [selection])

  if (selection.length === 0) {
    return (
      <div className="state state--empty">
      <ExplainerPanel id="terms" title={`What this tab is for: ${strings.tabs.terms.hint}`} diagram={diagram} defaultOpen={false}>
        {explainer}
      </ExplainerPanel>
        <h3 className="state__title">No {strings.colloquial} selected</h3>
        <p className="state__body">
          Select {strings.colloquial} in Explore and this rolls up {strings.tabs.terms.hint}.
          Nothing is rolled up over the whole corpus by default — a set you did not choose is
          not a comparable set.
        </p>
      </div>
    )
  }

  return (
    <div className="terms">
      <p className="terms__scope">{data?.scope_note ?? scopeFallback}</p>

      {error && (
        <div className="state state--error" role="alert">
          <h3 className="state__title">Rollup unavailable</h3>
          <p className="state__body">{error}</p>
          <p className="state__hint">
            This is not “no terms found” — the semantic layer did not answer, so no figure here
            would be trustworthy.
          </p>
        </div>
      )}

      {!error && !data && (
        <div className="terms__skeleton" aria-label={`loading ${strings.tabs.terms.label.toLowerCase()}`}>
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skeleton skeleton--row" />
          ))}
        </div>
      )}

      {/* Its own state, distinct from both an error and an ordinary empty result: below
          min_n, no figure — not even a count as small as "1 of 1" — is safe to show. A
          selection this size, characterized at all, identifies one client's negotiated term. */}
      {data?.refused && data.refusal && (
        <div className="state state--refusal" role="status" data-testid="refusal">
          <h3 className="state__title">Insufficient to characterize</h3>
          <p className="state__body mono">{data.refusal.message}</p>
          <p className="state__hint">
            Below n={data.refusal.threshold}, no figure here is safe to show — a count this
            small can identify a single client&rsquo;s negotiated term. Broaden the selection in
            Explore.
          </p>
        </div>
      )}

      {data && !data.refused && (
        <>
          <p className="terms__caption">
            {data.answered_subject_count} {strings.subjects} answered across{' '}
            <span className="mono">n={data.selection_n}</span> {strings.records} ·{' '}
            {data.absent_subject_count} not answered by any of them · counts rather than
            percentages below n={data.percentage_threshold}, because a percentage implies a
            precision this sample does not support
          </p>

          <ul className="terms__list">
            {data.rows.map((row) => (
              <TermRow key={row.subject} row={row} selection={selection} />
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

function TermRow({
  row,
  selection,
}: {
  row: RollupRow
  selection: string[]
}) {
  const [drilled, setDrilled] = useState<DrillRecord[] | null>(null)
  const [open, setOpen] = useState(true)
  const [drillError, setDrillError] = useState<string | null>(null)
  const absent = row.answered_n === 0
  const gated = row.display_kind === 'low_confidence'
  const nextDrillSignal = useAbortOnUnmount() // #38: drill-through is click-driven

  async function drill() {
    if (absent || gated) return
    // Toggle, not a one-way door. `aria-expanded` was always wired here, so the component
    // already claimed to toggle; the early return on `drilled` meant a row opened once and
    // could never be closed. Records are kept, so re-opening costs no request.
    if (drilled) {
      setOpen((o) => !o)
      return
    }
    try {
      const response = await fetch('/api/terms/drill', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ record_ids: selection, subject: row.subject }),
        signal: nextDrillSignal(),
      })
      const payload = await response.json()
      if (!response.ok) throw new Error(payload?.error?.message ?? 'drill-through failed')
      // the server refuses drill-through the same way it refuses the rollup (#23) — a small
      // selection must not leak a named client's clause text through this second door
      if (payload.refused) {
        setDrillError(payload.refusal?.message ?? 'This selection is too small to drill into.')
        return
      }
      setDrilled(payload.records)
    } catch (e) {
      if (isAbortError(e)) return
      setDrillError((e as Error).message)
    }
  }

  return (
    <li className={`term${absent ? ' term--absent' : ''}`} data-testid={`term-${row.subject}`}>
      <button type="button" className="term__hit" onClick={drill} aria-expanded={drilled !== null && open}>
        <span className="term__name">{row.subject}</span>

        <span className="term__figures">
          {/* neutral prevalence bar — a width, not a figure; the proportion is computed in CSS */}
          {!gated && (
            <span
              className="term__bar"
              aria-hidden="true"
              style={{ '--n': row.answered_n, '--of': selection.length } as React.CSSProperties}
            />
          )}
          {/* pre-rendered server-side; this view never divides two numbers */}
          <span className={`term__display term__display--${row.display_kind}`}>{row.display}</span>
          {row.numeric && (
            <span className="term__numeric">
              median {fmt(row.numeric.median)} · {fmt(row.numeric.p25)}–{fmt(row.numeric.p75)} ·{' '}
              <span className="mono">n={row.numeric.numeric_n}</span>
            </span>
          )}
        </span>
      </button>

      {gated && row.gate_note && <p className="term__absent">{row.gate_note}</p>}

      {row.positions.length > 0 && (
        <ul className="term__positions">
          {row.positions.map((p) => (
            <li key={p.position} className="term__position">
              <span className="term__poslabel">{p.position}</span>
              <span className="mono muted">n={p.n}</span>
              {/* The slice share against the corpus share. A distribution with no baseline is
                  uninterpretable: "Fraud Reported Y = 35 of 100" reads as a finding until you
                  know the corpus rate is 24.7%, at which point it becomes one. Rendered only
                  when the two differ enough to mean something — a delta inside a couple of
                  points is noise, and printing it invites a reader to over-read it. */}
              {(() => {
                const base = row.corpus_answered_n ?? 0
                const slice = row.answered_n ?? 0
                if (!base || !slice || p.corpus_n === undefined) return null
                const here = (p.n / slice) * 100
                const corpus = (p.corpus_n / base) * 100
                const delta = here - corpus
                return (
                  <span className="term__baseline mono">
                    {here.toFixed(0)}% vs {corpus.toFixed(0)}% corpus
                    {Math.abs(delta) >= 5 && (
                      <b className={delta > 0 ? 'term__up' : 'term__down'}>
                        {' '}
                        {delta > 0 ? '+' : ''}
                        {delta.toFixed(0)}
                      </b>
                    )}
                  </span>
                )
              })()}
            </li>
          ))}
        </ul>
      )}

      {absent && (
        <p className="term__absent">
          No answer recorded in this set.
        </p>
      )}

      {drillError && (
        <p className="term__absent" role="alert">
          {drillError}
        </p>
      )}

      {drilled && open && (
        <ul className="term__drill">
          {drilled.map((m) => (
            <li key={m.record_id} className="drill" data-testid={`drill-${m.record_id}`}>
              <div className="drill__head">
                <span className="drill__party">{m.target_name ?? m.record_id}</span>
                <span className="term__poslabel">{m.position}</span>
              </div>
              {m.clause_text ? (
                <>
                  {/* MAUD's spans mark where in the agreement an answer was found, which for
                      holistic deal points is most of the document — median 4,658 characters,
                      90th percentile 238,949. A span that wide is not the operative language,
                      and showing it under the word "clause" was showing a table of contents.
                      The excerpt says what it is instead. */}
                  {/* the row is head | text; note, clause and provenance stack inside the
                      text column so a full-width note cannot squeeze the clause into a strip */}
                  <div className="drill__text">
                  {m.is_excerpt && (
                    <p className="dp__excerptnote" data-testid="excerpt-note">
                      Document-scale span — {m.span_chars?.toLocaleString()} characters. MAUD
                      recorded where this answer was found rather than the clause that carries it.
                      Opening excerpt only; open the filing for the operative language.
                    </p>
                  )}
                  <blockquote className={`dp__clause${m.is_excerpt ? ' dp__clause--excerpt' : ''}`}>
                    {m.clause_text}
                  </blockquote>
                  <p className="dp__span mono muted">
                    {m.source_file} [{m.source_span_start}, {m.source_span_end})
                  </p>
                  </div>
                </>
              ) : (
                <p className="dp__missing">{m.text_unavailable}</p>
              )}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

function fmt(value: number | null): string {
  return value === null ? '—' : String(value)
}
