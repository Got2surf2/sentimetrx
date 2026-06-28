// lib/projectReportHtml.ts
//
// Point-in-time HTML bake of a Project (brand-level) report. Pure, self-contained
// inline styles (headless-Chrome page.pdf() renders it directly), Datanautix-
// branded. Reuses the SAME shared renderers as the per-input Town Hall + Agent
// Study reports — renderSourceSummaryHtml + renderCommentaryHtml — so the project
// report reads as a sibling of them, only aggregated and source-attributed.

import type { ProjectReportModel, ProjectQA } from '@/lib/projectReport'
import { renderSourceSummaryHtml } from '@/lib/sourceSummary'
import { renderCommentaryHtml } from '@/lib/commentaryReport'

const TEAL = '#0f766e'
const ORANGE = '#c2410c'
const INK = '#0f172a'
const BODY = '#334155'
const MUTE = '#64748b'
const FAINT = '#94a3b8'
const LINE = '#e2e8f0'

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}
function fmtDate(s: string | null): string {
  if (!s) return ''
  try { return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) } catch { return '' }
}

const DN_WORDMARK =
  '<span style="font-weight:800;font-size:17px;letter-spacing:-0.3px;white-space:nowrap">' +
  '<span style="color:#0F7173">data</span><span style="color:#E8632A">nautix</span></span>'

function srcBadge(kind: string): string {
  return kind === 'town_hall'
    ? `<span style="font-size:10px;font-weight:700;color:${ORANGE};background:#fff7ed;border-radius:5px;padding:1px 7px">🎙 Town Hall</span>`
    : `<span style="font-size:10px;font-weight:700;color:${TEAL};background:#f0fdfa;border-radius:5px;padding:1px 7px">🤖 Agent</span>`
}

function sentPill(s: string | null): string {
  const v = (s || '').toLowerCase()
  const map: Record<string, [string, string]> = {
    positive: ['#059669', '#ecfdf5'], negative: ['#dc2626', '#fef2f2'],
    mixed: ['#b45309', '#fffbeb'], neutral: ['#475569', '#f1f5f9'],
  }
  const [fg, bg] = map[v] || map.neutral
  if (!v) return ''
  return `<span style="font-size:10px;font-weight:700;color:${fg};background:${bg};border-radius:5px;padding:1px 7px;text-transform:capitalize">${esc(v)}</span>`
}

// One source-attributed Q&A card (mirrors the town-hall qaCard, + a source badge).
function qaCard(qa: ProjectQA): string {
  return (
    `<div style="border:1px solid ${LINE};border-radius:12px;overflow:hidden;margin-bottom:12px;page-break-inside:avoid">` +
    `<div style="padding:11px 14px;border-bottom:1px solid #f1f5f9">` +
    `<div style="display:flex;justify-content:space-between;gap:8px;align-items:baseline">` +
    `<div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${TEAL}">Question${qa.asker ? '  ·  ' + esc(qa.asker) : ''}</div>` +
    `<span style="font-size:10px;font-weight:600;color:${MUTE};background:#f1f5f9;border-radius:5px;padding:1px 6px;white-space:nowrap">${esc(qa.source)}</span>` +
    `</div>` +
    `<p style="font-size:14px;font-weight:600;color:${INK};margin:3px 0 0">${esc(qa.question)}</p></div>` +
    (qa.answer
      ? `<div style="padding:11px 14px;background:#f8fafc">` +
        `<div style="font-size:10px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:${ORANGE}">Response${qa.panelist ? '  ·  ' + esc(qa.panelist) : ''}</div>` +
        `<p style="font-size:14px;line-height:1.6;color:${BODY};margin:3px 0 0">${esc(qa.answer)}</p></div>`
      : '') +
    `</div>`
  )
}

