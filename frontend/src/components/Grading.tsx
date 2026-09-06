import { useEffect, useState } from 'react'
import type { CorrectionsGrade, GradingResponse } from '../types'
import { ignoreAbort } from '../index'

/**
 * The offline grade (#36).
 *
 * This is the payoff of a fixed vocabulary: correctness is a discrete question, so it can be
 * scored from committed fixtures with no database and no model call. Freeform text-to-SQL has
 * no equivalent — two generated queries can be diffed but not scored, so there is nothing to
 * put in a table like this.
 *
 * Refusal cases are shown apart from the rest rather than averaged in. Refusal accuracy is the
 * worst number here, and it is also the argument for why min_n is enforced server-side rather
 * than asked for in a prompt.
 */
export function Grading() {
  const [data, setData] = useState<GradingResponse | null>(null)
  const [corrections, setCorrections] = useState<CorrectionsGrade | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // #38: abort rather than a `cancelled` flag — the flag discarded the result but let the
    // request finish, which is why a resolution could still land after teardown
    const controller = new AbortController()
    fetch('/api/agent/grading', { signal: controller.signal })
      .then(async (r) => {
        const body = await r.json()
        if (!r.ok) throw new Error(body?.detail ?? 'Grading fixtures are not committed.')
        return body as GradingResponse
      })
      .then(setData)
      .catch(ignoreAbort((e) => setError(e.message)))

    // #51: a second request rather than a second field on the first. `/agent/grading` grades
    // with no database — a test pins that by forbidding psycopg.connect for the call — and
    // these rows live in Postgres. A failure here leaves the authored row standing.
    fetch('/api/agent/corrections-grade', { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => setCorrections(body as CorrectionsGrade | null))
      .catch(ignoreAbort(() => setCorrections(null)))

    return () => controller.abort()
  }, [])

  if (error) {
    return (
      <section className="sem__pane">
        <h3 className="sem__h">Offline grading</h3>
        <p className="sem__sub">{error}</p>
      </section>
    )
  }
  if (!data) return <div className="skeleton skeleton--row" aria-label="loading grading" />

  const refusalBad = data.refusal_correct < data.refusal_total
  // Read defensively: this comes from a second endpoint that may 404 on a database with no
  // selection_corrections table yet, and a missing corrections row must not take the authored
  // row down with it.
  const correctionCount = corrections?.corrections_count ?? 0
  const changedFields = corrections?.changed_field_counts ?? {}

  return (
    <section className="sem__pane" data-testid="grading">
      <h3 className="sem__h">The grade — computed with no database and no model</h3>
      <p className="sem__sub">{data.note}</p>
      <p className="sem__sub">
        <strong>Read the failures before the score.</strong> Exact-set matching is harsher than
        it looks: <code>q01</code> is marked wrong for choosing{' '}
        <code>count_distinct_matters</code> where the case expected{' '}
        <code>matters_total</code> — and the Cube model documents those two as the same measure
        under different names. A grader that cannot see an alias will punish a correct answer,
        which is itself a finding about the vocabulary rather than about the model.
      </p>

      {/*
        #51: two rows, never one headline. The authored set was written in July to probe the
        vocabulary and deliberately includes five questions that should be refused; the
        corrections are whatever people actually asked on Ask, which is not a balanced sample
        of anything. An average over both would describe neither.
      */}
      <table className="admin__table grade__sets" data-testid="grade-sets">
        <thead>
          <tr>
            <th>case set</th>
            <th>n</th>
            <th>model was right</th>
            <th>what people changed</th>
          </tr>
        </thead>
        <tbody>
          <tr data-testid="grade-authored">
            <td>authored — written to probe the vocabulary</td>
            <td className="mono">{data.answerable_total}</td>
            <td className="mono">
              {data.answerable_correct} of {data.answerable_total}
            </td>
            <td className="mono">—</td>
          </tr>
          <tr data-testid="grade-corrections">
            <td>corrections — real confirmations on Ask</td>
            <td className="mono">{correctionCount}</td>
            <td className="mono">
              {correctionCount > 0 ? (
                <>
                  {corrections?.corrections_agreed ?? 0} of {correctionCount}
                </>
              ) : (
                // n=0 is the honest statement. 0.00 would read as "the model is always wrong".
                <span className="admin__unmeasured">not measured</span>
              )}
            </td>
            <td className="mono">
              {Object.keys(changedFields).length > 0
                ? Object.entries(changedFields)
                    .map(([field, n]) => `${field} ${n}`)
                    .join(' · ')
                : '—'}
            </td>
          </tr>
        </tbody>
      </table>

      <div className="grade__tiles">
        <div className="grade__tile">
          <span className="grade__num" data-testid="grade-answerable">
            {data.answerable_correct} of {data.answerable_total}
          </span>
          <span className="grade__lbl">answerable questions, exact selection match</span>
        </div>
        <div className={`grade__tile${refusalBad ? ' is-bad' : ''}`}>
          <span className="grade__num" data-testid="grade-refusal">
            {data.refusal_correct} of {data.refusal_total}
          </span>
          <span className="grade__lbl">
            questions it should have declined — and mostly did not
          </span>
        </div>
      </div>

      {refusalBad && (
        <p className="qb__blocked" data-testid="grade-finding">
          <strong>This is the finding.</strong> The model is bad at knowing when
          to refuse. That is precisely why <code>min_n</code> is enforced in the API rather than
          asked for in a prompt — refusal cannot be the model&rsquo;s job when this is how well
          it does it.
        </p>
      )}

      <div className="scrollx">
        <table className="admin__table grade__table">
          <thead>
            <tr>
              <th>question</th>
              <th>expected</th>
              <th>actual</th>
              <th>ok</th>
            </tr>
          </thead>
          <tbody>
            {data.cases.map((c) => (
              <tr key={c.id} className={c.correct ? '' : 'grade__row--bad'}>
                <td>
                  {c.question}
                  {c.should_refuse && <span className="grade__tag">should refuse</span>}
                </td>
                <td className="mono">
                  {c.should_refuse ? '(nothing)' : c.expected_measures.join(', ') || '—'}
                  {c.expected_dimensions.length > 0 && (
                    <span className="grade__dims">by {c.expected_dimensions.join(', ')}</span>
                  )}
                </td>
                <td className="mono">
                  {c.actual_measures.join(', ') || '(nothing)'}
                  {c.actual_dimensions.length > 0 && (
                    <span className="grade__dims">by {c.actual_dimensions.join(', ')}</span>
                  )}
                </td>
                <td className={c.correct ? 'admin__ok' : 'admin__bad'}>{c.correct ? '✓' : '✗'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
