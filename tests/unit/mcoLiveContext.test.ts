// lib/mcoLiveContext.ts — the LIVE MCO DATA block injected into Ask Ana's
// prompt. Only the three live fetchers are mocked; intent detection, the
// follow-up carry logic, the time window, the checkpoint mapping
// (lib/walkingTime) and the prep math all run for real.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import type { Flight } from '@/lib/flights'
import type { CheckpointWait } from '@/lib/securityWait'
import type { ParkingLot } from '@/lib/parking'
import type * as FlightsMod from '@/lib/flights'
import type * as SecurityMod from '@/lib/securityWait'
import type * as ParkingMod from '@/lib/parking'

const fetchFlights = vi.fn<() => Promise<Flight[]>>()
const fetchSecurityWaits = vi.fn<() => Promise<CheckpointWait[]>>()
const fetchParkingAvailability = vi.fn<() => Promise<ParkingLot[]>>()
vi.mock('@/lib/flights', async () => ({ ...(await vi.importActual<typeof FlightsMod>('@/lib/flights')), fetchFlights: () => fetchFlights() }))
vi.mock('@/lib/securityWait', async () => ({ ...(await vi.importActual<typeof SecurityMod>('@/lib/securityWait')), fetchSecurityWaits: () => fetchSecurityWaits() }))
vi.mock('@/lib/parking', async () => ({ ...(await vi.importActual<typeof ParkingMod>('@/lib/parking')), fetchParkingAvailability: () => fetchParkingAvailability() }))

import { buildMcoLiveContext, ASKANA_BOT_ID } from '@/lib/mcoLiveContext'

// Flight fixtures are built with atLocalHour(19, 50) etc. — the module-level
// FLIGHTS list included — and the window logic compares against Date.now()
// (lib/flights: "not more than 30 min in the past"), so this file only passed
// before 7:50 PM local. Pin the clock at 3 PM AT IMPORT TIME (a beforeAll runs
// after the fixtures are already built); only Date is faked, so fetch mocks and
// timers run real.
vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(new Date(2026, 8, 14, 15, 0, 0))
afterAll(() => { vi.useRealTimers() })

const now = Math.floor(Date.now() / 1000)
function flight(over: Partial<Flight>): Flight {
  const ts = over.bestKnownTimestamp ?? now + 4 * 3600
  return {
    iataOperatingAirline: 'DL', operatingAirlineFlightNumber: 'DL1511', arrival: false, status: 'Scheduled', isDelayed: false, isVisible: true,
    terminal: 'B', gate: '71', baggageBelt: [], departureAirport: 'MCO', arrivalAirport: 'LGA', viaAirport: '',
    scheduledTimestamp: ts, actualTimestamp: null, bestKnownTimestamp: ts, scheduledDate: new Date(ts * 1000).toISOString().slice(0, 10),
    ...over,
  }
}
function wait(name: string, lane: 'precheck' | 'standard', minutes: number, isOpen = true): CheckpointWait {
  return { id: name, name, lane, isOpen, waitSeconds: minutes * 60, minWaitSeconds: null, maxWaitSeconds: null, lastUpdatedTimestamp: now, minGate: null, maxGate: null, terminal: 'B' } as CheckpointWait
}
function lot(name: string, status: string, daily?: string): ParkingLot {
  return { id: name, name, category: 'garage', status, available: null, occupied: null, total: null, terminalId: null, terminalName: null, lastUpdatedTimestamp: now, rate: daily ? { daily } : null }
}

// Same-hour departure so "the 7:50 one" style hints can be tested without
// depending on the wall clock: build a timestamp at a fixed local hour today
// (or tomorrow if that hour has passed) and derive the hint from it.
function atLocalHour(h: number, m: number): number {
  const d = new Date(); d.setHours(h, m, 0, 0)
  if (d.getTime() / 1000 < now) d.setDate(d.getDate() + 1)
  return Math.floor(d.getTime() / 1000)
}