export function renderProjectReportHtml(model: ProjectReportModel): string {
  const t = model.totals

  // Sources manifest
  const manifest =
    `<section style="margin:22px 0 0"><h2 class="h2">Sources</h2>` +
    `<div style="display:flex;flex-direction:column;gap:8px">` +
    model.sources.map(s =>
      `<div style="display:flex;align-items:center;gap:10px;border:1px solid ${LINE};border-radius:10px;padding:9px 12px">` +
      srcBadge(s.kind) +
      `<span style="font-weight:700;color:${INK};font-size:13px">${esc(s.name)}</span>` +
      (s.date ? `<span style="font-size:11px;color:${MUTE}">${esc(fmtDate(s.date))}</span>` : '') +
      `<span style="margin-left:auto;font-size:11px;color:${FAINT}">${s.rowCount.toLocaleString()} rows</span>` +
      `</div>`).join('') +
    `</div></section>`

  // Presentations / KB summaries (each input's "what was presented")
  const presentations = model.presentations.length > 0
    ? `<section style="margin:24px 0 0"><h2 class="h2">What was presented &amp; covered</h2>` +
      model.presentations.map(p =>
        `<div style="margin:0 0 16px">` +
        `<div style="display:flex;align-items:center;gap:8px;margin:0 0 6px">${srcBadge(p.source.kind)}<span style="font-weight:700;color:${INK};font-size:13px">${esc(p.source.name)}</span></div>` +
        `<div style="border-left:2px solid ${LINE};padding-left:12px">` +
        renderSourceSummaryHtml(p.summary, { heading: ' ' }) +
        `</div></div>`).join('') +
      `</section>`
    : ''

  // Themes (merged cross-input), each with source-attributed Q&A
  const themes =
    `<section style="margin:26px 0 0"><h2 class="h2">Themes across all inputs</h2>` +
    `<p style="font-size:12px;color:${MUTE};margin:0 0 14px">Topics raised across the meetings and the agent, merged into unified themes. Counts include every Q&amp;A and community comment (not a sample).</p>` +
    model.themes.map(th => {
      const qa = th.qa.slice(0, 6)
      const more = th.qa.length - qa.length
      return (
        `<div style="margin:0 0 20px;page-break-inside:auto">` +
        `<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap;border-bottom:1px solid ${LINE};padding-bottom:6px;margin:0 0 10px">` +
        `<h3 style="font-size:16px;font-weight:800;color:${INK};margin:0">${esc(th.title)}</h3>` +
        sentPill(th.sentiment) +
        `<span style="font-size:11px;color:${MUTE}">${th.count} item${th.count === 1 ? '' : 's'} · ${th.sources.length} source${th.sources.length === 1 ? '' : 's'}</span>` +
        `</div>` +
        (th.summary ? `<p style="font-size:13px;line-height:1.6;color:${BODY};margin:0 0 12px">${esc(th.summary)}</p>` : '') +
        qa.map(qaCard).join('') +
        (more > 0 ? `<p style="font-size:11px;color:${FAINT};margin:2px 0 0">+ ${more} more exchange${more === 1 ? '' : 's'} in this theme</p>` : '') +
        `</div>`
      )
    }).join('') +
    `</section>`

  // Commentary — all community comments, source-tagged (panel already excluded upstream)
  const commentary = model.commentary.length > 0
    ? `<section style="margin:26px 0 0"><h2 class="h2">Community commentary</h2>` +
      renderCommentaryHtml(model.commentary, {
        accent: TEAL,
        subtitle: 'Comments and concerns community members raised on their own, across every input. Organizer/panel speech is excluded.',
      }) + `</section>`
    : ''

  // Entities
  const entMax = Math.max(1, ...model.entities.map(e => e.mentions))
  const entities = model.entities.length > 0
    ? `<section style="margin:26px 0 0"><h2 class="h2">Most-mentioned</h2>` +
      `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:8px">` +
      model.entities.slice(0, 24).map(e =>
        `<div style="display:flex;align-items:center;gap:8px;background:#f8fafc;border-radius:8px;padding:6px 10px">` +
        `<span style="flex:1;font-size:12px;font-weight:600;color:${INK};overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(e.sources.join(', '))}">${esc(e.name)}</span>` +
        `<div style="height:7px;width:60px;background:#e2e8f0;border-radius:5px;overflow:hidden"><div style="height:100%;width:${Math.round((e.mentions / entMax) * 100)}%;background:${TEAL}"></div></div>` +
        `<span style="width:26px;text-align:right;font-size:12px;font-weight:700;color:${TEAL}">${e.mentions}</span></div>`).join('') +
      `</div></section>`
    : ''

  const kpi = (v: string | number, l: string) =>
    `<div style="background:#f8fafc;border-radius:10px;padding:12px 14px"><div style="font-size:24px;font-weight:800;color:${INK}">${esc(String(v))}</div><div style="font-size:11px;font-weight:600;color:${MUTE};margin-top:2px">${esc(l)}</div></div>`

  const overview =
    `<section style="margin:22px 0 0;border:1px solid ${LINE};border-radius:14px;padding:16px 18px;background:#f8fafc;page-break-inside:avoid">` +
    `<h2 style="font-size:13px;font-weight:700;color:${BODY};margin:0 0 8px">Executive summary</h2>` +
    (model.execSummary ? `<p style="font-size:14px;line-height:1.65;color:${BODY};margin:0 0 14px;white-space:pre-wrap">${esc(model.execSummary)}</p>` : '') +
    `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px">` +
    kpi(t.sources, 'Inputs') + kpi(t.townHalls, 'Town halls') + kpi(t.agents, 'Agents') +
    kpi(t.qa, 'Q&A exchanges') + kpi(t.comments, 'Community comments') + kpi(model.themes.length, 'Themes') +
    `</div></section>`

  return (
    `<!doctype html><html><head><meta charset="utf-8"><style>` +
    `*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}` +
    `body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:${INK};margin:0;background:#fff;font-size:14px;line-height:1.5}` +
    `.wrap{max-width:760px;margin:0 auto;padding:8px 0 28px}` +
    `.h2{font-size:17px;font-weight:800;color:${INK};border-bottom:1px solid ${LINE};padding-bottom:6px;margin:0 0 12px;break-after:avoid;page-break-after:avoid}` +
    `h1,.h2,h3{break-after:avoid;page-break-after:avoid}` +
    `</style></head><body><div class="wrap">` +
    `<header style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">` +
    `<div><div style="font-size:11px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:${FAINT};margin-bottom:6px">Project Report</div>` +
    `<h1 style="font-size:26px;font-weight:800;color:${INK};margin:0">${esc(model.name)}</h1>` +
    `<p style="font-size:12px;color:${MUTE};margin:6px 0 0">${t.townHalls} town hall${t.townHalls === 1 ? '' : 's'} · ${t.agents} agent${t.agents === 1 ? '' : 's'} · generated ${esc(fmtDate(model.generatedAt))}</p></div>` +
    DN_WORDMARK +
    `</header>` +
    overview + manifest + presentations + themes + commentary + entities +
    `<p style="font-size:11px;color:${FAINT};margin:24px 0 0;border-top:1px solid ${LINE};padding-top:10px">${esc(model.method)}</p>` +
    `<div style="text-align:center;font-size:11px;color:${FAINT};margin-top:18px">Prepared by datanautix.com</div>` +
    `</div></body></html>`
  )
}
