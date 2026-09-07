/** Shapes returned by the API. Mirrors the pydantic models in backend/explorer/api/. */

export interface FacetValue {
  value: string
  n: number
  selected: boolean
  /** why an absence bucket exists; null for a real value (#34) */
  reason?: string | null
  /** Stable identifier to filter by. Null for buckets with no concept behind them. */
  code?: string | null
}

export interface FacetGroup {
  key: string
  label: string
  values: FacetValue[]
  total_n: number | null
  total_basis: string
  inferred: boolean
  /** Set when the group has nothing worth filtering on, with the reason. Renders disabled. */
  unavailable?: string | null
}

/** What a facet click selects: the label is shown, the code is what gets filtered by. */
export interface FacetSelection {
  value: string
  code: string | null
}

export interface CorpusCounts {
  records: number
  facts: number
  categories: number
}

export interface FacetsResponse {
  groups: FacetGroup[]
  total_n: number
  unfiltered_n: number
  corpus: CorpusCounts
}

/**
 * One record, as the PLATFORM needs it: an id and the retrieval scores it was ranked by.
 *
 * Everything that identifies a record to a human — a merger corpus's target and acquirer, a
 * claims corpus's provider and date — is the domain's, and arrives through `RecordRenderers`
 * rather than through this type. A domain extends it:
 *
 *     interface Matter extends CorpusRecord {
 *       target_name: string | null
 *       acquirer_name: string | null
 *     }
 *
 * The scores are here rather than slotted because they are not domain data. They are how THIS
 * platform ranked the record — hybrid, vector and BM25 — and the card renders them so the
 * ranking is as inspectable as the source text is.
 */
export interface CorpusRecord {
  record_id: string
  score: number | null
  vector_score: number | null
  bm25_score: number | null
  /** Domain fields. Typed by the domain's own interface, not guessed at here. */
  [field: string]: unknown
}

export interface ComparablesResponse {
  records: CorpusRecord[]
  candidate_count: number
  returned_count: number
  /** Whatever the domain's own search endpoint reports back about how it narrowed the
   *  candidate set. Untyped here on purpose — a hardcoded shape (this used to name
   *  folio_industry_code, deal_size_band, signed_from/to) is a second domain's applied
   *  filters lying about their own shape, which nothing importing this type would catch. */
  applied_filters: Record<string, unknown>
}

export interface SubjectDetail {
  subject: string
  position: string
  is_inferred: boolean
  numeric_value: number | null
  source_span_start: number | null
  source_span_end: number | null
  /** The exact characters at [start, end) in the source file. Never generated. */
  clause_text: string | null
  /** Why there is no clause text. Set whenever clause_text is null. */
  text_unavailable: string | null
}

/**
 * A record's detail, as the PLATFORM needs it — the drill-through facts and how many were
 * located. Everything that identifies the record — target/acquirer on a merger, provider/date
 * on a claim — is the domain's, extended the same way `CorpusRecord` is:
 *
 *     interface MatterDetail extends RecordDetail {
 *       target_name: string | null
 *       acquirer_name: string | null
 *       deal_value_usd: number | null
 *     }
 */
export interface RecordDetail {
  record_id: string
  source_file: string | null
  source_title: string | null
  subject_count: number
  located_count: number
  facts: SubjectDetail[]
  /** Plain-text paragraph for pasting into a pitch. Built server-side so it cannot drift. */
  summary: string
  /** Domain fields, typed by the domain's own interface. */
  [field: string]: unknown
}

export interface PositionCount {
  position: string
  n: number
}

export interface NumericSummary {
  numeric_n: number
  median: number | null
  p25: number | null
  p75: number | null
}

export interface RollupRow {
  subject: string
  /** Selected matters with a labelled answer. The denominator — not the selection size. */
  answered_n: number
  present_count: number
  /** Pre-rendered server-side per the threshold rule: "6 of 8" or "62%". Never re-derive it. */
  display: string
  display_kind: 'count' | 'percentage' | 'low_confidence'
  positions: PositionCount[]
  numeric: NumericSummary | null
  gate_note: string | null
}

export interface RollupResponse {
  selection_n: number
  percentage_threshold: number
  min_extraction_confidence: number
  rows: RollupRow[]
  answered_subject_count: number
  absent_subject_count: number
  scope_note: string
  refused: boolean
  refusal: Refusal | null
}

export interface DrillRecord {
  record_id: string
  target_name: string | null
  position: string
  source_file: string | null
  source_span_start: number | null
  source_span_end: number | null
  clause_text: string | null
  text_unavailable: string | null
  /** Width of the recorded span in characters. */
  span_chars: number | null
  /** True when `clause_text` is the opening excerpt of a document-scale span. */
  is_excerpt: boolean
}

