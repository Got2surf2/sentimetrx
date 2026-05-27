import 'server-only'

// lib/mcoLiveContext.ts
//
// Builds a "LIVE MCO DATA" block to inject into Ana's system prompt for
// turns where the user's question is about something we have live data
// for: flights/gates, security wait, parking status. Without this block,
// the chat route's prose can only reference Ana's static KB — so she
// answers "I don't have live flight info" even when /api/mco/flights
// returns 250+ live flights with gates assigned.
//
// Cheap intent detection (regex/keyword — no synchronous AI call) decides
// which live data to fetch, then formats a compact block. Empty string if
// no live intent matches → no change to the prompt for normal turns.
//
// Bot-specific: called by chatCore only when bot.id matches AskAna. Other
// bots are unaffected.

import { fetchFlights, findFlightByNumber, nextDepartureAtGate, parseFlightNumber, type Flight } from '@/lib/flights'
import { fetchSecurityWaits } from '@/lib/securityWait'
import { fetchParkingAvailability } from '@/lib/parking'

const ASKANA_BOT_ID = '920c571b-5a09-4d3a-a20e-904a417d20b3'

// Common destination keywords → IATA airport codes. Not exhaustive but
// covers the major ones MCO connects to. The bot's prose will use these
// to filter the live flight list when the user mentions a destination
// by name instead of code.
const DEST_KEYWORDS: Record<string, string> = {
  'laguardia': 'LGA', 'la guardia': 'LGA', 'lga': 'LGA',
  'jfk': 'JFK', 'kennedy': 'JFK', 'new york': 'JFK',  // also LGA + EWR ambiguous — pick the most common
  'newark': 'EWR', 'ewr': 'EWR',
  'atlanta': 'ATL', 'atl': 'ATL',
  'chicago': 'ORD', 'ohare': 'ORD', "o'hare": 'ORD', 'ord': 'ORD', 'midway': 'MDW', 'mdw': 'MDW',
  'los angeles': 'LAX', 'lax': 'LAX',
  'dallas': 'DFW', 'dfw': 'DFW', 'love field': 'DAL',
  'detroit': 'DTW', 'dtw': 'DTW',
  'denver': 'DEN', 'den': 'DEN',
  'minneapolis': 'MSP', 'msp': 'MSP', 'twin cities': 'MSP',
  'houston': 'IAH', 'iah': 'IAH', 'hobby': 'HOU', 'hou': 'HOU',
  'philadelphia': 'PHL', 'phl': 'PHL', 'philly': 'PHL',
  'boston': 'BOS', 'bos': 'BOS',
  'seattle': 'SEA', 'sea': 'SEA',
  'phoenix': 'PHX', 'phx': 'PHX',
  'charlotte': 'CLT', 'clt': 'CLT',
  'miami': 'MIA', 'mia': 'MIA',
  'fort lauderdale': 'FLL', 'fll': 'FLL',
  'tampa': 'TPA', 'tpa': 'TPA',
  'jacksonville': 'JAX', 'jax': 'JAX',
  'nashville': 'BNA', 'bna': 'BNA',
  'baltimore': 'BWI', 'bwi': 'BWI',
  'washington': 'DCA', 'dca': 'DCA', 'reagan': 'DCA', 'dulles': 'IAD', 'iad': 'IAD',
  'san francisco': 'SFO', 'sfo': 'SFO',
  'las vegas': 'LAS', 'vegas': 'LAS', 'las': 'LAS',
  'london': 'LHR', 'heathrow': 'LHR', 'lhr': 'LHR',
  'mexico city': 'MEX', 'mex': 'MEX',
  'toronto': 'YYZ', 'yyz': 'YYZ',
}

