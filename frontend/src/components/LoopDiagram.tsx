/**
 * The improvement loop, drawn (#33).
 *
 * The Label tab's mechanism is not self-evident from the card: a reviewer sees two
 * predictions and a verdict, with no indication of where either came from or what their
 * decision changes. This is that mechanism as a picture.
 *
 * Inline SVG rather than an asset: it inherits the design tokens, so it cannot drift from
 * the palette, and it stays legible at any zoom. `role="img"` with a title and description
 * because a diagram that only works visually is not an explanation for everyone.
 */
export interface LoopCounts {
  /** model predictions recorded to disk */
  predictions: number
  /** decisions a reviewer actually made */
  decisions: number
  /** of those, how many differed from the model */
  differing: number
  correctBefore: number
  correctAfter: number
}

/**
 * Which way the regrade moved, read from the counts on the diagram itself.
 *
 * This was the string `'score went down'` whenever any counts were passed. With the `labels`
 * table empty the node beside it reads `569 → 569 correct`, so the arc closing the loop was
 * captioning a picture with a claim the picture contradicted — on the one tab whose whole
 * argument is that its figures are checkable. Caught by looking at the rendered page.
 *
 * All three strings clear the viewBox: anchored middle at x=52, a 9px italic sans string has
 * about 20 characters before its left edge goes negative, and the longest here is 18.
 */
function direction({ correctBefore, correctAfter }: LoopCounts): string {
  if (correctAfter < correctBefore) return 'score went down'
  if (correctAfter > correctBefore) return 'score went up'
  return 'score did not move'
}

/**
 * #54 puts real counts on the edges. Before this the diagram drew a mechanism that might never
 * have run; a cycle with 1,701 predictions and 6 decisions on it is a cycle that has turned.
 *
 * The direction is derived, never asserted. A loop that only ever reported improvement would be
 * a loop nobody should believe, and one that only ever reported a fall would be no better.
 */
export function LoopDiagram({ counts }: { counts?: LoopCounts } = {}) {
  const n = (v: number) => v.toLocaleString('en-US')
  return (
    <svg
      className="loop"
      viewBox="0 0 600 214"
      role="img"
      aria-labelledby="loop-title loop-desc"
      preserveAspectRatio="xMinYMin meet"
    >
      <title id="loop-title">The improvement loop</title>
      <desc id="loop-desc">
        Two extractors run over the same contract: a language model, whose predictions are
        recorded to disk, and a keyword baseline that costs nothing. Their answers are
        compared. Items where they disagree are ranked to the top of the review queue. Your
        decision writes one row to the labels table. The next calibration run reads that table
        and grades your answer in place of the model's, which moves the accuracy figure for that
        deal point — up if you were right, down if you were not.
      </desc>

      <defs>
        <marker
          id="loop-arrow"
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

      <g className="loop__edges" markerEnd="url(#loop-arrow)">
        <path d="M136,44 H152 Q160,44 160,52 V62" />
        <path d="M136,96 H152 Q160,96 160,88 V78" />
        <path d="M254,70 H284" />
        <path d="M416,70 H440" />
        <path d="M504,94 V142" />
        <path d="M440,164 H418" />
        <path d="M286,164 H262" />
        <path d="M116,164 H60 Q46,164 46,150 V122" />
      </g>

      <g className="loop__node">
        <rect x="12" y="24" width="124" height="40" rx="6" />
        <rect x="12" y="76" width="124" height="40" rx="6" />
        <rect x="160" y="50" width="94" height="40" rx="6" />
        <rect x="288" y="50" width="128" height="40" rx="6" />
        <rect x="444" y="50" width="120" height="40" rx="6" />
        <rect x="444" y="144" width="120" height="40" rx="6" />
        <rect x="290" y="144" width="126" height="40" rx="6" />
        <rect x="116" y="144" width="146" height="40" rx="6" />
      </g>

      <g className="loop__label">
        <text x="74" y="42">LLM extractor</text>
        <text x="74" y="94">keyword baseline</text>
        <text x="207" y="68">compare</text>
        <text x="352" y="68">queue rank</text>
        <text x="504" y="68">you decide</text>
        <text x="504" y="162">labels</text>
        <text x="353" y="162">calibration run</text>
        <text x="189" y="162">accuracy per deal point</text>
      </g>

      <g className="loop__sub">
        <text x="74" y="56">
          {counts ? `${n(counts.predictions)} recorded` : 'recorded to disk'}
        </text>
        <text x="74" y="108">no API call</text>
        <text x="207" y="82">same contract</text>
        <text x="352" y="82">disagreements first</text>
        {/* four buttons, not four keys (#52) — spelled out in the body copy; at 9px
            monospace the four words themselves overrun the 120px node */}
        <text x="504" y="82">
          {counts ? `${counts.decisions} decisions` : 'four buttons'}
        </text>
        <text x="504" y="176">
          {counts ? `${counts.differing} differed` : 'one row each'}
        </text>
        <text x="353" y="176">
          {counts ? `${counts.correctBefore} → ${counts.correctAfter} correct` : 'reads and prefers them'}
        </text>
        <text x="189" y="176">where it is weak</text>
      </g>

      {/* the arc closing the loop is the whole point: labels change the next measurement */}
      {/* Anchored middle at x, so the string's own width decides whether it clears the viewBox
          and the "no API call" sub-label above it. "the score went DOWN" measured 98px at 9px
          italic and ran off the left edge to x=-3, colliding with that label. Kept short and
          moved into the clear band between the baseline node (ends y=116) and the bottom row
          (starts y=144). Caught by the screenshot pass, not by any unit test. */}
      <text className="loop__note" x="52" y="132">
        {counts ? direction(counts) : 'loop closed (#41)'}
      </text>
    </svg>
  )
}
