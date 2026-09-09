import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { RecordCard } from '../components/RecordCard'
import type { CorpusRecord } from '../types'
import { isAbortError, useAbortOnUnmount } from '../index'
import type { QuorumStrings } from '../strings'
import { AnswerRows } from '../components/AskBox'
import type { AskExample, DrillResult } from '../components/AskBox'

/**
 * Ask, one question at a time (extracted from claims-explorer 2026-09-08).
 *
 * The platform already had `AskBox`, which returns a selection and makes a person confirm it as
 * editable chips before anything runs. That is the right shape for a domain whose interpreter is
 * mediocre at the filter value and bad at declining, and it is two steps where a reader expects
 * one. This component is the other arrangement, and it is the better UX for the same guarantees:
 * post the question, state what was understood, show the gated answer, and put the *whole*
 * derivation one disclosure away.
 *
 * ## Confirmation is conditional, and that is the point
 *
 * The measured weakness was never "the model picks filter values badly" in general — an exact,
 * case-insensitive match against the corpus's own values is free, deterministic and involves no
 * model call at all. The weakness is the ladder's upper rungs. So a question whose every value
 * resolved EXACTLY runs immediately, and one where a value was guessed stops and asks, showing
 * the corpus's actual values to choose from.
 *
 * That keeps the guarantee people care about (nothing that was guessed executes unreviewed)
 * while removing the ceremony from the ~majority of questions where nothing was guessed. The
 * server decides, not this component: it sets `needs_confirmation`, because only the server
 * knows which rung each value came off.
 *
 * ## What is domain-supplied, and why
 *
 * Answer *shapes* are the platform's — a refusal, a list of records, one number with a spread,
 * a distribution, a bare count. Answer *units* are not: one corpus's numbers are dollars and
 * another's are business days, and formatting days as `$4` is the kind of wrong that looks
 * fine. So `numeric` arrives as a prop, as do the record renderers and the sentence explaining
 * what the sample-size floor protects, which is a regulation in one domain and legal ethics in
 * another.
 */

/** How this corpus's numeric answers are recognised and written down. */
export interface NumericAnswerFormat {
  /** Matches a measure that returns one number, e.g. `^claims\.median_`. */
  match: (measureName: string) => boolean
  /** The p25/p75 pair to show as a spread, when the row carries both. */
  spread?: readonly [string, string]
  /** The count measure whose value is the `n` beside the number. */
  denominator: string
  /** `claims.median_vehicle_claim` -> "median vehicle claim" */
  label: (measureName: string) => string
  /** Units live here. Dollars, days, months, percent — the platform must not guess. */
  format: (value: string) => string
}

export interface AskValueResolution {
  raw: string
  resolved: string
  method: string
  /** The corpus's actual values, offered when this one was guessed rather than matched. */
  candidates?: string[]
}

export interface AskReceipt {
  measures: string[]
  dimensions: string[]
  filters: { member: string; operator: string; values: string[] }[]
  choice_count: number
  sql: string
  params: string[]
  cache_key_queries: string[]
  resolutions: AskValueResolution[]
  descriptions: Record<string, string>
  other_grain: { measure: string; value: string; asked: string } | null
}

export interface AskConsoleResponse {
  question: string
  resolved_query: string
  selection: {
    measures?: string[]
    dimensions?: string[]
    filters?: { member: string; operator: string; values: string[] }[]
  }
  rows: Record<string, string>[]
  n: number | null
  refused: boolean
  threshold: number | null
  message: string | null
  declined: boolean
  decline_reason: string | null
  receipt: AskReceipt | null
  records: CorpusRecord[] | null
  /** Set by the server when a filter value was guessed rather than matched exactly. */
  needs_confirmation?: boolean
  resolutions?: AskValueResolution[]
  usage?: { cost_usd: number } | null
}

/**
 * A list answer: the records themselves, drawn by the same `RecordCard` the search tab uses and
 * expanding to the same detail. Deliberately not a bespoke table — a record should look and
 * behave like one wherever the reader meets it, and the expand panel is where the evidence for
 * each finding already lives.
 */
