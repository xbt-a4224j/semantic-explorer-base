import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FacetRail } from '../components/FacetRail'
import { RecordCard, type RecordRenderers } from '../components/RecordCard'
import { ResultsSkeleton } from '../index'
import type { ComparablesResponse, CorpusCounts, FacetsResponse, CorpusRecord, JourneySeed } from '../types'
import { ignoreAbort } from '../index'
import type { QuorumStrings } from '../strings'


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
  /** Reports the records currently on screen — the set Deal Terms rolls up (#21). */
  onSelectionChange?: (recordIds: string[]) => void
  /**
   * Arrive already narrowed, from an Overview journey. Every field is nullable because a
   * journey narrows on whichever axes its question names — industry and consideration for the
   * comparables one. A Coverage cell click was the other caller until #48 cut that tab.
   */
  /** How this corpus draws a record. Forwarded to every card; see RecordRenderers. */
  render?: RecordRenderers
  seedFilters?: JourneySeed | null
  onSeedConsumed?: () => void
  /** The domain's nouns, forwarded to every component that renders a word. */
  strings: QuorumStrings

  /** This corpus's own provenance line — which sources, what date range, what is
   *  inferred. A claim about the corpus, so it cannot be the platform's. */
  corpusStrip?: (counts: CorpusCounts) => React.ReactNode

  /**
   * How the active `ExploreFilters` become the two request bodies this view sends. Defaults to
   * sending `filters` verbatim to both `/facets` and `/comparables` — correct whenever a
   * filter is a plain equality match on both endpoints, which is the common case.
   *
   * Override only when a filter needs server-side reshaping the platform cannot know: the
   * reference domain's `signing_year` becomes a bare number for `/facets` but a
   * `signed_from`/`signed_to` date range for `/comparables`. Before this hook existed that
   * reshaping was hardcoded here by field name, which silently dropped every filter field a
   * second domain used instead — `policy_state`, say — because nothing forwarded it.
   */
  toRequestFilters?: (filters: ExploreFilters) => {
    facets: Record<string, unknown>
    comparables: Record<string, unknown>
  }

  /**
   * The resolved-query line above results (#26: "so a domain expert can catch a misread").
   * Defaults to every active filter's value, joined by ' · ', plus `applied_filters.ranked_by`
   * when the response carries one. Override for phrasing that reads more like the domain's own
   * voice — the reference domain says "signed 2021-01-01 to 2021-12-31" rather than a bare
   * filter dump.
   */
  describeQuery?: (results: ComparablesResponse, filters: ExploreFilters) => string

  /**
   * Ranking presets shown above results once a description is typed — the reference domain's
   * Keyword/Hybrid/Meaning knob over BM25 vs. embeddings. Omit entirely for a domain whose
   * search has no ranking axis to expose: a knob for a blend that is not actually computed
   * would demonstrate a capability the search endpoint does not have.
   */
  rankers?: readonly { name: string; tone: string; alpha: number; why: string }[]

  /**
   * A query to open the tab already ranking. The rank-by control is gated on there being a
   * description — correct, since a blend weight over nothing is a knob attached to nothing —
   * but it also meant the two-ranker comparison, the most interesting thing on this tab, was
   * invisible until a reader happened to type. A domain that has a measured query worth
   * showing can stage it here. Editable and clearable like anything typed; omit it and the
   * tab opens empty as before.
   */
  seedDescription?: string
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
export type ExploreFilters = Record<string, string | null>

/** No filters. Built from the rail's own groups, so it cannot list a dimension the corpus
 *  does not have — an empty object is the honest starting point before /facets answers. */
const EMPTY: ExploreFilters = {}


/**
 * The three settings of one knob, named for what they do rather than for their algorithm.
 *
 * Both halves score the same candidate set and are min-max normalised per query before they
 * are blended, because BM25 is unbounded and cosine sits in [0,1] — measured on this corpus,
 * BM25's spread is about 25x cosine's, so blending the raw numbers makes alpha a decoration.
 */
