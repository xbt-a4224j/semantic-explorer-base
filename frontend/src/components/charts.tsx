import { useId, useState, type ReactNode } from 'react'

/**
 * Chart primitives for Trust (#54). Inline SVG, no charting library.
 *
 * Built to the data-viz procedure: form first, then colour by the job it does, then the
 * validator. What that produced here:
 *
 * **Form.** Three of the four visuals are magnitude comparisons over a named list, so they are
 * horizontal bars. The fourth is part-to-whole over six decisions, so it is a stacked bar. No
 * donut, no dual axis, no animation.
 *
 * **Colour.** Two of the three bar charts plot *one measure over nominal categories* — deal
 * points, and the four things the model is scored on. Those are one series, so every bar takes
 * categorical slot 1 and nothing else. Note this departs from #54's wording, which asked for
 * "sequential blue by accuracy": colouring each bar darker-where-bigger over categories with no
 * natural order is a named anti-pattern — it spends the identity channel re-encoding what bar
 * length already shows. Sorting worst-first already carries the ranking. The stacked bar is the
 * one place identity is the job, and it takes slots 1 and 2.
 *
 * **Validated, not eyeballed.** `node scripts/validate_palette.js`:
 *   "#2a78d6,#eb6834" --mode light --surface #ffffff  → all six PASS,
 *       worst adjacent CVD ΔE 24.7 (protan), normal-vision 33.6
 *   "#3987e5,#d95926" --mode dark  --surface #1a1a19  → all six PASS,
 *       worst adjacent CVD ΔE 26.8 (protan), normal-vision 31.8
 * Slot 1 alone clears contrast in both modes: 4.42:1 light, 4.79:1 dark.
 *
 * **Text never wears a series colour.** Every label, value and axis tick here is an ink token.
 * The colour lives in the mark beside it.
 */

/** 4px rounded data-end, square at the baseline (left edge), per the mark spec. */
export function barPath(x: number, y: number, width: number, height: number, radius = 4) {
  const r = Math.min(radius, Math.max(0, width))
  if (r <= 0.5) return `M${x},${y} h${width} v${height} h${-width} Z`
  return (
    `M${x},${y} h${width - r} a${r},${r} 0 0 1 ${r},${r} ` +
    `v${height - 2 * r} a${r},${r} 0 0 1 ${-r},${r} h${-(width - r)} Z`
  )
}

/**
 * A chart and its table view, behind one toggle.
 *
 * Every chart on Trust has a table twin. It is the relief channel the colour checks require and
 * the only form that works in a screen reader, and it means no value is reachable *only* by
 * hovering.
 */
export function ChartFrame({
  title,
  note,
  footnote,
  table,
  testId,
  children,
}: {
  title: string
  /** At most two sentences: what the chart says. */
  note?: ReactNode
  /**
   * The statistical argument, below the chart and behind a disclosure.
   *
   * These captions had grown to seven lines explaining a lower bound mid-sentence, which is the
   * same fault the explainer collapse fixed on the older tabs: prose defending a chart instead
   * of a chart that reads. Nothing is deleted, it moves below the thing it qualifies.
   */
  footnote?: ReactNode
  table: ReactNode
  testId: string
  children: ReactNode
}) {
  const [showTable, setShowTable] = useState(false)
  const id = useId()
  return (
    <section className="viz" data-testid={testId}>
      <div className="viz__head">
        <h3 className="viz__title" id={`${id}-title`}>
          {title}
        </h3>
        <button
          type="button"
          className="viz__toggle"
          aria-pressed={showTable}
          aria-controls={`${id}-body`}
          onClick={() => setShowTable((v) => !v)}
        >
          {showTable ? 'chart' : 'table'}
        </button>
      </div>
      {note && <p className="viz__note">{note}</p>}
      <div id={`${id}-body`}>
        {showTable ? (
          <div className="scrollx" data-testid={`${testId}-table`}>
            {table}
          </div>
        ) : (
          children
        )}
      </div>
      {footnote && (
        <details className="viz__footnote" data-testid={`${testId}-footnote`}>
          <summary>How to read this</summary>
          <p>{footnote}</p>
        </details>
      )}
    </section>
  )
}

export interface BarDatum {
  label: string
  /** null renders as "not measured" — never as 0, which would turn a gap into a failure */
  value: number | null
  /** shown on hover, e.g. the Wilson interval and n */
  detail?: string
  /** a sparing direct label; most bars carry none */
  directLabel?: string
}

/**
 * Horizontal bars, one series, sorted by the caller.
 *
 * `rowHeight` × the row count is the SVG height — 90 rows is a scroll, not a squeeze. Shrinking
 * to fit is what turns a weakness map into a texture.
 */
