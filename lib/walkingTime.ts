// lib/walkingTime.ts
//
// Hardcoded walking-time estimates for the kiosk-to-gate journey at MCO.
// Assumes the demo kiosk lives in the MAIN TERMINAL landside (Level 3
// Departures, between Terminals A & B). This is the most common kiosk
// placement and the assumption we ship for v1.
//
// The journey has three legs:
//   1. Kiosk → security checkpoint (pre-security walk)
//   2. Security wait — LIVE, sourced from lib/securityWait.ts
//   3. Checkpoint → gate (post-security walk through the concourse)
//
// These are minutes, ground truth from MCO airport directories + Apple Maps
// indoor walking estimates. They DO NOT include any of: waiting for an
// elevator/escalator, taking the Terminal Link APM (already factored in
// for Terminal C totals), or unusually slow movement (large family, mobility
// device). They're a reasonable middle estimate.
//
// Future hardening: derive these dynamically from the Meridian placemark x/y
// data + a hand-traced walkable graph. For now the hardcoded matrix is fine —
// the actual variance from real-world walking is bigger than our model
// resolution anyway.

export type Concourse = 'A1' | 'A2' | 'A3' | 'A4' | 'C'

export interface WalkLegs {
  /** Walk from the kiosk to the security checkpoint serving this gate. */
  pre_security_min: number
  /** Walk from the checkpoint to the gate, after security. */
  post_security_min: number
  /** Which checkpoint serves this concourse — for cross-ref with security wait API. */
  checkpoint: 'West' | 'East' | 'South'
  /** Which terminal letter the gate is in. */
  terminal: 'A' | 'B' | 'C'
}

/**
 * Map a gate string to a concourse + walking estimates.
 *
 *   Terminal A:
 *     Gates 1-29   → concourse A1 (West checkpoint)
 *     Gates 30-59  → concourse A3 (West checkpoint, deeper)
 *   Terminal B:
 *     Gates 70-99   → concourse A4 (East checkpoint)
 *     Gates 100-129 → concourse A2 (East checkpoint, deeper)
 *   Terminal C:
 *     C230-C245 → Terminal C (South checkpoint)
 *
 * For Terminal C the pre-security leg includes the Terminal Link APM ride
 * from main-terminal landside; that's why it's notably longer (10 min vs 3).
 */
export function walkLegsForGate(gate: string): WalkLegs | null {
  if (!gate) return null
  const g = gate.toUpperCase().replace(/[^0-9A-Z]/g, '')

  // Terminal C — "C" prefix or pure numeric >= 230
  if (/^C\d+/.test(g) || (/^\d+$/.test(g) && Number(g) >= 230)) {
    return {
      pre_security_min: 10,    // walk to Terminal Link APM (5) + APM ride (4) + walk to South checkpoint (1)
      post_security_min: 4,
      checkpoint: 'South',
      terminal: 'C',
    }
  }

  const n = Number(g.replace(/^[A-Z]+/, ''))
  if (Number.isNaN(n)) return null

  // Terminal A
  if (n >= 1 && n <= 29) {
    return { pre_security_min: 3, post_security_min: 7, checkpoint: 'West', terminal: 'A' }
  }
  if (n >= 30 && n <= 59) {
    return { pre_security_min: 3, post_security_min: 10, checkpoint: 'West', terminal: 'A' }
  }
  // Terminal B
  if (n >= 70 && n <= 99) {
    return { pre_security_min: 3, post_security_min: 7, checkpoint: 'East', terminal: 'B' }
  }
  if (n >= 100 && n <= 129) {
    return { pre_security_min: 3, post_security_min: 10, checkpoint: 'East', terminal: 'B' }
  }
  return null
}

/**
 * Format minutes as "Xh Y min" for short durations, "X min" otherwise.
 */
export function formatMinutes(m: number): string {
  const n = Math.max(0, Math.round(m))
  if (n < 60) return n + ' min'
  const h = Math.floor(n / 60)
  const r = n % 60
  return r === 0 ? `${h}h` : `${h}h ${r} min`
}
