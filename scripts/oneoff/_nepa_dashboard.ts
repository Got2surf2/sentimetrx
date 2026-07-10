/* eslint-disable */
// Generate the NEPA Comment-Intelligence dashboard as a self-contained HTML
// artifact (pure HTML/CSS — the shared-link iframe is sandboxed without scripts)
// from the real Blue Mountains analysis, and publish it via shared_links → a
// public /shared/conversation/<token> URL. No deploy, no build. Cadence-ready:
// pass --token <t> to re-publish the SAME link with fresh data each day.
//
// Run: node --import tsx scripts/oneoff/_nepa_dashboard.ts <corpus.json> <analysis.json> <coded.json> [--token <t>]

import { readFileSync } from 'node:fs'
for (const line of readFileSync('.env.local', 'utf-8').split('\n')) {
  const mm = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (mm && !process.env[mm[1]]) process.env[mm[1]] = mm[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}
import { createClient } from '@supabase/supabase-js'

const ORG_ID = 'b72e9ee6-0466-459a-8440-988a8bd6d3c5'
const BOT_ID = '5845cdb8-f33e-4a2e-9500-5ed0b37e471c'
const BASE = 'https://www.sentimetrx.ai'
const AS_OF = 'July 10, 2026'

const ISSUE_LABEL: Record<string, string> = {
  access_roads: 'Access & roads', recreation: 'Recreation', timber_logging: 'Timber / logging',
  wildlife: 'Wildlife', old_growth_large_trees: 'Old growth / 21-inch rule', process_standards: 'Enforceable standards',
  water_fish: 'Water & fish', fire_fuels: 'Fire & fuels', economics_jobs: 'Economics & jobs', grazing: 'Grazing',
  restoration_pace: 'Pace & scale', salvage: 'Salvage logging', tribal: 'Tribal treaty rights', other: 'Other',
}
const esc = (s: string) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function build(corpus: any, analysis: any, coded: any): string {
  const f = coded.funnel
  const C = { pine: '#1B4332', pineMid: '#2D6A4F', moss: '#52B788', mossDeep: '#40916C', teal: '#0F7173', orange: '#E8632A', ink: '#1B2D26', slate: '#7C8B84', card: '#F4F7F5', line: '#E7EDE9', amber: '#B45309', red: '#B91C1C' }

  // Funnel stages
  const stages = [
    { n: f.submitted, label: 'Comments submitted', sub: 'logged in CARA' },
    { n: f.available, label: 'Available & analyzed', sub: `${f.held} held pending PII review` },
    { n: f.distinct, label: 'Distinct voices', sub: `${f.available - f.distinct} duplicate copies removed (${Math.round((f.available - f.distinct) / f.available * 100)}%)` },
    { n: f.substantiveVoices, label: 'Substantive — must respond', sub: `${f.distinct - f.substantiveVoices} non-substantive` },
  ]
  const maxN = f.submitted
  const funnelHtml = stages.map(s => {
    const w = Math.round(s.n / maxN * 100)
    return `<div class="fstage"><div class="fbar" style="width:${w}%"><span class="fn">${s.n.toLocaleString()}</span><span class="fl">${s.label}</span></div><div class="fsub">${esc(s.sub)}</div></div>`
  }).join('')

  // Issues (sorted by voices)
  const issues = Object.entries(coded.issueVoices as Record<string, number>).sort((a, b) => b[1] - a[1]).slice(0, 10)
  const maxVol = Math.max(...issues.map(([k]) => coded.issueVolume[k] || 0))
  const issueHtml = issues.map(([k, v]) => {
    const vol = coded.issueVolume[k] || 0, sub = coded.issueSubstantive[k] || 0
    const volW = Math.round(vol / maxVol * 100), voxW = Math.round(v / maxVol * 100)
    return `<div class="irow"><div class="ilab">${esc(ISSUE_LABEL[k] || k)}</div><div class="itrack"><div class="ivol" style="width:${volW}%"></div><div class="ivox" style="width:${voxW}%"><span>${v}</span></div></div><div class="inum">${vol}<span class="imut"> total</span> · <b>${sub}</b> substantive</div></div>`
  }).join('')

  // Stance split
  const st = coded.stanceVoices, stTot = st.oppose + st.support + st.mixed + st.unclear
  const stanceSeg = [['oppose', st.oppose, C.orange], ['support', st.support, C.mossDeep], ['mixed', st.mixed, C.slate], ['unclear', st.unclear, C.line]]
    .map(([lab, n, c]: any) => `<div style="width:${(n / stTot * 100).toFixed(1)}%;background:${c}" title="${lab} ${n}"></div>`).join('')

  // Campaigns
  const camps = (analysis.campaigns || []).slice(0, 6)
  const campHtml = camps.map((c: any) => `<tr><td class="csz">×${c.size}</td><td class="csamp">${esc((c.sample || '').replace(/\s+/g, ' ').slice(0, 130))}…</td><td class="cper">${c.personalized || 0}</td></tr>`).join('')

  // Template-delta showcase
  const showcase = (analysis.campaigns || []).find((c: any) => (c.deltaExamples || []).some((d: any) => d.delta && d.delta.length > 60))
  // Prefer the meatiest personalizations (real added substance) over bare sign-offs.
  const deltaEx = showcase ? (showcase.deltaExamples || []).slice().sort((a: any, b: any) => (b.delta || '').length - (a.delta || '').length).slice(0, 2) : []
  const deltaHtml = showcase ? `
    <div class="td">
      <div class="tdlab">Shared template <span class="tdmut">(${showcase.size} near-identical copies)</span></div>
      <div class="tdtpl">“${esc((showcase.sample || '').replace(/\s+/g, ' ').slice(0, 170))}…”</div>
      ${deltaEx.map((d: any) => `<div class="tddelta"><span class="tdname">+ ${esc(d.name)}</span> “${esc((d.delta || '').replace(/\s+/g, ' ').slice(0, 200))}…”</div>`).join('')}
    </div>` : ''

  // Sample voices — a few real, medium-length, non-campaign comments
  const seen = new Set((analysis.campaigns || []).slice(0, 3).map((c: any) => (c.sample || '').slice(0, 40)))
  const samples = (corpus.comments || []).filter((c: any) => { const t = (c.comment || '').replace(/\s+/g, ' '); return t.length > 350 && t.length < 900 && !seen.has(t.slice(0, 40)) })
    .filter((_: any, i: number) => i % 37 === 0).slice(0, 3)
  const sampleHtml = samples.map((c: any) => `<div class="voice"><div class="vname">${esc([c.first, c.last].filter(Boolean).join(' ') || c.organization || 'Commenter')}</div><div class="vtext">“${esc((c.comment || '').replace(/\s+/g, ' ').slice(0, 320))}…”</div></div>`).join('')

  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Blue Mountains Comment Intelligence</title>
<style>
  *{box-sizing:border-box} body{margin:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${C.ink};background:#fbfcfb}
  .wrap{max-width:920px;margin:0 auto;padding:0 18px 60px}
  .hero{background:linear-gradient(135deg,${C.pine},#14352b);color:#fff;margin:0 -18px 26px;padding:30px 26px}
  .hero h1{margin:0 0 6px;font-size:24px;font-weight:800;letter-spacing:-.2px}
  .hero p{margin:0;font-size:13px;color:${C.moss}}
  .wm{font-weight:800} .wm b{color:${C.moss}} .wm i{color:${C.orange};font-style:normal}
  .hero .meta{margin-top:14px;font-size:12px;color:#cfe3d8}
  h2{font-size:15px;font-weight:800;color:${C.pine};margin:30px 0 12px;text-transform:uppercase;letter-spacing:.4px}
  .kpis{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:8px}
  .kpi{flex:1;min-width:120px;background:#fff;border:1px solid ${C.line};border-radius:10px;padding:12px 14px}
  .kpi .b{font-size:24px;font-weight:800;color:${C.pineMid}} .kpi .l{font-size:11px;color:${C.slate};margin-top:2px}
  .fstage{margin:0 0 14px}
  .fbar{background:${C.pineMid};color:#fff;border-radius:7px;padding:11px 16px;display:flex;align-items:baseline;gap:12px;min-width:180px}
  .fbar .fn{font-size:22px;font-weight:800} .fbar .fl{font-size:13px}
  .fsub{font-size:11px;color:${C.amber};font-style:italic;margin:5px 0 0 4px}
  .fstage:nth-child(1) .fbar{background:${C.pine}} .fstage:nth-child(3) .fbar{background:${C.mossDeep}} .fstage:nth-child(4) .fbar{background:${C.moss}}
  .irow{display:flex;align-items:center;gap:12px;margin:7px 0;font-size:12px}
  .ilab{width:150px;flex-shrink:0;color:${C.ink}}
  .itrack{position:relative;flex:1;height:22px;background:${C.card};border-radius:4px;overflow:hidden}
  .ivol{position:absolute;top:0;left:0;height:100%;background:${C.line}}
  .ivox{position:absolute;top:0;left:0;height:100%;background:${C.pineMid};display:flex;align-items:center;justify-content:flex-end}
  .ivox span{color:#fff;font-size:10px;font-weight:700;padding-right:6px}
  .inum{width:150px;flex-shrink:0;color:${C.slate};font-size:11px;text-align:right} .inum b{color:${C.pine}} .imut{color:${C.slate}}
  .stance{display:flex;height:26px;border-radius:6px;overflow:hidden;margin-bottom:6px}
  .stance>div{height:100%}
  .stlab{font-size:12px;color:${C.slate}} .stlab b{color:${C.orange}}
  table{width:100%;border-collapse:collapse;font-size:12px} td{padding:8px 10px;border-bottom:1px solid ${C.line};vertical-align:top}
  .csz{font-weight:800;color:${C.orange};white-space:nowrap} .csamp{color:${C.ink}} .cper{color:${C.slate};text-align:right;white-space:nowrap}
  .td{background:${C.card};border-left:4px solid ${C.moss};border-radius:8px;padding:14px 16px;margin-top:6px}
  .tdlab{font-size:11px;font-weight:800;color:${C.pine};text-transform:uppercase;letter-spacing:.3px} .tdmut{color:${C.slate};font-weight:400;text-transform:none}
  .tdtpl{font-size:12px;color:${C.slate};font-style:italic;margin:6px 0 10px}
  .tddelta{font-size:12px;color:${C.ink};margin:6px 0;padding-left:10px;border-left:2px solid ${C.orange}} .tdname{font-weight:700;color:${C.orange}}
  .voice{background:#fff;border:1px solid ${C.line};border-radius:8px;padding:12px 14px;margin:8px 0}
  .vname{font-size:11px;font-weight:700;color:${C.pineMid};margin-bottom:4px} .vtext{font-size:12px;color:${C.ink};line-height:1.5}
  .foot{margin-top:34px;padding-top:14px;border-top:1px solid ${C.line};font-size:11px;color:${C.slate};line-height:1.6}
</style></head><body><div class="wrap">
  <div class="hero">
    <h1>Blue Mountains Forest Plan — Public Comment Intelligence</h1>
    <p>Malheur · Umatilla · Wallowa-Whitman National Forests · Draft EIS comment period (open through Sep 30, 2026)</p>
    <div class="meta">Snapshot as of ${AS_OF} · <span class="wm"><b>data</b><i>nautix</i></span> · powered by the Sentimetrx platform</div>
  </div>

  <div class="kpis">
    <div class="kpi"><div class="b">${f.available.toLocaleString()}</div><div class="l">comments analyzed<br>(of ${f.submitted.toLocaleString()} submitted)</div></div>
    <div class="kpi"><div class="b">${f.distinct}</div><div class="l">distinct voices<br>after near-dup dedup</div></div>
    <div class="kpi"><div class="b">${f.substantiveVoices}</div><div class="l">substantive<br>(must respond)</div></div>
    <div class="kpi"><div class="b">${Math.round((f.available - f.distinct) / f.available * 100)}%</div><div class="l">of the pile is<br>duplicate copies</div></div>
  </div>

  <h2>The funnel: ${f.submitted.toLocaleString()} → ${f.substantiveVoices} to actually answer</h2>
  ${funnelHtml}

  <h2>What they're raising · distinct voices vs. raw volume</h2>
  ${issueHtml}
  <p style="font-size:11px;color:${C.slate};margin-top:8px">Dark bar = distinct voices · light bar = total volume (incl. duplicate copies). The gap is form-letter inflation.</p>

  <h2>Stance on the proposed action</h2>
  <div class="stance">${stanceSeg}</div>
  <div class="stlab"><b>≈2:1 opposed</b> — ${st.oppose} oppose · ${st.support} support · ${st.mixed} mixed · ${st.unclear} unclear</div>

  <h2>Form-letter campaigns detected</h2>
  <table><tr><td class="csz">copies</td><td>representative text</td><td class="cper">personalized</td></tr>${campHtml}</table>

  ${deltaHtml ? `<h2>Template-delta: the substance hidden in a form letter</h2>${deltaHtml}` : ''}

  ${sampleHtml ? `<h2>Sample individual voices</h2>${sampleHtml}` : ''}

  <div class="foot">
    <b>Method.</b> Comments pulled from the CARA public reading room (project 301397). Near-duplicate clustering and template-delta are deterministic (word-shingle Jaccard) — the dedup and funnel counts are exact. Substantive / issue / stance labels are an automated first pass (Claude), coded on one representative per cluster; in a live engagement a Forest Service reviewer confirms them. ${f.held} letters were held pending PII review at snapshot time and are swept up as they post.<br>
    Prepared by <span class="wm"><b>data</b><i>nautix</i></span> · powered by the Sentimetrx platform · Confidential.
  </div>
</div></body></html>`
}

async function main() {
  const [corpusP, analysisP, codedP] = process.argv.slice(2, 5)
  const tokIdx = process.argv.indexOf('--token')
  const token = tokIdx >= 0 ? process.argv[tokIdx + 1] : null
  const corpus = JSON.parse(readFileSync(corpusP, 'utf-8'))
  const analysis = JSON.parse(readFileSync(analysisP, 'utf-8'))
  const coded = JSON.parse(readFileSync(codedP, 'utf-8'))
  const html = build(corpus, analysis, coded)

  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } })
  const expires = new Date(Date.now() + 550 * 24 * 3600 * 1000).toISOString()
  const meta = { html, label: 'Blue Mountains NEPA dashboard', source: 'nepa_dashboard' }
  if (token) {
    const { error } = await db.from('shared_links').update({ metadata: meta, expires_at: expires }).eq('token', token)
    if (error) { console.error(error.message); process.exit(1) }
    console.log(`✔ updated dashboard → ${BASE}/shared/conversation/${token}`)
  } else {
    const { data, error } = await db.from('shared_links').insert({ type: 'conversation', target_id: BOT_ID, org_id: ORG_ID, expires_at: expires, metadata: meta }).select('token').single()
    if (error) { console.error(error.message); process.exit(1) }
    console.log(`✔ published dashboard → ${BASE}/shared/conversation/${data.token}`)
    console.log(`   (cadence: re-run with --token ${data.token} to refresh the same link)`)
  }
}
main().catch(e => { console.error(e); process.exit(1) })
