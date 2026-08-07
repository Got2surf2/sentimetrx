import 'server-only'
import { callAI } from '@/lib/ai'
import { logError } from '@/lib/log'
import type { ThemeTableRow } from '@/lib/outletReport'

// LLM-narrated "3 things to work on next" action plan for one outlet — the PDF's
// page-2 AI Action Plan, in product. Deterministic selection of the weakest
// themes (worst READ first) feeds a Claude call that writes the diagnosis + a
// concrete operator playbook per priority, plus a "keep doing" note. Every
// figure the plan cites comes from the (already-computed) snapshot; verbatims
// are SELECTED from real 1–3★ reviews we pass in and validated against them, so
// nothing is fabricated. Cached per outlet (see sql/183) keyed by `basis`.

export type PlanVerbatim = { rating: number; quote: string }

export type PlanPriority = {
  tag: string          // short kicker, e.g. "BIGGEST LEVER"
  title: string        // imperative headline, e.g. "Get every order right at the pass"
  theme: string        // the theme this priority addresses
  diagnosis: string    // 1–2 sentences grounded in the theme's stats
  verbatims: PlanVerbatim[] // 1–2 real guest quotes
  actions: string[]    // 2–4 concrete operator actions
}

export type ActionPlan = {
  priorities: PlanPriority[]
  keepDoing: string   // "what's already working" note (PDF page-2 KEEP DOING paragraph)
  generatedAt: string
}

export type ActionPlanInput = {
  orgId: string
  brand: string
  outletName: string
  reviews: number
  rating: number
  recent: { count: number; avg: number; direction: string } | null
  ownerResponseRate: number
  themeTable: ThemeTableRow[]
  lowQuotes: { theme: string; quote: string }[] // one real 1–3★ verbatim per theme
  praiseVerbatims: PlanVerbatim[]
}

// The plan regenerates only when its inputs materially change: the outlet's
// review count or any theme's READ verdict. Cheap, stable signature.
export function actionPlanBasis(reviews: number, themeTable: ThemeTableRow[]): string {
  // Bump the version prefix to invalidate all cached plans after a prompt change.
  // v4 (2026-08-07): refer to "your location" (brand/outlet names can be messy)
  // — supersedes v3's specific-naming attempt; verbatim-accuracy fix stays.
  return `v4|${reviews}|${themeTable.map((t) => `${t.theme}:${t.read}`).join(',')}`
}

// Themes to work on: FIX first, then WATCH, worst avg★ first — up to 3.
function pickPriorityThemes(themeTable: ThemeTableRow[]): ThemeTableRow[] {
  const rank = (r: string) => (r === 'FIX' ? 0 : r === 'WATCH' ? 1 : 2)
  return [...themeTable]
    .filter((t) => t.read === 'FIX' || t.read === 'WATCH')
    .sort((a, b) => rank(a.read) - rank(b.read) || a.avgStar - b.avgStar)
    .slice(0, 3)
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]+/g, '').replace(/\s+/g, ' ').trim()

// Guard against fabricated / altered verbatims. We match the model's returned
// quote to a real candidate by NORMALIZED substring (tolerating trimming), but
// then ALWAYS display the real candidate's exact text — never the model's own
// version. norm() strips case + punctuation, so the model could "pass" this
// check while having silently re-punctuated, fixed a typo, or stitched two
// fragments; showing its text then prints a quote no reviewer actually wrote,
// which reads as fabricated. Candidates are exact review substrings
// (extractSentence), so rendering match.raw guarantees a verbatim quote.
export function validateVerbatims(returned: PlanVerbatim[] | undefined, theme: string, candidates: Map<string, string>): PlanVerbatim[] {
  const pool = [...candidates.values()].map((q) => ({ raw: q, n: norm(q) }))
  const out: PlanVerbatim[] = []
  const seen = new Set<string>()
  for (const v of returned || []) {
    const nq = norm(v?.quote || '')
    if (!nq) continue
    const match = pool.find((p) => p.n.includes(nq) || nq.includes(p.n))
    if (match && !seen.has(match.raw)) {
      seen.add(match.raw)
      out.push({ rating: Math.min(3, Math.max(1, Math.round(v.rating) || 2)), quote: match.raw })
    }
  }
  if (!out.length && candidates.has(theme)) out.push({ rating: 2, quote: candidates.get(theme)! })
  return out.slice(0, 2)
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
}

