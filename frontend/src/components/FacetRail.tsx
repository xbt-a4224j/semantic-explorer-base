import type { FacetsResponse } from '../types'
import type { QuorumStrings } from '../strings'

/**
 * The facet rail (#19).
 *
 * Two rules that are easy to get wrong and expensive to get wrong:
 *
 * 1. **A zero-count value renders disabled, never hidden.** What the corpus does not contain
 *    is information — hiding it makes an absent slice indistinguishable from one that was
 *    never offered.
 * 2. **Every count carries its denominator.** `n=25`, not a bare 25 floating beside a label.
 */
export function FacetRail({
  strings,
  facets,
  loading,
  onToggle,
}: {
  facets: FacetsResponse | null
  loading: boolean
  onToggle: (group: string, value: string, code: string | null) => void
  /** The domain's nouns. Passed, not injected — see strings.ts. */
  strings: QuorumStrings
}) {
  return (
    <aside className="facets" aria-label="filters">
      {facets && (
        <p className="facets__total">
          <span className="facets__totalnum">{facets.total_n}</span> of {facets.unfiltered_n}{' '}
          {strings.records}
        </p>
      )}

      {loading && !facets && (
        <div className="facets__skeleton" aria-hidden="true">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="skeleton skeleton--facet" />
          ))}
        </div>
      )}

      {facets?.groups.map((group) => (
        <section
          key={group.key}
          className={`facet${group.unavailable ? ' facet--unavailable' : ''}`}
          data-testid={`facet-${group.key}`}
        >
          <h3 className="facet__title">
            <span>
              {group.label}
              {/* inferred is marked where someone filters, not only in a doc (#34) */}
              {group.inferred && (
                <span className="facet__inferred" title="classifier output, not an expert label">
                  inferred
                </span>
              )}
            </span>
            {/* a group total and a value count are different denominators; only the group total
                is a filterable-matter count, and it says so rather than repeating a bare n= */}
            {group.total_n !== null && group.total_n !== undefined && (
              <span className="facet__n" title={group.total_basis}>
                {group.total_n} filterable
              </span>
            )}
          </h3>
          {group.unavailable && <p className="facet__unavailable">{group.unavailable}</p>}
          <ul className="facet__values">
            {group.values.map((value) => (
              <li key={value.value}>
                <button
                  type="button"
                  className={`facet__value${value.selected ? ' is-selected' : ''}`}
                  disabled={value.n === 0 || group.unavailable != null}
                  aria-pressed={value.selected}
                  aria-disabled={value.n === 0 || group.unavailable != null}
                  onClick={() => onToggle(group.key, value.value, value.code ?? null)}
                >
                  <span className="facet__label">{value.value}</span>
                  <span className="facet__count">n={value.n}</span>
                </button>
                {/* an absence bucket states its cause: "unclassified · 3" reads as a bug and
                    is actually a provenance fact (#34) */}
                {value.reason && <p className="facet__reason">{value.reason}</p>}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  )
}
