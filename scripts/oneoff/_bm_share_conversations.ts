/* eslint-disable */
// Mint public, shareable links for the real Blue Mountains demo conversations,
// so they can be sent to prospects. Reads the captured transcript file (real,
// verbatim agent output), renders each conversation as self-contained HTML, and
// inserts a `shared_links` row (type=conversation) on PROD → a public
// /shared/conversation/<token> URL. created_by left null; token auto-generated.
//
// Run: node --conditions=react-server --import tsx scripts/oneoff/_bm_share_conversations.ts <transcript.txt>

import { readFileSync } from 'fs'

for (const line of readFileSync('.env.local', 'utf-8').split('\n')) {
  const mm = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (mm && !process.env[mm[1]]) process.env[mm[1]] = mm[2].replace(/^["']|["']$/g, '')
}
import { createClient } from '@supabase/supabase-js'

const BOT_ID = '5845cdb8-f33e-4a2e-9500-5ed0b37e471c' // prod Blue Mountains agent
const ORG_ID = 'b72e9ee6-0466-459a-8440-988a8bd6d3c5' // Datanautix
const BASE = 'https://www.sentimetrx.ai'

type Turn = { role: 'user' | 'agent'; text: string }
type Convo = { label: string; turns: Turn[] }

function parseTranscript(raw: string): Convo[] {
  const convos: Convo[] = []
  let cur: Convo | null = null
  let role: 'user' | 'agent' | null = null
  let buf: string[] = []
  const flush = () => { if (cur && role && buf.length) { cur.turns.push({ role, text: buf.join('\n').trim() }); } buf = [] }
  const lines = raw.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]
    if (/^={10,}$/.test(ln)) {
      // the label is the line AFTER the first divider; a second divider closes the header
      const next = lines[i + 1] || ''
      if (next && !/^={10,}$/.test(next) && !/^(USER|AGENT):/.test(next)) {
        flush(); role = null
        cur = { label: next.replace(/\s*\(session[^)]*\)\s*$/, '').trim(), turns: [] }
        convos.push(cur)
        i++ // consume label line
      }
      continue
    }
    const um = ln.match(/^USER:\s?(.*)$/)
    const am = ln.match(/^AGENT:\s?(.*)$/)
    if (um) { flush(); role = 'user'; buf = [um[1]] }
    else if (am) { flush(); role = 'agent'; buf = [am[1]] }
    else if (role) buf.push(ln)
  }
  flush()
  return convos.filter(c => c.turns.length)
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function renderHtml(c: Convo): string {
  const bubbles = c.turns.map(t => {
    if (t.role === 'user') {
      return `<div style="display:flex;justify-content:flex-end;margin:14px 0;"><div style="max-width:78%;background:#2D6A4F;color:#fff;padding:11px 15px;border-radius:14px 14px 3px 14px;font-size:15px;line-height:1.5;">${esc(t.text)}</div></div>`
    }
    return `<div style="margin:14px 0;"><div style="font-size:11px;color:#7C8B84;font-weight:700;margin:0 0 4px 4px;">🌲 Plan Assistant</div><div style="max-width:82%;background:#F4F7F5;color:#1B2D26;padding:11px 15px;border-radius:14px 14px 14px 3px;font-size:15px;line-height:1.55;border:1px solid #E7EDE9;">${esc(t.text)}</div></div>`
  }).join('')
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#fff;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="max-width:720px;margin:0 auto;padding:24px 18px 40px;">
  <div style="border-bottom:2px solid #2D6A4F;padding-bottom:12px;margin-bottom:8px;">
    <div style="font-size:19px;font-weight:800;color:#1B4332;">Blue Mountains Plan Assistant</div>
    <div style="font-size:12px;color:#7C8B84;margin-top:2px;">Sample conversation · ${esc(c.label)} · USDA Forest Service Blue Mountains Forest Plan Revision</div>
  </div>
  ${bubbles}
  <div style="margin-top:26px;padding-top:12px;border-top:1px solid #E7EDE9;font-size:11px;color:#9aa5a0;">
    A real, unscripted exchange with the live demo agent. <span style="color:#0F7173;font-weight:700;">data</span><span style="color:#E8632A;font-weight:700;">nautix</span> · powered by the Sentimetrx platform.
  </div>
</div></body></html>`
}

async function main() {
  const file = process.argv[2]
  if (!file) { console.error('Usage: … _bm_share_conversations.ts <transcript.txt>'); process.exit(1) }
  const convos = parseTranscript(readFileSync(file, 'utf-8'))
  console.log(`parsed ${convos.length} conversations`)

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const expires = new Date(Date.now() + 550 * 24 * 3600 * 1000).toISOString() // ~18 months

  for (const c of convos) {
    const html = renderHtml(c)
    const { data, error } = await db.from('shared_links')
      .insert({ type: 'conversation', target_id: BOT_ID, org_id: ORG_ID, expires_at: expires, metadata: { html, label: c.label, source: 'bm_demo_2026_07' } })
      .select('token').single()
    if (error) { console.error(`  ✗ ${c.label}:`, error.message); continue }
    console.log(`  ✓ ${c.label.padEnd(34)} ${BASE}/shared/conversation/${data.token}`)
  }
}

main().catch(e => { console.error(e); process.exit(1) })
