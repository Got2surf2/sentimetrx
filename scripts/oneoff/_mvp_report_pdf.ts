/* eslint-disable */
// Throwaway: generates a branded summary-report PDF over the 28 MVP+ verbatim
// comments (scratchpad/mvp_corpus.json) → ~/Downloads. Ana ('advanced') writes
// structured JSON grounded ONLY in the comments; every quote is verified to
// appear verbatim in the corpus before rendering. Not committed.
//
// Run: node --conditions=react-server --import tsx scripts/_mvp_report_pdf.ts

import { readFileSync, writeFileSync } from 'fs'
import path from 'path'
import { homedir } from 'os'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}

import { callAI } from '../../lib/ai'
import { htmlToPdfBuffer, brandedPdfChrome } from '../../lib/htmlToPdf'

const CORPUS_PATH = '/private/tmp/claude-501/-Users-sanjaypatel-Developer-GitHub-sentimetrx/ea99aac0-8f2f-4776-870a-6723db8abb48/scratchpad/mvp_corpus.json'

function esc(s: string) { return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
function norm(s: string) { return String(s ?? '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim() }

async function main() {
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf-8')) as { comments: any[] }
  const comments = corpus.comments
  const corpusNorm = comments.map(c => norm(c.comment))

  const numbered = comments.map((c, i) =>
    `${i + 1}. [${c.source}; ${c.author}; platform=${c.platform || 'n/a'}; region=${c.region || 'n/a'}; game=${c.game}] ${c.comment}`
  ).join('\n')

  const system = 'You are a senior consumer-insights consultant writing a concise, executive-grade listening summary. Return ONLY raw JSON — no markdown, no backticks. Start with { and end with }. Ground EVERY statement strictly in the provided comments. Every quote MUST be copied verbatim (word-for-word) from a provided comment — never paraphrase a quote, never invent one. Be honest and neutral; do not overclaim from a small sample.'

  const user =
`Below are ${comments.length} real public comments about EA SPORTS MVP+ Membership, scraped from EA's official forums and MUT.GG (a vocal-minority public sample — NOT a representative member survey).

COMMENTS:
${numbered}

Write a summary report as JSON with this exact shape:
{
  "exec_summary": "3-4 sentence executive summary of what this public chatter reveals.",
  "sentiment": {"negative": <int>, "neutral": <int>, "positive": <int>},  // counts across the ${comments.length} comments, must sum to ${comments.length}
  "themes": [
    {"name":"Theme name","sentiment":"negative|neutral|positive","summary":"1-2 sentences.","approx_share":"e.g. '~40% of comments'","quotes":[{"text":"VERBATIM quote from a comment","author":"the author"}]}
  ],  // 5-6 themes, ordered by prevalence; 1-2 verbatim quotes each
  "segments": [{"label":"e.g. PC players","finding":"1 sentence on what this segment says"}],  // 3-4 segment cuts (PC, international/region, Franchise/mode, confused/new buyers)
  "confusion_finding": "1-2 sentences on how well players understand what MVP+ is (bundle vs subscription, renewal, what they keep).",
  "implications": ["3-5 short forward-looking implications for growing MVP+ value — framed as questions/levers to test with real members, not conclusions."]
}`

  console.log('Calling Ana (advanced)...')
  const res = await callAI({ tier: 'advanced', maxTokens: 4000, timeoutMs: 110000, system, messages: [{ role: 'user', content: user }] })
  const clean = res.text.replace(/^```json\s*/i, '').replace(/```\s*$/g, '').trim()
  const r = JSON.parse(clean)

  // Verify every quote appears verbatim in the corpus
  let bad = 0
  for (const th of r.themes || []) {
    for (const q of th.quotes || []) {
      const qn = norm(q.text)
      const found = corpusNorm.some(cn => cn.includes(qn) && qn.length > 8)
      if (!found) { console.warn('  ⚠ quote not found verbatim:', q.text.slice(0, 60)); bad++ }
    }
  }
  console.log(bad === 0 ? 'All quotes verified verbatim ✓' : `${bad} quote(s) failed verification — review before use`)

  // Render HTML
  const sentTotal = (r.sentiment?.negative || 0) + (r.sentiment?.neutral || 0) + (r.sentiment?.positive || 0)
  const pct = (n: number) => sentTotal ? Math.round((n / sentTotal) * 100) : 0
  const themeColor = (s: string) => s === 'positive' ? '#059669' : s === 'neutral' ? '#D97706' : '#DC2626'

  const themesHtml = (r.themes || []).map((t: any) => `
    <div class="keep theme">
      <h3>${esc(t.name)} <span class="pill" style="background:${themeColor(t.sentiment)}">${esc(t.sentiment)}</span> <span class="share">${esc(t.approx_share || '')}</span></h3>
      <p>${esc(t.summary)}</p>
      ${(t.quotes || []).map((q: any) => `<blockquote>“${esc(q.text)}”<cite>— ${esc(q.author)}</cite></blockquote>`).join('')}
    </div>`).join('')

  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box} body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e2a33;font-size:11.5px;line-height:1.5;margin:0}
    .wrap{max-width:760px;margin:0 auto}
    h1{font-size:21px;color:#0D2B45;margin:0 0 2px} .sub{color:#5b6b76;font-size:11px;margin:0 0 4px}
    .note{background:#FEF3C7;border-left:3px solid #D97706;padding:7px 11px;font-size:10.5px;color:#5b4a16;margin:10px 0}
    h2{font-size:12.5px;color:#0F7173;text-transform:uppercase;letter-spacing:.04em;margin:16px 0 6px;border-bottom:1.5px solid #D4DDE2;padding-bottom:3px}
    h3{font-size:13px;color:#0D2B45;margin:12px 0 3px} .keep{break-inside:avoid}
    p{margin:4px 0} ul{margin:4px 0;padding-left:18px} li{margin:3px 0}
    .pill{color:#fff;font-size:8.5px;font-weight:700;padding:1px 6px;border-radius:8px;text-transform:uppercase;vertical-align:middle}
    .share{color:#8FA3AE;font-size:10px;font-weight:400}
    blockquote{margin:5px 0 5px 0;padding:5px 11px;background:#F4F7F8;border-left:3px solid #00B4D8;color:#0D2B45;font-style:italic;font-size:11px}
    cite{display:block;font-style:normal;color:#5b6b76;font-size:9.5px;margin-top:2px}
    .sent{display:flex;gap:8px;margin:6px 0} .sbar{flex:1;text-align:center;padding:8px 4px;border-radius:6px;color:#fff}
    .exec{background:#0D2B45;color:#fff;padding:11px 14px;border-radius:6px;margin:8px 0} .exec p{margin:0}
  </style></head><body><div class="wrap">
    <h1>EA SPORTS MVP+ Membership — Public Listening Summary</h1>
    <p class="sub">Prepared for EA by Datanautix · ${comments.length} verbatim comments · EA official forums + MUT.GG · collected June 2026</p>
    <div class="note"><b>Illustrative sample.</b> This is vocal-minority public chatter (people who post on forums skew dissatisfied) — directional, <b>not</b> a representative member survey. Reddit and in-game audiences are not included. Theme mix reflects which threads were publicly accessible.</div>

    <h2>Executive summary</h2>
    <div class="exec"><p>${esc(r.exec_summary)}</p></div>

    <h2>Sentiment of the sample (n=${comments.length})</h2>
    <div class="sent">
      <div class="sbar" style="background:#DC2626">Negative<br><b>${r.sentiment?.negative || 0}</b> · ${pct(r.sentiment?.negative || 0)}%</div>
      <div class="sbar" style="background:#D97706">Neutral<br><b>${r.sentiment?.neutral || 0}</b> · ${pct(r.sentiment?.neutral || 0)}%</div>
      <div class="sbar" style="background:#059669">Positive<br><b>${r.sentiment?.positive || 0}</b> · ${pct(r.sentiment?.positive || 0)}%</div>
    </div>

    <h2>What they're talking about</h2>
    ${themesHtml}

    <h2>Who's saying what</h2>
    <ul>${(r.segments || []).map((s: any) => `<li><b>${esc(s.label)}:</b> ${esc(s.finding)}</li>`).join('')}</ul>

    <h2>Do they understand what they bought?</h2>
    <p>${esc(r.confusion_finding)}</p>

    <h2>Implications — levers to test with real members</h2>
    <ul>${(r.implications || []).map((i: string) => `<li>${esc(i)}</li>`).join('')}</ul>
  </div></body></html>`

  const chrome = brandedPdfChrome({ brand: 'MVP+ Listening Summary — for EA', confidentiality: 'Illustrative public-data sample · Prepared for EA · Confidential' })
  const pdf = await htmlToPdfBuffer(html, { format: 'letter', headerTemplate: chrome.headerTemplate, footerTemplate: chrome.footerTemplate, margin: chrome.margin })
  const out = path.join(homedir(), 'Downloads', 'MVP+-Listening-Summary.pdf')
  writeFileSync(out, pdf)
  console.log('WROTE', out, pdf.length, 'bytes')
}

main().catch(e => { console.error(e); process.exit(1) })
