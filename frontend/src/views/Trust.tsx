import { useEffect, useState } from 'react'
import type {
  CalibrationLabels,
  CalibrationResponse,
  MeasureSelectionSummary,
} from '../types'
import { ignoreAbort } from '../index'
import { BarChart, ChartFrame, Legend, StackedBar, StatTiles } from '../components/charts'
import { LoopDiagram } from '../components/LoopDiagram'
import { IngestStatus, LogViewer } from '../components/operator'

/**
 * Trust (#54) — where the model is trusted, where it is not, and what the humans changed.
 *
 * The two loops that make this an AI system rather than a query tool used to be invisible:
 * calibration was a preformatted text dump on Admin, the label loop's outcome was a second
 * section, measure-selection a third. A reader had to assemble the argument out of three
 * report blocks and a JSON file. This is that argument on one screen.
 *
 * **Trust absorbs Admin rather than adding a tab.** Admin split along a real line — the
 * evidence is this tab; the operator surface (ingest status, the log viewer) folds into a
 * collapsed section at the bottom. Six tabs before, six after.
 *
 * **Every figure is read from a committed artefact.** Nothing here is recomputed when the tab
 * opens. `calibration_accuracy.json`, `calibration-labels.json` and `measure-selection.json`
 * were each written by a command that ran, and the command is named beside the numbers. A
 * figure recomputed per request can drift from the report committed next to it, and then the
 * tab and the repo disagree with no way to say which one ran — on the one tab whose entire
 * purpose is that a sceptic can check it.
 *
 * **The copy states direction.** The label loop *lowered* the score, 569 correct to 565. #52
 * put a test on the Label panel forbidding `/improved|better|▲|↑/`; the same test guards this
 * tab. A loop that only ever reported improvement is a loop nobody should believe.
 */
/**
 * One artefact this tab reads, and what to say when it is not there.
 *
 * Every section here renders null when its data is null, so with none of the three artefacts
 * produced the tab was a lead paragraph promising "every figure below" and then nothing below
 * it. On the one tab whose job is to show the evidence, a missing artefact is the finding.
 *
 * The `label` is this file's; the sentence naming the command comes from the API, which
 * already answers a 404 with the file and the command that writes it. Restating those commands
 * here would be a second copy of them, and the copy the reader sees would be the stale one.
 */
interface Artefact {
  label: string
  /** null until the request settles; the API's own message once it fails */
  problem: string | null
}

