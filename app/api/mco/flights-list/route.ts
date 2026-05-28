// app/api/mco/flights-list/route.ts
//
// POST — list flights for the right-pane FlightListCard. Filters by airline,
// destination/origin, terminal, arrivals vs departures, and a free-text
// time window ("tonight" / "this morning" / "today" / default next 4h).
// Returns up to 12 flights, sorted by scheduled departure time.
//
// Public, CORS-open. Read-only.

import { NextResponse, type NextRequest } from 'next/server'
import { fetchFlights, type Flight } from '@/lib/flights'

export const dynamic = 'force-dynamic'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors })
}

function timeWindow(hint: string | undefined): { startSec: number; endSec: number } {
  const now = Math.floor(Date.now() / 1000)
  const m = (hint || '').toLowerCase()
  const todayEnd = new Date(); todayEnd.setHours(23, 59, 59, 999)
  const eveStart = new Date(); eveStart.setHours(17, 0, 0, 0)
  const morningEnd = new Date(); morningEnd.setHours(11, 59, 59, 999)
  // Tomorrow / tomorrow morning / tomorrow evening / tomorrow night
  if (/tomorrow/.test(m)) {
    const tStart = new Date(); tStart.setDate(tStart.getDate() + 1); tStart.setHours(0, 0, 0, 0)
    const tEnd   = new Date(); tEnd.setDate(tEnd.getDate() + 1);   tEnd.setHours(23, 59, 59, 999)
    if (/morning|am/.test(m)) tEnd.setHours(11, 59, 59, 999)
    if (/evening|tonight|night|pm/.test(m)) tStart.setHours(17, 0, 0, 0)
    return { startSec: tStart.getTime() / 1000, endSec: tEnd.getTime() / 1000 }
  }
  if (/tonight|this evening|evening/.test(m)) {
    return { startSec: Math.max(now, eveStart.getTime() / 1000), endSec: todayEnd.getTime() / 1000 }
  }
  if (/this morning|morning/.test(m)) {
    return { startSec: now, endSec: Math.min(todayEnd.getTime() / 1000, morningEnd.getTime() / 1000) }
  }
  if (/today/.test(m)) return { startSec: now, endSec: todayEnd.getTime() / 1000 }
  // Default — rest of today, with at least 6h forward so late-day queries
  // still surface red-eyes / overnight flights.
  return { startSec: now, endSec: Math.max(todayEnd.getTime() / 1000, now + 6 * 3600) }
}

export async function POST(req: NextRequest) {
  let body: any = {}
  try { body = await req.json() } catch {}

  const airline = typeof body?.airline === 'string' && body.airline.length <= 4 ? body.airline.toUpperCase() : undefined
  const destination = typeof body?.destination === 'string' && body.destination.length <= 4 ? body.destination.toUpperCase() : undefined
  const origin = typeof body?.origin === 'string' && body.origin.length <= 4 ? body.origin.toUpperCase() : undefined
  const terminal = body?.terminal === 'A' || body?.terminal === 'B' || body?.terminal === 'C' ? body.terminal : undefined
  const arrivals = body?.arrivals === true
  const timeWindowHint = typeof body?.time_window === 'string' ? body.time_window : ''

  const flights = await fetchFlights()
  const { startSec, endSec } = timeWindow(timeWindowHint)

  const matches = flights.filter(f => {
    if (arrivals !== !!f.arrival) return false
    if (airline && f.iataOperatingAirline !== airline) return false
    if (terminal && f.terminal !== terminal) return false
    if (destination && !arrivals && f.arrivalAirport !== destination && f.viaAirport !== destination) return false
    if (origin && arrivals && f.departureAirport !== origin) return false
    if (f.bestKnownTimestamp < startSec - 600 || f.bestKnownTimestamp > endSec) return false
    return true
  }).sort((a, b) => a.bestKnownTimestamp - b.bestKnownTimestamp).slice(0, 12)

  return NextResponse.json({
    flights: matches.map(serializeFlight),
    count: matches.length,
    filters: { airline, destination, origin, terminal, arrivals, time_window: timeWindowHint },
    range_unix: { start: startSec, end: endSec },
  }, { headers: cors })
}

function serializeFlight(f: Flight) {
  return {
    flight_number: f.operatingAirlineFlightNumber,
    airline: f.iataOperatingAirline,
    arrival: f.arrival,
    status: f.status,
    is_delayed: f.isDelayed,
    departure_to: f.arrivalAirport,
    arrived_from: f.departureAirport,
    via_airport: f.viaAirport,
    terminal: f.terminal,
    gate: f.gate,
    baggage_belt: f.baggageBelt,
    scheduled_timestamp: f.scheduledTimestamp,
    best_known_timestamp: f.bestKnownTimestamp,
    actual_timestamp: f.actualTimestamp,
    scheduled_date: f.scheduledDate,
  }
}
