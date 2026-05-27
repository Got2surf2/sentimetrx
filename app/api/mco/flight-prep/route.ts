// app/api/mco/flight-prep/route.ts
//
// POST — the time-to-gate calculator. Takes a flight number OR a gate,
// looks up the flight, combines:
//   - live TSA wait per checkpoint × lane (lib/securityWait.ts)
//   - hardcoded kiosk→checkpoint and checkpoint→gate walking estimates
//     (lib/walkingTime.ts; assumes pre-security main-terminal kiosk)
// and returns a "you have N min" budget for both PreCheck and Standard
// lane options.
//
// Body:
//   { flight?: string }       — e.g. "DL1455", "Delta 1455"
//   { gate?: string }         — e.g. "B71", "C235"
//   (at least one required)
//
// Response:
//   {
//     flight: { number, airline, status, departureTo, scheduledTimestamp, ... } | null,
//     gate, terminal, concourse,
//     security: {
//       precheck:  { wait_min, checkpoint_name, lane: "precheck", available: bool },
//       standard:  { wait_min, checkpoint_name, lane: "general",  available: bool },
//     },
//     walk: { pre_security_min, post_security_min },
//     total: { precheck_min, standard_min },
//     time_to_departure_min: number,
//     time_to_boarding_min: number,
//     spare_time_min: { precheck, standard },
//     security_recommendation: "precheck" | "standard" | "either",
//   }
//
// Public, CORS-open. Read-only.

import { NextResponse, type NextRequest } from 'next/server'
import { fetchFlights, findFlightByNumber, nextDepartureAtGate, type Flight } from '@/lib/flights'
import { fetchSecurityWaits, type CheckpointWait } from '@/lib/securityWait'
import { walkLegsForGate, formatMinutes } from '@/lib/walkingTime'

export const dynamic = 'force-dynamic'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors })
}

// Boarding typically starts ~30 min before scheduled departure for domestic,
// ~45 min for international. We don't have international flag in the data,
// so use a single 30 min buffer — close enough for the time-budget purpose.
const BOARDING_BUFFER_MIN = 30

export async function POST(req: NextRequest) {
  let body: any = {}
  try { body = await req.json() } catch {}
  const flightStr = typeof body?.flight === 'string' ? body.flight.slice(0, 24) : ''
  const gateStr   = typeof body?.gate === 'string' ? body.gate.slice(0, 12) : ''

  if (!flightStr && !gateStr) {
    return NextResponse.json({ error: 'flight or gate required' }, { status: 400, headers: cors })
  }

  const [flights, waits] = await Promise.all([fetchFlights(), fetchSecurityWaits()])

  // Resolve the flight: prefer explicit flight number, fall back to "next
  // departure at this gate". Either way we end up with a single Flight (or null).
  let flight: Flight | null = null
  if (flightStr) flight = findFlightByNumber(flights, flightStr)
  let gate = gateStr || flight?.gate || ''
  if (!flight && gate) flight = nextDepartureAtGate(flights, gate)
  if (flight?.gate && !gate) gate = flight.gate

  if (!gate) {
    return NextResponse.json({
      flight: flight ? serializeFlight(flight) : null,
      error: 'no gate available yet',
    }, { headers: cors })
  }

  const legs = walkLegsForGate(gate)
  if (!legs) {
    return NextResponse.json({
      flight: flight ? serializeFlight(flight) : null,
      gate,
      error: 'gate not in walking-time table',
    }, { headers: cors })
  }

  const checkpointName = legs.checkpoint
  const precheckRow = waits.find(w => isAtCheckpoint(w, checkpointName) && w.lane === 'precheck')
  const generalRow  = waits.find(w => isAtCheckpoint(w, checkpointName) && w.lane !== 'precheck')

  const pcMin = waitMinutes(precheckRow)
  const stMin = waitMinutes(generalRow)

  const totalPrecheck  = legs.pre_security_min + pcMin + legs.post_security_min
  const totalStandard  = legs.pre_security_min + stMin + legs.post_security_min

  // Time-to-departure (and boarding starts ~30 min earlier).
  const nowSec = Math.floor(Date.now() / 1000)
  const departSec = flight?.bestKnownTimestamp || flight?.scheduledTimestamp || 0
  const timeToDepartMin = departSec ? Math.max(0, Math.round((departSec - nowSec) / 60)) : 0
  const timeToBoardingMin = Math.max(0, timeToDepartMin - BOARDING_BUFFER_MIN)

  // Spare time = (time until boarding) - (total to gate via lane). Negative
  // means "should have headed to security already."
  const sparePrecheck = timeToBoardingMin - totalPrecheck
  const spareStandard = timeToBoardingMin - totalStandard

  // Recommendation: PreCheck if available + significantly faster; standard
  // if PreCheck unavailable; either if both are similar.
  let rec: 'precheck' | 'standard' | 'either' = 'either'
  if (precheckRow && (!generalRow || stMin - pcMin > 5)) rec = 'precheck'
  else if (!precheckRow?.isOpen && generalRow?.isOpen) rec = 'standard'

  return NextResponse.json({
    flight: flight ? serializeFlight(flight) : null,
    gate,
    terminal: legs.terminal,
    concourse: gateConcourse(gate),
    security: {
      precheck: precheckRow
        ? { wait_min: pcMin, checkpoint_name: checkpointName + ' PreCheck', available: precheckRow.isOpen }
        : { wait_min: null, checkpoint_name: checkpointName + ' PreCheck', available: false },
      standard: generalRow
        ? { wait_min: stMin, checkpoint_name: checkpointName + ' Standard', available: generalRow.isOpen }
        : { wait_min: null, checkpoint_name: checkpointName + ' Standard', available: false },
    },
    walk: { pre_security_min: legs.pre_security_min, post_security_min: legs.post_security_min },
    total: { precheck_min: totalPrecheck, standard_min: totalStandard },
    time_to_departure_min: timeToDepartMin,
    time_to_boarding_min: timeToBoardingMin,
    spare_time_min: { precheck: sparePrecheck, standard: spareStandard },
    security_recommendation: rec,
    summary_line: buildSummary({
      flight, gate, terminal: legs.terminal,
      timeToBoardingMin, totalPrecheck, totalStandard, sparePrecheck, spareStandard,
      precheckAvailable: !!precheckRow?.isOpen,
    }),
  }, { headers: cors })
}

