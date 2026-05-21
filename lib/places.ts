import 'server-only'

// lib/places.ts
//
// Google Places API (New) wrapper for the canvas demo's RestaurantsCard.
// Resolves a list of place_ids → cards with name + rating + price + hours.
//
// SKU: Basic ($5/1K calls). Photos and reviews are deliberately out of scope
// for v1 — those are the Pro SKU ($17-20/1K) and not needed for the demo.
// Caching: Google's TOS allow caching only the place_id, never the live
// fields (rating, hours, name, address). So this fetcher refetches every
// call. The boardroom demo session is ~$0.02-0.05 in API spend.
//
// No GOOGLE_PLACES_API_KEY env var? Graceful degradation: returns synthetic
// MOCK_PLACES so the card still renders during local dev. The demo strip's
// "live"/"demo" indicator reflects whether the data is real.

const PLACES_API = 'https://places.googleapis.com/v1/places/'
// "Basic SKU" field mask — these don't trigger the more expensive
// Pro/Enterprise SKUs. Verify against
// https://developers.google.com/maps/documentation/places/web-service/usage-and-billing
const FIELD_MASK = [
  'displayName',
  'rating',
  'userRatingCount',
  'priceLevel',
  'currentOpeningHours.openNow',
  'formattedAddress',
  'googleMapsUri',
  'primaryType',
].join(',')

export interface PlaceCard {
  place_id: string
  name: string
  rating: number | null
  user_ratings_total: number | null
  price_level: number | null         // 1..4 (PRICE_LEVEL_INEXPENSIVE → PRICE_LEVEL_VERY_EXPENSIVE)
  opening_hours_now: 'open' | 'closed' | 'unknown'
  formatted_address: string
  maps_url: string
  primary_type: string | null         // e.g. "cafe", "restaurant"
  is_mock: boolean                    // true when graceful-fallback data
}

// Synthetic data used when no Places API key is configured. Names match
// real MCO airside concessions so the demo reads naturally. Ratings are
// in a believable range; not labeled as live to the user since `is_mock`
// gets surfaced in the card UI.
const MOCK_PLACES_BY_CONTEXT: Record<string, PlaceCard[]> = {
  terminal_a_airside: [
    { place_id: 'mock_starbucks_a', name: 'Starbucks', rating: 4.1, user_ratings_total: 2847, price_level: 2, opening_hours_now: 'open', formatted_address: 'Terminal A airside, MCO', maps_url: 'https://www.google.com/maps/search/starbucks+mco', primary_type: 'cafe', is_mock: true },
    { place_id: 'mock_auntie_a',    name: "Auntie Anne's Pretzels", rating: 4.3, user_ratings_total: 1206, price_level: 1, opening_hours_now: 'open', formatted_address: 'Terminal A airside, MCO', maps_url: 'https://www.google.com/maps/search/auntie+annes+mco', primary_type: 'snack_bar', is_mock: true },
    { place_id: 'mock_cask_a',      name: 'Cask & Larder Brewhouse', rating: 4.2, user_ratings_total: 984, price_level: 3, opening_hours_now: 'open', formatted_address: 'Terminal A airside, MCO', maps_url: 'https://www.google.com/maps/search/cask+larder+mco', primary_type: 'bar', is_mock: true },
    { place_id: 'mock_outback_a',   name: 'Outback Steakhouse', rating: 3.9, user_ratings_total: 2316, price_level: 3, opening_hours_now: 'open', formatted_address: 'Terminal A airside, MCO', maps_url: 'https://www.google.com/maps/search/outback+mco', primary_type: 'restaurant', is_mock: true },
    { place_id: 'mock_cibo_a',      name: 'Cibo Express Gourmet Market', rating: 4.0, user_ratings_total: 673, price_level: 2, opening_hours_now: 'open', formatted_address: 'Terminal A airside, MCO', maps_url: 'https://www.google.com/maps/search/cibo+express+mco', primary_type: 'restaurant', is_mock: true },
  ],
  terminal_b_airside: [
    { place_id: 'mock_chickfila_b', name: 'Chick-fil-A', rating: 4.4, user_ratings_total: 3120, price_level: 2, opening_hours_now: 'open', formatted_address: 'Terminal B airside, MCO', maps_url: 'https://www.google.com/maps/search/chickfila+mco', primary_type: 'restaurant', is_mock: true },
    { place_id: 'mock_mcd_b',       name: "McDonald's", rating: 3.8, user_ratings_total: 1894, price_level: 1, opening_hours_now: 'open', formatted_address: 'Terminal B airside, MCO', maps_url: 'https://www.google.com/maps/search/mcdonalds+mco', primary_type: 'restaurant', is_mock: true },
    { place_id: 'mock_starbucks_b', name: 'Starbucks', rating: 4.0, user_ratings_total: 2003, price_level: 2, opening_hours_now: 'open', formatted_address: 'Terminal B airside, MCO', maps_url: 'https://www.google.com/maps/search/starbucks+mco', primary_type: 'cafe', is_mock: true },
    { place_id: 'mock_villa_b',     name: 'Villa Italian Kitchen', rating: 3.7, user_ratings_total: 521, price_level: 2, opening_hours_now: 'open', formatted_address: 'Terminal B airside, MCO', maps_url: 'https://www.google.com/maps/search/villa+italian+mco', primary_type: 'restaurant', is_mock: true },
  ],
  terminal_c_airside: [
    { place_id: 'mock_oga_c',       name: 'Ouzo Bay', rating: 4.3, user_ratings_total: 712, price_level: 3, opening_hours_now: 'open', formatted_address: 'Terminal C airside, MCO', maps_url: 'https://www.google.com/maps/search/ouzo+bay+mco', primary_type: 'restaurant', is_mock: true },
    { place_id: 'mock_shake_c',     name: 'Shake Shack', rating: 4.2, user_ratings_total: 1543, price_level: 2, opening_hours_now: 'open', formatted_address: 'Terminal C airside, MCO', maps_url: 'https://www.google.com/maps/search/shake+shack+mco', primary_type: 'restaurant', is_mock: true },
    { place_id: 'mock_swine_c',     name: 'Swine & Sons', rating: 4.1, user_ratings_total: 487, price_level: 2, opening_hours_now: 'open', formatted_address: 'Terminal C airside, MCO', maps_url: 'https://www.google.com/maps/search/swine+sons+mco', primary_type: 'restaurant', is_mock: true },
    { place_id: 'mock_jersey_c',    name: 'Jersey Mike\'s Subs', rating: 4.4, user_ratings_total: 891, price_level: 1, opening_hours_now: 'open', formatted_address: 'Terminal C airside, MCO', maps_url: 'https://www.google.com/maps/search/jersey+mikes+mco', primary_type: 'restaurant', is_mock: true },
  ],
  landside_main_terminal: [
    { place_id: 'mock_hyatt_lounge', name: 'Hemisphere Restaurant (Hyatt Regency)', rating: 4.1, user_ratings_total: 432, price_level: 3, opening_hours_now: 'open', formatted_address: 'Hyatt Regency, Main Terminal, MCO', maps_url: 'https://www.google.com/maps/search/hemisphere+mco', primary_type: 'restaurant', is_mock: true },
    { place_id: 'mock_levarbar', name: "McCoy's Bar & Grill", rating: 3.9, user_ratings_total: 587, price_level: 2, opening_hours_now: 'open', formatted_address: 'Main Terminal landside, MCO', maps_url: 'https://www.google.com/maps/search/mccoys+mco', primary_type: 'bar', is_mock: true },
  ],
}