export function Trust() {
  const [calibration, setCalibration] = useState<CalibrationResponse | null>(null)
  const [labels, setLabels] = useState<CalibrationLabels | null>(null)
  const [selection, setSelection] = useState<MeasureSelectionSummary | null>(null)
  const [problems, setProblems] = useState<Record<string, string>>({})
  const [pending, setPending] = useState(3)

  useEffect(() => {
    const controller = new AbortController()
    const get = <T,>(path: string, label: string, set: (v: T | null) => void) =>
      fetch(path, { signal: controller.signal })
        .then(async (r) => {
          const body = await r.json().catch(() => null)
          if (r.ok) {
            set(body as T)
            return
          }
          set(null)
          setProblems((prev) => ({
            ...prev,
            [label]: String(body?.error?.message ?? body?.detail ?? `${path} answered ${r.status}`),
          }))
        })
        .catch(
          ignoreAbort((e: Error) => {
            set(null)
            setProblems((prev) => ({ ...prev, [label]: e.message }))
          }),
        )
        .finally(() => {
          if (!controller.signal.aborted) setPending((n) => n - 1)
        })

    get<CalibrationResponse>('/api/admin/calibration', 'calibration accuracy', setCalibration)
    get<CalibrationLabels>('/api/admin/calibration-labels', 'the label loop', setLabels)
    get<MeasureSelectionSummary>(
      '/api/admin/measure-selection',
      'measure-selection quality',
      setSelection,
    )
    return () => controller.abort()
  }, [])

  const missing: Artefact[] = Object.entries(problems).map(([label, problem]) => ({
    label,
    problem,
  }))
  const anything = calibration !== null || labels !== null || selection !== null

  return (
    <div className="trust">
      {/* The tab strip already says "where the model is trusted, and where it is not"
          directly above this, and this line opened by saying it again. What it is for is the
          half a reader cannot get anywhere else: how to check any of it. And it is not
          rendered when there is nothing below it to describe. */}
      {anything && (
        <p className="sem__pointer" data-testid="trust-lead">
          Every figure here is read from a committed artefact, named beside it, so the page and
          the repo cannot disagree about what ran.
        </p>
      )}

      {pending > 0 && !anything && (
        <div className="skeleton skeleton--row" aria-label="loading the committed artefacts" />
      )}

      {pending === 0 && missing.length > 0 && (
        <section className="state state--empty" data-testid="trust-missing">
          <h3 className="state__title">
            {anything ? 'Some of the evidence has not been produced yet' : 'No evidence yet'}
          </h3>
          <p className="state__body">
            This tab renders committed artefacts and computes nothing on request, so an artefact
            that has not been written stays blank. Each one below says what to
            run.
          </p>
          <dl className="trust__missing">
            {missing.map((artefact) => (
              <div key={artefact.label}>
                <dt>{artefact.label}</dt>
                <dd>{artefact.problem}</dd>
              </div>
            ))}
          </dl>
        </section>
      )}

      <CostRow calibration={calibration} />
      <AccuracyChart calibration={calibration} />
      <LoopSection labels={labels} />
      <DisagreementChart labels={labels} />
      <SelectionQualityChart summary={selection} />
      <OperatorSection />
    </div>
  )
}

/**
 * Cost is a stat-tile row, not a chart (#54). Four unrelated magnitudes — calls, dollars,
 * tokens in, tokens out — have no shared scale, and a bar chart over them would invent one.
 */
function CostRow({ calibration }: { calibration: CalibrationResponse | null }) {
  const cost = calibration?.cost
  if (!cost) return null
  return (
    <section className="trust__section">
      <StatTiles
        testId="trust-cost"
        tiles={[
          { label: 'model calls', value: cost.call_count.toLocaleString('en-US') },
          {
            label: 'measured cost',
            value: `$${cost.cost_usd.toFixed(6)}`,
            sub: 'priced from the committed table',
          },
          {
            label: 'tokens in',
            value: (cost.prompt_tokens ?? 0).toLocaleString('en-US'),
          },
          {
            label: 'tokens out',
            value: (cost.completion_tokens ?? 0).toLocaleString('en-US'),
          },
        ]}
      />
    </section>
  )
}

/**
 * 1 — accuracy across the deal-point vocabulary, worst first. The headline.
 *
 * One hue for every bar. #54 asked for a sequential ramp by accuracy, and colouring nominal
 * categories darker-where-bigger is a named anti-pattern: it re-encodes bar length as hue and
 * spends the identity channel on information the chart already shows. Sorting worst-first is
 * what carries the ranking.
 */
