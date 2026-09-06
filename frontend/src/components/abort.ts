/**
 * Abort handling shared by every fetching view (#38).
 *
 * The pattern these views used was a `cancelled` boolean flipped in the effect's cleanup. It
 * suppressed the `setState`, which is the visible symptom, but the request itself ran to
 * completion — socket held open, body downloaded, JSON parsed — for a component nobody is
 * looking at. An `AbortController` cancels the work rather than discarding its result, and
 * subsumes the boolean: an aborted fetch rejects, so the `.then` never runs.
 *
 * The cost is that abort arrives as a rejection, so every `.catch` that sets an error state
 * has to tell "the user navigated away" apart from "the server is down". Surfacing an abort as
 * an error would put a red panel on a tab the user just left — and, worse, would make the two
 * indistinguishable on the tab they returned to.
 */

import { useEffect, useRef } from 'react'

/**
 * A signal for a fetch started by a *click* rather than an effect.
 *
 * Effects get an `AbortController` from their own cleanup; a click handler has no cleanup to
 * hang one on, which is why `QueryBuilder` had no cancel handling at all and `Tables`'
 * row-expand and `DealTerms`' drill-through were unguarded. Calling the returned function
 * aborts whatever the previous click started — latest-click-wins, so a fast double-click
 * cannot render the older response — and unmounting aborts the outstanding one.
 *
 * Reads only. A POST that writes something (a label decision) must be allowed to finish;
 * cancelling it would silently drop the user's work.
 */
export function useAbortOnUnmount(): () => AbortSignal {
  const ref = useRef<AbortController | null>(null)
  useEffect(() => () => ref.current?.abort(), [])
  return () => {
    ref.current?.abort()
    ref.current = new AbortController()
    return ref.current.signal
  }
}

/** True when a rejection is this component's own teardown rather than a failed request. */
export function isAbortError(error: unknown): boolean {
  return (error as { name?: string } | null)?.name === 'AbortError'
}

/**
 * Wrap a `.catch` handler so aborts fall through silently.
 *
 * `fetch(url, { signal }).catch(ignoreAbort((e) => setError(e.message)))`
 */
export function ignoreAbort(handler: (error: Error) => void): (error: unknown) => void {
  return (error: unknown) => {
    if (isAbortError(error)) return
    handler(error as Error)
  }
}