export function BarChart({
  data,
  max = 1,
  rule,
  ruleLabel,
  labelWidth = 300,
  rowHeight = 18,
  valueFormat = (v: number) => v.toFixed(2),
  testId,
}: {
  data: BarDatum[]
  max?: number
  /** a 2px reference line — a rule, never a colour change */
  rule?: number
  ruleLabel?: string
  labelWidth?: number
  rowHeight?: number
  valueFormat?: (v: number) => string
  testId: string
}) {
  const width = 720
  const plotLeft = labelWidth
  const plotWidth = width - plotLeft - 56
  const height = data.length * rowHeight + 8
  const barHeight = Math.min(10, rowHeight - 6)
  const ruleX = rule !== undefined ? plotLeft + (rule / max) * plotWidth : null

  return (
    <div className="viz__scroll">
      <svg
        className="viz__svg"
        viewBox={`0 0 ${width} ${height}`}
        width={width}
        height={height}
        role="img"
        aria-label={`${data.length} bars`}
        data-testid={testId}
      >
        {/* hairline baseline, solid, one step off the surface — never dashed */}
        <line
          className="viz__axis"
          x1={plotLeft}
          y1={0}
          x2={plotLeft}
          y2={height - 4}
          strokeWidth={1}
        />

        {data.map((d, i) => {
          const y = i * rowHeight + 4
          const w = d.value === null ? 0 : Math.max(1, (d.value / max) * plotWidth)
          return (
            <g key={d.label} className="viz__row" data-testid={`${testId}-row`}>
              {/* the hit target spans the whole row, not just the bar — an 8px mark you must
                  land on dead-centre is a pinpoint hover target */}
              <rect
                className="viz__hit"
                x={0}
                y={y - 2}
                width={width}
                height={rowHeight}
                fill="transparent"
              >
                <title>
                  {d.label} — {d.value === null ? 'not measured' : valueFormat(d.value)}
                  {d.detail ? ` · ${d.detail}` : ''}
                </title>
              </rect>
              <text className="viz__cat" x={plotLeft - 8} y={y + barHeight} textAnchor="end">
                {d.label.length > 46 ? `${d.label.slice(0, 45)}…` : d.label}
              </text>
              {d.value === null ? (
                <text className="viz__unmeasured" x={plotLeft + 6} y={y + barHeight}>
                  not measured
                </text>
              ) : (
                <path className="viz__bar" d={barPath(plotLeft, y, w, barHeight)} />
              )}
              {d.directLabel && (
                <text className="viz__value" x={plotLeft + w + 6} y={y + barHeight}>
                  {d.directLabel}
                </text>
              )}
            </g>
          )
        })}

        {ruleX !== null && (
          <>
            <line
              className="viz__rule"
              x1={ruleX}
              y1={0}
              x2={ruleX}
              y2={height - 4}
              strokeWidth={2}
            />
            {/* At the top the label sits on whatever the first bar is. Sorted worst-first that
                was empty space; sorted best-first the longest bar runs straight through it. The
                foot of the rule is empty under either ordering. */}
            {ruleLabel && (
              <text className="viz__rulelbl" x={ruleX + 5} y={height - 6}>
                {ruleLabel}
              </text>
            )}
          </>
        )}
      </svg>
    </div>
  )
}

export interface Segment {
  label: string
  value: number
  /** 1 or 2 — categorical slots, assigned in fixed order and never cycled */
  slot: 1 | 2
}

/**
 * One stacked bar, part-to-whole.
 *
 * A 2px gap in the surface colour separates the segments — the gap does the separating, never a
 * stroke around the mark. Segments are direct-labelled only where the label fits with padding;
 * anything narrower falls to the legend and the table, never to clipped text.
 */
export function StackedBar({
  segments,
  total,
  testId,
}: {
  segments: Segment[]
  total: number
  testId: string
}) {
  const width = 720
  const barY = 12
  const barHeight = 24
  const gap = 2
  let x = 0

  const placed = segments.map((s) => {
    const w = total > 0 ? (s.value / total) * width : 0
    const seg = { ...s, x, w }
    x += w + gap
    return seg
  })
  // the gaps come out of the total width so the bar still ends flush
  const scale = width / (width + gap * Math.max(0, segments.length - 1))

  return (
    <div className="viz__scroll">
      <svg
        className="viz__svg"
        viewBox={`0 0 ${width} 76`}
        width={width}
        height={76}
        role="img"
        aria-label="reviewer decisions by outcome"
        data-testid={testId}
      >
        {placed.map((s) => {
          const sx = s.x * scale
          const sw = Math.max(0, s.w * scale)
          if (sw <= 0) return null
          // measure before placing: ~6.2px per character at 11px, plus 12px of padding
          const fits = sw > s.value.toString().length * 6.2 + 12
          return (
            <g key={s.label} data-testid={`${testId}-seg`}>
              <rect
                className={`viz__seg viz__seg--${s.slot}`}
                x={sx}
                y={barY}
                width={sw}
                height={barHeight}
                rx={2}
              >
                <title>
                  {s.label} — {s.value} of {total}
                </title>
              </rect>
              {fits && (
                // inside a filled segment is the one place a label may sit on colour; it is
                // painted surface-light so it clears contrast on either slot
                <text className="viz__seglbl" x={sx + sw / 2} y={barY + 17} textAnchor="middle">
                  {s.value}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Legend — always present for two or more series, so identity is never colour alone. */
export function Legend({ items }: { items: Array<{ label: string; slot: 1 | 2 }> }) {
  return (
    <ul className="viz__legend">
      {items.map((i) => (
        <li key={i.label}>
          <span className={`viz__swatch viz__swatch--${i.slot}`} aria-hidden="true" />
          {i.label}
        </li>
      ))}
    </ul>
  )
}

/** A row of measured figures. A number is not a chart; four of them are not four charts. */
export function StatTiles({
  tiles,
  testId,
}: {
  tiles: Array<{ label: string; value: string; sub?: string }>
  testId: string
}) {
  return (
    <div className="viz__tiles" data-testid={testId}>
      {tiles.map((t) => (
        <div className="viz__tile" key={t.label}>
          <span className="viz__tilelbl">{t.label}</span>
          <span className="viz__tileval">{t.value}</span>
          {t.sub && <span className="viz__tilesub">{t.sub}</span>}
        </div>
      ))}
    </div>
  )
}
