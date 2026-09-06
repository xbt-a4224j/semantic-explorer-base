import { useState } from 'react'

/**
 * Inline jargon definition (#35).
 *
 * The app was operable by someone who already knew the domain and unlearnable by anyone else:
 * MAUD, deal point, public target and min_n all appeared as bare words. A reader
 * should never have to leave the screen to find out what a word means.
 *
 * Definitions live in one module rather than being retyped per view, because the failure mode
 * of scattered copies is that they drift and the app ends up asserting two different things
 * about the same term.
 */

export const GLOSSARY: Record<string, { short: string; long: string }> = {
  MAUD: {
    short: 'Merger Agreement Understanding Dataset',
    long: '152 public-target merger agreements from SEC filings, annotated by lawyers against the 92 ABA deal points. Public filings — not any firm’s own matter history. CC BY 4.0.',
  },
  'SIC crosswalk': {
    short: 'SEC industry code → our industry grouping',
    long: 'A checked-in table mapping SIC prefixes to 20 industries, longest prefix first. Filtering joins on its codes, not display labels, so a label retitled from “Health Care Industry” to “Healthcare” cannot silently return zero rows.',
  },
  EDGAR: {
    short: 'the SEC’s public filing system',
    long: 'Electronic Data Gathering, Analysis and Retrieval. Supplies industry code, dates and parties for the same 152 agreements. 139 of 152 resolved to an industry.',
  },
  'deal point': {
    short: 'one negotiated provision, as a question',
    long: 'A provision written as a question with a fixed answer set — “is there a fiduciary out?”. The American Bar Association maintains 92 of them for public-target deals.',
  },
  'public target': {
    short: 'the company being acquired is publicly traded',
    long: 'Which is why these agreements are public records, filed with the SEC, and legal to redistribute. The entire corpus depends on it.',
  },
  'fiduciary out': {
    short: 'the board may change its recommendation',
    long: 'A clause letting the target’s board change its recommendation if a better offer arrives, without breaching the agreement. Present in 104 of 151 agreements here.',
  },
  'reverse termination fee': {
    short: 'what the buyer pays to walk away',
    long: 'Usually quoted as a percentage of equity value. Its mean and median diverge substantially on this corpus, which is why medians here are percentiles and never averages.',
  },
  min_n: {
    short: 'the refusal threshold — 5',
    long: 'Below it the system declines to characterize a slice. One threshold doing three jobs: statistical honesty, extraction-confidence gating, and k-anonymity.',
  },
  'k-anonymity': {
    short: 'no answer may describe fewer than k records',
    long: 'At k=1 an aggregate describes one client. An analyst who can filter until one deal remains has extracted that client’s negotiated term through the analytics layer without opening a document.',
  },
  inferred: {
    short: 'classifier output, not an expert label',
    long: 'Industry is derived from the SEC’s coarse, self-assigned SIC code through a checked-in crosswalk. Flagged in the schema so downstream aggregates cannot silently mix it with gold labels.',
  },
}

export function Term({ children }: { children: string }) {
  const [open, setOpen] = useState(false)
  const entry = GLOSSARY[children]
  if (!entry) return <>{children}</>
  return (
    <span className="term">
      <button
        type="button"
        className="term__btn"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        title={entry.short}
      >
        {children}
      </button>
      {open && (
        <span className="term__def" role="note">
          <strong>{entry.short}.</strong> {entry.long}
        </span>
      )}
    </span>
  )
}
