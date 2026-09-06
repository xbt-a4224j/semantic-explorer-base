/**
 * Per-tab explanatory diagrams (#35, reduced in #45).
 *
 * Inline SVG on design tokens so they cannot drift from the palette and stay legible at any
 * zoom. Every one is `role="img"` with a title AND a description that carries the same content
 * in words — a diagram that only works visually is not an explanation for everyone.
 *
 * There were five. #45 cut the explainer prose to what a tab is for plus its one honest limit,
 * and deleted the two diagrams whose argument no longer had prose beside it:
 * `ExploreDiagram` drew an industry hierarchy roll-up, and `AdminDiagram` drew the
 * `MAX(updated_at)` freshness chain. Both paragraphs moved to `docs/walkthrough.md`. #48 then
 * cut the Coverage and Tables tabs, and `CoverageDiagram` and `TablesDiagram` went with them —
 * a diagram outlives its tab only if some other tab still makes its claim. One is left, and it
 * survives because the claim it draws is still stated in the explainer beside it.
 *
 * Shared classes live in shell.css under the explainer section: .loop__edges, .loop__node,
 * .loop__label, .loop__sub, .loop__note.
 */

function Arrow({ id }: { id: string }) {
  return (
    <defs>
      <marker
        id={id}
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
  )
}

export function RollupDiagram({
  description,
}: {
  /** How THIS corpus's rollup works — what a row is, what rolls it up, why a new question costs
   *  nothing. A description of a specific corpus's mechanism, not the platform's to write. */
  description: string
}) {
  return (
    <svg
      className="loop"
      viewBox="0 0 600 208"
      role="img"
      aria-labelledby="dt-t dt-d"
      preserveAspectRatio="xMinYMin meet"
    >
      <title id="dt-t">How the rollup is built</title>
      <desc id="dt-d">{description}</desc>
      <Arrow id="dt-a" />

      <g className="loop__edges" markerEnd="url(#dt-a)">
        <path d="M124,44 H160" />
        <path d="M286,44 H322" />
        <path d="M448,44 H484" />
        <path d="M384,66 V102" />
        <path d="M322,122 H286" />
        <path d="M160,122 H124" />
      </g>

      <g className="loop__node">
        <rect x="12" y="24" width="112" height="40" rx="6" />
        <rect x="160" y="24" width="126" height="40" rx="6" />
        <rect x="322" y="24" width="126" height="40" rx="6" />
        <rect x="484" y="24" width="104" height="40" rx="6" />
        <rect x="322" y="102" width="126" height="40" rx="6" />
        <rect x="160" y="102" width="126" height="40" rx="6" />
        <rect x="12" y="102" width="112" height="40" rx="6" />
      </g>

      <g className="loop__label">
        <text x="68" y="42">152 agreements</text>
        <text x="223" y="42">92 ABA questions</text>
        <text x="385" y="42">one row each</text>
        <text x="536" y="42">your selection</text>
        <text x="385" y="120">roll up</text>
        <text x="223" y="120">“6 of 8”</text>
        <text x="68" y="120">click the row</text>
      </g>
      <g className="loop__sub">
        <text x="68" y="56">read by lawyers</text>
        <text x="223" y="56">same set, every deal</text>
        <text x="385" y="56">12,937 rows</text>
        <text x="536" y="56">8 comparables</text>
        <text x="385" y="134">count per question</text>
        <text x="223" y="134">not 75% — n too small</text>
        <text x="68" y="134">the clause text</text>
      </g>

      <text className="loop__note" x="300" y="182">
        absence is a finding: a question no deal answers renders “0 of 8”, it is not dropped from
        the table
      </text>
      <text className="loop__note" x="300" y="196">
        a missing row would read as “not asked”, which is a different and false claim
      </text>
    </svg>
  )
}