// IATA airline codes (operating airline) for common MCO carriers, plus
// human-readable aliases that the user might type. The full GOAA feed
// has many more but these cover the volume.
const AIRLINE_KEYWORDS: Record<string, string> = {
  'delta': 'DL', 'dl': 'DL',
  'american': 'AA', 'aa': 'AA', 'american airlines': 'AA',
  'united': 'UA', 'ua': 'UA',
  'southwest': 'WN', 'wn': 'WN', 'swa': 'WN',
  'jetblue': 'B6', 'b6': 'B6',
  'spirit': 'NK', 'nk': 'NK',
  'frontier': 'F9', 'f9': 'F9',
  'allegiant': 'G4', 'g4': 'G4',
  'alaska': 'AS', 'as': 'AS',
  'breeze': 'MX', 'mx': 'MX',
  'aeromexico': 'AM', 'am': 'AM',
  'british airways': 'BA', 'ba': 'BA',
  'lufthansa': 'LH', 'lh': 'LH',
  'air canada': 'AC', 'ac': 'AC',
  'westjet': 'WS', 'ws': 'WS',
  'virgin atlantic': 'VS', 'vs': 'VS',
}

interface DetectedIntent {
  wantsFlights: boolean
  wantsSecurity: boolean
  wantsParking: boolean
  airline: string | null
  destination: string | null
  flightNumber: string | null
  /** Flight numbers carried forward from a recent assistant message — used
   * so follow-up questions like "the 7:50 one" can still find the right
   * flight even though the user's latest message has no keywords. */
  carryFlightNumbers: string[]
  gate: string | null
  /** Time references in the user message that select among carried flights. */
  timeHint: string | null
}

