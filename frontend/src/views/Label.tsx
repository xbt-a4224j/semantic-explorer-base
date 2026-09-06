import { useEffect, useState } from 'react'
import type { CalibrationLabels, LabelQueueItem, LabelQueueResponse } from '../types'
import { ignoreAbort } from '../index'
import { ExplainerPanel } from '../components/ExplainerPanel'
import { LoopDiagram } from '../components/LoopDiagram'
import type { QuorumStrings } from '../strings'

/**
 * Label — the review queue (#29, #52).
 *
 * Improvement has to be cheap or it will not happen. The queue is ranked by disagreement
 * between two extractors (#28's LLM output vs. a free keyword baseline), which needs no
 * calibrated confidence — the cheapest useful signal before #28 has measured one. Every
 * decision writes a row or explicitly skips; there is no confirmation dialog, because the
 * target is under five seconds per item.
 *
 * #52 replaced the single-letter keys (`y n e s`) with four named buttons. The letters were
 * fast for whoever had memorised them and opaque to everyone else, and the reviewer this tab
 * exists for — a KM professional visiting occasionally — is exactly the person who has not.
 * They are removed rather than kept as a hidden layer: a shortcut nobody can discover is a
 * trap for the reviewer who types into a page that no longer listens. Native `<button>`s, so
 * Tab reaches them and Enter fires them without any window-level binding at all.
 */