function RecordList({
  records,
  strings,
  render,
}: {
  records: CorpusRecord[]
  strings: QuorumStrings
  render: Parameters<typeof RecordCard>[0]['render']
}) {
  const [expanded, setExpanded] = useState<string | null>(null)
  const [focused, setFocused] = useState<string | null>(null)
  return (
    <ul className="explore__list" data-testid="ask-records">
      {records.map((record) => (
        <RecordCard
          key={record.record_id}
          record={record}
          strings={strings}
          render={render}
          focused={focused === record.record_id}
          expanded={expanded === record.record_id}
          onFocus={() => setFocused(record.record_id)}
          onToggle={() => setExpanded((e) => (e === record.record_id ? null : record.record_id))}
        />
      ))}
    </ul>
  )
}

function Answer({
  response,
  strings,
  numeric,
  render,
  refusalHint,
  onDrill,
}: {
  response: AskConsoleResponse
  strings: QuorumStrings
  numeric: NumericAnswerFormat
  render: Parameters<typeof RecordCard>[0]['render']
  refusalHint: (threshold: number | null) => ReactNode
  onDrill?: (subject: string, position: string) => Promise<DrillResult>
}) {
  if (response.refused) {
    return (
      <div className="state state--refusal" role="status" data-testid="ask-refused">
        <h3 className="state__title">Insufficient to characterize</h3>
        <p className="state__body mono">{response.message}</p>
        <p className="state__hint">{refusalHint(response.threshold)}</p>
      </div>
    )
  }

  if (response.records) {
    return <RecordList records={response.records} strings={strings} render={render} />
  }

  const [row] = response.rows
  const numericKey = row && Object.keys(row).find((k) => numeric.match(k))
  if (row && numericKey) {
    const hasSpread = numeric.spread?.every((k) => row[k] !== undefined)
    return (
      <div className="terms__caption" data-testid="ask-amount">
        <p className="qb__n">
          {numeric.label(numericKey)}{' '}
          <span className="mono">{numeric.format(row[numericKey]!)}</span>
        </p>
        <p className="mono muted">
          {hasSpread && numeric.spread && (
            <>
              {numeric.format(row[numeric.spread[0]]!)} – {numeric.format(row[numeric.spread[1]]!)}{' '}
              ·{' '}
            </>
          )}
          n={row[numeric.denominator]}
        </p>
      </div>
    )
  }

  const dimension = response.selection.dimensions?.[0]
  const measure = response.selection.measures?.[0]
  if (dimension && measure) {
    // The same renderer the chip-confirming AskBox uses, so a distribution drills to the
    // records and their quoted source text here too rather than dead-ending at a count.
    return (
      <AnswerRows
        rows={response.rows}
        query={{
          dimensions: response.selection.dimensions ?? [],
          filters: (response.selection.filters ?? []).map((f) => ({
            member: f.member,
            values: f.values,
          })),
        }}
        strings={strings}
        onDrill={onDrill}
      />
    )
  }

  if (measure && response.rows[0]) {
    return (
      <p className="qb__n" data-testid="ask-count">
        <span className="mono">{response.rows[0][measure]}</span> {strings.records}
      </p>
    )
  }

  return <p className="qb__hint">No rows.</p>
}