// Cap a string without cutting mid-word: trim back to the last sentence end (or
// word boundary) before `max`. Avoids "…plant-bas" truncation artifacts.
function clampSentence(s: string, max: number): string {
  const t = s.trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  if (lastStop > max * 0.6) return cut.slice(0, lastStop + 1)
  return cut.replace(/\s+\S*$/, '') + '…'
}

// Deterministic fallback plan when the LLM is unavailable / returns junk — still
// useful (real themes, real quotes), just without the narrated operator playbook.
function fallbackPlan(input: ActionPlanInput, generatedAt: string): ActionPlan {
  const themes = pickPriorityThemes(input.themeTable)
  const qmap = new Map(input.lowQuotes.map((q) => [q.theme, q.quote]))
  return {
    priorities: themes.map((t, i) => ({
      tag: i === 0 ? 'BIGGEST LEVER' : 'PRIORITY',
      title: t.theme,
      theme: t.theme,
      diagnosis: `${t.theme} scores ${t.avgStar.toFixed(2)}★ with ${Math.round(t.pctNegative * 100)}% of its ${t.mentions} mentions rated at or below 3★ — the store's ${i === 0 ? 'lowest-scoring' : 'weakest'} theme${t.read === 'FIX' ? ' and the clearest fix' : ''}.`,
      verbatims: qmap.has(t.theme) ? [{ rating: 2, quote: qmap.get(t.theme)! }] : [],
      actions: [],
    })),
    keepDoing: input.recent && input.recent.direction === 'up'
      ? `The last ${input.recent.count.toLocaleString()} reviews average ${input.recent.avg.toFixed(2)}★ — this location is climbing. Keep replying to the 1–2★ reviews, where a good reply wins the room back.`
      : `Keep replying to the 1–2★ reviews, where a good reply wins the room back.`,
    generatedAt,
  }
}

