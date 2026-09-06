import { formatUsd } from './usage'

/**
 * What this session's questions have cost so far (#50).
 *
 * Sits at the foot of the Ask tab rather than beside each question: one call priced at a
 * fraction of a cent is not an argument about cost, and a running total in front of the reader
 * is. Summed from the same measured `usage` payloads the per-question line renders, so the two
 * cannot disagree.
 *
 * Hidden at zero. A total that reads "0 questions · $0.000000" before anyone has typed
 * anything is a row of noise on the one screen that is meant to read as an instrument.
 */
export function SessionCost({ questions, costUsd }: { questions: number; costUsd: number }) {
  if (questions === 0) return null
  return (
    <p className="ask__session mono" data-testid="ask-session">
      This session: {questions} question{questions === 1 ? '' : 's'} · {formatUsd(costUsd)}
    </p>
  )
}
