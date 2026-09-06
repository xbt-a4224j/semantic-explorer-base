import { useMemo, useState } from 'react'
import type { AskFilter, AskResponse, MemberInfo, RunSelectionResponse } from '../types'
import { isAbortError, useAbortOnUnmount } from '../index'
import { formatLatency, formatTokens, formatUsd } from '../index'
import type { QuorumStrings } from '../strings'

/**
 * Ask in words, confirm the reading, then run (#47, #57).
 *
 * The panel below this one builds a query by clicking, and its argument is an *absence*: no
 * text box, so an invalid measure cannot be expressed. This one is the other half. A question
 * goes to the model, which returns a **selection** — never an answer, never a number — and the
 * selection comes back as chips a person edits before anything executes.
 *
 * Three things are load-bearing and easy to lose in a refactor:
 *
 * 1. **`/agent/ask` never executes.** Confirming posts to `/agent/run-selection`, unchanged,
 *    so the validation gate and the `min_n` refusal apply exactly as they do everywhere else.
 * 2. **The confirmation step is not ceremony.** Graded over 25 authored cases, the model runs
 *    0.80 measure precision, 0.692 dimension precision, 0.50 filter exact-match and 0.20
 *    refusal accuracy. Decent at the measure, mediocre at the filter value, bad at declining.
 *    The chips put all three in front of the one person who can catch a misreading.
 * 3. **An unresolved filter value blocks the run.** It never becomes a query returning zero
 *    rows, because zero rows reads as "we have no comparable records" rather than "you named an
 *    industry this corpus does not carry".
 *
 * ## What #57 changed
 *
 * Asked *"What's the average deal size for healthcare?"* this drew
 * `[measure n ×] [measure n ×] [has_industry ( ) edited by you ×]`. Four faults:
 *
 * * **The chip showed the bare member suffix.** The catalog has carried a `title` and a full
 *   `description` for every member since #36 and neither was used. A person confirming a
 *   selection cannot confirm what they cannot read.
 * * **The same chip was drawn twice**, because the model named the measure twice and the UI
 *   reproduced the sloppiness. `/agent/ask` collapses it now.
 * * **A two-value field was offered as a free-text box.** Every dimension in this model is a
 *   closed vocabulary, so a filter value is a `<select>` over what the corpus holds. There is
 *   no free-text path left on this row.
 * * **The corpus never said it could not answer.** `deal_value_usd` is NULL on all 152
 *   matters, so nothing about deal size was answerable and the box asked the user to repair a
 *   selection that could not be repaired.
 *
 * The last three all need something the frontend could not ask for, so they are fed by
 * `POST /agent/members`: title, description, the closed vocabulary, and corpus coverage per
 * selected name. It is a second round trip on purpose — `/agent/ask` must not touch Cube.
 */

/** The qualified name, for the line under the title. It is what actually gets sent. */
function shortName(name: string) {
  return name.split('.').slice(1).join('.') || name
}

interface EditableFilter extends AskFilter {
  /** what the chip opened on, so "edited" can mean "different from that" */
  original: string
  /**
   * The model's value, when the corpus does not carry it (#57).
   *
   * Caught by driving the running app: asked "how many all-cash deals are there" the model
   * filtered `consideration_type = "All Cash Deal"`, which is not one of the four answers this
   * corpus holds. The chip's select fell back to its placeholder while state still held the
   * text, so the run went ahead and returned `comparable_deals.n = 0` — the exact failure the
   * resolution ladder prevents on industry labels, one field over from where the ladder runs.
   * The ladder has no vocabulary for this dimension; `/agent/members` does.
   */
  offVocabulary: string | null
}

interface Confirmed {
  measures: string[]
  dimensions: string[]
  filters: EditableFilter[]
}

/**
 * #57 fault 2, second line of defence.
 *
 * `/agent/ask` collapses a repeated name before it returns, and that is the contract every
 * consumer gets. This is here because React keys on the chip row must be unique regardless of
 * what a response contains — a duplicate arriving from anywhere renders two chips with one key
 * and React's own behaviour on that is undefined. Cheap, and it fails safe.
 */
function collapse(names: string[]) {
  return names.filter((name, i) => names.indexOf(name) === i)
}