export interface Refusal {
  reason: string
  n: number
  threshold: number
  message: string
}

export interface AgentFilter {
  member: string
  operator: string
  values: string[]
  /** What the user/agent originally typed for this value, before resolution (#25). */
  raw?: string
  /** True when `values` differs from `raw` — a filter-value resolution actually happened. */
  resolved?: boolean
  inferred?: boolean
}

export interface AgentTimeDimension {
  dimension: string
  range: string
}

export interface AgentSelection {
  measures: string[]
  dimensions: string[]
  filters: AgentFilter[]
  timeDimensions: AgentTimeDimension[]
  n: number
  is_inferred: boolean
}

export interface LabelQueueItem {
  record_id: string
  subject: string
  llm_prediction: string
  deterministic_prediction: string
  disagreement: boolean
  quoted_text: string | null
  span_start: number | null
  span_end: number | null
  /**
   * Every answer this deal point actually takes, read from the corpus (#57).
   *
   * `POST /label/decide` has validated against this same list since #56 — the reviewer was the
   * only party not shown it, so Edit was a free-text box over a closed vocabulary and the only
   * way to learn the vocabulary was to have an answer rejected.
   */
  allowed_positions: string[]
}

export interface LabelQueueResponse {
  items: LabelQueueItem[]
  queue_size: number
  labelled_count: number
}

export interface IngestRun {
  source: string
  rows_read: number
  rows_upserted: number
  duration_ms: number | null
  sha256: string | null
  status: string
  detail: string | null
  started_at: string | null
}

/** One deal point's row in the label-aware calibration artefact (#41). */
export interface CalibrationLabelRow {
  subject: string
  n: number
  correct_before: number
  accuracy_before: number
  correct: number
  accuracy: number
  labels_applied: number
  reportable: boolean
}

/** `docs/results/calibration-labels.json`, served verbatim by `/admin/calibration-labels`. */
export interface CalibrationLabels {
  generated_at: string
  command: string
  prediction_count: number
  labels_applied: number
  labels_differing: number
  correct_before: number
  correct_after: number
  accuracy_before: number
  accuracy_after: number
  results: CalibrationLabelRow[]
}

export interface LogLine {
  timestamp?: string
  level?: string
  request_id?: string
  event?: string
  duration_ms?: number
  [key: string]: unknown
}

export interface TableRowsResponse {
  table: string
  total_count: number
  rows: Record<string, unknown>[]
  limit: number
  offset: number
}

/** `GET /agent/catalog` (#36) — the vocabulary a selection may draw from. */
export interface CatalogEntry {
  name: string
  title: string
  type: string
  cube: string
  description: string
}

export interface CatalogResponse {
  measures: CatalogEntry[]
  dimensions: CatalogEntry[]
  /** measures + dimensions: the discrete label space an offline eval grades against */
  label_space: number
}

/** `POST /agent/run-selection` (#37) — the click-built query. */
export interface RunSelectionResponse {
  query: Record<string, unknown>
  rows: Array<Record<string, unknown>>
  n: number | null
  refused: boolean
  threshold: number | null
  message: string | null
  /**
   * Cells dropped for sitting below `min_n`. Never render the rows without rendering this:
   * a reader who believes they are seeing the whole distribution will find the denominators
   * do not add up, which is a worse failure than being told a cell was withheld.
   */
  suppressed: number
}

/** `GET /agent/grading` (#36) — the offline grade over recorded model output. */
export interface GradedCase {
  id: string
  question: string
  should_refuse: boolean
  expected_measures: string[]
  actual_measures: string[]
  expected_dimensions: string[]
  actual_dimensions: string[]
  correct: boolean
}

export interface GradingResponse {
  cases: GradedCase[]
  answerable_total: number
  answerable_correct: number
  refusal_total: number
  refusal_correct: number
  note: string
}

/**
 * `GET /agent/corrections-grade` (#51) — the grade over real confirmations from Ask.
 *
 * Served apart from `/agent/grading` because that endpoint grades with **no database** (a test
 * pins it by forbidding `psycopg.connect` for the call) and these rows live in Postgres.
 * Rendered as its own row, never averaged with the authored 25: those were written to probe
 * the vocabulary and include five questions that should be refused, while these are whatever
 * people happened to ask.
 */
export interface CorrectionsGrade {
  corrections_count: number
  corrections_agreed: number
  /** null when nothing has been recorded — n=0, not "always wrong" */
  corrections_accuracy: number | null
  /** which part of a selection people corrected, e.g. `{ filters: 3 }` */
  changed_field_counts: Record<string, number>
  note: string
}