const FLIGHTS: Flight[] = [
  flight({ operatingAirlineFlightNumber: 'DL1511', gate: '71', terminal: 'B' }),
  flight({ operatingAirlineFlightNumber: 'DL2564', gate: '80', terminal: 'B', bestKnownTimestamp: now + 6 * 3600, scheduledTimestamp: now + 6 * 3600, isDelayed: true, status: 'Delayed' }),
  flight({ operatingAirlineFlightNumber: 'AA100', iataOperatingAirline: 'AA', arrival: true, departureAirport: 'DFW', arrivalAirport: 'MCO', gate: '10', terminal: 'A', bestKnownTimestamp: now + 3600, scheduledTimestamp: now + 3600 }),
  flight({ operatingAirlineFlightNumber: 'B6123', iataOperatingAirline: 'B6', arrivalAirport: 'JFK', gate: 'C235', terminal: 'C', bestKnownTimestamp: now + 2 * 3600, scheduledTimestamp: now + 2 * 3600 }),
  flight({ operatingAirlineFlightNumber: 'WN500', iataOperatingAirline: 'WN', arrivalAirport: 'BNA', gate: null, terminal: null, bestKnownTimestamp: now + 5 * 3600, scheduledTimestamp: now + 5 * 3600 }),
]
const WAITS: CheckpointWait[] = [wait('East PreCheck', 'precheck', 8), wait('East Standard', 'standard', 22), wait('West Standard', 'standard', 15), wait('South PreCheck', 'precheck', 5, false)]
const LOTS: ParkingLot[] = [lot('Terminal Top Garage A', 'open', '25'), lot('Parking Garage C', 'full'), lot('Economy Lot', 'open')]

beforeEach(() => {
  fetchFlights.mockReset().mockResolvedValue(FLIGHTS)
  fetchSecurityWaits.mockReset().mockResolvedValue(WAITS)
  fetchParkingAvailability.mockReset().mockResolvedValue(LOTS)
})

describe('gating', () => {
  it('only the AskAna bot, only with a message, only on a live intent', async () => {
    expect(await buildMcoLiveContext('some-other-bot', 'when does DL1511 leave')).toBe('')
    expect(await buildMcoLiveContext(ASKANA_BOT_ID, '')).toBe('')
    expect(await buildMcoLiveContext(ASKANA_BOT_ID, 'where can I get a good burger')).toBe('')
    expect(fetchFlights).not.toHaveBeenCalled()
  })
  it('a bare follow-up referent with no prior flight context is a no-op (could be a zip code)', async () => {
    expect(await buildMcoLiveContext(ASKANA_BOT_ID, '2564', 'Welcome to MCO!')).toBe('')
  })
})