function toConfirmed(response: AskResponse): Confirmed {
  return {
    measures: collapse(response.measures),
    dimensions: collapse(response.dimensions),
    filters: response.filters.map((f) => ({
      ...f,
      values: [...f.values],
      original: f.values[0] ?? '',
      offVocabulary: null,
    })),
  }
}

/**
 * Drop any filter value the member's own vocabulary does not contain (#57).
 *
 * Runs once, when `/agent/members` lands. The value is cleared rather than kept, because a
 * `<select>` cannot display a value that is not one of its options: it silently shows the
 * placeholder while state still holds the text, and the run then goes ahead against a value
 * nothing matches. `original` becomes the empty string so the chip does not immediately claim
 * a person edited it, and the model's text moves to `offVocabulary` so the note can name it.
 */
function reconcile(confirmed: Confirmed, members: Record<string, MemberInfo>): Confirmed {
  return {
    ...confirmed,
    filters: confirmed.filters.map((f) => {
      const info = members[f.member]
      const value = f.values[0] ?? ''
      if (!info?.enumerable || !value || info.candidates.includes(value)) return f
      return { ...f, values: [], original: '', offVocabulary: value }
    }),
  }
}

/**
 * #57: "edited by you" appears only when a person actually changed something.
 *
 * It was previously set by any `onChange`, so re-picking the value the model chose still read
 * as a correction — and #51 records confirmations as eval data, so a false "edited" would have
 * become a labelled disagreement that never happened.
 */
function isEdited(filter: EditableFilter) {
  return (filter.values[0] ?? '') !== filter.original
}

/** A filter with no value cannot run: an unresolved value must not become an empty `IN ()`. */
function isBlocked(filters: EditableFilter[]) {
  return filters.some((f) => f.values.length === 0 || f.values.some((v) => !v.trim()))
}

function Resolution({ filter }: { filter: EditableFilter }) {
  const resolution = filter.resolutions[0]
  if (!resolution) return null
  if (isEdited(filter)) return <span className="ask__method">edited by you</span>
  if (filter.offVocabulary) {
    // "verbatim" was true of the value the ladder passed through, and false of the chip once
    // that value was dropped for not being in the field's vocabulary.
    return <span className="ask__method ask__method--unresolved">not in the vocabulary</span>
  }
  if (resolution.method === 'unresolved') {
    return <span className="ask__method ask__method--unresolved">unresolved</span>
  }
  return (
    <span className="ask__method">
      {resolution.method}
      {resolution.similarity !== null && <> · {resolution.similarity.toFixed(2)}</>}
      {resolution.record_count !== null && <> · n={resolution.record_count}</>}
    </span>
  )
}

/**
 * The member's name, as a person reads it (#57).
 *
 * The title is the label; the qualified name stays underneath because it is what gets sent and
 * a reviewer checking a selection against the catalog needs it. The description is on the
 * `title` attribute for hover and behind a click for everyone who does not hover — a tooltip
 * is not an affordance on a touch screen or for a keyboard.
 */
function ChipName({
  name,
  info,
  expanded,
  onToggle,
}: {
  name: string
  info?: MemberInfo
  expanded: boolean
  onToggle: () => void
}) {
  const title = info?.title ?? shortName(name)
  const description = info?.description ?? ''
  return (
    <>
      <button
        type="button"
        className="ask__chipname"
        data-testid="chip-name"
        title={description || undefined}
        aria-expanded={description ? expanded : undefined}
        onClick={onToggle}
      >
        {title}
        <span className="ask__chipqual mono">{name}</span>
      </button>
      {expanded && description && (
        <span className="ask__chipdesc" data-testid="chip-description">
          {description}
          {info?.populated !== null && info?.total ? (
            <span className="ask__chipcoverage mono">
              {' '}
              · {info.populated} of {info.total} carry a value
            </span>
          ) : null}
        </span>
      )}
    </>
  )
}

export interface DrillResult {
  refused: boolean
  message?: string
  records: {
    record_id: string
    target_name?: string | null
    position?: string | null
    clause_text?: string | null
    is_excerpt?: boolean
  }[]
}

