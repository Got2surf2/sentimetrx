/* eslint-disable */
// NEPA Phase 3 — ANSWERABILITY TEST. Takes the distinct ANSWERABLE questions
// extracted from the live comment record (_nepa_questions.ts) and points the
// ALREADY-DEPLOYED prod Blue Mountains assistant at a subset of them, one clean
// independent turn each. NO session_id is passed, so nothing persists to the real
// "what people ask" feed (chatCore only records turns when a session_id is given).
// A stronger judge model then rates each answer: high / partial / no — i.e. did the
// assistant answer this comment-question with confident, specific, factual content,
// or did it deflect / hedge / only offer to capture the concern. The % answered at
// HIGH confidence is the labor-reduction headline.
//
// Run: node --import tsx scripts/oneoff/_nepa_answerability.ts <questions.json> <out.json> [N]

import { readFileSync, writeFileSync } from 'node:fs'
for (const line of readFileSync('.env.local', 'utf-8').split('\n')) {
  const mm = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (mm && !process.env[mm[1]]) process.env[mm[1]] = mm[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}

const BASE = 'https://www.sentimetrx.ai'
const AGENT_ID = '5845cdb8-f33e-4a2e-9500-5ed0b37e471c' // prod Blue Mountains agent
const CHAT = `${BASE}/api/bots/${AGENT_ID}/chat`
const JUDGE_MODEL = 'claude-sonnet-5'

type DistinctQ = { text: string; type: string; count: number; distinctSources: number }
type Verdict = 'high' | 'partial' | 'no'

// One clean, independent turn against the live agent — no session_id → no persistence.
async function ask(question: string): Promise<string> {
  const res = await fetch(CHAT, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ messages: [{ role: 'user', content: question }] }),
  })
  if (!res.ok) throw new Error(`chat ${res.status}: ${(await res.text()).slice(0, 160)}`)
  const data = await res.json()
  return String(data.reply || '').replace(/\n*\[\[chips:[^\]]*\]\]\s*$/i, '').trim()
}

const JUDGE_SYS = `You are grading whether a public-comment assistant actually ANSWERED a member of the public's question about the USDA Forest Service Blue Mountains Forest Plan Revision. You are strict and skeptical.

Given a QUESTION (drawn verbatim-in-spirit from a real NEPA public comment) and the ASSISTANT'S ANSWER, return JSON:
- "verdict": one of
   - "high"    = the answer directly and specifically addresses the question with concrete, correct-looking facts (numbers, the alternative names, the actual rule, the real deadline). A knowledgeable Forest Service staffer would accept it as a usable first-draft response.
   - "partial" = touches the topic but is vague, hedged, incomplete, or gives context without actually answering the specific ask.
   - "no"      = does not answer: it deflects, says it cannot help, redirects to "submit a comment", ONLY offers to capture/note the concern, asks a clarifying question instead, or is off-topic.
- "reason": one short sentence (<20 words).

An answer that merely validates the concern and invites a comment WITHOUT supplying the requested facts is "no", not "partial". Return ONLY the JSON object.`

async function judge(question: string, answer: string): Promise<{ verdict: Verdict; reason: string }> {
  const key = process.env.ANTHROPIC_API_KEY!
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
    body: JSON.stringify({ model: JUDGE_MODEL, max_tokens: 300, system: JUDGE_SYS,
      messages: [{ role: 'user', content: `QUESTION:\n${question}\n\nASSISTANT'S ANSWER:\n${answer}` }] }),
  })
  if (!res.ok) throw new Error('judge ' + res.status + ': ' + (await res.text()).slice(0, 160))
  const data = await res.json()
  let txt = (data.content?.[0]?.text || '').trim()
  const a = txt.indexOf('{'), b = txt.lastIndexOf('}'); if (a >= 0 && b > a) txt = txt.slice(a, b + 1)
  const o = JSON.parse(txt)
  const v: Verdict = ['high', 'partial', 'no'].includes(o.verdict) ? o.verdict : 'no'
  return { verdict: v, reason: String(o.reason || '').trim() }
}

async function main() {
  const data = JSON.parse(readFileSync(process.argv[2], 'utf-8')) as { distinctQuestions: DistinctQ[] }
  const out = process.argv[3]
  const N = Number(process.argv[4] || 50)
  // Sample = the most-asked distinct answerable questions (highest labor concentration).
  const sample = data.distinctQuestions.slice(0, N)
  console.log(`[answerability] testing ${sample.length} of ${data.distinctQuestions.length} distinct answerable questions against the LIVE prod agent`)

  const results: { text: string; type: string; count: number; answer: string; verdict: Verdict; reason: string }[] = []
  for (let i = 0; i < sample.length; i++) {
    const q = sample[i]
    try {
      const answer = await ask(q.text)
      const { verdict, reason } = await judge(q.text, answer)
      results.push({ text: q.text, type: q.type, count: q.count, answer, verdict, reason })
      console.log(`  ${String(i + 1).padStart(2)}/${sample.length}  [${verdict.toUpperCase().padEnd(7)}] ×${String(q.count).padStart(3)}  ${q.text.slice(0, 72)}`)
    } catch (e) {
      console.error(`  ${i + 1} FAILED:`, (e as Error).message.slice(0, 140))
      results.push({ text: q.text, type: q.type, count: q.count, answer: '', verdict: 'no', reason: 'error' })
    }
  }

  const n = results.length
  const high = results.filter(r => r.verdict === 'high').length
  const partial = results.filter(r => r.verdict === 'partial').length
  const no = results.filter(r => r.verdict === 'no').length
  // Weight by frequency too: how much of the actual question VOLUME is high-confidence answerable.
  const totW = results.reduce((s, r) => s + r.count, 0)
  const highW = results.filter(r => r.verdict === 'high').reduce((s, r) => s + r.count, 0)
  const okW = results.filter(r => r.verdict !== 'no').reduce((s, r) => s + r.count, 0)

  console.log(`\n════ ANSWERABILITY ════`)
  console.log(`  tested:            ${n} distinct questions`)
  console.log(`  HIGH confidence:   ${high}  (${Math.round(high / n * 100)}%)`)
  console.log(`  partial:           ${partial}  (${Math.round(partial / n * 100)}%)`)
  console.log(`  not answered:      ${no}  (${Math.round(no / n * 100)}%)`)
  console.log(`  high + partial:    ${high + partial}  (${Math.round((high + partial) / n * 100)}%)`)
  console.log(`  by question VOLUME: high ${Math.round(highW / totW * 100)}% · high+partial ${Math.round(okW / totW * 100)}%`)

  writeFileSync(out, JSON.stringify({
    tested: n, high, partial, no,
    pctHigh: Math.round(high / n * 100), pctHighPartial: Math.round((high + partial) / n * 100),
    pctHighByVolume: Math.round(highW / totW * 100), pctHighPartialByVolume: Math.round(okW / totW * 100),
    results,
  }, null, 2))
  console.log(`\n✔ wrote → ${out}`)
}
main().catch(e => { console.error(e); process.exit(1) })