export function Label({ strings }: { strings: QuorumStrings }) {
  const [queue, setQueue] = useState<LabelQueueResponse | null>(null)
  const [cursor, setCursor] = useState(0)
  const [editing, setEditing] = useState(false)
  const [editValue, setEditValue] = useState('')
  const [labelledThisSession, setLabelledThisSession] = useState(0)
  const [skippedThisSession, setSkippedThisSession] = useState(0)
  const [lastDecision, setLastDecision] = useState<Decision | null>(null)
  const [queueError, setQueueError] = useState<string | null>(null)

  useEffect(() => {
    // aborted like Rollup and Explore: without it the response can land after the view is
    // gone and set state on an unmounted component (#38)
    const controller = new AbortController()
    fetch('/api/label/queue', { signal: controller.signal })
      .then(async (r) => {
        const body = await r.json().catch(() => null)
        if (!r.ok) {
          // The API answers a missing predictions file with the command that writes it, so the
          // message is passed through rather than replaced with a generic one.
          throw new Error(body?.error?.message ?? body?.detail ?? `The queue answered ${r.status}.`)
        }
        setQueue(body as LabelQueueResponse)
      })
      // This used to rethrow, which put the failure in an unhandled promise rejection and left
      // the skeleton up forever: the reviewer saw a loading state that never ended and no
      // reason for it. A loading state that cannot finish is not a loading state.
      .catch(ignoreAbort((e: Error) => setQueueError(e.message)))
    return () => controller.abort()
  }, [])

  const item: LabelQueueItem | undefined = queue?.items[cursor]

  async function decide(value: string, priorPrediction: string) {
    if (!item) return
    // deliberately un-aborted, unlike every read in this app: `useAbortOnUnmount`'s docstring
    // says why — cancelling a write silently drops the reviewer's work
    await fetch('/api/label/decide', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        record_id: item.record_id,
        subject: item.subject,
        value,
        prior_prediction: priorPrediction,
      }),
    })
    setLastDecision({
      recordId: item.record_id,
      subjectName: item.subject,
      value,
      modelAnswer: item.llm_prediction,
    })
    setLabelledThisSession((n) => n + 1)
    setEditing(false)
    setCursor((c) => c + 1)
  }

  function skip() {
    setEditing(false)
    setSkippedThisSession((n) => n + 1)
    setCursor((c) => c + 1)
  }

  function openEditor(prefill: string) {
    setEditValue(prefill)
    setEditing(true)
  }

  return (
    <div className="label">
      <ExplainerPanel id="label" title="How this queue works" diagram={<LoopDiagram subject={strings.subject} />}>
        <p>
          <strong>What this tab is for.</strong> Improving the extractor without paying for a
          full re-annotation. Two extractors read the same contract — a language model whose
          predictions were recorded to disk, and a keyword baseline that costs nothing — and
          items where they disagree rank to the top, because at least one of them is wrong.
          That is the cheapest useful signal available; it needs no calibrated confidence
          score, which is convenient, because a trustworthy confidence score is exactly what
          we do not have. Four buttons on each item: <strong>Accept</strong> the model&rsquo;s
          answer, <strong>Correct</strong> it to the baseline&rsquo;s, <strong>Edit</strong> to
          type something else, or <strong>Skip</strong> and record nothing.
        </p>
        <p>
          <strong>Why these items and not others.</strong> Two extractors read the same
          contract: a language model, whose predictions were recorded to disk in an earlier
          run, and a keyword baseline that costs nothing to run. Where they disagree, at
          least one is wrong. That is the cheapest useful ranking signal available — it needs
          no calibrated confidence score, which is convenient, because producing a trustworthy
          confidence score is the very thing we have not done yet.
        </p>
        <p>
          <strong>What your decision does.</strong> Each decision writes one row to{' '}
          <code>labels</code>, and <strong>calibration reads that table</strong>. On the next
          grading run your answer <em>replaces</em> the model&rsquo;s for that {strings.record} and
          {strings.subject} and is scored like any other answer — which means a mistyped label
          moves the accuracy table down, not up. The panel at the top of this tab is that
          before/after pair as it stands today; <strong>Trust</strong> breaks it down by deal
          point.
        </p>
        <p>
          <strong>What that does not mean.</strong> {strings.heldOutClaim}
          Reviewing a prediction where gold already exists tells you nothing gold did not. The
          loop closing means calibration <em>can</em> prefer a human label; it does not mean this
          corpus needs one. This tab is the mechanism you would need on <em>un-annotated</em> firm
          documents — where the reviewer&rsquo;s decision is the only answer there is —
          demonstrated on a corpus that does not need it.
        </p>
      </ExplainerPanel>

      <LoopOutcome strings={strings} />

      {!queue && !queueError && (
        <div className="skeleton skeleton--row" aria-label="loading queue" />
      )}

      {queueError && (
        <div className="state state--error" data-testid="label-queue-error">
          <h3 className="state__title">The review queue could not be loaded</h3>
          <p className="state__body">{queueError}</p>
          <p className="state__body">
            The queue is built from the committed extractor predictions and the corpus&rsquo;s own
            recorded answers, so there is nothing to show from cache — an empty queue and an
            unreachable one are different statements, and this is the second.
          </p>
        </div>
      )}

      {/* Three numbers over three different denominators: the whole queue, this page load, and
          the database. They must not share a sentence — that is what they used to do, and a
          lifetime row count sitting beside a session-scoped position read as one figure. Each
          keeps its own scope word.

          What came out is the ranking clause. "ranked by extractor disagreement" is a claim
          about the queue's order, not a count, and it was making a line of three numbers read
          as prose. It is stated in the explainer above and again on every item, in the
          reviewer's own terms, which is where someone deciding what to do with *this* item
          will look. */}
      {queue && (
        <p className="label__progress" data-testid="label-progress">
          <span className="mono">{queue.queue_size.toLocaleString('en-US')}</span> in the queue ·{' '}
          <span className="mono">{labelledThisSession}</span> decided,{' '}
          <span className="mono">{skippedThisSession}</span> skipped by you ·{' '}
          <span className="mono">{queue.labelled_count + labelledThisSession}</span> recorded in
          the database
          {labelledThisSession > 0 && (
            <span className="label__pending" data-testid="label-pending">
              {' '}
              · not graded yet: scored on the next calibration run
            </span>
          )}
        </p>
      )}

      {lastDecision && <Agreement decision={lastDecision} strings={strings} />}

      {queue && !item && (
        <div className="state state--empty">
          <h3 className="state__title">Queue is empty</h3>
          {/* Same two scope words as the progress line above, so the same number does not go
              by two different names on one screen. */}
          <p className="state__body">
            {labelledThisSession} decided and {skippedThisSession} skipped since this page
            loaded; {queue.labelled_count + labelledThisSession} recorded in the database.
          </p>
        </div>
      )}

      {item && (
        <div className="label__item" data-testid="label-item">
          <p className="label__meta">
            <span className="mono">{item.record_id}</span> · {item.subject}
            {item.disagreement && <span className="label__disagree"> · extractors disagree</span>}
          </p>

          {item.quoted_text ? (
            <blockquote className="dp__clause">{item.quoted_text}</blockquote>
          ) : (
            <p className="dp__missing" data-testid="label-nospan">{strings.noSpanReason}</p>
          )}

          {/* why THIS item, in the reviewer's terms — the ranking rationale is otherwise
              visible only in label.py's sort key */}
          <p className="label__why" data-testid="label-why">
            {item.disagreement ? (
              <>
                The two extractors <strong>disagree</strong> — the model answered{' '}
                <span className="mono">{item.llm_prediction}</span>, the keyword baseline
                answered <span className="mono">{item.deterministic_prediction}</span>. One of
                them is wrong.
              </>
            ) : (
              <>
                Both extractors <strong>agree</strong> on{' '}
                <span className="mono">{item.llm_prediction}</span>. You are confirming rather
                than settling a dispute — agreement is cheap to produce and still wrong
                sometimes, so a share of these get checked to keep the accuracy estimate honest.
              </>
            )}
          </p>

          <dl className="label__predictions" data-testid="label-predictions">
            <dt>LLM</dt>
            <dd>{item.llm_prediction}</dd>
            <dt>deterministic</dt>
            <dd>{item.deterministic_prediction}</dd>
          </dl>

          <div className="label__actions" data-testid="label-actions">
            <button
              type="button"
              className="label__action label__action--primary"
              onClick={() => void decide(item.llm_prediction, item.llm_prediction)}
            >
              Accept
            </button>
            <button
              type="button"
              className="label__action"
              onClick={() => openEditor(item.deterministic_prediction)}
            >
              Correct
            </button>
            <button
              type="button"
              className="label__action"
              onClick={() => openEditor(item.llm_prediction)}
            >
              Edit
            </button>
            <button type="button" className="label__action" onClick={skip}>
              Skip
            </button>
          </div>

          {/* outside label__actions on purpose: the buttons carry one word each, and the
              sentence that says what each word costs belongs beside them, not inside them */}
          <p className="label__actionhint">
            <strong>Accept</strong> records the model&rsquo;s answer.{' '}
            <strong>Correct</strong> records the keyword baseline&rsquo;s instead, pre-filled so
            you can change it. <strong>Edit</strong> starts from the model&rsquo;s answer.{' '}
            <strong>Skip</strong> records nothing and moves on.
          </p>

          {editing && (
            <div className="label__edit">
              <label htmlFor="label-correct-value">correct value</label>
              {/*
                #57. This was a free-text box over a closed vocabulary — the same fault as
                Ask's filter chip. `POST /label/decide` has validated against this exact list
                since #56, so the only party not shown it was the reviewer, whose way of
                learning the vocabulary was to type an answer and have it rejected.
              */}
              {item.allowed_positions.length > 0 ? (
                <select
                  id="label-correct-value"
                  aria-label="correct value"
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void decide(editValue, item.llm_prediction)
                    // element-level, not a window binding: Escape abandons the correction
                    if (e.key === 'Escape') setEditing(false)
                  }}
                  autoFocus
                >
                  {item.allowed_positions.map((position) => (
                    <option key={position} value={position}>
                      {position}
                    </option>
                  ))}
                </select>
              ) : (
                <>
                  <input
                    id="label-correct-value"
                    aria-label="correct value"
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void decide(editValue, item.llm_prediction)
                      if (e.key === 'Escape') setEditing(false)
                    }}
                    autoFocus
                  />
                  <span className="label__novocabulary" data-testid="label-novocabulary">
                    This {strings.subject} has no recorded answers in the corpus, so there is no
                    vocabulary to offer. The server will reject whatever you type here for the
                    same reason — nothing to check it against.
                  </span>
                </>
              )}
              <button
                type="button"
                className="label__action label__action--primary"
                onClick={() => void decide(editValue, item.llm_prediction)}
              >
                Record this value
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** What the reviewer just recorded, kept so the next item can report on the last one. */
interface Decision {
  recordId: string
  subjectName: string
  value: string
  modelAnswer: string
}

/**
 * Whether the model had agreed, for the item just decided (#52).
 *
 * The aggregate panel says what six decisions did to the graded score. This is the same
 * question at one item's resolution, and it is the only feedback the queue gives back: the
 * cursor has already moved on, so without this a reviewer never learns whether the answer
 * they overrode was the one the corpus's own gold answer would have kept.
 */
function Agreement({ decision, strings }: { decision: Decision; strings: QuorumStrings }) {
  const agreed = decision.value === decision.modelAnswer
  return (
    <p className="label__agreement" data-testid="label-agreement">
      Recorded <span className="mono">{decision.value}</span> for{' '}
      <span className="mono">{decision.recordId}</span> · {decision.subjectName}. The model had
      answered <span className="mono">{decision.modelAnswer}</span> —{' '}
      {agreed ? (
        <>
          it <strong>agreed with you</strong>. Grading will score the same answer it already had.
        </>
      ) : (
        <>
          it <strong>did not agree with you</strong>. Your answer replaces its own at the next
          grading run, and moves that {strings.subject}&rsquo;s number either way.
        </>
      )}
    </p>
  )
}

/**
 * What the decisions did to the graded score (#52).
 *
 * The loop's output used to live only on Admin, two tabs away from the queue that produces
 * it, so a reviewer making decisions had no way to see whether any of them mattered. Read
 * from the committed `docs/results/calibration-labels.json` via `/admin/calibration-labels` —
 * the same artefact Admin renders, not a second computation, so the two cannot disagree.
 *
 * The direction is stated, not implied. On the six decisions recorded so far the score went
 * *down*, and a panel that rendered a fall as progress would be worth less than no panel:
 * this whole tab is an argument that the number is checkable, and the first place that claim
 * gets tested is when the number moves the wrong way.
 */
function LoopOutcome({ strings }: { strings: QuorumStrings }) {
  const [data, setData] = useState<CalibrationLabels | null>(null)
  const [missing, setMissing] = useState(false)

  useEffect(() => {
    const controller = new AbortController()
    fetch('/api/admin/calibration-labels', { signal: controller.signal })
      .then(async (r) => {
        if (!r.ok) {
          setMissing(true)
          return
        }
        setData((await r.json()) as CalibrationLabels)
      })
      .catch(ignoreAbort(() => setMissing(true)))
    return () => controller.abort()
  }, [])

  const delta = data ? data.correct_after - data.correct_before : 0

  return (
    <section
      className="label__outcome"
      data-testid="label-outcome"
      aria-labelledby="label-outcome-title"
    >
      <h2 className="label__outcometitle" id="label-outcome-title">
        What these decisions changed
      </h2>

      {missing && (
        <p className="label__missing">
          Not run yet. Run <code>PYTHONPATH=backend python -m explorer.evals.calibration</code> and
          commit <code>docs/results/calibration-labels.json</code>.
        </p>
      )}
      {!missing && !data && (
        <div className="skeleton skeleton--row" aria-label="loading label calibration" />
      )}

      {data && (
        <>
          {/* Scoped, because this number and the "recorded in the database" one above it count
              different things and will diverge the moment anybody reviews an item: this is what
              the last calibration run graded, and that is what the table holds right now. */}
          <p className="label__outcomelead">
            <span className="mono">{data.labels_applied}</span> decisions were in the table when
            calibration last ran, of which{' '}
            <span className="mono">{data.labels_differing}</span> differed from the model&rsquo;s
            answer. Anything recorded since is counted above and is graded on the next run.
          </p>

          <dl className="label__figures">
            <div className="label__figure">
              <dt>graded correct before</dt>
              <dd>
                <span className="mono">
                  {data.correct_before} of {data.prediction_count}
                </span>
                <span className="label__pct">{percent(data.accuracy_before)}</span>
              </dd>
            </div>
            <div className="label__figure">
              <dt>graded correct after</dt>
              <dd>
                <span className="mono">
                  {data.correct_after} of {data.prediction_count}
                </span>
                <span className="label__pct">{percent(data.accuracy_after)}</span>
              </dd>
            </div>
          </dl>

          {/* direction by border and words, never by colour alone — and never by a green arrow */}
          <p className={`label__direction${delta < 0 ? ' is-down' : ''}`}>
            {delta < 0 && (
              <>
                The score <strong>went down</strong>: {-delta} fewer correct after these decisions
                than before. Substituting a reviewer&rsquo;s answer for the model&rsquo;s costs a
                point wherever the model was already right, and on balance that is what happened
                here.
              </>
            )}
            {delta > 0 && (
              <>
                The score <strong>went up</strong>: {delta} more correct after these decisions than
                before.
              </>
            )}
            {delta === 0 && (
              <>
                The score <strong>did not move</strong>: the same count graded correct before and
                after.
              </>
            )}
          </p>

          <p className="label__outcomecaveat">
            Read that against what this corpus is: {strings.heldOutClaim} Reviewing one teaches
            the system nothing gold did not. The loop closing means calibration <em>can</em>{' '}
            prefer a human label; it does not mean this corpus needs one. The mechanism earns its
            keep on <strong>un-annotated</strong> documents, where the reviewer&rsquo;s decision
            is the only answer there is.
          </p>

          <p className="label__provenance">
            Produced <span className="mono">{data.generated_at.slice(0, 10)}</span> by{' '}
            <code>{data.command}</code>. Per {strings.subject}, on <strong>Trust</strong>.
          </p>
        </>
      )}
    </section>
  )
}

/**
 * A share of 1,701 graded predictions, as a percentage.
 *
 * Percentages are allowed here and nowhere else on this tab: the house rule is counts below
 * threshold and percentages above, and n=1701 is far above it. The count and its denominator
 * are printed beside every percentage regardless.
 */
function percent(share: number): string {
  return `${(share * 100).toFixed(1)}%`
}