describe('flight lookups', () => {
  it('a flight number resolves to that flight and carries the joined prep math with the RIGHT checkpoint', async () => {
    const out = await buildMcoLiveContext(ASKANA_BOT_ID, 'when does DL1511 board?')
    expect(out).toContain('LIVE MCO DATA FOR THIS TURN')
    expect(out).toContain('LIVE FLIGHT LOOKUP')
    expect(out).toMatch(/- DL1511 to LGA · Terminal B, gate 71 · .* · Scheduled/)
    expect(out).not.toContain('DL2564')
    // gate 71 → Terminal B → EAST checkpoint; PreCheck open at 8 min is the best lane
    expect(out).toContain('FLIGHT PREP RECOMMENDATIONS')
    expect(out).toMatch(/DL1511 \(gate 71, dep .*\): use the \*\*East CHECKPOINT\*\* \(it serves Terminal B \/ gate 71\)\. PreCheck 8min · Standard 22min\./)
    expect(out).toMatch(/best lane: PreCheck/)
    expect(fetchSecurityWaits).toHaveBeenCalled()      // flights imply security for the prep math
    expect(fetchParkingAvailability).not.toHaveBeenCalled()
  })

  it('JetBlue / Frontier style codes (letter+digit) are recognised, Terminal C maps to SOUTH', async () => {
    const out = await buildMcoLiveContext(ASKANA_BOT_ID, 'is B6123 on time')
    expect(out).toMatch(/- B6123 to JFK · Terminal C, gate C235/)
    expect(out).toMatch(/use the \*\*South CHECKPOINT\*\*/)
    // South PreCheck is closed → Standard lane, and no standard row exists → "Standard closed"
    expect(out).toMatch(/PreCheck closed · Standard closed/)
  })

  it('follow-up: a numeric hint narrows the flights carried from the assistant’s prior reply', async () => {
    const prior = 'Tonight I see DL1511 at 7:50 PM and DL2564 at 9:40 PM to LaGuardia.'
    const out = await buildMcoLiveContext(ASKANA_BOT_ID, 'the 2564', prior)
    expect(out).toContain('DL2564')
    expect(out).not.toMatch(/- DL1511 /)
    expect(out).toContain('(DELAYED)')
  })

  it('follow-up: a time hint narrows carried flights by departure hour, falling back to all carried', async () => {
    const seven = atLocalHour(19, 50)
    fetchFlights.mockResolvedValue([
      flight({ operatingAirlineFlightNumber: 'DL1511', bestKnownTimestamp: seven, scheduledTimestamp: seven }),
      flight({ operatingAirlineFlightNumber: 'DL2564', gate: '80', bestKnownTimestamp: seven + 2 * 3600, scheduledTimestamp: seven + 2 * 3600 }),
    ])
    const prior = 'DL1511 leaves at 7:50 PM; DL2564 at 9:50 PM.'
    const narrowed = await buildMcoLiveContext(ASKANA_BOT_ID, 'the 7:50 one', prior)
    expect(narrowed).toMatch(/- DL1511 /)
    expect(narrowed).not.toMatch(/- DL2564 /)
    const all = await buildMcoLiveContext(ASKANA_BOT_ID, 'the 3:15 one please', prior)
    expect(all).toMatch(/- DL1511 /)
    expect(all).toMatch(/- DL2564 /)
    const yes = await buildMcoLiveContext(ASKANA_BOT_ID, 'yes', prior)
    expect(yes).toMatch(/- DL1511 /)
  })

  it('a gate question resolves to the next departure at that gate', async () => {
    const out = await buildMcoLiveContext(ASKANA_BOT_ID, "what's leaving from gate 80")
    expect(out).toMatch(/- DL2564 to LGA · Terminal B, gate 80/)
    expect(out).not.toMatch(/- DL1511 /)
  })

  it('airline + destination + direction filters: departures by default, arrivals when asked', async () => {
    const dep = await buildMcoLiveContext(ASKANA_BOT_ID, 'delta flights to laguardia today')
    expect(dep).toMatch(/- DL1511 /)
    expect(dep).toMatch(/- DL2564 /)
    expect(dep).not.toMatch(/- AA100 /)
    expect(dep).not.toMatch(/- B6123 /)
    // Arrivals: "coming in" flips the direction. (A destination keyword like
    // "dallas" would filter on arrivalAirport even for arrivals — so the
    // arrivals phrasing here deliberately names no city.)
    const arr = await buildMcoLiveContext(ASKANA_BOT_ID, 'american coming in today')
    expect(arr).toMatch(/- AA100 from DFW · Terminal A, gate 10/)
    expect(arr).not.toMatch(/- DL1511 /)
  })

  it('flights with no gate say so and get no prep line; the block caps at 6 with an overflow count', async () => {
    fetchFlights.mockResolvedValue(Array.from({ length: 9 }, (_, i) => flight({ operatingAirlineFlightNumber: 'WN' + (100 + i), iataOperatingAirline: 'WN', arrivalAirport: 'BNA', gate: null, terminal: null, bestKnownTimestamp: now + 3600 + i * 60, scheduledTimestamp: now + 3600 + i * 60 })))
    const out = await buildMcoLiveContext(ASKANA_BOT_ID, 'southwest departures to nashville today')
    expect(out).toContain('no terminal yet, no gate yet')
    expect(out).toContain('… and 3 more.')
    expect(out).not.toContain('FLIGHT PREP RECOMMENDATIONS (joined')   // the footer mentions the section by name; the section itself must be absent
  })

  it('no matches → an explicit empty-result line; a failed feed degrades to the same', async () => {
    const none = await buildMcoLiveContext(ASKANA_BOT_ID, 'lufthansa flights to toronto today')
    expect(none).toContain('LIVE FLIGHT LOOKUP: no matching flights found')
    fetchFlights.mockRejectedValue(new Error('GOAA down'))
    const failed = await buildMcoLiveContext(ASKANA_BOT_ID, 'when does DL1511 leave')
    expect(failed).toContain('no matching flights found')
  })

  it('tomorrow / tonight windows change which flights qualify', async () => {
    const tomorrowNoon = (() => { const d = new Date(); d.setDate(d.getDate() + 1); d.setHours(12, 0, 0, 0); return Math.floor(d.getTime() / 1000) })()
    fetchFlights.mockResolvedValue([
      flight({ operatingAirlineFlightNumber: 'DL1511', bestKnownTimestamp: now + 3600, scheduledTimestamp: now + 3600 }),
      flight({ operatingAirlineFlightNumber: 'DL7777', bestKnownTimestamp: tomorrowNoon, scheduledTimestamp: tomorrowNoon }),
    ])
    const tomorrow = await buildMcoLiveContext(ASKANA_BOT_ID, 'delta to laguardia tomorrow')
    expect(tomorrow).toMatch(/- DL7777 /)
    expect(tomorrow).not.toMatch(/- DL1511 /)
    // carry the window from the prior turn when the follow-up has none
    const carried = await buildMcoLiveContext(ASKANA_BOT_ID, 'lga', 'Here are tomorrow’s Delta departures to New York.')
    expect(carried).toMatch(/- DL7777 /)
  })
})