function ReceiptPanel({
  receipt,
  otherGrainNote,
}: {
  receipt: AskReceipt
  otherGrainNote: (og: { measure: string; value: string; asked: string }) => ReactNode
}) {
  return (
    <details className="receipt" data-testid="ask-receipt">
      <summary>
        how this was computed — {receipt.choice_count} enum choices in,{' '}
        {receipt.sql.split('\n').length} lines of SQL out
      </summary>

      <div className="receipt__grid">
        <div>
          <p className="receipt__h">what the model selected</p>
          {[...receipt.measures, ...receipt.dimensions].map((name) => (
            <div key={name} className="receipt__row">
              <span className="mono" title={receipt.descriptions[name]}>
                {name}
              </span>
            </div>
          ))}
          {receipt.filters.map((f) => (
            <div key={f.member} className="receipt__row">
              <span className="mono muted">where</span>{' '}
              <span className="mono" title={receipt.descriptions[f.member]}>
                {f.member} {f.operator} {f.values.join(', ')}
              </span>
            </div>
          ))}
          {Object.keys(receipt.descriptions).length > 0 && (
            <p className="receipt__note">
              Every name above carries its own definition, read live from Cube&rsquo;s{' '}
              <span className="mono">/meta</span> rather than a checked-in copy — hover one. A
              number can be right and still answer a different question than the one asked, and
              that is where the difference is written down.
            </p>
          )}

          {receipt.other_grain && (
            <div data-testid="other-grain">
              <p className="receipt__h" style={{ marginTop: 12 }}>
                the same slice, counted the other way
              </p>
              <div className="receipt__row">
                <span className="mono">{receipt.other_grain.measure}</span>
                <span className="mono">= {receipt.other_grain.value}</span>
              </div>
              <p className="receipt__note">{otherGrainNote(receipt.other_grain)}</p>
            </div>
          )}

          {receipt.resolutions.length > 0 && (
            <>
              <p className="receipt__h" style={{ marginTop: 12 }}>
                how each value resolved
              </p>
              {receipt.resolutions.map((r) => (
                <div key={r.raw} className="receipt__row" data-testid={`resolution-${r.method}`}>
                  <span className="mono">“{r.raw}”</span>
                  <span className="muted">→</span>
                  <span className="mono">{r.resolved}</span>
                  <span className={`receipt__tier receipt__tier--${r.method}`}>{r.method}</span>
                </div>
              ))}
              <p className="receipt__note">
                <strong>exact</strong> is a case-insensitive match against the corpus&rsquo;s own
                values — free, deterministic, no model call, and it runs without asking you to
                confirm anything. Any other tier is a <em>guess</em>, and a guess stops and asks.
              </p>
            </>
          )}
        </div>

        <div>
          <p className="receipt__h">what Postgres was asked to compute</p>
          <pre className="receipt__sql">{receipt.sql}</pre>
          <p className="receipt__note">
            Parameters are bound, never written into the statement:{' '}
            <span className="mono">[{receipt.params.map((p) => `“${p}”`).join(', ')}]</span>
          </p>
          {receipt.cache_key_queries.length > 0 && (
            <p className="receipt__note">
              Freshness is decided by{' '}
              <span className="mono">{receipt.cache_key_queries.join(' · ')}</span> — a cached
              answer is reused only while those are unchanged.
            </p>
          )}
        </div>
      </div>
    </details>
  )
}

/**
 * The one place a guess is reviewed.
 *
 * Only the values that were guessed appear here — a question with none never reaches this. Each
 * is a `<select>` over what the corpus actually carries, because every filterable field in these
 * models is a closed vocabulary, so there is no free-text path to leave open.
 */
