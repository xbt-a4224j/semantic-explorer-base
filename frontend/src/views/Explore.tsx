import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FacetRail } from '../components/FacetRail'
import { RecordCard, type RecordRenderers } from '../components/RecordCard'
import { ResultsSkeleton } from '../index'
import type { ComparablesResponse, FacetsResponse, CorpusRecord, JourneySeed } from '../types'
import { ignoreAbort } from '../index'
import { ExplainerPanel } from '../components/ExplainerPanel'
import { ExploreExplainer } from '../components/explainers'
import { Term } from '../components/Term'


/**
 * Explore — faceted comparable-deal search (#19).
 *
 * Three states are designed rather than defaulted: loading is a skeleton shaped like the
 * result list (not a spinner), empty says which filters produced nothing and offers to clear
 * them, and a failed semantic layer says so explicitly instead of rendering zero counts.
 * "No results" and "the count service is down" must never look the same.
 *
 * Every count carries its denominator. Facet values with n=0 render disabled rather than
 * disappearing — what the corpus does *not* have is information.
 */

interface Props {
  // MutableRefObject, not RefObject: the shell creates it with useRef<HTMLInputElement>(null),
  // so its current is nullable and React 18's ref prop type requires the mutable form.
  searchRef: React.MutableRefObject<HTMLInputElement | null>
  /** Reports the matters currently on screen — the set Deal Terms rolls up (#21). */
  onSelectionChange?: (matterIds: string[]) => void
  /**
   * Arrive already narrowed, from an Overview journey. Every field is nullable because a
   * journey narrows on whichever axes its question names — industry and consideration for the
   * comparables one. A Coverage cell click was the other caller until #48 cut that tab.
   */
  /** How this corpus draws a record. Forwarded to every card; see RecordRenderers. */
  render?: RecordRenderers
  seedFilters?: JourneySeed | null
  onSeedConsumed?: () => void
}

/**
 * The active facet selection, keyed by dimension.
 *
 * A `Record` rather than a field per dimension. The typed version named
 * `folio_industry_label`, `signing_year` and `consideration_type` — and that is precisely the
 * shape that made the first fork of this app un-reusable: a corpus with different facets could
 * not use the view without editing it, so it copied it instead.
 *
 * The dimensions come from `/facets` at runtime, which already knew them. Nothing here has to.
 */
export type Filters = Record<string, string | null>

/** No filters. Built from the rail's own groups, so it cannot list a dimension the corpus
 *  does not have — an empty object is the honest starting point before /facets answers. */
const EMPTY: Filters = {}


/**
 * The three settings of one knob, named for what they do rather than for their algorithm.
 *
 * Both halves score the same candidate set and are min-max normalised per query before they
 * are blended, because BM25 is unbounded and cosine sits in [0,1] — measured on this corpus,
 * BM25's spread is about 25x cosine's, so blending the raw numbers makes alpha a decoration.
 */
const RANKERS = [
  {
    name: 'Keyword',
    tone: 'exact',
    alpha: 0,
    why: 'BM25 only. Finds the words you typed. Misses a deal that says the same thing differently.',
  },
  {
    name: 'Hybrid',
    tone: 'hybrid',
    alpha: 0.5,
    why: 'Both, blended after each is normalised for this query. The default.',
  },
  {
    name: 'Meaning',
    tone: 'meaning',
    alpha: 1,
    why: 'Embeddings only. Finds deals that read like yours, and will happily rank one that shares no words with it.',
  },
] as const

