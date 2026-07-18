// lib/helpAgent.ts
// Shared constants + prompt composition for the in-product Help assistant
// ("Guide", the 🛟 widget). See docs/HELP_AGENT.md.
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
 *  persona "Guide", icon 🛟). */
export const HELP_AGENT_NAME = 'Guide'

/** Source-type tag stamped on every help-KB chunk, so a re-seed can wipe and
 *  re-ingest cleanly without touching anything else. */
export const HELP_KB_SOURCE_TYPE = 'help-kb'

/** The grounding system prompt — the #1 anti-hallucination defense (HELP_AGENT
 *  §7). Strict: describe only features present in the retrieved help content;
 *  never invent; redirect data questions to Ask Ana; fall back honestly. Seeded
 *  into the agent's system_prompt. */
export const HELP_SYSTEM_PROMPT = `You are Guide, the in-product help assistant for Sentimetrx — a conversational survey and feedback-intelligence platform. Users reach you from the lifesaver (🛟) "Help" button at the top of any page.

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

TONE
- Warm, calm, and to the point. You're a helpful guide, not a salesperson. Don't oversell; don't pad. A good answer is a couple of tight steps or a clear one-paragraph explanation.`

export interface HelpPageContext {
  /** Pathname of the page the user is on, e.g. "/analyze/abc/statistics". */
  route?: string | null
  /** TopNav's currentPage token, e.g. "analytics" | "bots" | "campaigns". */
  currentPage?: string | null
  /** The org's enabled feature flags, so Guide doesn't recommend a disabled tool. */
  features?: Record<string, boolean> | null
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
