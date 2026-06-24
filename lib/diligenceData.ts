import 'server-only'
import { createServiceRoleClient } from '@/lib/supabase/server'

// Brand-health "extras" the outlet predictor doesn't expose, computed from a
// single scan of dataset_rows_flat. Used by the Customer-Experience Diligence
// deck. Every figure is observed; nothing is fabricated.

export interface DiligenceData {
  reviewCount: number          // total star-rated rows
  textCount: number            // rows with non-empty review_text
  blendedRating: number        // mean rating
  starDist: { star: number; pct: number; count: number }[]  // 5..1
  ownerResponseRate: number    // share with non-empty owner_response (0..1)
  window: { startISO: string; endISO: string; months: number; label: string } // e.g. "Jan 2025–Jun 2026"
  monthly: { ym: string; count: number }[]   // chronological
  volumeRampFlag: boolean      // true if last 3 months' avg volume >= 2.5x first 3 months' avg
  byState: { state: string; stores: number; reviews: number; rating: number }[] // review-weighted, desc by rating
  topMarkets: string[]         // top 8 markets as "City ST" (2-letter state), ranked by review count
}

type FlatRow = {
  rating?: number | null
  review_text?: string | null
  review_date?: string | null
  owner_response?: string | null
  location_city?: string | null
  location_state?: string | null
  location_address?: string | null
}

// 2-letter USPS code → full state name (the subset Rubio's-style brands span;
// unknown codes pass through unchanged so nothing is silently dropped).
const STATE_NAMES: Record<string, string> = {
  CA: 'California', AZ: 'Arizona', NV: 'Nevada', TX: 'Texas', CO: 'Colorado',
  FL: 'Florida', UT: 'Utah', NM: 'New Mexico', OR: 'Oregon', WA: 'Washington',
  GA: 'Georgia', IL: 'Illinois', NY: 'New York', NC: 'North Carolina',
  VA: 'Virginia', MD: 'Maryland', OH: 'Ohio', PA: 'Pennsylvania',
  MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', WI: 'Wisconsin',
  MO: 'Missouri', TN: 'Tennessee', IN: 'Indiana', SC: 'South Carolina',
  OK: 'Oklahoma', LA: 'Louisiana', KY: 'Kentucky', ID: 'Idaho', HI: 'Hawaii',
}

const MIN_STORE_REVIEWS = 15 // match the predictor's per-location floor

function normState(raw: string): string {
  const s = (raw || '').trim()
  if (!s) return 'Unknown'
  const up = s.toUpperCase()
  if (up.length === 2 && STATE_NAMES[up]) return STATE_NAMES[up]
  return s
}

// Full state name → 2-letter code (reverse of STATE_NAMES), for building
// "City ST" market strings regardless of how the source stored the state.
const STATE_CODES: Record<string, string> = Object.fromEntries(
  Object.entries(STATE_NAMES).map(([code, name]) => [name.toLowerCase(), code]),
)
function stateCode(raw: string): string {
  const s = (raw || '').trim()
  if (!s) return ''
  const up = s.toUpperCase()
  if (up.length === 2) return STATE_NAMES[up] ? up : up
  return STATE_CODES[s.toLowerCase()] || ''
}

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0)

