// lib/helpAgent.ts
// Shared constants + prompt composition for the in-product Help assistant
// ("Sherpa", the 🧭 widget). See docs/HELP_AGENT.md.
//
// The Help assistant is ONE platform-owned agent (a single `agents` row in the
// internal/admin org) running on the existing chatCore engine, standard tier,
// grounded ONLY in the curated help articles under docs/help-kb/. It answers
// how-to / navigation questions about Sentimetrx itself — never the user's data
// (that's Ask Ana). The seed script writes HELP_SYSTEM_PROMPT into the agent
// record; the /api/help/chat route layers per-request page context on top.

/** Globally-unique slug that identifies the single platform Help agent row.
 *  The route resolves the agent by this slug (status-agnostic); the seed script
 *  upserts it. Kept out of the public /b/[slug] surface by a non-'active'
 *  status. */
export const HELP_AGENT_SLUG = 'help-guide'

/** The assistant's persona name (owner decision 2026-07-16: label "Help",
 *  persona "Sherpa", icon 🧭). */
export const HELP_AGENT_NAME = 'Sherpa'

/** Source-type tag stamped on every help-KB chunk, so a re-seed can wipe and
 *  re-ingest cleanly without touching anything else. */
export const HELP_KB_SOURCE_TYPE = 'help-kb'

/** Curated in-app navigation map — the ONLY destinations Sherpa may deep-link
 *  to. Each is a top-level section landing (no per-item ids). The route layer
 *  injects this into the prompt; the scrub strips any link outside it. Keep the
 *  paths in sync with the real nav in components/nav/TopNav.tsx. */
export const HELP_NAV_MAP: Array<{ path: string; label: string; feature?: string }> = [
  { path: '/dashboard',     label: 'Home & Surveys' },
  { path: '/analyze',       label: 'Advanced Analytics (TextMine, Statistics, Search, Ask Ana)', feature: 'analyze' },
  { path: '/bots',          label: 'Agents', feature: 'bots' },
  { path: '/campaigns',     label: 'Campaigns (email / SMS)', feature: 'campaigns' },
  { path: '/pulseiq',       label: 'PulseIQ (live pulse)', feature: 'townhall' },
  { path: '/recordings',    label: 'Town Hall (recorded meetings)', feature: 'recordings' },
  { path: '/social',        label: 'Social', feature: 'social' },
  { path: '/favorites',     label: 'Favorites' },
  { path: '/settings/team', label: 'Team & invites' },
  { path: '/admin/hub',     label: 'Settings & Admin' },
]

/** Path prefixes the scrub treats as valid in-app links (the map paths; a
 *  deeper path under one, like /analyze/<id>, is allowed too). */
const ALLOWED_NAV_PREFIXES = HELP_NAV_MAP.map((n) => n.path)

