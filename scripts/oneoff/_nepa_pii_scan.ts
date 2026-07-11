/* eslint-disable */
// NEPA — PII-DETECTION demo pass over the Blue Mountains comment corpus. Shows the
// capability that would triage the Forest Service's "held pending PII review"
// backlog: a deterministic regex pass (email / phone / street address) plus an LLM
// pass for contextual PII (third-party names, specific home locations, family/
// health details). Reports a reviewer-approval queue — how many comments a human
// would need to look at, and what type. NEVER prints raw PII: every example is
// shown redacted with [EMAIL]/[PHONE]/[ADDRESS]/[NAME]/[LOCATION] placeholders.
//
// Run: node --import tsx scripts/oneoff/_nepa_pii_scan.ts <corpus.json> <out.json>

import { readFileSync, writeFileSync } from 'node:fs'
for (const line of readFileSync('.env.local', 'utf-8').split('\n')) {
  const mm = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (mm && !process.env[mm[1]]) process.env[mm[1]] = mm[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}

type Comment = { letterid: string; first: string | null; last: string | null; comment: string }

// --- Deterministic structured-PII regexes (exact, no AI) ---
const RE = {
  email: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
  // Phone: require separators or parens so we don't match bare 10-digit numbers / board-feet.
  phone: /(?:\+?1[-.\s])?(?:\(\d{3}\)\s?|\d{3}[-.\s])\d{3}[-.\s]\d{4}\b/g,
  // Street address: number + 1-3 capitalized words + a street-type suffix.
  address: /\b\d{1,6}\s+(?:[A-Z][a-zA-Z]+\.?\s+){1,3}(?:Street|St|Avenue|Ave|Road|Rd|Drive|Dr|Lane|Ln|Court|Ct|Boulevard|Blvd|Way|Circle|Cir|Highway|Hwy|Route|Rte|Trail|Trl|Place|Pl|Terrace|Ter)\.?(?=\s|,|$)/g,
}
function regexHits(text: string) {
  const email = (text.match(RE.email) || []).length
  const phone = (text.match(RE.phone) || []).length
  const address = (text.match(RE.address) || []).length
  return { email, phone, address }
}

// --- LLM pass for contextual PII the regexes can't catch ---
const SYS = `You are a PII-redaction screener for public NEPA comments that a government reviewer must clear before release. The commenter's OWN name and their stated town/state are public record — do NOT flag those. Flag only PII a reviewer would redact:
- third-party personal names (a spouse, child, neighbor, employee named in the text)
- a specific home/street location or property description that could identify a private residence
- personal contact details in the body (email, phone) — count if present
- sensitive personal details (health, financial, legal specifics about an identifiable person)

For each numbered comment return JSON: {"pii": boolean, "types": string[] (subset of "third_party_name","home_location","contact","sensitive"), "redacted": string} where "redacted" is a SHORT (<160 char) snippet of the flagged portion with the PII replaced by [NAME]/[LOCATION]/[CONTACT]/[SENSITIVE] — NEVER include the real PII. If none, {"pii":false,"types":[],"redacted":""}.
Return ONLY a JSON array, one object per numbered comment IN ORDER. No prose.`

async function llmBatch(texts: string[]): Promise<{ pii: boolean; types: string[]; redacted: string }[]> {
  const key = process.env.ANTHROPIC_API_KEY!
  const body = texts.map((t, i) => `#${i + 1}: ${t.replace(/\s+/g, ' ').slice(0, 1400)}`).join('\n\n')
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 3072, system: SYS, messages: [{ role: 'user', content: body }] }),
  })
  if (!res.ok) throw new Error('anthropic ' + res.status + ': ' + (await res.text()).slice(0, 160))
  const data = await res.json()
  let txt = (data.content?.[0]?.text || '').trim()
  const a = txt.indexOf('['), b = txt.lastIndexOf(']'); if (a >= 0 && b > a) txt = txt.slice(a, b + 1)
  return JSON.parse(txt).map((o: any) => ({ pii: !!o?.pii, types: Array.isArray(o?.types) ? o.types : [], redacted: String(o?.redacted || '').slice(0, 160) }))
}