describe('security and parking blocks', () => {
  it('a TSA question lists each checkpoint with per-lane waits and closed flags', async () => {
    const out = await buildMcoLiveContext(ASKANA_BOT_ID, 'how long is the security line right now')
    expect(out).toContain('LIVE SECURITY WAIT TIMES')
    expect(out).toMatch(/- East checkpoint: PreCheck 8 min · Standard 22 min/)
    expect(out).toMatch(/- West checkpoint: Standard 15 min/)
    expect(out).toMatch(/- South checkpoint: PreCheck 5 min \(CLOSED\)/)
    expect(out).not.toContain('LIVE FLIGHT LOOKUP')
    expect(fetchFlights).not.toHaveBeenCalled()
  })
  it('parking shows full lots and garages with rates, and returns nothing when nothing is interesting', async () => {
    const out = await buildMcoLiveContext(ASKANA_BOT_ID, 'is the garage full?')
    expect(out).toContain('LIVE PARKING STATUS')
    expect(out).toContain('- Terminal Top Garage A: open · $25/day')
    expect(out).toContain('- Parking Garage C: full')
    expect(out).not.toContain('Economy Lot')
    fetchParkingAvailability.mockResolvedValue([lot('Economy Lot', 'open')])
    expect(await buildMcoLiveContext(ASKANA_BOT_ID, 'is there parking?')).toBe('')
  })
  it('a fetch failure on security is fail-soft (no block, no throw)', async () => {
    fetchSecurityWaits.mockRejectedValue(new Error('down'))
    expect(await buildMcoLiveContext(ASKANA_BOT_ID, 'tsa wait?')).toBe('')
  })
  it('the authoritative-override footer rides every non-empty block', async () => {
    const out = await buildMcoLiveContext(ASKANA_BOT_ID, 'precheck line?')
    expect(out).toContain('THIS BLOCK IS THE GROUND TRUTH FOR THIS TURN')
    expect(out).toContain('CHECKPOINT MAPPING')
  })
})