export function Explore({
  render, searchRef, onSelectionChange, seedFilters, onSeedConsumed }: Props) {
  const [filters, setFilters] = useState<Filters>(EMPTY)
  const [description, setDescription] = useState('')
  const [facets, setFacets] = useState<FacetsResponse | null>(null)
  const [results, setResults] = useState<ComparablesResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [expanded, setExpanded] = useState<string | null>(null)
  // The blend weight, exposed because a claim that hybrid retrieval helps is only worth
  // something if the reader can turn each half off and watch the ranking move. The endpoint
  // has always taken `alpha`; until now nothing on a user path sent it, so the two halves
  // were an implementation detail rather than a thing anyone could check.
  const [alpha, setAlpha] = useState<number>(0.5)
  const listRef = useRef<HTMLUListElement>(null)

  const activeCount = Object.values(filters).filter(Boolean).length

  // consume a journey seed exactly once: applying it and clearing it are the same act, so a
  // second render of the same seed (e.g. a parent re-render) cannot re-apply stale filters
  useEffect(() => {
    if (!seedFilters) return
    // Every dimension the seed names is applied and every other is CLEARED. Merging instead
    // would leave a filter from a previous journey silently narrowing the new one, which is a
    // wrong result that looks like a thin corpus.
    setFilters((current) => {
      const cleared = Object.fromEntries(Object.keys(current).map((k) => [k, null]))
      return { ...cleared, ...(seedFilters.filters ?? {}) }
    })
    if (seedFilters.description !== undefined) setDescription(seedFilters.description ?? '')
    onSeedConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seedFilters])

  useEffect(() => {
    // #38
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    const facetBody = {
      folio_industry_label: filters.folio_industry_label,
      signing_year: filters.signing_year ? Number(filters.signing_year) : null,
      deal_size_band: filters.deal_size_band,
      consideration_type: filters.consideration_type,
    }
    const comparablesBody = {
      description: description.trim() || null,
      // the industry filter belongs on the server: #18 filters in Postgres and builds the
      // hybrid index over exactly the survivors, so scores are relative to the requested
      // slice. Filtering the response here instead would rank against the whole corpus and
      // report a candidate_count for matters the partner never asked about.
      folio_industry_code: filters.folio_industry_code,
      signed_from: filters.signing_year ? `${filters.signing_year}-01-01` : null,
      signed_to: filters.signing_year ? `${filters.signing_year}-12-31` : null,
      deal_size_band: filters.deal_size_band,
      consideration_type: filters.consideration_type,
      alpha,
      limit: 25,
    }

    Promise.all([
      post<FacetsResponse>('/api/facets', facetBody, controller.signal),
      post<ComparablesResponse>('/api/comparables', comparablesBody, controller.signal),
    ])
      .then(([f, r]) => {
        setFacets(f)
        setResults(r)
        setCursor(0)
      })
      .catch(ignoreAbort((e) => setError(e.message)))
      // `finally` runs on abort too, and clearing the spinner for a view that is going away
      // would leave the *next* mount briefly showing a stale not-loading state
      .finally(() => !controller.signal.aborted && setLoading(false))

    return () => controller.abort()
  }, [filters, description, alpha])

  // No client-side filtering: the server is the authority on what is in the slice, and dropping
  // rows here would put the visible list and `candidate_count` into disagreement.
  const matters: CorpusRecord[] = useMemo(() => results?.matters ?? [], [results])

  // report the visible set upward so Deal Terms rolls up exactly what the partner is looking at
  useEffect(() => {
    onSelectionChange?.(matters.map((m) => m.record_id))
  }, [matters, onSelectionChange])

  const move = useCallback(
    (delta: number) => {
      setCursor((c) => Math.max(0, Math.min(matters.length - 1, c + delta)))
    },
    [matters.length],
  )

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target as HTMLElement | null
      const typing =
        el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)
      if (typing && e.key !== 'Escape') return

      if (e.key === 'j') {
        e.preventDefault()
        move(1)
      } else if (e.key === 'k') {
        e.preventDefault()
        move(-1)
      } else if (e.key === 'Enter' && matters[cursor]) {
        e.preventDefault()
        setExpanded((id) => (id === matters[cursor].record_id ? null : matters[cursor].record_id))
      } else if (e.key === 'f') {
        e.preventDefault()
        listRef.current?.ownerDocument
          .querySelector<HTMLButtonElement>('.facet__value')
          ?.focus()
      } else if (e.key === 'Escape') {
        setFilters(EMPTY)
        setDescription('')
        setExpanded(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [move, matters, cursor])

  function toggle(group: string, value: string, code: string | null) {
    setFilters((f) => {
      if (group === 'industry') {
        const clearing = f.folio_industry_label === value
        return {
          ...f,
          folio_industry_label: clearing ? null : value,
          folio_industry_code: clearing ? null : code,
        }
      }
      const key =
        group === 'year'
          ? 'signing_year'
          : group === 'consideration'
            ? 'consideration_type'
            : 'deal_size_band'
      return { ...f, [key]: f[key] === value ? null : value }
    })
  }

  return (
    <div className="explore">
      <ExplainerPanel id="explore" title="What this tab is for: finding comparable deals">
        <ExploreExplainer />
      </ExplainerPanel>
      {/* demo script 1 beat 1: what is loaded, before any interaction. An empty-looking rail
          could be a small corpus or a broken ingest; these tell the two apart. */}
      {facets?.corpus && (
        <p className="explore__corpus mono">
          {facets.corpus.matters} matters · {facets.corpus.deal_points.toLocaleString()} deal
          points · {facets.corpus.industries} industries
          {/* #35: a figure with no source is unverifiable. Each of these three comes from a
              different corpus, and one of them is inferred rather than labelled. */}
          <span className="explore__prov">
            matters and deal points from <Term>MAUD</Term> (expert-labelled) · industries from{' '}
            the <Term>SIC crosswalk</Term> via <Term>EDGAR</Term> (<Term>inferred</Term>) ·
            2020-03-13 to
            2021-11-21
          </span>
        </p>
      )}

      <div className="explore__search">
        <input
          ref={searchRef}
          className="explore__input"
          type="search"
          placeholder="Describe the deal in front of you…  ( / to focus )"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label="describe the deal"
        />
        {results && (
          <p className="explore__resolved" data-testid="resolved-query">
            {describeQuery(results, filters)}
          </p>
        )}

        {/* Only meaningful once there is a query to rank: with no description the endpoint
            orders by matter id and every setting returns the same list, so a control that
            appeared to do nothing would be worse than no control. */}
        {description.trim() !== '' && (
          <div className="rank" data-testid="rank-control">
            <span className="rank__label">rank by</span>
            <div className="rank__group" role="radiogroup" aria-label="ranking method">
              {RANKERS.map((r) => (
                <button
                  key={r.alpha}
                  type="button"
                  role="radio"
                  aria-checked={alpha === r.alpha}
                  className={`rank__btn rank__btn--${r.tone}${alpha === r.alpha ? ' rank__btn--on' : ''}`}
                  onClick={() => setAlpha(r.alpha)}
                  title={r.why}
                >
                  {r.name}
                  <span className="rank__alpha mono">α={r.alpha}</span>
                </button>
              ))}
            </div>
            <p className="rank__why">{RANKERS.find((r) => r.alpha === alpha)?.why}</p>
          </div>
        )}
      </div>

      <div className="explore__body">
        <FacetRail
          facets={facets}
          loading={loading}
          onToggle={toggle}
        />

        <section className="explore__results" aria-label="results">
          {error && (
            <div className="state state--error" role="alert">
              <h3 className="state__title">Counts unavailable</h3>
              <p className="state__body">{error}</p>
              <p className="state__hint">
                This is not “no results” — the semantic layer did not answer, so no number here
                would be trustworthy.
              </p>
            </div>
          )}

          {!error && loading && <ResultsSkeleton />}

          {!error && !loading && matters.length === 0 && (
            <div className="state state--empty">
              <h3 className="state__title">No comparable deals in this slice</h3>
              <p className="state__body">
                {activeCount === 0
                  ? 'The corpus is loaded but returned nothing for this description.'
                  : `${activeCount} filter${activeCount > 1 ? 's' : ''} applied. The corpus has no matters that satisfy all of them.`}
              </p>
              <button type="button" className="state__action" onClick={() => setFilters(EMPTY)}>
                Clear filters
              </button>
            </div>
          )}

          {!error && !loading && matters.length > 0 && (
            <>
              <p className="explore__count">
                showing {matters.length} of {results?.candidate_count ?? matters.length} matching ·{' '}
                <span className="muted">n={results?.candidate_count ?? matters.length}</span>
              </p>
              <ul className="explore__list" ref={listRef}>
                {matters.map((matter, i) => (
                  <RecordCard
                    key={matter.record_id}
                    render={render}
                  record={matter}
                    focused={i === cursor}
                    expanded={expanded === matter.record_id}
                    activeFilter={
                      filters.consideration_type
                        ? { dimension: 'consideration_type', value: filters.consideration_type }
                        : null
                    }
                    onFocus={() => setCursor(i)}
                    onToggle={() =>
                      setExpanded((id) => (id === matter.record_id ? null : matter.record_id))
                    }
                  />
                ))}
              </ul>
            </>
          )}
        </section>
      </div>
    </div>
  )
}

/** The resolved query, shown above every answer so a domain expert can catch a misread (#26). */
function describeQuery(results: ComparablesResponse, filters: Filters): string {
  const parts: string[] = []
  const applied = results.applied_filters
  if (filters.folio_industry_label) parts.push(filters.folio_industry_label)
  if (applied.signed_from) parts.push(`signed ${applied.signed_from} to ${applied.signed_to}`)
  if (applied.consideration_type) parts.push(applied.consideration_type)
  if (applied.deal_size_band) parts.push(applied.deal_size_band)
  parts.push(applied.ranked_by)
  return `${parts.join(' · ')} · n=${results.candidate_count}`
}

async function post<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
  const payload = await response.json()
  if (!response.ok) {
    throw new Error(payload?.error?.message ?? `request failed (${response.status})`)
  }
  return payload as T
}
