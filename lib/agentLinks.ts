// lib/agentLinks.ts
// D4 (AGENT_TIERS §2) — build-time link-integrity scaffolding for
// website-sourced agents. A crawl gives us the set of real, fetched page
// URLs; we turn those into an "Official Links Directory" injected into the
// agent's system_prompt plus a standing link-integrity guardrail, so the
// model can only ever surface URLs it has been handed — never invent a
// domain or a path (the July 2026 Spacy incident). Both are idempotent:
// re-crawling replaces the directory block and never duplicates the rule.

export interface OfficialLink {
  label: string
  url: string
}

// Stable header — also the idempotency marker. A re-crawl replaces the block
// bounded by this header and END_MARKER rather than stacking a second copy.
export const LINKS_DIRECTORY_HEADER = 'OFFICIAL LINKS DIRECTORY'
const END_MARKER = '--- END OFFICIAL LINKS DIRECTORY ---'
const MAX_DIRECTORY_LINKS = 200

// The standing link-integrity guardrail attached to every website-sourced
// agent. Host-agnostic generalization of the Spacy fix.
export const LINK_INTEGRITY_GUARDRAIL =
  'LINK INTEGRITY: Only share a website link if it appears in the OFFICIAL LINKS DIRECTORY in your instructions, or verbatim in your knowledge base. NEVER guess, construct, shorten, or modify a URL, and never turn a menu label into a URL. If someone needs something that has no page in the directory, give them a phone number or email from your knowledge base, or say you do not have a link for that — do not fabricate one.'

/** Dedup + cap official links, dropping entries without a usable http(s) URL. */
export function normalizeOfficialLinks(links: OfficialLink[]): OfficialLink[] {
  const seen = new Set<string>()
  const out: OfficialLink[] = []
  for (const l of links) {
    const url = (l?.url || '').trim()
    if (!/^https?:\/\//i.test(url)) continue
    if (seen.has(url)) continue
    seen.add(url)
    const label = (l.label || '').replace(/\s+/g, ' ').trim() || url
    out.push({ label, url })
    if (out.length >= MAX_DIRECTORY_LINKS) break
  }
  return out
}

/**
 * Build the Official Links Directory block (with header + end marker) for
 * injection into a system prompt. Returns '' when there are no usable links.
 */
export function buildLinksDirectory(links: OfficialLink[]): string {
  const norm = normalizeOfficialLinks(links)
  if (norm.length === 0) return ''
  const lines = norm.map((l) => `- ${l.label}: ${l.url}`)
  return (
    LINKS_DIRECTORY_HEADER +
    '\nThese are the ONLY official URLs. Use them verbatim; never invent or modify a URL.\n' +
    lines.join('\n') +
    '\n' +
    END_MARKER
  )
}

/** True if the text already carries a Links Directory block. */
export function hasLinksDirectory(text: string | null | undefined): boolean {
  return !!text && text.includes(LINKS_DIRECTORY_HEADER)
}

/**
 * Merge a fresh Links Directory into a system prompt idempotently: replaces
 * any existing directory block (header…end marker) with the new one, or
 * appends it when absent. Returns the prompt unchanged when there are no links.
 */
export function attachLinksDirectory(systemPrompt: string, links: OfficialLink[]): string {
  const block = buildLinksDirectory(links)
  if (!block) return systemPrompt
  const base = (systemPrompt || '').trim()
  // Strip a prior directory block (header through end marker, inclusive).
  const stripped = base
    .replace(new RegExp('\\n*' + LINKS_DIRECTORY_HEADER + '[\\s\\S]*?' + END_MARKER.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'), 'g'), '')
    .trim()
  return (stripped ? stripped + '\n\n' : '') + block
}

/** True if the guardrail list already contains the link-integrity rule. */
export function hasLinkIntegrityGuardrail(guardrails: string[]): boolean {
  return guardrails.some((g) => g.includes('LINK INTEGRITY:'))
}

/** Add the link-integrity guardrail unless one is already present. */
export function withLinkIntegrityGuardrail(guardrails: string[]): string[] {
  return hasLinkIntegrityGuardrail(guardrails) ? guardrails : [...guardrails, LINK_INTEGRITY_GUARDRAIL]
}