function ConfirmGuesses({
  response,
  onRun,
  busy,
}: {
  response: AskConsoleResponse
  onRun: (edited: Record<string, string>) => void
  busy: boolean
}) {
  const guessed = (response.resolutions ?? []).filter((r) => r.method !== 'exact')
  const [chosen, setChosen] = useState<Record<string, string>>(
    Object.fromEntries(guessed.map((g) => [g.raw, g.resolved])),
  )
  return (
    <div className="askc" data-testid="ask-confirm">
      <p className="askc__lead">
        <strong>One value was guessed, so nothing has run yet.</strong> An exact match would have
        gone straight through; this one came off a higher rung of the ladder, which is the rung the
        measured error rate is about.
      </p>
      {guessed.map((g) => (
        <div className="askc__row" key={g.raw}>
          <span className="mono">“{g.raw}”</span>
          <span className="muted">→</span>
          {g.candidates && g.candidates.length > 0 ? (
            <select
              className="askc__select"
              aria-label={`value for ${g.raw}`}
              value={chosen[g.raw] ?? g.resolved}
              onChange={(e) => setChosen((c) => ({ ...c, [g.raw]: e.target.value }))}
            >
              {g.candidates.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : (
            <span className="mono">{g.resolved}</span>
          )}
          <span className={`receipt__tier receipt__tier--${g.method}`}>{g.method}</span>
        </div>
      ))}
      <button type="button" className="qb__run" onClick={() => onRun(chosen)} disabled={busy}>
        {busy ? 'running…' : 'Run it'}
      </button>
    </div>
  )
}

export function AskConsole({
  strings,
  examples = [],
  numeric,
  render,
  refusalHint,
  otherGrainNote,
  askEndpoint = '/api/ask',
  seed = null,
  onSeedConsumed,
  onDrill,
  onAsked,
}: {
  strings: QuorumStrings
  /** Starter questions with the result each returns. Verified, not plausible. */
  examples?: AskExample[]
  numeric: NumericAnswerFormat
  render: Parameters<typeof RecordCard>[0]['render']
  /** What the sample-size floor protects, in this domain's terms. */
  refusalHint: (threshold: number | null) => ReactNode
  otherGrainNote: (og: { measure: string; value: string; asked: string }) => ReactNode
  askEndpoint?: string
  /** A question submitted on arrival — how an Overview journey lands here already answered. */
  seed?: string | null
  onSeedConsumed?: () => void
  /** Fetch the records behind one row of a distribution, with their quoted source text. */
  onDrill?: (subject: string, position: string) => Promise<DrillResult>
  /** What the question cost, so a session total can be shown rather than estimated. */
  onAsked?: (costUsd: number) => void
}) {
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [running, setRunning] = useState(false)
  const [response, setResponse] = useState<AskConsoleResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const nextSignal = useAbortOnUnmount()

  useEffect(() => {
    if (!seed) return
    onSeedConsumed?.()
    void ask(seed)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed])

  async function ask(text: string = question) {
    if (!text.trim()) return
    setQuestion(text)
    const signal = nextSignal()
    setAsking(true)
    setError(null)
    setResponse(null)
    try {
      const r = await fetch(askEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: text }),
        signal,
      })
      const body = await r.json()
      if (!r.ok)
        throw new Error(
          body?.error?.message ?? body?.detail ?? 'The question could not be interpreted.',
        )
      const parsed = body as AskConsoleResponse
      setResponse(parsed)
      if (parsed.usage) onAsked?.(parsed.usage.cost_usd)
    } catch (e) {
      if (isAbortError(e)) return
      setError((e as Error).message)
    } finally {
      if (!signal.aborted) setAsking(false)
    }
  }

  /** Confirming a guess runs the SAME selection through the SAME gated route as everything else. */
  async function runConfirmed(edited: Record<string, string>) {
    if (!response) return
    const filters = (response.selection.filters ?? []).map((f) => {
      const guess = (response.resolutions ?? []).find((r) => f.values.includes(r.resolved))
      const replacement = guess ? edited[guess.raw] : undefined
      return replacement ? { ...f, values: [replacement] } : f
    })
    setRunning(true)
    setError(null)
    try {
      const r = await fetch(askEndpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          question: response.question,
          confirmed: { ...response.selection, filters },
        }),
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body?.error?.message ?? body?.detail ?? 'That did not run.')
      setResponse(body as AskConsoleResponse)
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="ask" data-testid="ask-view">
      <div className="ask__row">
        <input
          type="text"
          className="ask__input"
          data-testid="ask-question"
          aria-label="ask a question"
          placeholder={strings.exampleQuestion}
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') ask()
          }}
        />
        <button
          type="button"
          className="qb__run"
          onClick={() => ask()}
          disabled={asking || !question.trim()}
        >
          {asking ? 'asking…' : 'Ask'}
        </button>
      </div>

      {!response && !asking && examples.length > 0 && (
        <div className="ask__tiles" data-testid="ask-tiles">
          {examples.map((ex) => (
            <button
              key={ex.question}
              type="button"
              className="ask__tile"
              onClick={() => ask(ex.question)}
            >
              <span className="ask__tile-q">{ex.question}</span>
              <span className="ask__tile-a">{ex.expect}</span>
            </button>
          ))}
        </div>
      )}

      {asking && <div className="skeleton skeleton--row" aria-label="interpreting the question" />}

      {error && (
        <div className="qb__rejected" data-testid="ask-error">
          <strong>The question was not interpreted.</strong>
          <p>{error}</p>
        </div>
      )}

      {response && response.declined && (
        <div className="qb__blocked" data-testid="ask-declined">
          <strong>Not answerable.</strong> {response.decline_reason}
        </div>
      )}

      {response && !response.declined && (
        <>
          <p className="terms__scope mono" data-testid="ask-resolved">
            {response.resolved_query}
          </p>
          {response.needs_confirmation ? (
            <ConfirmGuesses response={response} onRun={runConfirmed} busy={running} />
          ) : (
            <>
              {response.receipt && (
                <ReceiptPanel receipt={response.receipt} otherGrainNote={otherGrainNote} />
              )}
              <Answer
                response={response}
                strings={strings}
                numeric={numeric}
                render={render}
                refusalHint={refusalHint}
                onDrill={onDrill}
              />
            </>
          )}
        </>
      )}
    </section>
  )
}