export async function computeDiligenceData(datasetId: string): Promise<DiligenceData> {
  const sb = createServiceRoleClient()

  // One scan of the flat table.
  const rows: FlatRow[] = []
  let from = 0
  for (;;) {
    const { data, error } = await sb
      .from('dataset_rows_flat')
      .select('data')
      .eq('dataset_id', datasetId)
      .range(from, from + 999)
    if (error) throw error
    if (!data || !data.length) break
    for (const r of data) rows.push((r as { data: FlatRow }).data || {})
    from += 1000
    if (data.length < 1000) break
  }

  const rated = rows.filter((r) => typeof r.rating === 'number')
  const ratings = rated.map((r) => r.rating as number)
  const reviewCount = rated.length
  const blendedRating = mean(ratings)
  const textCount = rated.filter((r) => (r.review_text || '').trim().length > 0).length
  const ownerResponseRate = reviewCount
    ? rated.filter((r) => (r.owner_response || '').trim().length > 0).length / reviewCount
    : 0

  // Star distribution 5..1.
  const distCount: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  for (const rt of ratings) {
    const k = Math.round(rt)
    if (distCount[k] !== undefined) distCount[k]++
  }
  const starDist = [5, 4, 3, 2, 1].map((star) => ({
    star,
    count: distCount[star],
    pct: reviewCount ? (100 * distCount[star]) / reviewCount : 0,
  }))

  // Monthly volume (chronological). review_date → YYYY-MM.
  const monthCount: Record<string, number> = {}
  for (const r of rated) {
    const ym = String(r.review_date || '').slice(0, 7)
    if (!/^\d{4}-\d{2}$/.test(ym)) continue
    monthCount[ym] = (monthCount[ym] || 0) + 1
  }
  const monthly = Object.entries(monthCount)
    .map(([ym, count]) => ({ ym, count }))
    .sort((a, b) => a.ym.localeCompare(b.ym))

  // Window label from first→last observed month.
  const fmtMonth = (ym: string) => {
    const [y, m] = ym.split('-').map(Number)
    return new Date(Date.UTC(y, (m || 1) - 1, 1)).toLocaleDateString('en-US', {
      month: 'short', year: 'numeric', timeZone: 'UTC',
    })
  }
  const startYM = monthly[0]?.ym || ''
  const endYM = monthly[monthly.length - 1]?.ym || ''
  let months = 0
  if (startYM && endYM) {
    const [sy, sm] = startYM.split('-').map(Number)
    const [ey, em] = endYM.split('-').map(Number)
    months = (ey - sy) * 12 + (em - sm) + 1
  }
  const window = {
    startISO: startYM ? `${startYM}-01` : '',
    endISO: endYM ? `${endYM}-01` : '',
    months,
    label: startYM && endYM ? `${fmtMonth(startYM)}–${fmtMonth(endYM)}` : '',
  }

  // Volume ramp: last 3 months' avg vs first 3 months' avg.
  let volumeRampFlag = false
  if (monthly.length >= 6) {
    const first3 = mean(monthly.slice(0, 3).map((m) => m.count))
    const last3 = mean(monthly.slice(-3).map((m) => m.count))
    volumeRampFlag = first3 > 0 && last3 >= 2.5 * first3
  }

  // Per-state, review-weighted, only counting stores with >=15 reviews.
  type StoreAgg = { state: string; sum: number; n: number }
  const storeMap = new Map<string, StoreAgg>() // keyed by location_address
  for (const r of rated) {
    const addr = (r.location_address || '').trim()
    if (!addr) continue
    const a = storeMap.get(addr) || { state: normState(r.location_state || ''), sum: 0, n: 0 }
    a.sum += r.rating as number
    a.n += 1
    storeMap.set(addr, a)
  }
  type StateAgg = { stores: number; ratingSum: number; reviews: number }
  const stateMap = new Map<string, StateAgg>()
  for (const a of storeMap.values()) {
    if (a.n < MIN_STORE_REVIEWS) continue
    const s = stateMap.get(a.state) || { stores: 0, ratingSum: 0, reviews: 0 }
    s.stores += 1
    s.ratingSum += a.sum          // review-weighted: sum of the store's ratings
    s.reviews += a.n
    stateMap.set(a.state, s)
  }
  const byState = [...stateMap.entries()]
    .map(([state, s]) => ({
      state,
      stores: s.stores,
      reviews: s.reviews,
      rating: s.reviews ? s.ratingSum / s.reviews : 0,
    }))
    .sort((a, b) => b.rating - a.rating)

  // Top markets ("City ST") by review count — feeds the live competitor pull.
  const marketCount: Record<string, number> = {}
  for (const r of rated) {
    const city = (r.location_city || '').trim()
    const st = stateCode(r.location_state || '')
    if (!city || !st) continue
    const key = `${city} ${st}`
    marketCount[key] = (marketCount[key] || 0) + 1
  }
  const topMarkets = Object.entries(marketCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k]) => k)

  return {
    reviewCount,
    textCount,
    blendedRating,
    starDist,
    ownerResponseRate,
    window,
    monthly,
    volumeRampFlag,
    byState,
    topMarkets,
  }
}
