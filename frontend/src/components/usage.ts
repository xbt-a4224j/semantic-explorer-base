/**
 * Rendering rules for a measured model call (#50). One module so the per-question line and
 * the session total cannot format the same dollars two different ways.
 */

/**
 * Six decimal places, matching the committed cost artefacts (`calibration_cost.json` records
 * `0.854442`). Two would round every single question to `$0.00`, which reads as free; four
 * rounds a real $0.000147 to $0.0001 and loses a third of it. The figures here are fractions
 * of a cent and the point is that they are *known*, so they are shown at the precision they
 * were computed to.
 */
export function formatUsd(usd: number) {
  return `$${usd.toFixed(6)}`
}

/** Thousands separated: these are read as evidence, not decoration. */
export function formatTokens(tokens: number) {
  return tokens.toLocaleString('en-US')
}

/** Latency in seconds to one decimal — milliseconds are precision nobody acts on. */
export function formatLatency(ms: number) {
  return `${(ms / 1000).toFixed(1)}s`
}