function isAllowedInAppPath(path: string): boolean {
  const clean = path.split(/[?#]/)[0]
  return ALLOWED_NAV_PREFIXES.some((p) => clean === p || clean.startsWith(p + '/'))
}

const NAV_BLOCK = HELP_NAV_MAP.map((n) => '- ' + n.label + ': ' + n.path).join('\n')

/** The grounding system prompt — the #1 anti-hallucination defense (HELP_AGENT
 *  §7). Strict: describe only features present in the retrieved help content;
 *  never invent; redirect data questions to Ask Ana; fall back honestly. Seeded
 *  into the agent's system_prompt. */
export const HELP_SYSTEM_PROMPT = `You are Sherpa, the in-product help assistant for Sentimetrx — a conversational survey and feedback-intelligence platform. Users reach you from the compass (🧭) "Help" button in the bottom-right corner of any page.

YOUR JOB
- Help people USE Sentimetrx: how to do things, where to click, what a feature is, which tool fits their goal.
- Be concise, friendly, and practical. Prefer short, scannable steps. Refer to features by their on-screen labels (e.g. "the Schema tab", "Advanced Analytics", "TextMine", "Ask Ana").

STRICT GROUNDING — this is your most important rule
- Answer ONLY from the help knowledge provided to you. If the knowledge doesn't cover something, DO NOT guess.
- NEVER invent a feature, menu, button, tab, setting, price, plan, statistic, URL, or email address. If you cannot confirm something exists from the help knowledge, say you're not certain rather than describing it as real.
- If you're unsure, say so plainly, point the person to the closest real area you DO know, and suggest they contact their account team for anything you can't confirm. It is always better to admit uncertainty than to fabricate.

STAY IN YOUR LANE
- You answer HOW TO USE the product. You do NOT answer questions about what the user's DATA says ("what did respondents say about parking?", "summarize my results") — that is Ask Ana's job, which lives inside a dataset in Advanced Analytics.
- When someone asks a data question, briefly say that's what Ask Ana is for and point them to open a dataset and use Ask Ana.

LINKING — take them there when you can
- When your answer points to a place in Sentimetrx, add an in-app link so the user can jump straight there. The Help chat stays open and travels with them, so following a link doesn't lose your conversation.
- Use ONLY the destinations in the NAVIGATION MAP below, written as a markdown link with the EXACT path — e.g. "Open [Advanced Analytics](/analyze) and pick your dataset." Only link to a destination whose feature is enabled for this organization (see CURRENT CONTEXT if provided). NEVER invent a path, guess an id, or link to anything not in the map. If the right destination isn't in the map, describe where to click instead of linking.

NAVIGATION MAP (the only linkable destinations):
${NAV_BLOCK}

TONE
- Warm, calm, and to the point. You're a helpful guide, not a salesperson. Don't oversell; don't pad. A good answer is a couple of tight steps or a clear one-paragraph explanation.`

export interface HelpPageContext {
  /** Pathname of the page the user is on, e.g. "/analyze/abc/statistics". */
  route?: string | null
  /** TopNav's currentPage token, e.g. "analytics" | "bots" | "campaigns". */
  currentPage?: string | null
  /** The org's enabled feature flags, so Sherpa doesn't recommend a disabled tool. */
  features?: Record<string, boolean> | null
}

// ── Feature-integrity scrub (HELP_AGENT §7.4) ─────────────────────────────
// Post-generation defense-in-depth on top of the system-prompt grounding. The
// concrete, detectable fabrication class for a help agent is invented links and
// support emails (the Spacy incident, reference_agent_kb_link_hallucination):
// Sherpa should never send the user to a URL or email it made up. We allow only
// the official Sentimetrx / Datanautix domains; anything else is stripped, and
// invented emails are softened to "your account team".

const OFFICIAL_HOSTS = ['sentimetrx.ai', 'datanautix.com']

function isOfficialHost(host: string): boolean {
  const h = host.toLowerCase()
  return OFFICIAL_HOSTS.some((o) => h === o || h.endsWith('.' + o))
}

/** Strip fabricated links/emails from a Help reply. Returns the cleaned text
 *  plus whether anything was removed (for logging). Pure + unit-tested. */
export function scrubHelpReply(reply: string): { text: string; flagged: boolean } {
  if (!reply) return { text: reply, flagged: false }
  let flagged = false

  // 1. Markdown links [label](url) → keep just the label when the host isn't official.
  let out = reply.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, (m, label: string, url: string) => {
    try { if (isOfficialHost(new URL(url).hostname)) return m } catch { /* fall through */ }
    flagged = true
    return label
  })

  // 1b. In-app links [label](/path) → keep only when the path is in the nav map
  // allow-list (blocks invented routes / guessed ids); otherwise drop to label.
  out = out.replace(/\[([^\]]+)\]\((\/[^)\s]*)\)/g, (_m, label: string, path: string) => {
    if (isAllowedInAppPath(path)) return '[' + label + '](' + path + ')'
    flagged = true
    return label
  })

  // 2. Bare URLs to non-official hosts → remove.
  out = out.replace(/https?:\/\/[^\s)]+/g, (url) => {
    try { if (isOfficialHost(new URL(url).hostname)) return url } catch { /* invalid → drop */ }
    flagged = true
    return ''
  })

  // 3. Email addresses → soften to "your account team" (the KB never gives emails).
  out = out.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, () => {
    flagged = true
    return 'your account team'
  })

  // Tidy artifacts a strip can leave: doubled spaces, space-before-punct, empty parens.
  out = out.replace(/\(\s*\)/g, '').replace(/[ \t]{2,}/g, ' ').replace(/[ \t]+([.,;:!?])/g, '$1').trim()
  return { text: out, flagged }
}

/** Compose the per-request page-context block appended to the Help agent's
 *  system prompt. Returns '' when there's nothing useful to add. */
export function formatHelpPageContext(ctx: HelpPageContext | null | undefined): string {
  if (!ctx) return ''
  const lines: string[] = []
  if (ctx.currentPage) lines.push('- Current section: ' + ctx.currentPage)
  if (ctx.route) lines.push('- Current page: ' + ctx.route)
  const enabled = ctx.features
    ? Object.entries(ctx.features).filter(([, v]) => v === true).map(([k]) => k)
    : []
  if (enabled.length) lines.push('- Features enabled for this organization: ' + enabled.join(', '))
  if (lines.length === 0) return ''
  return '\n\nCURRENT CONTEXT (use it to make your answer relevant to where the user is; do NOT describe features their organization does not have):\n' + lines.join('\n')
}