/**
 * `GET /admin/calibration` (#44) — the extractor's per-deal-point weakness map.
 *
 * `accuracy` and the CI bounds are null when `measured` is false: the calibration run reached
 * that deal point on zero held-out matters. Rendering a null as 0 would turn a coverage gap
 * into a reported failure.
 */
export interface CalibrationRow {
  subject: string
  n: number
  correct: number
  accuracy: number | null
  ci_low: number | null
  ci_high: number | null
  reportable: boolean
  measured: boolean
}

export interface CalibrationCost {
  call_count: number
  total_tokens: number
  cost_usd: number
  prompt_tokens?: number
  completion_tokens?: number
}

/**
 * `GET /admin/measure-selection` (#54) — the committed aggregate scores behind Trust's
 * selection-quality chart.
 *
 * Read from `docs/results/measure-selection.json`, written by a command that ran, never graded
 * at request time. The grade is deterministic over two committed fixtures, so recomputing it
 * would usually agree — and "usually" is the problem: the moment it did not, the chart and the
 * report committed beside it would disagree with nothing to say which one ran.
 */
export interface MeasureSelectionSummary {
  generated_at: string
  command: string
  case_count: number
  answerable_count: number
  refusal_count: number
  measure_precision: number
  measure_recall: number
  dimension_precision: number
  dimension_recall: number
  filter_exact_match_rate: number
  refusal_accuracy: number
}

export interface CalibrationResponse {
  markdown: string
  /** Sorted worst-first by the grader, with unmeasured deal points last. */
  results: CalibrationRow[]
  min_extraction_confidence: number
  vocabulary_size: number | null
  measured_subject_count: number | null
  reportable_count: number | null
  cost: CalibrationCost | null
}

/**
 * `POST /agent/ask` (#47) — free text in, a *selection* out.
 *
 * There is deliberately no result field on this shape. The model selects; the figure comes
 * from `/agent/run-selection` after a person has confirmed the chips, which is where the
 * `min_n` gate has always lived.
 */
export interface FilterResolution {
  raw: string
  /** "exact" | "embedding" | "verbatim" | "unresolved" */
  method: string
  resolved: string | null
  similarity: number | null
  record_count: number | null
  /** near misses, populated only when `method` is "unresolved" */
  candidates: string[]
  note: string | null
}

export interface AskFilter {
  member: string
  operator: string
  values: string[]
  resolutions: FilterResolution[]
}

/** What one question cost, measured (#50). Never estimated, never hardcoded. */
export interface AskUsage {
  model: string
  prompt_tokens: number
  completion_tokens: number
  latency_ms: number
  cost_usd: number
  price_checked_on: string
  price_source: string
}

export interface AskResponse {
  question: string
  measures: string[]
  dimensions: string[]
  filters: AskFilter[]
  time_dimensions: Array<Record<string, unknown>>
  /** the model's output verbatim, so what it said can be diffed against what will run */
  model_selection: Record<string, unknown>
  runnable: boolean
  blocked_reason: string | null
  usage: AskUsage
}

/**
 * `POST /agent/members` (#57) — what one selected name means, and whether the corpus can
 * answer with it.
 *
 * Read after `/agent/ask` returns, never before: the names come from the selection. Kept off
 * `/agent/ask` because that route must never touch Cube's `/load`, and coverage is a query.
 */
export interface MemberInfo {
  name: string
  /** the catalog's own title, e.g. "Deal Points N". Falls back to `name` when unknown. */
  title: string
  description: string
  /** "measure" | "dimension" | "unknown" */
  kind: string
  type: string
  /** the values the corpus holds for this dimension, when they can be enumerated */
  candidates: string[]
  /** true only when `candidates` is the complete set — a truncated list is not a vocabulary */
  enumerable: boolean
  distinct_values: number
  /** rows carrying a value / rows in the cube; null when coverage could not be probed */
  populated: number | null
  total: number | null
  /** set when no selection over this member can produce an answer, saying why in full */
  cannot_answer: string | null
}

export interface MembersResponse {
  members: MemberInfo[]
}


/**
 * A starting point handed from one tab to another — a landing-page journey that arrives on
 * Explore already narrowed, or the shell's header search handing over its text.
 *
 * Keyed by facet dimension rather than by named fields, because the dimensions ARE the domain:
 * a merger corpus narrows on industry and consideration, a claims corpus on something else
 * entirely. A typed field per legal dimension is exactly the shape that made the first fork
 * impossible to reuse.
 */
export interface JourneySeed {
  /** Facet dimension -> value. Absent dimensions are left alone; null clears one. */
  filters?: Readonly<Record<string, string | null>>
  /** Free text for the search box. Null on a journey that starts from structured filters. */
  description?: string | null
}
