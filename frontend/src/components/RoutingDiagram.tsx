/**
 * The two paths a question can take (#36).
 *
 * Top: freeform text-to-SQL. The model writes the query, so it chooses both the number and
 * the *definition* of the number, and two generated queries can only be diffed — there is
 * nothing to score.
 *
 * Bottom: governed selection. The model picks from a fixed vocabulary; Postgres computes.
 * Correctness collapses to "did it pick the right measure and filters", which is gradeable
 * offline with no database and no model in the loop.
 */
export function RoutingDiagram() {
  return (
    <svg
      className="loop"
      viewBox="0 0 600 196"
      role="img"
      aria-labelledby="routing-title routing-desc"
      preserveAspectRatio="xMinYMin meet"
    >
      <title id="routing-title">Two routes from question to number</title>
      <desc id="routing-desc">
        Freeform text-to-SQL: the question goes to a language model, which writes SQL, which
        produces a number. The model chooses both the number and the definition of the
        number, and the result can only be compared to another generated query, not scored.
        Governed selection: the question goes to a language model constrained to a catalog of
        named measures and dimensions. It emits a selection. Filter values are
        resolved against the values actually present in the data, failing loudly rather than
        returning an empty result. The semantic layer turns the selection into SQL and
        Postgres computes the number. Only the selection can be wrong, and a selection is
        gradeable offline.
      </desc>

      <defs>
        <marker
          id="route-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto-start-reverse"
        >
          <path d="M0,0 L8,4 L0,8 z" fill="var(--hairline-strong)" />
        </marker>
      </defs>

      <g className="loop__edges" markerEnd="url(#route-arrow)">
        <path d="M104,34 H140" />
        <path d="M244,34 H280" />
        <path d="M384,34 H420" />
        <path d="M104,130 H136" />
        <path d="M240,130 H272" />
        <path d="M376,130 H408" />
        <path d="M480,152 V166 H300" />
      </g>

      <g className="loop__node">
        <rect x="12" y="14" width="92" height="40" rx="6" />
        <rect x="140" y="14" width="104" height="40" rx="6" />
        <rect x="280" y="14" width="104" height="40" rx="6" />
        <rect x="12" y="110" width="92" height="40" rx="6" />
        <rect x="136" y="110" width="104" height="40" rx="6" />
        <rect x="272" y="110" width="104" height="40" rx="6" />
        <rect x="408" y="110" width="104" height="40" rx="6" />
      </g>

      <g className="loop__node loop__node--out">
        <rect x="420" y="14" width="104" height="40" rx="6" />
      </g>

      <g className="loop__label">
        <text x="58" y="32">question</text>
        <text x="192" y="32">model writes SQL</text>
        <text x="332" y="32">a number</text>
        <text x="472" y="32">ungradeable</text>
        <text x="58" y="128">question</text>
        <text x="188" y="128">model selects</text>
        <text x="324" y="128">resolve values</text>
        <text x="460" y="128">Cube → Postgres</text>
      </g>

      <g className="loop__sub">
        <text x="58" y="46">same words</text>
        {/* These sub-captions are centred inside a 104px node at 9px monospace, so ~5.4px a
            character: past 18 they render outside the box they label. Measured in the browser
            with getComputedTextLength, which is the only thing that catches it. */}
        <text x="192" y="46">and the definition</text>
        <text x="332" y="46">looks right</text>
        <text x="472" y="46">only diffable</text>
        <text x="58" y="142">same words</text>
        <text x="188" y="142">from the catalog</text>
        <text x="324" y="142">or fail loudly</text>
        <text x="460" y="142">computes the number</text>
      </g>

      <text className="loop__note" x="300" y="180">
        one discrete decision to grade: did it pick the right measure and filters
      </text>
      <text className="loop__lane" x="12" y="76">
        freeform · above &nbsp;|&nbsp; governed · below
      </text>
    </svg>
  )
}