function AccuracyChart({ calibration }: { calibration: CalibrationResponse | null }) {
  if (!calibration || calibration.results.length === 0) return null
  // The grader emits worst-first, because the ordering is a finding about the extractor. This
  // tab is read to decide what the extractor may be trusted with, and that decision is made at
  // the top of the list, so the ones that clear the gate go there. Unmeasured rows sink to the
  // bottom: they are a coverage gap, not a score of zero.
  const rows = [...calibration.results].sort((a, b) => {
    if (a.measured !== b.measured) return a.measured ? -1 : 1
    return (b.accuracy ?? 0) - (a.accuracy ?? 0)
  })
  const measured = rows.filter((r) => r.measured)
  const gate = calibration.min_extraction_confidence
  const clearingGate = measured.filter((r) => (r.accuracy ?? 0) >= gate).length
  const belowGate = measured.length - clearingGate
  const zeros = measured.filter((r) => r.accuracy === 0).length
  // How many agreements each deal point was tested on. Read from the data rather than hardcoded:
  // a deal point is scored on every holdout matter that carries an answer for it, so the largest
  // n across the vocabulary is the holdout size.
  const holdoutMatters = measured.reduce((m, r) => Math.max(m, r.n), 0)
  const unmeasured = rows.length - measured.length
  const best = measured[0]

  const data = rows.map((r) => ({
    label: r.subject,
    value: r.measured ? r.accuracy : null,
    detail: r.measured
      ? `${r.correct} of ${r.n} · 95% CI [${r.ci_low?.toFixed(2)}, ${r.ci_high?.toFixed(2)}]`
      : 'the run never reached this deal point',
    // selective: only the worst row is labelled, so the label still means something
    directLabel: r === best && r.accuracy !== null ? `best · ${r.accuracy.toFixed(2)}` : undefined,
  }))

  return (
    <section className="trust__section">
      <ChartFrame
        testId="trust-accuracy"
        title="Which questions could run without a lawyer?"
        note={
          <>
            Each bar is one of the ABA&rsquo;s deal-point questions; its length is how often an
            automated extractor got it right on {holdoutMatters} agreements lawyers had already
            answered. Point it at documents nobody has annotated and{' '}
            <strong>
              {calibration.reportable_count} of {measured.length} questions could be answered by
              machine
            </strong>
            . For the other {measured.length - (calibration.reportable_count ?? 0)}, a person has
            to read the agreement.
          </>
        }
        footnote={
          <>
            The {measured.length} split three ways, which is why no two numbers here add up to it
            on their own: <strong>{belowGate}</strong> score below {gate.toFixed(2)} outright,{' '}
            <strong>{clearingGate - (calibration.reportable_count ?? 0)}</strong> score above it but on
            too few samples to prove it, and <strong>{calibration.reportable_count}</strong> clear
            the bar the product enforces. That bar is the lower end of the confidence interval, not
            the score, so a deal point cannot be flattered by a sample too small to tell from a coin
            flip. At {holdoutMatters} agreements that is demanding: roughly 18 of 19 correct.{' '}
            {zeros} score exactly 0.00, and {unmeasured} read “not measured”, a coverage gap
            rather than a failed extraction.
          </>
        }
        table={
          <table className="admin__table">
            <thead>
              <tr>
                <th>deal point</th>
                <th>n</th>
                <th>correct</th>
                <th>accuracy</th>
                <th>95% CI</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.subject}>
                  <td>{r.subject}</td>
                  <td className="mono">{r.n}</td>
                  <td className="mono">{r.measured ? r.correct : '—'}</td>
                  <td className="mono">
                    {r.measured && r.accuracy !== null ? (
                      r.accuracy.toFixed(2)
                    ) : (
                      <span className="admin__unmeasured">not measured</span>
                    )}
                  </td>
                  <td className="mono">
                    {r.measured && r.ci_low !== null && r.ci_high !== null
                      ? `[${r.ci_low.toFixed(2)}, ${r.ci_high.toFixed(2)}]`
                      : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      >
        <BarChart
          testId="trust-accuracy-bars"
          data={data}
          max={1}
          rule={gate}
          ruleLabel={`${gate.toFixed(2)} gate`}
        />
      </ChartFrame>
    </section>
  )
}

/** 2 — the loop, with real counts on its edges, and the caveat that qualifies them. */
function LoopSection({ labels }: { labels: CalibrationLabels | null }) {
  if (!labels) return null
  return (
    <section className="trust__section">
      <h2 className="admin__heading">The review loop</h2>
      <LoopDiagram
        counts={{
          predictions: labels.prediction_count,
          decisions: labels.labels_applied,
          differing: labels.labels_differing,
          correctBefore: labels.correct_before,
          correctAfter: labels.correct_after,
        }}
      />
      <p className="admin__note" data-testid="trust-loop-direction">
        {labels.labels_applied === 0 ? (
          <>
            <strong>No decisions recorded yet</strong>, so the score stands where the extractor
            left it: {labels.correct_before} correct of{' '}
            {labels.prediction_count.toLocaleString('en-US')}.
          </>
        ) : (
          <>
            {labels.labels_applied} decisions were graded into the next calibration run, and the
            score{' '}
            <strong>
              {labels.correct_after < labels.correct_before
                ? 'went down'
                : labels.correct_after > labels.correct_before
                  ? 'went up'
                  : 'did not move'}
            </strong>
            : {labels.correct_before} correct of{' '}
            {labels.prediction_count.toLocaleString('en-US')} before, {labels.correct_after}{' '}
            after.
          </>
        )}
      </p>
      <p className="admin__note" data-testid="trust-corpus-caveat">
        A reviewer&rsquo;s answer replaces the model&rsquo;s and is then graded against MAUD like
        any other, so a mistyped label lowers the score rather than being quietly discarded.{' '}
        <strong>And every item in the queue already has a
        lawyer&rsquo;s answer behind it</strong>, so a reviewer here is being scored against a gold label
        rather than supplying one. On un-annotated firm documents there would be no such
        comparison, and the loop&rsquo;s value would be the label rather than the grade.
      </p>
      <p className="admin__note">
        Produced <span className="mono">{labels.generated_at.slice(0, 10)}</span> by{' '}
        <code>{labels.command}</code>.
      </p>
    </section>
  )
}

/**
 * 3 — where the reviewer disagreed with the model.
 *
 * #54 described three buckets and put four of six in the last one. The committed file says
 * something sharper, and the file wins: of six decisions, one agreed with the model, **none**
 * corrected a wrong model answer, four overwrote an answer that was right, and one replaced a
 * wrong answer with another wrong one. Not one of the six matched MAUD's gold label.
 *
 * The bar carries the two non-empty outcomes in the two validated hues; the empty bucket is
 * the finding, so it is stated in the copy and kept in the table rather than drawn as a
 * zero-width segment nobody can see.
 */
const DISAGREEMENT_BUCKETS = [
  'reviewer agreed with the model',
  'reviewer corrected a wrong model answer',
  'reviewer differed and overwrote a correct answer',
  'reviewer differed, and was wrong either way',
] as const

function DisagreementChart({ labels }: { labels: CalibrationLabels | null }) {
  if (!labels) return null
  const agreed = labels.labels_applied - labels.labels_differing
  const differed = labels.labels_differing
  const overwroteCorrect = labels.correct_before - labels.correct_after

  return (
    <section className="trust__section">
      <ChartFrame
        testId="trust-disagreement"
        title="Where the reviewer disagreed with the model"
        note={
          labels.labels_applied === 0 ? (
            <>
              <strong>Nothing has been reviewed yet.</strong> Each decision lands in one of the
              four buckets below and is scored against MAUD, so a reviewer who overwrites a
              correct answer costs the run a point. That is the design: the decision is graded,
              not trusted.
            </>
          ) : (
            <>
              All {labels.labels_applied} recorded decisions. {differed} differed from the model.
              Of those, {overwroteCorrect} overwrote an answer that had been correct and{' '}
              {differed - overwroteCorrect} swapped one wrong answer for another.
            </>
          )
        }
        table={
          <table className="admin__table">
            <thead>
              <tr>
                <th>outcome</th>
                <th>decisions</th>
              </tr>
            </thead>
            <tbody>
              {DISAGREEMENT_BUCKETS.map((bucket, i) => (
                <tr key={bucket}>
                  <td>{bucket}</td>
                  <td className="mono">
                    {[agreed, 0, overwroteCorrect, differed - overwroteCorrect][i]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      >
        {/*
          A stacked bar over a total of zero draws nothing, and a heading with a note and then
          empty space under it reads as a failed render rather than as a count of zero. The
          buckets are what the chart would show, so at zero they are listed instead: the shape
          of the measurement, with nothing measured into it yet.
        */}
        {labels.labels_applied === 0 ? (
          <ul className="trust__buckets" data-testid="trust-disagreement-empty">
            {DISAGREEMENT_BUCKETS.map((bucket) => (
              <li key={bucket}>
                {bucket} — <span className="mono">0</span>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <StackedBar
              testId="trust-disagreement-bar"
              total={labels.labels_applied}
              segments={[
                { label: 'agreed with the model', value: agreed, slot: 1 },
                { label: 'differed, and was wrong against gold', value: differed, slot: 2 },
              ]}
            />
            <Legend
              items={[
                { label: `agreed with the model — ${agreed}`, slot: 1 },
                { label: `differed, and was wrong against gold — ${differed}`, slot: 2 },
              ]}
            />
          </>
        )}
      </ChartFrame>
    </section>
  )
}

/**
 * 4 — selection quality, by what the model was asked to get right.
 *
 * The point is the shape, not the average. Decent at the measure, mediocre at the filter
 * value, bad at declining — and each of those lands on a different part of the design, which
 * is why the numbers sit here rather than in a README.
 *
 * Refusal accuracy carries a direct label naming it the weak one. No red and no alarm styling:
 * it is a measurement, not an incident.
 */
function SelectionQualityChart({ summary }: { summary: MeasureSelectionSummary | null }) {
  if (!summary) return null
  const data = [
    {
      label: 'measure precision',
      value: summary.measure_precision,
      detail: `${summary.answerable_count} answerable cases`,
    },
    {
      label: 'dimension precision',
      value: summary.dimension_precision,
      detail: `${summary.answerable_count} answerable cases`,
    },
    {
      label: 'filter exact-match',
      value: summary.filter_exact_match_rate,
      detail: `${summary.answerable_count} answerable cases`,
    },
    {
      label: 'refusal accuracy',
      value: summary.refusal_accuracy,
      detail: `${summary.refusal_count} refusal cases`,
      directLabel: 'the weak one — knowing when to decline',
    },
  ]

  return (
    <section className="trust__section">
      <ChartFrame
        testId="trust-selection"
        title="Selection quality"
        note={
          <>
            Read the shape: decent at picking the{' '}
            <strong>measure</strong>, mediocre at the <strong>filter value</strong>, bad at
            knowing when to <strong>decline</strong>. {summary.case_count} authored cases.
          </>
        }
        footnote={
          <>
            Each failure lands somewhere different, which is why the architecture treats them
            differently. The measure is enum-locked, so a wrong one is visible in the chip. The
            filter value cannot be, so it goes down a resolution ladder that fails loudly rather
            than returning zero rows. And refusal at {summary.refusal_accuracy.toFixed(2)} is why{' '}
            <code>min_n</code> lives in the server rather than in the model&rsquo;s judgment, and
            why a human confirms the chips on Ask.
          </>
        }
        table={
          <table className="admin__table">
            <thead>
              <tr>
                <th>metric</th>
                <th>value</th>
                <th>n</th>
              </tr>
            </thead>
            <tbody>
              {data.map((d) => (
                <tr key={d.label}>
                  <td>{d.label}</td>
                  <td className="mono">{d.value.toFixed(3)}</td>
                  <td className="mono">{d.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        }
      >
        <BarChart testId="trust-selection-bars" data={data} max={1} labelWidth={180} rowHeight={34} />
      </ChartFrame>
      <p className="admin__note">
        Produced <span className="mono">{summary.generated_at.slice(0, 10)}</span> by{' '}
        <code>{summary.command}</code>.
      </p>
    </section>
  )
}

/**
 * The operator surface, collapsed (#54).
 *
 * Ingest status and the log viewer are how you tell whether the data landed and what the
 * server did. They are not evidence about the model, so they sit at the bottom behind a
 * disclosure rather than competing with the argument above them.
 */
function OperatorSection() {
  const [open, setOpen] = useState(false)
  return (
    <section className="trust__section trust__operator">
      <button
        type="button"
        className="viz__toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        data-testid="trust-operator-toggle"
      >
        {open ? 'hide' : 'show'} operator surface — ingest status and logs
      </button>
      {open && (
        <div data-testid="trust-operator">
          <IngestStatus />
          <LogViewer />
        </div>
      )}
    </section>
  )
}