function isAtCheckpoint(w: CheckpointWait, name: string): boolean {
  return (w.name || '').toUpperCase().startsWith(name.toUpperCase())
}
function waitMinutes(w: CheckpointWait | undefined): number {
  if (!w || w.waitSeconds == null) return 0
  return Math.round(w.waitSeconds / 60)
}
function gateConcourse(gate: string): string {
  const g = gate.toUpperCase().replace(/[^0-9A-Z]/g, '')
  if (/^C\d/.test(g) || (/^\d+$/.test(g) && Number(g) >= 230)) return 'C'
  const n = Number(g.replace(/^[A-Z]+/, ''))
  if (n >= 1 && n <= 29) return 'A1'
  if (n >= 30 && n <= 59) return 'A3'
  if (n >= 70 && n <= 99) return 'A4'
  if (n >= 100 && n <= 129) return 'A2'
  return ''
}

function serializeFlight(f: Flight) {
  return {
    number: f.operatingAirlineFlightNumber,
    airline: f.iataOperatingAirline,
    arrival: f.arrival,
    status: f.status,
    is_delayed: f.isDelayed,
    departure_to: f.arrivalAirport,
    arrived_from: f.departureAirport,
    via_airport: f.viaAirport,
    scheduled_timestamp: f.scheduledTimestamp,
    best_known_timestamp: f.bestKnownTimestamp,
    actual_timestamp: f.actualTimestamp,
    scheduled_date: f.scheduledDate,
    baggage_belt: f.baggageBelt,
  }
}

function buildSummary(args: {
  flight: Flight | null; gate: string; terminal: string;
  timeToBoardingMin: number; totalPrecheck: number; totalStandard: number;
  sparePrecheck: number; spareStandard: number; precheckAvailable: boolean;
}): string {
  const { flight, gate, terminal, timeToBoardingMin, totalPrecheck, totalStandard, sparePrecheck, spareStandard, precheckAvailable } = args
  const parts: string[] = []
  if (flight) {
    const dest = flight.arrival ? `from ${flight.departureAirport}` : `to ${flight.arrivalAirport}`
    parts.push(`Flight ${flight.operatingAirlineFlightNumber} ${dest} — Terminal ${terminal}, gate ${gate}.`)
  } else {
    parts.push(`Gate ${gate} (Terminal ${terminal}).`)
  }
  if (flight && timeToBoardingMin > 0) {
    parts.push(`Boarding starts in ${formatMinutes(timeToBoardingMin)}.`)
  }
  if (precheckAvailable) {
    parts.push(`PreCheck route to your seat takes ~${formatMinutes(totalPrecheck)} total; standard route ~${formatMinutes(totalStandard)}.`)
  } else {
    parts.push(`Standard route to your seat takes ~${formatMinutes(totalStandard)} total.`)
  }
  const bestSpare = precheckAvailable ? sparePrecheck : spareStandard
  if (bestSpare > 30) {
    parts.push(`You have ~${formatMinutes(bestSpare)} to shop or eat before you should head to security. Want recommendations?`)
  } else if (bestSpare > 5) {
    parts.push(`You've got about ${formatMinutes(bestSpare)} of buffer — quick coffee or snack maybe, then move.`)
  } else if (bestSpare >= 0) {
    parts.push(`Head to security now — no time to spare.`)
  } else {
    parts.push(`You're tight on time — go straight to security now.`)
  }
  return parts.join(' ')
}