async function main() {
  const corpus = JSON.parse(readFileSync(process.argv[2], 'utf-8')) as { comments: Comment[] }
  const comments = corpus.comments
  const out = process.argv[3]

  // Deterministic pass over ALL comments.
  let cEmail = 0, cPhone = 0, cAddr = 0, cStructAny = 0
  let nEmail = 0, nPhone = 0, nAddr = 0
  comments.forEach(c => {
    const h = regexHits(c.comment || '')
    if (h.email) { cEmail++; nEmail += h.email }
    if (h.phone) { cPhone++; nPhone += h.phone }
    if (h.address) { cAddr++; nAddr += h.address }
    if (h.email || h.phone || h.address) cStructAny++
  })

  // LLM contextual pass over ALL comments (batched).
  const ctx: { pii: boolean; types: string[]; redacted: string }[] = []
  const B = 10
  for (let i = 0; i < comments.length; i += B) {
    const batch = comments.slice(i, i + B).map(c => c.comment || '')
    try { ctx.push(...await llmBatch(batch)) }
    catch (e) { console.error(`  batch ${i} failed:`, (e as Error).message.slice(0, 100)); for (let k = 0; k < batch.length; k++) ctx.push({ pii: false, types: [], redacted: '' }) }
    if ((i + B) % 100 === 0 || i + B >= comments.length) console.log(`  …scanned ${Math.min(i + B, comments.length)}/${comments.length}`)
  }
  const ctxType: Record<string, number> = {}
  let cCtx = 0
  ctx.forEach(r => { if (r.pii) { cCtx++; for (const t of r.types) ctxType[t] = (ctxType[t] || 0) + 1 } })

  // Union: a comment is "flagged for reviewer approval" if regex OR llm found PII.
  let flagged = 0
  const examples: { type: string; redacted: string }[] = []
  comments.forEach((c, i) => {
    const h = regexHits(c.comment || '')
    const struct = h.email || h.phone || h.address
    const cx = ctx[i]?.pii
    if (struct || cx) flagged++
    if (examples.length < 6) {
      if (h.email) examples.push({ type: 'email', redacted: (c.comment || '').replace(RE.email, '[EMAIL]').replace(/\s+/g, ' ').slice(0, 150) })
      else if (cx && ctx[i].redacted) examples.push({ type: ctx[i].types[0] || 'contextual', redacted: ctx[i].redacted })
    }
  })

  const n = comments.length
  const pct = (x: number) => Math.round(x / n * 100)
  console.log(`\n════ PII SCAN — ${n} released comments ════`)
  console.log(`  structured (regex, exact):   email ${cEmail} comments (${nEmail} hits) · phone ${cPhone} (${nPhone}) · street address ${cAddr} (${nAddr})`)
  console.log(`  contextual (LLM):            ${cCtx} comments — ${Object.entries(ctxType).map(([k, v]) => `${k} ${v}`).join(' · ')}`)
  console.log(`  ── FLAGGED for reviewer approval: ${flagged} of ${n} (${pct(flagged)}%) ──`)
  console.log(`  clean (no reviewer needed):  ${n - flagged} (${pct(n - flagged)}%)`)

  writeFileSync(out, JSON.stringify({
    scanned: n, structured: { emailComments: cEmail, emailHits: nEmail, phoneComments: cPhone, phoneHits: nPhone, addressComments: cAddr, addressHits: nAddr, anyStructured: cStructAny },
    contextual: { comments: cCtx, byType: ctxType }, flagged, clean: n - flagged, pctFlagged: pct(flagged), examples,
  }, null, 2))
  console.log(`\n✔ wrote → ${out}`)
}
main().catch(e => { console.error(e); process.exit(1) })