export function mockPlacesForContext(context: string | undefined): PlaceCard[] {
  if (!context) return MOCK_PLACES_BY_CONTEXT.terminal_a_airside
  return MOCK_PLACES_BY_CONTEXT[context] || MOCK_PLACES_BY_CONTEXT.terminal_a_airside
}

// Google's PriceLevel enum is a string in the New API. Convert to 1..4.
function priceStringToInt(p: string | undefined | null): number | null {
  switch (p) {
    case 'PRICE_LEVEL_FREE': return 0
    case 'PRICE_LEVEL_INEXPENSIVE': return 1
    case 'PRICE_LEVEL_MODERATE': return 2
    case 'PRICE_LEVEL_EXPENSIVE': return 3
    case 'PRICE_LEVEL_VERY_EXPENSIVE': return 4
    default: return null
  }
}

async function fetchOne(placeId: string, apiKey: string): Promise<PlaceCard | null> {
  try {
    const res = await fetch(PLACES_API + encodeURIComponent(placeId), {
      headers: {
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': FIELD_MASK,
      },
      signal: AbortSignal.timeout(5000),
    })
    if (!res.ok) return null
    const j: any = await res.json()
    return {
      place_id: placeId,
      name: j?.displayName?.text || '(unknown)',
      rating: typeof j?.rating === 'number' ? j.rating : null,
      user_ratings_total: typeof j?.userRatingCount === 'number' ? j.userRatingCount : null,
      price_level: priceStringToInt(j?.priceLevel),
      opening_hours_now: typeof j?.currentOpeningHours?.openNow === 'boolean'
        ? (j.currentOpeningHours.openNow ? 'open' : 'closed')
        : 'unknown',
      formatted_address: j?.formattedAddress || '',
      maps_url: j?.googleMapsUri || ('https://www.google.com/maps/place/?q=place_id:' + placeId),
      primary_type: typeof j?.primaryType === 'string' ? j.primaryType : null,
      is_mock: false,
    }
  } catch {
    return null
  }
}

/**
 * Resolve a list of place_ids to PlaceCard rows.
 *
 * Without GOOGLE_PLACES_API_KEY set, returns mock data scoped to `fallbackContext`
 * (e.g. "terminal_a_airside") — the demo still works in local dev.
 *
 * With the key set, fans out up to `concurrency` parallel calls and drops
 * failed entries (keeps the rest). Hours/rating/etc. are NOT cached — per
 * Google's TOS, only place_id can be cached.
 */
export async function fetchPlaceCards(
  placeIds: string[],
  options?: { fallbackContext?: string; concurrency?: number }
): Promise<PlaceCard[]> {
  const apiKey = process.env.GOOGLE_PLACES_API_KEY || ''

  // No key: graceful degradation to context-scoped mocks.
  if (!apiKey) return mockPlacesForContext(options?.fallbackContext)

  // No place_ids: nothing to look up; show mocks rather than an empty card.
  if (placeIds.length === 0) return mockPlacesForContext(options?.fallbackContext)

  const concurrency = Math.max(1, Math.min(options?.concurrency || 8, 12))
  const results: PlaceCard[] = []
  let i = 0
  async function worker() {
    while (i < placeIds.length) {
      const idx = i++
      const card = await fetchOne(placeIds[idx], apiKey)
      if (card) results.push(card)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, placeIds.length) }, worker))
  // Preserve original order in the response
  const byId = new Map(results.map((c) => [c.place_id, c]))
  return placeIds.map((pid) => byId.get(pid)).filter((c): c is PlaceCard => !!c)
}