// Scan a block of text and collect detected signals. When we run this against
// both the user message AND the prior assistant message, we get the right
// behavior for follow-ups: the assistant's prior reply containing "DL1511"
// + "DL2564" sticks the relevant numbers into carryFlightNumbers; the
// user's "the 7:50 one" supplies the timeHint that narrows them down.
function scanText(text: string, intoUserIntent: boolean, out: DetectedIntent) {
  const m = (text || '').toLowerCase()
  if (!m) return

  if (intoUserIntent) {
    if (/\b(gate|flight|board(ing)?|depart(ure|s|ing)?|arrive|arrival|leaving|takes? off|that flight|the .+ one)\b/.test(m)) {
      out.wantsFlights = true
    }
    if (/\b(security|tsa|line|wait|checkpoint|precheck)\b/i.test(m)) out.wantsSecurity = true
    if (/\b(parking|garage|lot|valet|park place|cell phone)\b/i.test(m)) out.wantsParking = true
  }

  // Flight number pattern — strict, must look like an IATA code + digits.
  // Runs on BOTH user + assistant text so "DL1511" in the bot's reply gets
  // captured for the next turn.
  const fnRe = /\b([A-Z]{2})\s?(\d{2,4}[A-Z]?)\b/g
  let fnMatch: RegExpExecArray | null
  while ((fnMatch = fnRe.exec(text)) !== null) {
    const fn = fnMatch[1] + fnMatch[2]
    // Filter — only keep if the airline code is a known airline (avoids false
    // matches on random capital pairs like "TSA 901" or "FL 32827")
    if (Object.values(AIRLINE_KEYWORDS).includes(fnMatch[1])) {
      if (intoUserIntent && !out.flightNumber) out.flightNumber = fn
      if (!out.carryFlightNumbers.includes(fn)) out.carryFlightNumbers.push(fn)
      out.wantsFlights = true
    }
  }

  // Time hint — "7:50", "8:30 PM", etc. (only meaningful from user message)
  if (intoUserIntent) {
    const t = m.match(/\b(\d{1,2}:\d{2})\s*(am|pm)?\b/)
    if (t) out.timeHint = t[1]
  }

  // Gate, airline, destination — scan from both sources
  const gm = m.match(/\bgate\s*([0-9]{1,3}|c[\s-]?\d{3})\b/i) || m.match(/\b(c\s?\d{3})\b/i)
  if (gm && !out.gate) { out.gate = gm[1].replace(/\s+/g, ''); out.wantsFlights = true }

  for (const k of Object.keys(AIRLINE_KEYWORDS)) {
    if (out.airline) break
    const re = new RegExp('\\b' + k + '\\b', 'i')
    if (re.test(m)) { out.airline = AIRLINE_KEYWORDS[k]; out.wantsFlights = true }
  }
  for (const k of Object.keys(DEST_KEYWORDS)) {
    if (out.destination) break
    const re = new RegExp('\\b' + k.replace(/'/g, "['']?") + '\\b', 'i')
    if (re.test(m)) { out.destination = DEST_KEYWORDS[k]; out.wantsFlights = true }
  }
}

function detectIntent(userMessage: string, priorAssistantMessage: string): DetectedIntent {
  const out: DetectedIntent = {
    wantsFlights: false, wantsSecurity: false, wantsParking: false,
    airline: null, destination: null, flightNumber: null,
    carryFlightNumbers: [], gate: null, timeHint: null,
  }
  // User message owns the "intent" signal — that's what determines whether
  // to enrich the prompt at all. Carry forward from assistant for the
  // specific entity references the user is shorthanding to.
  scanText(userMessage, true, out)
  scanText(priorAssistantMessage, false, out)
  return out
}

// Time-window filter for "tonight", "this morning", etc. Conservative —
// we only narrow when the user gave an explicit window.
function timeWindow(userMessage: string): { startSec: number; endSec: number } {
  const now = Math.floor(Date.now() / 1000)
  const m = userMessage.toLowerCase()
  const todayStart = new Date(); todayStart.setHours(0,0,0,0)
  const todayEnd = new Date(); todayEnd.setHours(23,59,59,999)
  const eveStart = new Date(); eveStart.setHours(17,0,0,0)
  const morningEnd = new Date(); morningEnd.setHours(11,59,59,999)
  if (/\btonight|this evening|tonight\b/.test(m)) return { startSec: Math.max(now, eveStart.getTime()/1000), endSec: todayEnd.getTime()/1000 }
  if (/\bthis (morning|am)\b/.test(m)) return { startSec: now, endSec: Math.min(todayEnd.getTime()/1000, morningEnd.getTime()/1000) }
  if (/\btoday\b/.test(m)) return { startSec: now, endSec: todayEnd.getTime()/1000 }
  // default: next 4 hours
  return { startSec: now, endSec: now + 4 * 3600 }
}

function fmtTime(unix: number): string {
  return new Date(unix * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

/**
 * Build a system-prompt block of LIVE MCO data relevant to the user's
 * message. Returns empty string when no live intent matches (the default
 * for any non-MCO turn).
 *
 * Accepts the prior assistant message so follow-up turns like "the 7:50
 * one" still resolve — the assistant's previous reply seeded the flight
 * numbers; the user's time/airline reference narrows them.
 *
 * Called by chatCore for the AskAna bot only — gated by bot id.
 */
export async function buildMcoLiveContext(botId: string, userMessage: string, priorAssistantMessage: string = ''): Promise<string> {
  if (botId !== ASKANA_BOT_ID) return ''
  if (!userMessage) return ''
  const intent = detectIntent(userMessage, priorAssistantMessage)
  if (!intent.wantsFlights && !intent.wantsSecurity && !intent.wantsParking) return ''

  const sections: string[] = []
  // Fetch in parallel — each fail-soft.
  const [flights, waits, parking] = await Promise.all([
    intent.wantsFlights ? fetchFlights().catch(() => []) : Promise.resolve([] as Flight[]),
    intent.wantsSecurity ? fetchSecurityWaits().catch(() => []) : Promise.resolve([] as any[]),
    intent.wantsParking ? fetchParkingAvailability().catch(() => []) : Promise.resolve([] as any[]),
  ])

  // Flights block
  if (intent.wantsFlights) {
    let matches: Flight[] = flights
    if (intent.flightNumber) {
      const one = findFlightByNumber(flights, intent.flightNumber)
      if (one) matches = [one]
    } else if (intent.carryFlightNumbers.length > 0) {
      // Follow-up reference — resolve to the carried numbers, optionally
      // narrowed by a time hint ("the 7:50 one").
      const carried = intent.carryFlightNumbers
        .map(n => findFlightByNumber(flights, n))
        .filter((f): f is Flight => !!f)
      if (intent.timeHint) {
        // Match either by clock time or by hour
        const [hh] = intent.timeHint.split(':')
        const targetHour = Number(hh)
        const narrowed = carried.filter(f => {
          const d = new Date(f.bestKnownTimestamp * 1000)
          const h12 = d.getHours() % 12 || 12
          const h24 = d.getHours()
          return h12 === targetHour || h24 === targetHour
        })
        matches = narrowed.length > 0 ? narrowed : carried
      } else {
        matches = carried
      }
    } else if (intent.gate) {
      const one = nextDepartureAtGate(flights, intent.gate)
      if (one) matches = [one]
    } else {
      // Destination / airline filter, narrowed by the time window the user mentioned
      const { startSec, endSec } = timeWindow(userMessage)
      matches = flights.filter(f => {
        if (intent.airline && f.iataOperatingAirline !== intent.airline) return false
        if (intent.destination && f.arrivalAirport !== intent.destination) return false
        if (f.bestKnownTimestamp < startSec - 600 || f.bestKnownTimestamp > endSec) return false
        // Default to departures if no direction implied
        if (!intent.flightNumber && !intent.gate) {
          // If user said "leave/depart/board" prefer departures; "arrive/from" prefer arrivals.
          const wantsArr = /\b(arriv|landing|coming in|from)\b/i.test(userMessage)
          if (wantsArr && !f.arrival) return false
          if (!wantsArr && f.arrival) return false
        }
        return true
      }).sort((a, b) => a.bestKnownTimestamp - b.bestKnownTimestamp)
    }

    if (matches.length === 0) {
      sections.push('LIVE FLIGHT LOOKUP (next 4 h window): no matching flights found in the current GOAA feed.')
    } else {
      const lines = matches.slice(0, 6).map(f => {
        const dir = f.arrival ? `from ${f.departureAirport || f.viaAirport || '?'}` : `to ${f.arrivalAirport || f.viaAirport || '?'}`
        const when = fmtTime(f.bestKnownTimestamp || f.scheduledTimestamp || 0)
        const gate = f.gate ? `gate ${f.gate}` : 'no gate yet'
        const term = f.terminal ? `Terminal ${f.terminal}` : 'no terminal yet'
        const status = f.status + (f.isDelayed ? ' (DELAYED)' : '')
        return `  - ${f.iataOperatingAirline}${f.operatingAirlineFlightNumber} ${dir} · ${term}, ${gate} · ${when} · ${status}`
      }).join('\n')
      sections.push(`LIVE FLIGHT LOOKUP (sourced from the GOAA feed at api.goaa.aero/flights, current as of right now):\n${lines}\n  ${matches.length > 6 ? '… and ' + (matches.length - 6) + ' more.' : ''}`)
    }
  }

  // Security block
  if (intent.wantsSecurity && waits.length > 0) {
    const byCheckpoint: Record<string, string[]> = {}
    for (const w of waits) {
      const cp = w.name.split(' ')[0] // West / East / South
      const mins = w.waitSeconds != null ? Math.round(w.waitSeconds / 60) : null
      const lane = w.lane === 'precheck' ? 'PreCheck' : 'Standard'
      const line = `${lane} ${mins != null ? mins + ' min' : 'unknown'}${w.isOpen ? '' : ' (CLOSED)'}`
      ;(byCheckpoint[cp] ??= []).push(line)
    }
    const lines = Object.entries(byCheckpoint).map(([cp, ls]) => `  - ${cp} checkpoint: ${ls.join(' · ')}`).join('\n')
    sections.push(`LIVE SECURITY WAIT TIMES (sourced from api.goaa.aero/wait-times/checkpoint/MCO):\n${lines}`)
  }

  // Parking block
  if (intent.wantsParking && parking.length > 0) {
    const interesting = parking.filter(p => p.status === 'full' || /garage|terminal.top/i.test(p.name))
    if (interesting.length > 0) {
      const lines = interesting.slice(0, 8).map(p => {
        return `  - ${p.name}: ${p.status}${p.rate?.daily ? ` · $${p.rate.daily}/day` : ''}`
      }).join('\n')
      sections.push(`LIVE PARKING STATUS (sourced from api.goaa.aero/parking/availability/MCO):\n${lines}\n  Note: live spot counts are not exposed by GOAA today — only open/full status.`)
    }
  }

  if (sections.length === 0) return ''
  return '\n\n--- LIVE MCO DATA FOR THIS TURN ---\n' + sections.join('\n\n') +
    `\n\nUse this LIVE block over your static KB for any flight/gate/security/parking question this turn. Cite specific flight numbers, gates, and times from the LIVE block as fact (no "I don't have…" disclaimers). If the LIVE block shows zero matches for a query, say so directly ("I see no Delta flights to LGA tonight in the live feed — the next one to a NYC airport is …" if applicable).`
}