export function Explore({
  corpusStrip,
  strings,
  toRequestFilters,
  describeQuery: describeQueryProp,
  rankers,
  render, searchRef, onSelectionChange, seedFilters, onSeedConsumed, seedDescription }: Props) {
  const [filters, setFilters] = useState<ExploreFilters>(EMPTY)
  const [description, setDescription] = useState(seedDescription ?? '')
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
  // The selected position must always be ON the preset list. A hardcoded 0.5 was the Hybrid
  // position; when a domain dropped that preset the first query still ran at 0.5 with neither
  // remaining button selected and an empty "why" line — a two-button control silently driving
  // a third mode. Falling back to `rankers[0]` fixed that and broke something else: a domain
  // listing Keyword first then opened on pure BM25, which is the one mode that makes hybrid
  // retrieval look pointless. So: prefer the blend when the domain offers it, otherwise the
  // first preset, and only then the literal.
  const [alpha, setAlpha] = useState<number>(
    rankers?.find((r) => r.alpha === 0.5)?.alpha ?? rankers?.[0]?.alpha ?? 0.5,
  )
  const listRef = useRef<HTMLUListElement>(null)

  const activeCount = Object.values(filters).filter(Boolean).length

  // Which active filter, if any, has evidence a card can show — derived from `render.evidenceFor`
  // (a dimension -> subject map the domain already supplies) rather than a hardcoded dimension
  // name. This used to check `filters.consideration_type` specifically, which is `undefined` for
  // any domain whose facets are named differently, silently disabling the whole feature for
  // them.
  const activeEvidenceDim = render?.evidenceFor
    ? Object.keys(render.evidenceFor).find((dim) => filters[dim])
    : undefined
  const activeEvidenceFilter = activeEvidenceDim
    ? { dimension: activeEvidenceDim, value: filters[activeEvidenceDim] as string }
    : null

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

    // Verbatim by default: a plain-equality filter (claims-explorer's `policy_state`, say)
    // needs no reshaping to be a valid request body for either endpoint. `toRequestFilters`
    // exists only for a filter whose two endpoints want different shapes of the same value —
    // see the reference domain's own override, just below the component, for the case that
    // forced this hook to exist: `/facets` wants a bare `signing_year`, `/comparables` wants a
    // `signed_from`/`signed_to` range built from it.
    const { facets: facetBody, comparables: comparablesFilters } = (
      toRequestFilters ?? ((f: ExploreFilters) => ({ facets: f, comparables: f }))
    )(filters)
    const comparablesBody = {
      description: description.trim() || null,
      // the filter belongs on the server: #18 filters in Postgres and builds the hybrid index
      // over exactly the survivors, so scores are relative to the requested slice. Filtering
      // the response here instead would rank against the whole corpus and report a
      // candidate_count for records the partner never asked about.
      ...comparablesFilters,
      ...(rankers ? { alpha } : {}),
      // 200 (the endpoint's max), not 25. The selection this view exports is what the rollup
      // tab rolls up, so a 25-cap meant a 26-record slice was rolled up over 25 of them and
      // labelled "25 of 25" — an incomplete set presented as complete, in a product whose claim
      // is that every figure carries its denominator. Display is paged separately.
      limit: 200,
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
  const records: CorpusRecord[] = useMemo(() => results?.records ?? [], [results])

  // report the visible set upward so Deal Terms rolls up exactly what the partner is looking at
  useEffect(() => {
    onSelectionChange?.(records.map((m) => m.record_id))
  }, [records, onSelectionChange])

  const move = useCallback(
    (delta: number) => {
      setCursor((c) => Math.max(0, Math.min(records.length - 1, c + delta)))
    },
    [records.length],
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
      } else if (e.key === 'Enter' && records[cursor]) {
        e.preventDefault()
        setExpanded((id) => (id === records[cursor].record_id ? null : records[cursor].record_id))
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
  }, [move, records, cursor])

  function toggle(group: string, value: string, code: string | null) {
    // `group` IS the filter key — FacetRail passes the facet's own `group.key` straight
    // through (see `/facets`'s own response shape), so there is no name to look up. This used
    // to branch on three hardcoded group names ('industry' | 'year' | 'consideration') and
    // fall through to `deal_size_band` for anything else — clicking a facet value from a
    // second domain's rail (`policy_state`, say) silently wrote into `deal_size_band` instead,
    // a wrong key with no error anywhere.
    setFilters((f) => {
      const clearing = f[group] === value
      const next: ExploreFilters = { ...f, [group]: clearing ? null : value }
      // A facet whose values carry a stable code (the reference domain's industry: a label may
      // be retitled, the code is not) gets a parallel `${group}_code` key. A facet with no
      // code — `code` is always null — never gains one, so this stays inert for a domain like
      // claims-explorer whose four facets are already exactly the string a question would use.
      if (code !== null) next[`${group}_code`] = clearing ? null : code
      return next
    })
  }

  return (
    <div className="explore">
      {/* demo script 1 beat 1: what is loaded, before any interaction. An empty-looking rail
          could be a small corpus or a broken ingest; these tell the two apart.
          #35: a figure with no source is unverifiable — but WHICH sources and whether any of
          them is inferred is a claim about this corpus, so it is the domain's `corpusStrip`,
          not this file's. This view supplies the live counts; the domain supplies the prose. */}
      {facets?.corpus && corpusStrip?.(facets.corpus)}

      <div className="explore__search">
        <input
          ref={searchRef}
          className="explore__input"
          type="search"
          placeholder={strings.searchPlaceholder ?? `Describe the ${strings.record} in front of you…`}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          aria-label={`describe the ${strings.record}`}
        />
        {results && (
          <p className="explore__resolved" data-testid="resolved-query">
            {(describeQueryProp ?? defaultDescribeQuery)(results, filters)}
          </p>
        )}

        {/* Only meaningful once there is a query to rank, and only for a domain that supplied
            ranking presets — a knob for a blend `/comparables` does not actually compute would
            demonstrate a capability the search does not have (see the `rankers` prop). */}
        {rankers && description.trim() !== '' && (
          <div className="rank" data-testid="rank-control">
            <span className="rank__label">rank by</span>
            <div className="rank__group" role="radiogroup" aria-label="ranking method">
              {rankers.map((r) => (
                <button
                  key={r.alpha}
                  type="button"
                  role="radio"
                  aria-checked={alpha === r.alpha}
                  className={`rank__btn rank__btn--${r.tone}${alpha === r.alpha ? ' rank__btn--on' : ''}`}
                  onClick={() => setAlpha(r.alpha)}
                  title={r.why}
                >
                  {/* No α chip. With two exclusive positions alpha is a boolean choosing a
                      ranker; a number on a boolean is noise to a reader and an invitation to
                      an engineer to ask for the 0.3 the UI no longer offers. `alpha` stays the
                      API's real parameter and the measured value in RETRIEVAL.md. */}
                  {r.name}
                </button>
              ))}
            </div>
            <p className="rank__why">{rankers.find((r) => r.alpha === alpha)?.why}</p>
          </div>
        )}
      </div>

      <div className="explore__body">
        <FacetRail
            strings={strings}
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

          {!error && !loading && records.length === 0 && (
            <div className="state state--empty">
              <h3 className="state__title">No comparable {strings.colloquial} in this slice</h3>
              <p className="state__body">
                {activeCount === 0
                  ? 'The corpus is loaded but returned nothing for this description.'
                  : `${activeCount} filter${activeCount > 1 ? 's' : ''} applied. The corpus has no records that satisfy all of them.`}
              </p>
              <button type="button" className="state__action" onClick={() => setFilters(EMPTY)}>
                Clear filters
              </button>
            </div>
          )}

          {!error && !loading && records.length > 0 && (
            <>
              {/* Was: "showing 25 of 352 matching · n=352". Two defects in one line.
                  (1) `candidate_count` was printed TWICE — as the "of" and again as the `n` —
                      so the same denominator was rendered as if it were two facts. That is #34's
                      failure in its purest form: identical numbers, different-looking claims.
                  (2) "matching" was a lie about causation. A text query RANKS, it never filters;
                      352 is what the FACETS narrowed to. Saying "matching" credits the search for
                      a number the filters produced, which is exactly the kind of quietly-wrong
                      attribution this product exists to prevent. */}
              <p className="explore__count">
                showing {records.length} of{' '}
                <span className="muted">n={results?.candidate_count ?? records.length}</span>{' '}
                {description.trim() ? 'ranked by relevance' : 'in this slice'}
              </p>
              <ul className="explore__list" ref={listRef}>
                {records.map((record, i) => (
                  <RecordCard
                  strings={strings}
                    key={record.record_id}
                    render={render}
                  record={record}
                    focused={i === cursor}
                    expanded={expanded === record.record_id}
                    activeFilter={activeEvidenceFilter}
                    onFocus={() => setCursor(i)}
                    onToggle={() =>
                      setExpanded((id) => (id === record.record_id ? null : record.record_id))
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

/**
 * The resolved query, shown above every answer so a domain expert can catch a misread (#26).
 *
 * Generic default: every active filter's own value, joined by ' · ', plus `ranked_by` if the
 * response carries one — correct for any domain, readable for none of them in particular. A
 * domain overrides `describeQuery` for phrasing that reads like its own voice, the way the
 * reference domain says "signed 2021-01-01 to 2021-12-31" rather than a bare value.
 */
function defaultDescribeQuery(results: ComparablesResponse, filters: ExploreFilters): string {
  const parts = Object.entries(filters)
    .filter(([key, value]) => value && !key.endsWith('_code'))
    .map(([, value]) => value as string)
  const rankedBy = results.applied_filters?.ranked_by
  if (rankedBy) parts.push(String(rankedBy))
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