/**
 * The answer, as rows rather than a JSON dump.
 *
 * It rendered `JSON.stringify(rows)` — correct, auditable, and a dead end. A distribution's
 * rows are the interesting object in the whole product: each one is a group of records that
 * gave the same answer, and the reader's next question is always *which ones*. So a row that
 * names an answer opens into the records behind it, with the clause language, through the same
 * gate the aggregate went through: a slice below the threshold refuses here too.
 *
 * Rows without an answer dimension (a bare count) are shown as a figure and nothing more —
 * there is no subject to drill and pretending otherwise would offer a dead button.
 */
function AnswerRows({
  rows,
  query,
  strings,
  onDrill,
}: {
  rows: Record<string, unknown>[]
  query: { dimensions: string[]; filters: { member: string; values: string[] }[] } | null | false | undefined
  strings: QuorumStrings
  onDrill?: (subject: string, position: string) => Promise<DrillResult>
}) {
  const [open, setOpen] = useState<string | null>(null)
  const [drilled, setDrilled] = useState<Record<string, DrillResult>>({})
  const [busy, setBusy] = useState<string | null>(null)

  // The answer axis is whichever dimension the selection grouped by; the subject is whatever
  // the selection pinned on the subject axis. Both come from the query that was actually sent,
  // never from the question text — the chips are the thing the reader confirmed.
  const answerDim = query ? (query.dimensions[0] ?? null) : null
  // The subject axis is the filter on the SAME CUBE as the answer dimension — a distribution
  // pins `x.subject` and groups by `x.position`. Taking "the first filter that is not the
  // answer dimension" instead picked up a record-level scope: a question about healthcare
  // cash deals drilled on `Health Care Industry` as though it were the deal point.
  const cube = answerDim ? answerDim.split('.')[0] : null
  const subject =
    (query &&
      query.filters.find(
        (f) => f.values?.length === 1 && f.member !== answerDim && f.member.split('.')[0] === cube,
      )?.values[0]) ||
    null
  const canDrill = Boolean(onDrill && answerDim && subject)

  async function drill(position: string) {
    if (!onDrill || !subject) return
    if (open === position) {
      setOpen(null)
      return
    }
    setOpen(position)
    if (drilled[position]) return
    setBusy(position)
    try {
      const hit = await onDrill(subject, position)
      setDrilled((d) => ({ ...d, [position]: hit }))
    } finally {
      setBusy(null)
    }
  }

  if (!rows.length) return <p className="qb__hint">No rows.</p>

  return (
    <ul className="ask__answers" data-testid="ask-rows">
      {rows.map((row, i) => {
        const position = answerDim ? String(row[answerDim] ?? '') : ''
        const figures = Object.entries(row).filter(([k]) => k !== answerDim)
        const hit = drilled[position]
        return (
          <li key={position || i} className="ask__answer">
            <div className="ask__answerhead">
              <span className="ask__answername">{position || '—'}</span>
              <span className="ask__answerfigs">
                {figures.map(([k, v]) => (
                  <span key={k} className="mono">
                    {String(v)}
                  </span>
                ))}
              </span>
              {canDrill && position && (
                <button
                  type="button"
                  className="ask__drillbtn"
                  onClick={() => drill(position)}
                  aria-expanded={open === position}
                  data-testid={`ask-drill-${position}`}
                >
                  {open === position ? 'hide' : `show the ${strings.records ?? 'records'}`}
                </button>
              )}
            </div>
            {open === position && (
              <div className="ask__drill">
                {busy === position && <p className="qb__hint">Loading…</p>}
                {hit?.refused && (
                  <p className="qb__refused" data-testid="ask-drill-refused">
                    {hit.message ?? 'This slice is too small to open.'}
                  </p>
                )}
                {hit && !hit.refused && (
                  <ul>
                    {hit.records.map((r) => (
                      <li key={r.record_id} className="drill" data-testid={`ask-drill-row-${r.record_id}`}>
                        <span className="drill__party">{r.target_name ?? r.record_id}</span>
                        {r.clause_text && (
                          <div className="drill__text">
                            {r.is_excerpt && <span className="drill__tag">excerpt</span>}
                            {r.clause_text}
                          </div>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export function AskBox({
  strings,
  onAsked,
  onDrill,
}: {
  /** The domain's nouns. Passed, not injected — see strings.ts. */
  strings: QuorumStrings
  onAsked?: (costUsd: number) => void
  /**
   * Fetch the records behind one answer. Injected because the route and the record shape are
   * the domain's, and omitting it simply leaves the rows unclickable — a platform that
   * hard-codes a drill endpoint has stopped being domain-free.
   */
  onDrill?: (subject: string, position: string) => Promise<DrillResult>
}) {
  const [question, setQuestion] = useState('')
  const [asking, setAsking] = useState(false)
  const [asked, setAsked] = useState<AskResponse | null>(null)
  const [confirmed, setConfirmed] = useState<Confirmed | null>(null)
  const [askError, setAskError] = useState<string | null>(null)
  const [members, setMembers] = useState<Record<string, MemberInfo>>({})
  const [membersError, setMembersError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<string | null>(null)
  const [result, setResult] = useState<RunSelectionResponse | null>(null)
  const [runError, setRunError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const nextSignal = useAbortOnUnmount()

  const query = useMemo(
    () =>
      confirmed && {
        measures: confirmed.measures,
        dimensions: confirmed.dimensions,
        filters: confirmed.filters.map((f) => ({
          member: f.member,
          operator: f.operator,
          values: f.values,
        })),
      },
    [confirmed],
  )

  /**
   * Everything currently selected that the corpus cannot answer with (#57).
   *
   * Recomputed from what is on screen rather than from the response, so removing the offending
   * chip clears the refusal — the selection minus that member may be perfectly answerable, and
   * a refusal that will not go away is indistinguishable from a broken tab.
   */
  const unanswerable = useMemo(() => {
    if (!confirmed) return []
    const selected = [
      ...confirmed.measures,
      ...confirmed.dimensions,
      ...confirmed.filters.map((f) => f.member),
    ]
    return selected
      .map((name) => members[name])
      .filter((info): info is MemberInfo => Boolean(info?.cannot_answer))
      .filter((info, i, all) => all.findIndex((other) => other.name === info.name) === i)
  }, [confirmed, members])

  async function loadMembers(response: AskResponse, signal: AbortSignal) {
    const names = [
      ...response.measures,
      ...response.dimensions,
      ...response.filters.map((f) => f.member),
    ]
    if (names.length === 0) return
    try {
      const r = await fetch('/api/agent/members', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ names }),
        signal,
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body?.error?.message ?? 'The catalog could not be read.')
      const byName: Record<string, MemberInfo> = {}
      for (const m of body.members as MemberInfo[]) byName[m.name] = m
      setMembers(byName)
      setConfirmed((prev) => (prev ? reconcile(prev, byName) : prev))
    } catch (e) {
      if (isAbortError(e)) return
      // Degraded, not broken: the chips still render under their qualified names and the run
      // still works. What is lost is the titles and the vocabularies, and that is said.
      setMembersError((e as Error).message)
    }
  }

  async function interpret() {
    if (!question.trim()) return
    const signal = nextSignal()
    setAsking(true)
    setAskError(null)
    setResult(null)
    setRunError(null)
    setAsked(null)
    setConfirmed(null)
    setMembers({})
    setMembersError(null)
    setExpanded(null)
    try {
      const r = await fetch('/api/agent/ask', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question }),
        signal,
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body?.error?.message ?? 'The question could not be interpreted.')
      const response = body as AskResponse
      setAsked(response)
      setConfirmed(toConfirmed(response))
      onAsked?.(response.usage.cost_usd)
      await loadMembers(response, signal)
    } catch (e) {
      if (isAbortError(e)) return
      setAskError((e as Error).message)
    } finally {
      if (!signal.aborted) setAsking(false)
    }
  }

  /**
   * #51 — the confirm click is the label.
   *
   * Fired here and nowhere else: a person confirming or editing is what writes to
   * `selection_corrections`, and `/agent/ask` never does. Deliberately not awaited and never
   * surfaced as an error — recording eval data must not be able to stop someone getting their
   * answer, and a failed write is logged server-side rather than shown to a partner mid-query.
   */
  function recordConfirmation() {
    if (!asked || !query) return
    fetch('/api/agent/selection-correction', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        question: asked.question,
        model_selection: asked.model_selection,
        confirmed_selection: query,
      }),
    }).catch(() => {})
  }

  async function run() {
    if (!query) return
    recordConfirmation()
    const signal = nextSignal()
    setRunning(true)
    setRunError(null)
    try {
      const r = await fetch('/api/agent/run-selection', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(query),
        signal,
      })
      const body = await r.json()
      if (!r.ok) throw new Error(body?.error?.message ?? 'The selection was rejected.')
      setResult(body as RunSelectionResponse)
    } catch (e) {
      if (isAbortError(e)) return
      setRunError((e as Error).message)
    } finally {
      if (!signal.aborted) setRunning(false)
    }
  }

  function editValue(index: number, value: string) {
    setConfirmed((prev) =>
      prev
        ? {
            ...prev,
            filters: prev.filters.map((f, i) =>
              i === index ? { ...f, values: value ? [value] : [] } : f,
            ),
          }
        : prev,
    )
    setResult(null)
  }

  function removeFilter(index: number) {
    setConfirmed((prev) =>
      prev ? { ...prev, filters: prev.filters.filter((_, i) => i !== index) } : prev,
    )
    setResult(null)
  }

  function removeFrom(key: 'measures' | 'dimensions', name: string) {
    setConfirmed((prev) => (prev ? { ...prev, [key]: prev[key].filter((n) => n !== name) } : prev))
    setResult(null)
  }

  function toggle(name: string) {
    setExpanded((prev) => (prev === name ? null : name))
  }

  const nothingSelected =
    confirmed !== null &&
    confirmed.measures.length === 0 &&
    confirmed.dimensions.length === 0 &&
    confirmed.filters.length === 0

  const canRun =
    confirmed !== null &&
    confirmed.measures.length > 0 &&
    !isBlocked(confirmed.filters) &&
    unanswerable.length === 0 &&
    !running

  return (
    <section className="ask" data-testid="ask-box">
      <h3 className="sem__h">Ask in words</h3>
      <p className="sem__sub">
        The model reads your question and returns a <strong>selection</strong> — which measure,
        which slice — never an answer and never a number. Check the chips, change what it got
        wrong, and only then does Postgres compute anything.
      </p>

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
            if (e.key === 'Enter') interpret()
          }}
        />
        <button
          type="button"
          className="qb__run"
          onClick={interpret}
          disabled={asking || !question.trim()}
        >
          {asking ? 'interpreting…' : 'Interpret'}
        </button>
      </div>

      {asking && !asked && (
        <div className="skeleton skeleton--row" aria-label="interpreting the question" />
      )}

      {askError && (
        <div className="qb__rejected" data-testid="ask-error">
          <strong>The question was not interpreted.</strong>
          <p>{askError}</p>
        </div>
      )}

      {confirmed && asked && (
        <>
          {/* #50: under the chips, and rendered whether or not anyone goes on to run the
              selection — the dollars were spent at the question, not at the run. */}
          <p className="ask__usage mono" data-testid="ask-usage">
            {asked.usage.model} · {formatTokens(asked.usage.prompt_tokens)} in /{' '}
            {formatTokens(asked.usage.completion_tokens)} out ·{' '}
            {formatLatency(asked.usage.latency_ms)} · {formatUsd(asked.usage.cost_usd)}
            <span className="ask__priced">
              {' '}
              priced from the committed table, checked {asked.usage.price_checked_on}
            </span>
          </p>

          {/*
            #57 fault 4. Not a validation error and not "no results": the question was
            well-formed, the selection is valid, and the corpus has nothing behind it. Stated
            before the chips because repairing them cannot help.
          */}
          {unanswerable.length > 0 && (
            <div className="qb__refused" data-testid="ask-cannot-answer">
              <strong>This corpus cannot answer that.</strong>
              <ul className="ask__cannotlist">
                {unanswerable.map((info) => (
                  <li key={info.name}>{info.cannot_answer}</li>
                ))}
              </ul>
              <p>
                Nothing here needs repairing — the selection is valid and the data behind it is
                not there. Remove that chip to run the rest, or ask a different question.
              </p>
            </div>
          )}

          {membersError && (
            <p className="qb__blocked" data-testid="ask-catalog-error">
              <strong>The catalog could not be read, so the chips show raw names.</strong>{' '}
              {membersError} The selection is still valid and still runnable; what is missing is
              each member&rsquo;s title, its description, and the list of values it may hold.
            </p>
          )}

          <div className="ask__chips" data-testid="ask-chips">
            {nothingSelected && (
              <p className="qb__blocked" data-testid="ask-empty">
                <strong>The model selected nothing.</strong> That is a real outcome, not an
                error — graded over 25 authored cases it declines correctly only 1 time in 5,
                and it also declines when it should not. Rephrase, or build the query by
                clicking below.
              </p>
            )}

            {confirmed.measures.map((m) => (
              <span
                className={`ask__chip${members[m]?.cannot_answer ? ' is-unanswerable' : ''}`}
                data-testid="chip-measure"
                key={m}
              >
                <span className="ask__chiprole">measure</span>
                <ChipName
                  name={m}
                  info={members[m]}
                  expanded={expanded === m}
                  onToggle={() => toggle(m)}
                />
                {members[m]?.cannot_answer && (
                  <span className="ask__method ask__method--unresolved">cannot answer</span>
                )}
                <button
                  type="button"
                  className="ask__x"
                  aria-label={`remove measure ${members[m]?.title ?? shortName(m)}`}
                  onClick={() => removeFrom('measures', m)}
                >
                  ×
                </button>
              </span>
            ))}

            {confirmed.dimensions.map((d) => (
              <span
                className={`ask__chip${members[d]?.cannot_answer ? ' is-unanswerable' : ''}`}
                data-testid="chip-dimension"
                key={d}
              >
                <span className="ask__chiprole">group by</span>
                <ChipName
                  name={d}
                  info={members[d]}
                  expanded={expanded === d}
                  onToggle={() => toggle(d)}
                />
                {members[d]?.cannot_answer && (
                  <span className="ask__method ask__method--unresolved">cannot answer</span>
                )}
                <button
                  type="button"
                  className="ask__x"
                  aria-label={`remove dimension ${members[d]?.title ?? shortName(d)}`}
                  onClick={() => removeFrom('dimensions', d)}
                >
                  ×
                </button>
              </span>
            ))}

            {confirmed.filters.map((f, i) => {
              const info = members[f.member]
              const label = info?.title ?? shortName(f.member)
              const value = f.values[0] ?? ''
              const key = `${f.member}-filter`
              return (
                <span
                  className={`ask__chip${f.values.length === 0 ? ' is-unresolved' : ''}${
                    info?.cannot_answer ? ' is-unanswerable' : ''
                  }`}
                  data-testid="chip-filter"
                  key={`${f.member}-${i}`}
                >
                  <span className="ask__chiprole">where</span>
                  <ChipName
                    name={f.member}
                    info={info}
                    expanded={expanded === key}
                    onToggle={() => toggle(key)}
                  />
                  {/*
                    #57 fault 3. Every dimension in this model is a closed vocabulary, so the
                    value is picked, never typed. The text input below survives only for a
                    vocabulary too large to enumerate, which no dimension in this corpus is —
                    the widest is 225 distinct answers against a cap of 500.
                  */}
                  {info?.enumerable ? (
                    <select
                      className="ask__chipedit"
                      aria-label={`value for ${label}`}
                      value={value}
                      onChange={(e) => editValue(i, e.target.value)}
                    >
                      <option value="">— pick a value —</option>
                      {info.candidates.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      type="text"
                      className="ask__chipedit"
                      aria-label={`value for ${label}`}
                      value={value}
                      onChange={(e) => editValue(i, e.target.value)}
                    />
                  )}
                  {info && !info.enumerable && info.kind === 'dimension' && (
                    <span className="ask__method ask__method--unresolved">
                      {info.distinct_values.toLocaleString('en-US')} values — too many to list
                    </span>
                  )}
                {info?.cannot_answer && (
                  <span className="ask__method ask__method--unresolved">cannot answer</span>
                )}
                  <Resolution filter={f} />
                  {f.resolutions[0]?.method === 'unresolved' && !isEdited(f) && (
                    <span className="ask__near">
                      {f.resolutions[0].candidates.slice(0, 4).map((c) => (
                        <button
                          key={c}
                          type="button"
                          className="ask__nearbtn"
                          onClick={() => editValue(i, c)}
                        >
                          {c}
                        </button>
                      ))}
                    </span>
                  )}
                  <button
                    type="button"
                    className="ask__x"
                    aria-label={`remove filter ${label}`}
                    onClick={() => removeFilter(i)}
                  >
                    ×
                  </button>
                </span>
              )
            })}
          </div>

          {asked.blocked_reason && !confirmed.filters.every((f) => f.values.length > 0) && (
            <p className="qb__blocked" data-testid="ask-blocked">
              <strong>Not runnable yet.</strong> {asked.blocked_reason} This is refused rather
              than run: a filter value the corpus does not carry returns zero rows, and zero
              rows reads as “we have no comparable deals”.
            </p>
          )}

          {/*
            #57. This used to be a paragraph asking the reader to notice that a value might not
            exist. Every dimension now carries its real vocabulary, so the same case is checked
            instead of flagged: the value is dropped, the run is blocked, and both the model's
            text and the field's actual answers are named.
          */}
          {confirmed.filters.some((f) => f.offVocabulary) && (
            <p className="qb__blocked" data-testid="ask-off-vocabulary">
              <strong>The model wrote a value this corpus does not carry.</strong>{' '}
              {confirmed
                .filters.filter((f) => f.offVocabulary)
                .map((f) => {
                  const info = members[f.member]
                  return (
                    <span key={f.member}>
                      On <strong>{info?.title ?? shortName(f.member)}</strong> it wrote{' '}
                      <code>{f.offVocabulary}</code>; the field holds{' '}
                      {info?.candidates.map((c, i) => (
                        <span key={c}>
                          {i > 0 && ' · '}
                          <code>{c}</code>
                        </span>
                      ))}
                      .{' '}
                    </span>
                  )
                })}
              It is dropped rather than run: a value nothing matches returns zero rows, and zero
              rows reads as “we have no comparable deals”. Pick one above, or drop the chip.
            </p>
          )}

          {membersError && confirmed.filters.some(
            (f) => f.resolutions[0]?.method === 'verbatim' && !isEdited(f),
          ) && (
            <p className="qb__blocked" data-testid="ask-unchecked">
              <strong>Some values were not checked against the corpus.</strong> The resolution
              ladder has a vocabulary for industry labels and nothing else, and the catalog that
              covers the rest is unreachable, so a value on any other field is the
              model&rsquo;s own text. Observed on a live call: it wrote{' '}
              <code>consideration_type = All Cash Deal</code> where this corpus holds{' '}
              <code>All Cash</code> — which runs, and returns zero rows that read as “we have
              no comparable deals”. Read those chips before running.
            </p>
          )}

          <div className="ask__confirm">
            <button type="button" className="qb__run" onClick={run} disabled={!canRun}>
              {running ? 'running…' : 'Run the confirmed selection'}
            </button>
            <span className="qb__hint">
              Runs through <code>/agent/run-selection</code>, the same path the builder below
              uses — so the validation gate and the <code>min_n</code> refusal still apply.
            </span>
          </div>

          {runError && (
            <div className="qb__rejected" data-testid="ask-rejected">
              <strong>Rejected before it reached the database.</strong>
              <p>{runError}</p>
            </div>
          )}

          {result?.refused && (
            <div className="qb__refused" data-testid="ask-refused">
              <strong>
                Refused — n={result.n}, threshold {result.threshold}
              </strong>
              <p>{result.message}</p>
            </div>
          )}

          {result && !result.refused && (
            <div data-testid="ask-sent">
              <p className="qb__n">
                {result.n !== null ? (
                  <>
                    n = <span className="mono">{result.n}</span>
                  </>
                ) : (
                  <>no denominator selected</>
                )}
              </p>
              {result.suppressed > 0 && (
                <p className="qb__suppressed" data-testid="ask-suppressed">
                  {result.message}
                </p>
              )}
              <AnswerRows
                rows={result.rows}
                query={query}
                strings={strings}
                onDrill={onDrill}
              />
            </div>
          )}
        </>
      )}
    </section>
  )
}