export async function generateActionPlan(input: ActionPlanInput): Promise<ActionPlan> {
  const generatedAt = new Date().toISOString()
  const themes = pickPriorityThemes(input.themeTable)
  if (!themes.length) {
    // Nothing scoring FIX/WATCH — a strong store. Keep-doing-only plan (no LLM).
    return fallbackPlan(input, generatedAt)
  }
  const qmap = new Map(input.lowQuotes.map((q) => [q.theme, q.quote]))

  const tableLines = input.themeTable
    .map((t) => `- ${t.theme}: ${t.mentions} mentions, ${t.avgStar.toFixed(2)}★, ${Math.round(t.pctNegative * 100)}% negative → ${t.read}`)
    .join('\n')
  const targetLines = themes
    .map((t, i) => {
      const q = qmap.get(t.theme)
      return `PRIORITY ${i + 1} — ${t.theme} (${t.avgStar.toFixed(2)}★, ${Math.round(t.pctNegative * 100)}% negative, ${t.mentions} mentions)${q ? `\n   candidate quote: "${q}"` : ''}`
    })
    .join('\n')

  // This report is always scoped to ONE location, and the underlying brand /
  // outlet names can be messy or demo-grade (e.g. "Flemings Reviews · demo
  // Fleming's Prime Steakhouse & Wine Bar"), so naming them produces garbled
  // prose. Refer to it generically as "your location" — unambiguous here and
  // never wrong (owner call 2026-08-07). Don't feed the raw names to the model.
  const system = `You are an operations consultant writing a one-page action plan for the general manager of a single restaurant location, drawn entirely from that location's own Google reviews. Be concrete and operational, never generic. Always refer to the location in the second person as "your location" — never state or guess a brand or store name. Return ONLY raw JSON — no markdown, no backticks. Start with { and end with }.`

  const user = `Location: your location (a single restaurant; do not name a brand or store).
${input.reviews.toLocaleString()} reviews, ${input.rating.toFixed(2)}★ overall${input.recent ? `; last ${input.recent.count} reviews ${input.recent.avg.toFixed(2)}★ (${input.recent.direction})` : ''}; owner-response rate ${Math.round(input.ownerResponseRate * 100)}%.

How every theme scores at this location:
${tableLines}

Write "3 things to work on next", one per priority below (worst first). Each priority MUST address exactly its named theme:
${targetLines}

For EACH priority produce:
- "tag": a 2–3 word kicker (e.g. "BIGGEST LEVER", "PROTECT OFF-PREMISE", "REFRAME, DON'T DISCOUNT").
- "title": an imperative headline (e.g. "Get every order right at the pass").
- "theme": the exact theme name.
- "diagnosis": 1–2 sentences explaining the problem. NAME THE THEME explicitly in the first sentence (e.g. "Order accuracy is the store's lowest-scoring theme…" or "Pricing & value drives…") so the reader knows which theme this priority is about, then ground it in the theme's avg★/%-negative and what guests actually say. Distinguish execution errors from skill/recipe issues where relevant. Write as if you read the reviews yourself — never refer to "the candidate quote", "the data", or "the numbers above" as meta-references.
- "verbatims": 1–2 short guest quotes. Copy the candidate quote(s) provided for that priority EXACTLY — same words, spelling, and punctuation. Do NOT trim, fix, reword, or stitch fragments; the quote must be reproducible verbatim from a real review. If no candidate is provided, use an empty array.
- "actions": 2–4 concrete, specific operator actions a manager can implement this week, each ONE sentence under 30 words (e.g. "Bag-check rule: nothing leaves the pass without one person reading the ticket against the bag"). No vague advice like "improve quality".

Then "keepDoing": a 1–2 sentence paragraph on what's already working — cite the recent trend and owner-response rate if they're strong, and name the store's top strengths. Keep it encouraging.

Return JSON exactly: {"priorities":[{"tag","title","theme","diagnosis","verbatims":[{"rating","quote"}],"actions":[]}],"keepDoing":"..."}`

  let raw = ''
  try {
    const res = await callAI({
      tier: 'advanced',
      maxTokens: 1800,
      timeoutMs: 45000,
      system,
      messages: [{ role: 'user', content: user }],
      usage: { org_id: input.orgId, resource_type: 'dataset', event_type: 'outlet_action_plan' },
    })
    raw = res.text || ''
  } catch (e) {
    void logError('outletActionPlan.callAI', e)
    return fallbackPlan(input, generatedAt)
  }

  let parsed: { priorities?: PlanPriority[]; keepDoing?: string }
  try {
    parsed = JSON.parse(stripFences(raw))
  } catch (e) {
    void logError('outletActionPlan.parse', e)
    return fallbackPlan(input, generatedAt)
  }

  const priorities: PlanPriority[] = (parsed.priorities || []).slice(0, 3).map((p, i) => {
    const theme = themes[i]?.theme || p.theme || ''
    return {
      tag: String(p.tag || (i === 0 ? 'BIGGEST LEVER' : 'PRIORITY')).slice(0, 40),
      title: String(p.title || theme).slice(0, 120),
      theme,
      diagnosis: clampSentence(String(p.diagnosis || ''), 600),
      verbatims: validateVerbatims(p.verbatims, theme, qmap),
      actions: (Array.isArray(p.actions) ? p.actions : []).map((a) => clampSentence(String(a), 400)).filter(Boolean).slice(0, 4),
    }
  }).filter((p) => p.theme && p.diagnosis)

  if (!priorities.length) return fallbackPlan(input, generatedAt)

  const keepDoing = clampSentence(String(parsed.keepDoing || ''), 800) || fallbackPlan(input, generatedAt).keepDoing
  return { priorities, keepDoing, generatedAt }
}
