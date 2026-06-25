import 'server-only'

// Live competitor-benchmark pull for the Customer-Experience Diligence deck.
// For the brand itself + each user-named competitor, sweeps DataForSEO Google
// Maps across the brand's top markets, keeps only listings whose normalized
// title CONTAINS the normalized search name (excludes contamination like
// "Rubio's Painting Services" / "El Rubio's Market"), dedups by address, and
// returns a vote-weighted lifetime rating. A one-time snapshot, not a feed.
// Ported from scripts/_rubio_comp_brand.ts (the working pull).

const BASE = 'https://api.dataforseo.com/v3'

export interface CompetitorBenchmark {
  brandLifetime: { rating: number; locs: number; reviews: number }
  competitors: { name: string; rating: number; locs: number; reviews: number }[]
}

type Listing = { name: string; address: string; rating: number | null; votes: number }

// Bound the work so the route stays inside maxDuration: at most
// (1 brand + 4 competitors) × 6 markets = 30 concurrent Maps calls.
const MAX_COMPETITORS = 4
const MAX_MARKETS = 8
const MIN_VOTES = 15

function auth(): string {
  return 'Basic ' + Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString('base64')
}

async function search(keyword: string): Promise<Listing[]> {
  const res = await fetch(`${BASE}/serp/google/maps/live/advanced`, {
    method: 'POST',
    headers: { Authorization: auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify([{ keyword, location_code: 2840, language_code: 'en', device: 'desktop', os: 'windows', depth: 100 }]),
  })
  const d = JSON.parse(await res.text())
  const items = d?.tasks?.[0]?.result?.[0]?.items || []
  return items
    .filter((i: { type?: string; place_id?: string }) => i?.type === 'maps_search' && i.place_id)
    .map((i: { title?: string; address?: string; rating?: { value?: number; votes_count?: number } }) => ({
      name: i.title || '',
      address: i.address || '',
      rating: i.rating?.value ?? null,
      votes: i.rating?.votes_count ?? 0,
    }))
}

// Normalize for name matching: lowercase, REMOVE apostrophes (so "Ruth's" →
// "ruths" — not "ruth s", which a space-replace would produce and which then
// fails to contain the apostrophe-less brand name), turn other punctuation into
// spaces, collapse whitespace, strip a leading "the ".
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/['’ʼ]/g, '')   // straight + curly apostrophes → removed
    .replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^the /, '')
}

// Sweep one brand across the markets; keep only matched, voted listings;
// dedup by address; return vote-weighted lifetime rating.
async function collect(name: string, markets: string[]): Promise<{ rating: number; locs: number; reviews: number }> {
  const needle = norm(name)
  const seen = new Set<string>()
  const locs: { rating: number; votes: number }[] = []

  const results = await Promise.all(
    markets.map(async (mk) => {
      try {
        return await search(`${name} ${mk}`)
      } catch {
        return [] as Listing[]
      }
    }),
  )

  for (const listings of results) {
    for (const l of listings) {
      if (l.rating == null || l.votes < MIN_VOTES) continue
      if (!norm(l.name).includes(needle)) continue
      if (seen.has(l.address)) continue
      seen.add(l.address)
      locs.push({ rating: l.rating, votes: l.votes })
    }
  }

  const totalVotes = locs.reduce((s, x) => s + x.votes, 0)
  const weighted = totalVotes ? locs.reduce((s, x) => s + x.rating * x.votes, 0) / totalVotes : 0
  return { rating: Math.round(weighted * 100) / 100, locs: locs.length, reviews: totalVotes }
}

export async function computeCompetitorBenchmark(
  brandSearchName: string,
  competitorNames: string[],
  markets: string[],
): Promise<CompetitorBenchmark> {
  const mkts = markets.slice(0, MAX_MARKETS)
  const comps = competitorNames.map((c) => c.trim()).filter(Boolean).slice(0, MAX_COMPETITORS)

  const [brand, ...compResults] = await Promise.all([
    collect(brandSearchName, mkts),
    ...comps.map((c) => collect(c, mkts)),
  ])

  const competitors = comps
    .map((name, i) => ({ name, ...compResults[i] }))
    .filter((c) => c.locs > 0) // omit competitors with no matched locations (no NaN)

  return { brandLifetime: brand, competitors }
}
