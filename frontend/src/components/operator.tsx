import { useEffect, useState } from 'react'
import type { IngestRun, LogLine } from '../types'
import { ignoreAbort } from '../index'

/**
 * The operator surface: did the data land, and what did the server do (#30, moved in #54).
 *
 * Lifted out of the Admin view unchanged when #54 folded Admin into Trust. These two answer
 * "is the thing running", which is a different question from "should the numbers be believed"
 * — so they live at the bottom of Trust behind a disclosure rather than beside the evidence.
 * The code is the same code; only where it is mounted changed.
 */

export function IngestStatus() {
  const [runs, setRuns] = useState<IngestRun[] | null>(null)

  useEffect(() => {
    // #38: every fetch in this file is aborted on teardown, not merely ignored on arrival
    const controller = new AbortController()
    fetch('/api/admin/ingest-status', { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => setRuns(d.runs))
      .catch(
        ignoreAbort((e) => {
          throw e
        }),
      )
    return () => controller.abort()
  }, [])

  return (
    <section className="admin__section">
      <h2 className="admin__heading">Ingest status</h2>
      {!runs && <div className="skeleton skeleton--row" aria-label="loading ingest status" />}
      {runs && (
        <table className="admin__table">
          <thead>
            <tr>
              <th>source</th>
              <th>rows upserted</th>
              <th>duration</th>
              <th>sha256</th>
              <th>status</th>
              <th>started</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.source}>
                <td>{r.source}</td>
                <td className="mono">{r.rows_upserted}</td>
                <td className="mono">{r.duration_ms ? `${r.duration_ms.toFixed(0)}ms` : '—'}</td>
                <td className="mono admin__sha">{r.sha256 ?? '—'}</td>
                <td className={r.status === 'ok' ? 'admin__ok' : 'admin__bad'}>{r.status}</td>
                <td className="mono">{r.started_at?.slice(0, 19).replace('T', ' ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  )
}

/**
 * Calibration (#44) — the extractor's weakness map, all 92 deal points, worst first.
 *
 * The ordering and the reportable flag are computed by the grader and committed to
 * `docs/eval/calibration_accuracy.json`; this renders them. The same file backs
 * `deal_terms.confidence_lookup()`, so the accuracy on screen is the accuracy in the gate.
 *
 * Two rules this table exists to hold:
 * - Every accuracy carries its own n. A deal point measured on 4 matters and one measured on 20
 *   are not comparable, and a bare percentage hides that.
 * - "Not measured" is its own state, never 0.00. A deal point the run never reached is a
 *   coverage gap, not a failed extraction.
 */


export function LogViewer() {
  const [lines, setLines] = useState<LogLine[]>([])
  const [totalMatched, setTotalMatched] = useState(0)
  const [level, setLevel] = useState('')
  const [q, setQ] = useState('')
  const [offset, setOffset] = useState(0)
  const limit = 50

  useEffect(() => {
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) })
    if (level) params.set('level', level)
    if (q) params.set('q', q)
    const controller = new AbortController()
    fetch(`/api/admin/logs?${params}`, { signal: controller.signal })
      .then((r) => r.json())
      .then((d) => {
        setLines(d.lines)
        setTotalMatched(d.total_matched)
      })
      .catch(
        ignoreAbort((e) => {
          throw e
        }),
      )
    return () => controller.abort()
  }, [level, q, offset])

  return (
    <section className="admin__section">
      <h2 className="admin__heading">Logs</h2>
      <div className="admin__logbar">
        <select
          aria-label="filter by level"
          value={level}
          onChange={(e) => {
            setLevel(e.target.value)
            setOffset(0)
          }}
        >
          <option value="">all levels</option>
          <option value="info">info</option>
          <option value="warning">warning</option>
          <option value="error">error</option>
        </select>
        <input
          type="search"
          aria-label="filter logs"
          placeholder="filter…"
          value={q}
          onChange={(e) => {
            setQ(e.target.value)
            setOffset(0)
          }}
        />
        <span className="admin__logcount mono">{totalMatched} matched</span>
      </div>

      <table className="admin__table admin__logtable">
        <thead>
          <tr>
            <th>time</th>
            <th>level</th>
            <th>request_id</th>
            <th>event</th>
            <th>duration_ms</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, i) => (
            <tr key={i}>
              <td className="mono">{String(line.timestamp ?? '').slice(11, 19)}</td>
              <td>{line.level}</td>
              <td className="mono">{line.request_id ?? '—'}</td>
              <td>{line.event}</td>
              <td className="mono">{line.duration_ms ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="admin__pager">
        <button
          type="button"
          disabled={offset === 0}
          onClick={() => setOffset((o) => Math.max(0, o - limit))}
        >
          prev
        </button>
        <span className="mono">
          {offset + 1}–{Math.min(offset + limit, totalMatched)} of {totalMatched}
        </span>
        <button
          type="button"
          disabled={offset + limit >= totalMatched}
          onClick={() => setOffset((o) => o + limit)}
        >
          next
        </button>
      </div>
    </section>
  )
}
