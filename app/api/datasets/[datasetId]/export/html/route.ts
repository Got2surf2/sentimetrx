// app/api/datasets/[datasetId]/export/html/route.ts
// POST — generate a Reveal.js HTML presentation from dataset analytics.
// Same request body as /export/pptx — returns text/html file download.

import { NextResponse } from 'next/server'
import { callAI } from '@/lib/ai'
import { logUsage } from '@/lib/usageLog'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { pickBestComments } from '@/lib/export/scoreComments'
import { smartOrder, isOrdinalScale } from '@/lib/scaleUtils'
import { aliasedCounts } from '@/lib/aliasUtils'
import { buildKwRegex } from '@/lib/themeUtils'
import { deserializeFilters, applyFilters, type SerializedFilters } from '@/lib/filterUtils'

export const dynamic     = 'force-dynamic'
export const maxDuration = 120

interface Params { params: { datasetId: string } }

// ── Brand palette ─────────────────────────────────────────────────────────────
const DN = {
  navy:      '#0D2B45', navyMid:  '#0F3A54', navyLight: '#1A5070',
  teal:      '#0F7173', tealLight:'#1DA39A', tealPale:  '#E0F2F1',
  gold:      '#E8B84B', goldPale: '#FFF8E1',
  orange:    '#E85A1A', orangeLt: '#F07040',
  slate:     '#8FA3AE', slateDk:  '#4A6572', slateCard: '#F4F7F8',
  white:     '#FFFFFF', divider:  '#D4DDE2',
  green:     '#059669', amber:    '#D97706', red: '#DC2626',
}

// ── Shared types / helpers ────────────────────────────────────────────────────
interface FieldInsight { keyFinding: string; narrative: string; implication: string; watchout?: string; pickedQuotes?: string[] }
interface Narratives {
  reportTitle: string; executiveSummary: string[]; keyTakeaways: string[]
  fieldInsights: Record<string, FieldInsight>
}
interface SelectedField {
  field: string; label: string; type: string; summary: any
  remapping?: Record<string, number>; valueAliases?: Record<string, string>; section?: string; prompt?: string
  liveSample?: string[] // evenly-sampled verbatims from allRows — replaces stale analytics snapshot
}

function pct(v: number, total: number) { return total > 0 ? Math.round(v / total * 100) : 0 }
function trunc(s: string, n: number) { return !s ? '' : s.length > n ? s.slice(0, n - 1) + '…' : s }
function trimNatural(s: string, max: number): string {
  if (!s) return s
  const candidate = s.length > max ? s.slice(0, max) : s
  const lastEnd = Math.max(candidate.lastIndexOf('.'), candidate.lastIndexOf('!'), candidate.lastIndexOf('?'))
  if (lastEnd >= 1) return candidate.slice(0, lastEnd + 1)
  const lastSpace = candidate.lastIndexOf(' ')
  return (lastSpace > 0 ? candidate.slice(0, lastSpace) : candidate) + '…'
}
function esc(s: string) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;') }
function normalize(s: string) { return s.toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'') }

// ── AI narratives (shared logic with pptx route) ──────────────────────────────
async function generateNarratives(
  orgId: string, datasetName: string, totalRows: number,
  audience: string, fields: SelectedField[], instructions?: string
): Promise<Narratives> {
  const audienceNote: Record<string, string> = {
    executive:   'C-suite audience. Lead with so-what, not data.',
    stakeholder: 'Manager/analyst audience. Include percentages and averages.',
    full:        'Full team audience. Include nuance, caveats, and context.',
  }
  const fieldBlocks = fields.map(f => {
    const s = f.summary
    if (!s) return `${f.label} (${f.type}): no data`
    if (s.type === 'categorical') {
      const aliased = f.valueAliases && Object.keys(f.valueAliases).length > 0
        ? aliasedCounts(f.field, s.counts || {}, [{ field: f.field, valueAliases: f.valueAliases }])
        : (s.counts || {})
      const top5 = Object.entries(aliased).sort((a: any, b: any) => b[1] - a[1]).slice(0, 5)
        .map(([k, v]: any) => `"${k}" ${v} (${pct(v, s.nonNull)}%)`).join(', ')
      return `${f.label} (categorical, n=${s.nonNull}): top — ${top5}`
    }
    if (s.type === 'numeric') return `${f.label} (numeric, n=${s.nonNull}): avg=${s.avg?.toFixed(2)}, median=${s.median?.toFixed(2)}, min=${s.min}, max=${s.max}`
    if (s.type === 'open-ended') {
      const samplePool = (f.liveSample && f.liveSample.length > 0) ? f.liveSample : (s.sample || [])
      const allSamples = samplePool.slice(0,20).map((t: string, i: number) => `[${i}] "${t.slice(0,500)}"`).join('\n')
      return `${f.label} (open-ended, n=${s.nonNull}): avg ${s.avgWordCount} words\nCANDIDATE QUOTES (indexed 0–${Math.min(19,samplePool.length-1)}):\n${allSamples}`
    }
    return `${f.label}: no data`
  }).join('\n\n')

  const prompt = `You are a senior consultant preparing a data readout. Dataset: "${datasetName}" — ${totalRows.toLocaleString()} responses. Audience: ${audience}. ${audienceNote[audience]||''}${instructions ? '\n\nCLIENT INSTRUCTIONS: '+instructions : ''}

FIELD DATA:
${fieldBlocks}

Return ONLY valid JSON. No markdown fences:
{
  "reportTitle": "short punchy subtitle (8 words max)",
  "executiveSummary": ["Bullet 1 with a specific number","Bullet 2","Bullet 3","Bullet 4","Bullet 5"],
  "keyTakeaways": ["Actionable recommendation 1","Actionable recommendation 2","Actionable recommendation 3"],
  "fieldInsights": {
${fields.map(f => {
  const isOE = f.type === 'open-ended'
  return `    "${f.field}": {"keyFinding":"one strong statement (max 12 words)","narrative":"2-3 sentences with specific data.","implication":"1-2 sentences. So what?","watchout":"1 sentence caveat (optional, omit if nothing meaningful)"${isOE ? `,"pickedQuotes":["pick 3-5 of the most insightful, distinct, representative quotes from CANDIDATE QUOTES above. Prefer quotes that are at least 200 characters and end at a natural sentence boundary. Do not truncate mid-sentence. Exact text only — no paraphrasing."]` : ''}}`
}).join(',\n')}
  }
}`

  const result = await callAI({
    tier: 'advanced',
    maxTokens: 3500,
    timeoutMs: 45000,
    messages: [{ role: 'user', content: prompt }],
    usage: { org_id: orgId, resource_type: 'dataset', event_type: 'html_export' },
  })
  logUsage({ org_id: orgId, resource_type: 'dataset', event_type: 'html_export' }, result.usage)
  const raw = result.text.trim().replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/i,'')
  try { return JSON.parse(raw) }
  catch { return { reportTitle: '', executiveSummary: [], keyTakeaways: [], fieldInsights: Object.fromEntries(fields.map(f => [f.field, { keyFinding: f.label, narrative: '', implication: '' }])) } }
}

// ── HTML slide builders ───────────────────────────────────────────────────────

interface SlideCtx {
  chartIndex: number
  charts: Record<string, { data: any[]; layout: any }>
  manifest: { title: string; icon: string; section?: string }[]
}

function chartId(ctx: SlideCtx) { return 'chart-' + (ctx.chartIndex++) }

function slideHeader(title: string, subtitle?: string, dark = false): string {
  const bg = dark ? DN.navy : DN.slateCard
  const tc = dark ? DN.white : DN.navy
  const sc = dark ? DN.tealLight : DN.slateDk
  return `<div class="slide-hdr" style="background:${bg};border-bottom:3px solid ${DN.gold}">
    <div class="slide-hdr-accent"></div>
    <div style="flex:1;min-width:0">
      <div class="slide-title-text" style="color:${tc}">${esc(title)}</div>
      ${subtitle ? `<div class="slide-sub-text" style="color:${sc}">${esc(subtitle)}</div>` : ''}
    </div>
    <div class="dn-logo"><span style="color:${DN.orangeLt}">data</span><span style="color:${DN.tealLight}">nautix</span></div>
  </div>`
}

function buildTitleSlide(ctx: SlideCtx, datasetName: string, reportTitle: string, totalRows: number, computedAt: string|null): string {
  ctx.manifest.push({ title: datasetName, icon: '🏠' })
  // Always use report generation date, not analytics compute date
  const dateStr = new Date().toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})
  return `<section class="slide-title" style="background:${DN.navy}">
    <div class="title-left-bar"></div>
    <div class="title-gold-bar"></div>
    <div class="title-deco-circle title-deco-1"></div>
    <div class="title-deco-circle title-deco-2"></div>
    <div class="title-content">
      <div class="dn-logo-large"><span style="color:${DN.orangeLt}">data</span><span style="color:${DN.tealLight}">nautix</span></div>
      <div class="title-divider"></div>
      <h1 class="title-dataset">${esc(datasetName)}</h1>
      ${reportTitle ? `<p class="title-subtitle">${esc(reportTitle)}</p>` : ''}
      <div class="title-meta">
        ${dateStr ? `<span>${esc(dateStr)}</span> &nbsp;·&nbsp; ` : ''}<span>${totalRows.toLocaleString()} responses</span>
      </div>
      <div class="title-footer">Prepared by Datanautix &nbsp;·&nbsp; Proprietary and Confidential</div>
    </div>
  </section>`
}

function buildSummarySlide(ctx: SlideCtx, totalRows: number, bullets: string[], takeaways: string[], themes: any[], fields: SelectedField[]): string {
  ctx.manifest.push({ title: 'Executive Summary', icon: '📋' })
  const kpis: { v: string; l: string }[] = [{ v: totalRows.toLocaleString(), l: 'Total Responses' }]
  const numF = fields.find(f => f.type === 'numeric')
  if (numF?.summary?.avg != null) kpis.push({ v: String(Math.round(numF.summary.avg)), l: trunc(numF.label, 20) })
  if (themes.length > 0) kpis.push({ v: String(themes.length), l: 'Themes Identified' })
  const oeF = fields.find(f => f.type === 'open-ended')
  if (oeF?.summary?.avgWordCount) kpis.push({ v: String(oeF.summary.avgWordCount), l: 'Avg Words / Response' })

  const bulletsHtml = bullets.filter(b => b?.length > 5).slice(0, 5).map(b =>
    `<li><span class="bullet-dot"></span>${esc(b)}</li>`).join('')

  const themesHtml = themes.slice(0, 5).map(t => {
    const hitPct = Math.round(t.percentage || 0)
    return `<div class="theme-row">
      <div class="theme-bar-bg"><div class="theme-bar-fill" style="width:${Math.min(hitPct,100)}%"></div></div>
      <span class="theme-name">${esc(trunc(t.name||t.label,32))}</span>
      <span class="theme-pct">${hitPct}%</span>
    </div>`}).join('')

  const taHtml = takeaways.slice(0, 3).map((ta, i) =>
    `<div class="takeaway-row"><span class="ta-num">${i+1}</span>${esc(ta)}</div>`).join('')

  return `<section style="background:${DN.navy};color:${DN.white}">
    ${slideHeader('Executive Summary', undefined, true)}
    <div class="slide-body" style="display:flex;flex-direction:column;gap:12px;padding:12px 28px 8px">
      <div class="kpi-row">${kpis.slice(0,4).map(k => `<div class="kpi-card"><div class="kpi-val">${esc(k.v)}</div><div class="kpi-lbl">${esc(k.l)}</div></div>`).join('')}</div>
      <div style="display:flex;gap:20px;flex:1;min-height:0">
        <div style="flex:1.1;display:flex;flex-direction:column;gap:6px">
          <div class="section-label">KEY FINDINGS</div>
          <ul class="bullets-list">${bulletsHtml}</ul>
        </div>
        <div style="flex:0.9;display:flex;flex-direction:column;gap:6px">
          ${themes.length>0 ? `<div class="section-label">TOP THEMES</div><div class="themes-list">${themesHtml}</div>` : ''}
          ${takeaways.length>0 ? `<div class="section-label" style="margin-top:8px">RECOMMENDED ACTIONS</div><div class="takeaways-list">${taHtml}</div>` : ''}
        </div>
      </div>
    </div>
  </section>`
}

function buildCategoricalSlide(ctx: SlideCtx, f: SelectedField, ai: FieldInsight): string {
  ctx.manifest.push({ title: f.label, icon: '📊', section: f.section })
  const countsRaw = f.summary?.counts as Record<string, number> || {}
  const counts = f.valueAliases && Object.keys(f.valueAliases).length > 0
    ? aliasedCounts(f.field, countsRaw, [{ field: f.field, valueAliases: f.valueAliases }])
    : countsRaw
  const allKeys = Object.keys(counts)
  const total  = Object.values(counts).reduce((s: number, v: any) => s + Number(v), 0) || 1

  // Use smartOrder: remapping first, then scale detection, then count-descending
  const isOrdinal = (f.remapping && Object.keys(f.remapping).length > 0) || isOrdinalScale(allKeys)
  let orderedKeys: string[]
  if (isOrdinal) {
    orderedKeys = smartOrder(allKeys, f.remapping).slice().reverse() // best-first
  } else {
    orderedKeys = allKeys.slice().sort((a, b) => (counts[b] || 0) - (counts[a] || 0))
  }
  orderedKeys = orderedKeys.filter(k => (counts[k] || 0) > 0).slice(0, 15)

  // Labels: always use the original text labels (NOT numeric remapping values)
  const labels  = orderedKeys.map(k => k)
  const values  = orderedKeys.map(k => Math.round((counts[k] || 0) / total * 1000) / 10)
  const rawCts  = orderedKeys.map(k => counts[k] || 0)

  // Color: ordinal gradient (green→red) or single color
  let barColors: string | string[] = DN.teal
  if (isOrdinal && orderedKeys.length >= 3) {
    const ordGrad = ['#059669','#34D399','#94A3B8','#F97316','#DC2626']
    barColors = orderedKeys.map(function(_, i) {
      const frac = orderedKeys.length <= 1 ? 0 : i / (orderedKeys.length - 1)
      if (frac < 0.15) return ordGrad[0]
      if (frac < 0.38) return ordGrad[1]
      if (frac < 0.62) return ordGrad[2]
      if (frac < 0.82) return ordGrad[3]
      return ordGrad[4]
    })
  }

  const cid = chartId(ctx)
  ctx.charts[cid] = {
    data: [{
      type: 'bar', orientation: 'h',
      y: labels.slice().reverse(),
      x: values.slice().reverse(),
      customdata: rawCts.slice().reverse(),
      text: values.slice().reverse().map(v => v + '%'),
      textposition: 'outside',
      marker: { color: Array.isArray(barColors) ? barColors.slice().reverse() : barColors },
      hovertemplate: '<b>%{y}</b><br>%{x:.0f}% (%{customdata} responses)<extra></extra>',
    }],
    layout: {
      paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
      margin: { l: 16, r: 60, t: 8, b: 30 },
      xaxis: { showgrid: true, gridcolor: DN.divider, zeroline: false, ticksuffix: '%', tickformat: '.0f', color: DN.slateDk, tickfont: { size: 10 } },
      yaxis: { tickfont: { size: 11 }, color: DN.navy, automargin: true },
      font: { family: 'Inter, system-ui, sans-serif', color: DN.navy },
      bargap: 0.25,
    },
  }

  const subtitle = f.prompt || (f.section ? f.section.charAt(0).toUpperCase()+f.section.slice(1)+' · ' : '') +
    'Categorical · ' + (f.summary?.nonNull||0).toLocaleString() + ' responses'

  return `<section style="background:${DN.slateCard}">
    ${slideHeader(f.label, subtitle)}
    <div class="slide-body two-col">
      <div class="chart-col" id="${cid}" data-chart-id="${cid}" style="min-height:320px"></div>
      <div class="insight-col">
        ${ai.keyFinding ? `<div class="key-finding">${esc(ai.keyFinding)}</div>` : ''}
        ${ai.narrative ? `<p class="narrative">${esc(ai.narrative)}</p>` : ''}
        ${ai.implication ? `<div class="implication"><span class="imp-arrow">→</span> ${esc(ai.implication)}</div>` : ''}
        ${ai.watchout ? `<div class="watchout">⚠ ${esc(ai.watchout)}</div>` : ''}
        <div class="resp-count">n = ${(f.summary?.nonNull||0).toLocaleString()} responses</div>
      </div>
    </div>
  </section>`
}

function buildNumericSlide(ctx: SlideCtx, f: SelectedField, ai: FieldInsight, allRows: Record<string,any>[], rowKeyMap: Record<string,string>): string {
  ctx.manifest.push({ title: f.label, icon: '🔢', section: f.section })
  const s = f.summary || {}
  const subtitle = f.prompt || 'Numeric · ' + (s.nonNull||0).toLocaleString() + ' responses'

  // Extract raw values from rows for histogram
  function rowVal(row: Record<string,any>, key: string): string {
    if (row[key] != null) return String(row[key]).trim()
    const actual = rowKeyMap[normalize(key)]
    if (actual && row[actual] != null) return String(row[actual]).trim()
    return ''
  }
  const rawVals = allRows.map(r => parseFloat(rowVal(r, f.field))).filter(v => !isNaN(v))

  const cid = chartId(ctx)
  if (rawVals.length > 5) {
    ctx.charts[cid] = {
      data: [{
        type: 'histogram', x: rawVals, nbinsx: 20,
        marker: { color: DN.teal, line: { color: DN.tealLight, width: 1 } },
        hovertemplate: 'Value: %{x}<br>Count: %{y}<extra></extra>',
      }],
      layout: {
        paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
        margin: { l: 16, r: 16, t: 8, b: 30 },
        xaxis: { gridcolor: DN.divider, color: DN.slateDk, tickfont: { size: 10 }, tickformat: rawVals.every(v => Number.isInteger(v)) ? 'd' : '.0f' },
        yaxis: { gridcolor: DN.divider, color: DN.slateDk, tickfont: { size: 10 }, tickformat: 'd', title: { text: 'Count', font: { size: 10 } } },
        font: { family: 'Inter, system-ui, sans-serif', color: DN.navy },
        bargap: 0.05,
        shapes: s.avg != null ? [{ type: 'line', x0: s.avg, x1: s.avg, y0: 0, y1: 1, yref: 'paper', line: { color: DN.gold, width: 2, dash: 'dot' } }] : [],
        annotations: s.avg != null ? [{ x: s.avg, y: 1, yref: 'paper', text: 'avg', showarrow: false, font: { color: DN.gold, size: 10 }, yanchor: 'bottom' }] : [],
      },
    }
  }

  const kpis = [
    s.avg    != null ? { v: String(Math.round(s.avg)),    l: 'Average'  } : null,
    s.median != null ? { v: String(Math.round(s.median)), l: 'Median'   } : null,
    s.min    != null ? { v: String(s.min),         l: 'Min'      } : null,
    s.max    != null ? { v: String(s.max),         l: 'Max'      } : null,
  ].filter(Boolean) as { v: string; l: string }[]

  const kpiHtml = kpis.map(k =>
    `<div class="kpi-card-sm"><div class="kpi-val-sm" style="color:${DN.teal}">${esc(k.v)}</div><div class="kpi-lbl-sm">${esc(k.l)}</div></div>`).join('')

  return `<section style="background:${DN.slateCard}">
    ${slideHeader(f.label, subtitle)}
    <div class="slide-body" style="display:flex;flex-direction:column;gap:10px;padding:10px 28px 8px">
      <div class="kpi-row-sm">${kpiHtml}</div>
      ${rawVals.length > 5 ? `<div id="${cid}" data-chart-id="${cid}" style="flex:1;min-height:240px"></div>` : '<div style="color:'+DN.slateDk+';font-size:13px;padding:20px 0">Distribution chart requires row-level data</div>'}
      <div class="insight-box">
        ${ai.keyFinding ? `<div class="key-finding" style="margin-bottom:6px">${esc(ai.keyFinding)}</div>` : ''}
        ${ai.narrative ? `<p class="narrative" style="margin:0">${esc(ai.narrative)}</p>` : ''}
        ${ai.implication ? `<div class="implication" style="margin-top:6px"><span class="imp-arrow">→</span> ${esc(ai.implication)}</div>` : ''}
      </div>
    </div>
  </section>`
}

function buildOpenEndedSlide(ctx: SlideCtx, f: SelectedField, ai: FieldInsight, themes: any[]): string {
  ctx.manifest.push({ title: f.label, icon: '💬', section: f.section })
  const subtitle = f.prompt || 'Open-ended · ' + (f.summary?.nonNull||0).toLocaleString() + ' responses'
  // Prefer AI-curated quotes (≤140 chars each); fall back to raw sample
  const allSamples = (f.summary?.sample || []) as string[]
  const longSamples = allSamples.filter(q => q && q.trim().length >= 200)
  const rawFallback = (longSamples.length >= 2 ? longSamples : allSamples.filter(q => q && q.trim().length > 50))
    .slice(0, 6).map(q => trimNatural(q, 400))
  const quotes = (ai.pickedQuotes && ai.pickedQuotes.length > 0)
    ? ai.pickedQuotes.slice(0, 6).map(q => trimNatural(q, 400))
    : rawFallback
  const fieldThemes = themes.slice(0, 8)

  let chartHtml = ''
  if (fieldThemes.length > 0) {
    const cid = chartId(ctx)
    const labels = fieldThemes.map((t: any) => trunc(t.name||t.label, 30))
    const vals   = fieldThemes.map((t: any) => t.percentage || 0)
    ctx.charts[cid] = {
      data: [{
        type: 'bar', orientation: 'h',
        y: labels.slice().reverse(),
        x: vals.slice().reverse(),
        text: vals.slice().reverse().map((v: number) => v + '%'),
        textposition: 'outside',
        marker: { color: fieldThemes.slice().reverse().map((_: any, i: number) =>
          i === fieldThemes.length - 1 ? DN.teal : i === fieldThemes.length - 2 ? DN.tealLight : DN.navyLight) },
        hovertemplate: '<b>%{y}</b>: %{x:.0f}%<extra></extra>',
      }],
      layout: {
        paper_bgcolor: 'rgba(0,0,0,0)', plot_bgcolor: 'rgba(0,0,0,0)',
        margin: { l: 16, r: 50, t: 8, b: 20 },
        xaxis: { showgrid: true, gridcolor: DN.divider, zeroline: false, ticksuffix: '%', tickformat: '.0f', tickfont: { size: 10 }, color: DN.slateDk },
        yaxis: { tickfont: { size: 11 }, color: DN.navy, automargin: true },
        font: { family: 'Inter, system-ui, sans-serif', color: DN.navy },
        bargap: 0.3,
      },
    }
    chartHtml = `<div id="${cid}" data-chart-id="${cid}" style="min-height:240px;flex:1"></div>`
  }

  const quotesHtml = quotes.map(q =>
    `<blockquote class="quote-card">${esc(q)}</blockquote>`).join('')

  return `<section style="background:${DN.slateCard}">
    ${slideHeader(f.label, subtitle)}
    <div class="slide-body two-col">
      <div style="flex:1.1;display:flex;flex-direction:column;gap:8px;padding:10px 12px 8px 28px">
        ${fieldThemes.length > 0 ? `<div class="section-label" style="color:${DN.slateDk}">AI-IDENTIFIED THEMES</div>${chartHtml}` : ''}
        ${ai.narrative ? `<div class="insight-box">${esc(ai.narrative)}</div>` : ''}
      </div>
      <div style="flex:0.9;display:flex;flex-direction:column;gap:6px;padding:10px 28px 8px 8px;overflow:hidden">
        <div class="section-label" style="color:${DN.slateDk}">VERBATIM RESPONSES</div>
        <div style="overflow-y:auto;flex:1">${quotesHtml}</div>
      </div>
    </div>
  </section>`
}

async function buildThemeDetailSlides(
  ctx: SlideCtx, themes: any[], fieldLabel: string,
  allRows: Record<string,any>[], rowKeyMap: Record<string,string>, fieldKeys: string[],
  orgId?: string,
): Promise<string[]> {
  if (!themes?.length) return []

  // Pre-compile keyword regexes per theme for performance
  var themeRegexCache = new Map<string, RegExp[]>()
  function getThemeRegexes(keywords: string[]): RegExp[] {
    var key = keywords.join('|')
    if (themeRegexCache.has(key)) return themeRegexCache.get(key)!
    var regexes = keywords.map(function(kw) { return buildKwRegex(kw) })
    themeRegexCache.set(key, regexes)
    return regexes
  }
  function matchesTheme(text: string, keywords: string[]): boolean {
    if (!keywords?.length) return false
    var regexes = getThemeRegexes(keywords)
    var lower = text.toLowerCase()
    return regexes.some(function(re) { return re.test(lower) })
  }

  async function getComments(t: any): Promise<string[]> {
    if (!allRows?.length) return []
    const keys = fieldKeys.map(fk => {
      const norm = fk.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
      return rowKeyMap[norm] || fk
    })
    const matched: string[] = []
    for (const row of allRows) {
      const text = keys.map(k => String(row[k] || '')).join(' ').trim()
      if (text.length < 80) continue
      if (matchesTheme(text, t.keywords || [])) matched.push(text)
    }
    if (!matched.length) return []
    matched.sort((a, b) => b.length - a.length)
    const pool = matched.slice(0, Math.min(matched.length, 40))

    return pickBestComments(
      pool,
      { name: t.name || '', description: t.description || '', keywords: t.keywords || [], sentiment: t.sentiment || '' },
      5,
      orgId,
      undefined,
      350,
    )
  }

  const total = themes.length
  const slides: string[] = []
  for (let tidx = 0; tidx < themes.length; tidx++) {
    const t = themes[tidx] as any
    ctx.manifest.push({ title: t.name || 'Theme', icon: '🏷️', section: fieldLabel })
    const themeColor = t.color || DN.teal
    const sent       = t.sentiment || ''
    const pctVal     = Math.round(t.percentage || 0)
    const comments   = await getComments(t)

    const sentBadge = sent
      ? `<span style="display:inline-block;padding:3px 12px;border-radius:4px;font-size:11px;font-weight:700;background:${sent==='positive'?'#f0fdf4':sent==='negative'?'#fef2f2':sent==='mixed'?'#fffbeb':'#f4f7f8'};color:${sent==='positive'?'#15803d':sent==='negative'?'#b91c1c':sent==='mixed'?'#92400e':DN.slateDk};border:1px solid currentColor">${sent.charAt(0).toUpperCase()+sent.slice(1)}</span>`
      : ''

    const kwHtml = (t.keywords||[]).slice(0,6).map((k: string) =>
      `<span style="display:inline-block;padding:3px 10px;margin:0 5px 5px 0;background:${DN.slateCard};border:1px solid ${DN.divider};border-radius:3px;font-size:10px;color:${DN.slateDk}">${esc(k)}</span>`).join('')

    const quotesHtml = comments.length > 0
      ? comments.map(q => `<blockquote class="quote-card">${esc(q)}</blockquote>`).join('')
      : `<p style="font-size:11px;color:${DN.slate};font-style:italic;padding:8px 0">No verbatim responses matched this theme.</p>`

    const subtitle = `AI-identified theme  ·  ${tidx+1} of ${total}  ·  from: ${fieldLabel}`
    slides.push(`<section>
      <div style="position:absolute;top:0;left:0;right:0;height:5px;background:${themeColor}"></div>
      ${slideHeader(t.name || 'Theme', subtitle)}
      <div class="slide-body two-col">
        <div style="flex:0.8;display:flex;flex-direction:column;gap:10px;padding:8px 16px 8px 28px;border-right:1px solid ${DN.divider}">
          <div>${sentBadge}</div>
          ${t.description ? `<p style="font-size:11px;color:${DN.slateDk};font-style:italic;margin:0;line-height:1.55">${esc(t.description)}</p>` : ''}
          <div style="flex-wrap:wrap">${kwHtml}</div>
          <div style="margin-top:auto;border-top:1px solid ${DN.divider};padding-top:10px">
            <div style="font-size:28px;font-weight:700;color:${themeColor};line-height:1">${pctVal}%</div>
            <div style="font-size:10px;color:${DN.slateDk};margin-top:3px">${t.count ? t.count.toLocaleString() + ' responses' : ''}</div>
            <div style="height:6px;background:${DN.slateCard};border-radius:3px;margin-top:8px;overflow:hidden">
              <div style="height:100%;width:${pctVal}%;background:${themeColor};border-radius:3px"></div>
            </div>
          </div>
        </div>
        <div style="flex:1.2;display:flex;flex-direction:column;gap:6px;padding:8px 24px 8px 14px;overflow:hidden">
          <div class="section-label" style="color:${DN.slateDk}">VOICES FROM THIS THEME</div>
          <div style="overflow-y:auto;flex:1;display:flex;flex-direction:column;gap:6px">${quotesHtml}</div>
        </div>
      </div>
    </section>`)
  }
  return slides
}

function buildClosingSlide(ctx: SlideCtx, datasetName: string, takeaways: string[]): string {
  ctx.manifest.push({ title: 'Key Takeaways', icon: '✅' })
  const taHtml = takeaways.slice(0, 3).map((ta, i) =>
    `<div class="closing-ta"><div class="closing-ta-num">${i+1}</div><div>${esc(ta)}</div></div>`).join('')
  return `<section style="background:${DN.navy};color:${DN.white}">
    <div class="title-gold-bar"></div>
    <div class="title-left-bar"></div>
    <div class="title-content" style="justify-content:center">
      <div style="font-size:11px;font-weight:700;letter-spacing:2px;color:${DN.tealLight};margin-bottom:16px">KEY TAKEAWAYS</div>
      <div class="closing-tas">${taHtml}</div>
      <div style="margin-top:32px;font-size:11px;color:${DN.slate}">
        datanautix.com &nbsp;·&nbsp; ${esc(trunc(datasetName, 60))} &nbsp;·&nbsp; Proprietary and Confidential
      </div>
    </div>
  </section>`
}

// ── CSS ───────────────────────────────────────────────────────────────────────
const CSS = `
  :root { --dn-navy:${DN.navy};--dn-teal:${DN.teal};--dn-gold:${DN.gold};--dn-white:${DN.white} }
  .reveal .slides section { text-align:left; font-family:'Inter',system-ui,sans-serif; padding:0; box-sizing:border-box }
  .reveal .slides { height:100%!important }
  .reveal .slides > section { height:100%!important; display:flex!important; flex-direction:column!important }

  /* Header */
  .slide-hdr { display:flex;align-items:center;gap:12px;padding:8px 16px 8px 0;flex-shrink:0;position:relative;min-height:56px }
  .slide-hdr-accent { width:6px;align-self:stretch;background:${DN.teal};flex-shrink:0;margin-right:10px }
  .slide-title-text { font-size:18px;font-weight:700;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis }
  .slide-sub-text { font-size:10px;margin-top:2px;font-style:italic }
  .dn-logo { font-size:13px;font-weight:700;font-style:italic;white-space:nowrap;margin-left:auto;padding-right:12px }

  /* Slide body */
  .slide-body { flex:1;overflow:hidden;display:flex }
  .slide-body.two-col { flex-direction:row }
  .chart-col { flex:1.2;padding:10px 12px 8px 28px;min-width:0 }
  .insight-col { flex:0.85;padding:14px 24px 10px 12px;display:flex;flex-direction:column;gap:10px;border-left:1px solid ${DN.divider} }

  /* Insights */
  .key-finding { font-size:14px;font-weight:700;color:${DN.navy};line-height:1.3;padding:8px 10px;background:${DN.tealPale};border-left:4px solid ${DN.teal};border-radius:2px }
  .narrative { font-size:11.5px;color:${DN.navyLight};line-height:1.55;margin:0 }
  .implication { font-size:11px;color:${DN.teal};font-weight:600;padding-top:4px }
  .imp-arrow { font-size:13px;margin-right:4px }
  .watchout { font-size:10.5px;color:${DN.amber};background:${DN.goldPale};padding:5px 8px;border-radius:3px }
  .resp-count { font-size:9.5px;color:${DN.slate};margin-top:auto;padding-top:6px }
  .insight-box { background:${DN.white};border:1px solid ${DN.divider};border-radius:6px;padding:10px 12px;flex-shrink:0 }

  /* KPI rows */
  .kpi-row { display:flex;gap:8px;flex-shrink:0 }
  .kpi-card { flex:1;background:${DN.navyMid};border:1px solid ${DN.navyLight};border-top:3px solid ${DN.gold};border-radius:4px;padding:8px 10px }
  .kpi-val { font-size:24px;font-weight:700;color:${DN.gold};line-height:1.1 }
  .kpi-lbl { font-size:9.5px;color:#A8C8D8;margin-top:3px;font-weight:600 }
  .kpi-row-sm { display:flex;gap:8px;flex-shrink:0 }
  .kpi-card-sm { flex:1;background:${DN.white};border:1px solid ${DN.divider};border-top:3px solid ${DN.teal};border-radius:4px;padding:6px 10px }
  .kpi-val-sm { font-size:20px;font-weight:700;line-height:1.1 }
  .kpi-lbl-sm { font-size:9px;color:${DN.slate};margin-top:2px;font-weight:600 }

  /* Summary bullets */
  .section-label { font-size:9px;font-weight:700;letter-spacing:1.5px;color:${DN.gold};padding-bottom:4px;border-bottom:1px solid ${DN.gold} }
  .bullets-list { list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:5px }
  .bullets-list li { display:flex;align-items:flex-start;gap:8px;font-size:11px;color:${DN.white};line-height:1.4 }
  .bullet-dot { width:6px;height:6px;background:${DN.teal};border-radius:50%;margin-top:4px;flex-shrink:0 }

  /* Theme rows */
  .themes-list { display:flex;flex-direction:column;gap:5px }
  .theme-row { display:flex;align-items:center;gap:8px;font-size:11px }
  .theme-bar-bg { flex:1;height:8px;background:${DN.navyMid};border-radius:4px;overflow:hidden }
  .theme-bar-fill { height:100%;background:${DN.teal};border-radius:4px;transition:width .3s }
  .theme-name { color:${DN.white};min-width:0;flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis }
  .theme-pct { color:${DN.gold};font-weight:700;min-width:32px;text-align:right }
  .takeaways-list { display:flex;flex-direction:column;gap:6px }
  .takeaway-row { display:flex;align-items:flex-start;gap:8px;font-size:11px;color:${DN.white};background:${DN.navyMid};padding:6px 8px;border-radius:3px }
  .ta-num { width:20px;height:20px;background:${DN.teal};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:700;color:${DN.white};flex-shrink:0 }

  /* Quotes */
  .quote-card { margin:0 0 6px;padding:8px 10px 8px 14px;background:${DN.white};border-left:4px solid ${DN.teal};border-radius:2px;font-size:10.5px;color:${DN.navyLight};font-style:italic;line-height:1.45 }

  /* Title slide */
  .slide-title { position:relative;overflow:hidden }
  .title-left-bar { position:absolute;top:0;left:0;width:16px;height:100%;background:${DN.teal};z-index:1 }
  .title-gold-bar { position:absolute;top:0;left:0;right:0;height:6px;background:${DN.gold};z-index:2 }
  .title-deco-circle { position:absolute;border-radius:50%;z-index:0 }
  .title-deco-1 { width:320px;height:320px;right:-80px;top:-60px;background:${DN.teal};opacity:.07 }
  .title-deco-2 { width:200px;height:200px;right:-20px;top:40px;background:${DN.teal};opacity:.05 }
  .title-content { position:relative;z-index:3;padding:40px 48px 40px 56px;height:100%;display:flex;flex-direction:column;justify-content:flex-end;box-sizing:border-box }
  .dn-logo-large { font-size:28px;font-weight:700;font-style:italic;margin-bottom:16px }
  .title-divider { width:220px;height:3px;background:${DN.gold};margin-bottom:18px }
  .title-dataset { font-size:30px;font-weight:700;color:${DN.white};line-height:1.2;margin:0 0 8px;max-width:600px }
  .title-subtitle { font-size:15px;color:${DN.tealLight};font-style:italic;margin:0 0 14px }
  .title-meta { font-size:12px;color:${DN.slate};margin-bottom:8px }
  .title-footer { font-size:9px;color:${DN.slate};margin-top:auto }

  /* Closing slide */
  .closing-tas { display:flex;flex-direction:column;gap:12px;max-width:660px }
  .closing-ta { display:flex;align-items:flex-start;gap:14px;font-size:13px;color:${DN.white};line-height:1.5 }
  .closing-ta-num { width:28px;height:28px;background:${DN.teal};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;color:${DN.white};flex-shrink:0;margin-top:1px }

  /* ── Navigator ─────────────────────────────────────────────────────────── */
  #nav-toggle {
    position:fixed!important;top:14px!important;left:14px!important;
    z-index:2147483647!important;
    width:48px!important;height:48px!important;
    padding:0!important;
    background:${DN.navy};border:2px solid ${DN.gold};border-radius:8px;
    color:${DN.gold};cursor:pointer!important;
    display:flex!important;align-items:center;justify-content:center;
    pointer-events:all!important;
    transition:background .15s,border-color .15s;
    box-sizing:border-box!important;
    -webkit-tap-highlight-color:transparent;
    outline:none;
  }
  #nav-toggle svg { pointer-events:none; display:block }
  #nav-toggle:hover { background:${DN.navyMid} }
  #nav-toggle.nav-open { left:302px!important;border-color:${DN.tealLight};background:${DN.navyMid} }

  #nav-panel {
    position:fixed!important;top:0!important;left:0!important;bottom:0!important;
    width:288px;
    background:${DN.navy};border-right:2px solid ${DN.gold};
    z-index:2147483646!important;
    transform:translateX(-100%);transition:transform .22s cubic-bezier(.4,0,.2,1);
    display:flex!important;flex-direction:column;overflow:hidden;
    box-shadow:8px 0 32px rgba(0,0,0,.55);
  }
  .nav-header {
    display:flex;align-items:center;justify-content:space-between;
    padding:14px 16px;border-bottom:1px solid ${DN.navyLight};flex-shrink:0;
    background:${DN.navyMid};
  }
  .nav-header-brand { font-size:16px;font-weight:700;font-style:italic }
  .nav-header-counter { font-size:11px;color:${DN.slate};font-weight:600 }
  .nav-items {
    flex:1;overflow-y:auto;padding:8px 0;
    scrollbar-width:thin;scrollbar-color:${DN.navyLight} transparent;
  }
  .nav-items::-webkit-scrollbar { width:4px }
  .nav-items::-webkit-scrollbar-thumb { background:${DN.navyLight};border-radius:2px }
  .nav-section-hdr {
    font-size:8.5px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;
    color:${DN.slate};padding:10px 16px 4px;
  }
  .nav-item {
    display:flex;align-items:center;gap:10px;width:100%;
    padding:9px 16px;background:none;border:none;cursor:pointer;
    text-align:left;font-family:inherit;transition:background .12s;
    border-left:3px solid transparent;
  }
  .nav-item:hover { background:${DN.navyMid} }
  .nav-item-active {
    background:${DN.navyMid}!important;border-left-color:${DN.teal}!important;
  }
  .nav-item-active .nav-item-label { color:${DN.white}!important;font-weight:600 }
  .nav-item-icon { font-size:14px;flex-shrink:0;width:20px;text-align:center }
  .nav-item-label { flex:1;font-size:11.5px;color:${DN.slate};line-height:1.3;overflow:hidden;text-overflow:ellipsis;white-space:nowrap }
  .nav-item-num { font-size:10px;color:${DN.slateDk};flex-shrink:0;min-width:20px;text-align:right }
  .nav-footer {
    padding:10px 16px;border-top:1px solid ${DN.navyLight};
    font-size:9.5px;color:${DN.slateDk};line-height:1.6;flex-shrink:0;
  }
  .nav-footer kbd {
    background:${DN.navyMid};border:1px solid ${DN.navyLight};border-radius:3px;
    padding:1px 4px;font-size:9px;color:${DN.slate};font-family:inherit;
  }
`

// ── HTML template ─────────────────────────────────────────────────────────────
function buildHTML(datasetName: string, slides: string[], chartsJson: string, nav: SlideCtx['manifest']): string {
  const sectionLabels: Record<string, string> = { demographic: 'Demographics', psychographic: 'Psychographics', core: 'Core Questions' }

  // Group nav items — insert section headers when section changes
  let lastSection: string | undefined = undefined
  const navItems = nav.map((item, idx) => {
    let headerHtml = ''
    const sec = item.section || (idx <= 1 ? '' : 'core')
    if (sec && sec !== lastSection && idx > 1) {
      const label = sectionLabels[sec] || sec.charAt(0).toUpperCase() + sec.slice(1)
      headerHtml = `<div class="nav-section-hdr">${esc(label)}</div>`
      lastSection = sec
    }
    return `${headerHtml}<button class="nav-item" data-slide-idx="${idx}" title="${esc(item.title)}">
      <span class="nav-item-icon">${item.icon}</span>
      <span class="nav-item-label">${esc(trunc(item.title, 36))}</span>
      <span class="nav-item-num">${idx + 1}</span>
    </button>`
  }).join('\n')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(datasetName)} — StoryTime Report</title>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.css">
<style>
  html,body{margin:0;padding:0;width:100%;height:100%;overflow:hidden;background:#0D2B45;font-family:'Inter',system-ui,-apple-system,sans-serif}
  .reveal{width:100%!important;height:100%!important}
  .reveal .slide-number{font-size:12px;background:rgba(0,0,0,.3);color:#7A8BA0;padding:4px 10px;border-radius:4px}
  ${CSS}
</style>
</head>
<body>

<div class="reveal">
<div class="slides">
${slides.join('\n')}
</div>
</div>

<!-- ── Slide navigator (after Reveal — wins stacking order) ───────────────── -->
<button id="nav-toggle" title="Slide menu (N)">
  <svg width="16" height="14" viewBox="0 0 16 14" fill="none"><rect y="0" width="16" height="2" rx="1" fill="currentColor"/><rect y="6" width="16" height="2" rx="1" fill="currentColor"/><rect y="12" width="16" height="2" rx="1" fill="currentColor"/></svg>
</button>

<div id="nav-panel">
  <div class="nav-header">
    <div class="nav-header-brand"><span style="color:${DN.orangeLt}">data</span><span style="color:${DN.tealLight}">nautix</span></div>
    <div id="nav-counter" class="nav-header-counter">1 / ${nav.length}</div>
  </div>
  <div class="nav-items">
    ${navItems}
  </div>
  <div class="nav-footer">Press <kbd>N</kbd> to toggle · <kbd>←</kbd><kbd>→</kbd> to navigate</div>
</div>
<script src="https://cdn.plot.ly/plotly-2.35.0.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/reveal.js@5.1.0/dist/reveal.js"></script>
<script>
const CHARTS = ${chartsJson};
Reveal.initialize({
  hash:true, transition:'fade', width:1280, height:720,
  slideNumber:'c/t', controls:true, progress:true, center:false,
  margin:0.04, minScale:0.2, maxScale:2.0,
  embedded:false, respondToHashChanges:true,
});
function tryRender(section) {
  if (!section) return;
  section.querySelectorAll('[data-chart-id]').forEach(function(el) {
    if (el.dataset.rendered) return;
    var id = el.dataset.chartId;
    if (CHARTS[id]) {
      var cfg = CHARTS[id];
      Plotly.newPlot(el, cfg.data, cfg.layout, {responsive:true,displayModeBar:false});
      el.dataset.rendered = '1';
    }
  });
}
// ── Slide navigator ──────────────────────────────────────────────────────
// Re-append nav elements to body so they're always the last (topmost) nodes,
// Move nav elements to end of body inside 'ready' so they land after all Reveal DOM setup.
var navPanel  = document.getElementById('nav-panel');
var navToggle = document.getElementById('nav-toggle');
var navOpen   = false;

Reveal.on('ready', function(e) {
  document.body.appendChild(navToggle);
  document.body.appendChild(navPanel);
  tryRender(e.currentSlide);
  updateNav(Reveal.getIndices().h);
});
Reveal.on('slidechanged', function(e) { tryRender(e.currentSlide); updateNav(Reveal.getIndices().h); });

function updateNav(activeIdx) {
  document.querySelectorAll('.nav-item[data-slide-idx]').forEach(function(el) {
    var isActive = parseInt(el.dataset.slideIdx) === activeIdx;
    el.classList.toggle('nav-item-active', isActive);
    if (isActive) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  });
  var total = document.querySelectorAll('.nav-item[data-slide-idx]').length;
  var counter = document.getElementById('nav-counter');
  if (counter) counter.textContent = (activeIdx + 1) + ' / ' + total;
}

function setNavOpen(open) {
  navOpen = open;
  navPanel.style.transform = open ? 'translateX(0)' : 'translateX(-100%)';
  navToggle.classList.toggle('nav-open', open);
  navToggle.innerHTML = open
    ? '<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M1 1l12 12M13 1L1 13" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>'
    : '<svg width="16" height="14" viewBox="0 0 16 14" fill="none"><rect y="0" width="16" height="2" rx="1" fill="currentColor"/><rect y="6" width="16" height="2" rx="1" fill="currentColor"/><rect y="12" width="16" height="2" rx="1" fill="currentColor"/></svg>';
}

navToggle.addEventListener('click', function() { setNavOpen(!navOpen); });

document.querySelectorAll('.nav-item[data-slide-idx]').forEach(function(el) {
  el.addEventListener('click', function() {
    Reveal.slide(parseInt(el.dataset.slideIdx));
    setNavOpen(false);
  });
});

// Close panel on click outside
document.addEventListener('click', function(e) {
  if (navOpen && !navPanel.contains(e.target) && !navToggle.contains(e.target)) {
    setNavOpen(false);
  }
});

// Keyboard shortcut: press 'N' to toggle nav
document.addEventListener('keydown', function(e) {
  if ((e.key === 'n' || e.key === 'N') && !e.ctrlKey && !e.metaKey) setNavOpen(!navOpen);
});
</script>
</body>
</html>`
}

// ── POST handler ──────────────────────────────────────────────────────────────
export async function POST(req: Request, { params }: Params) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const selectedFieldNames: string[] = body.fields || []
  const audience:            string   = body.audience || 'stakeholder'
  const instructions:        string   = body.instructions || ''
  const includeThemeSlides:  boolean  = body.includeThemeSlides !== false
  const selectedThemeIds:    string[] = body.selectedThemeIds || []
  const rawFilters: Record<string, any> = body.filters || {}
  const skipAI:              boolean  = body.skipAI === true
  const hasFilters = Object.keys(rawFilters).length > 0

  if (selectedFieldNames.length === 0) {
    return NextResponse.json({ error: 'Select at least one field' }, { status: 400 })
  }

  // Cross-org gate: the dataset lookup uses the service role (bypasses RLS),
  // so it must verify caller ownership or any authed user could export another
  // org's dataset by id. Admin-org may export any (Phase E). Multi-tenancy invariant.
  const { orgId, isAdmin } = await getCallerOrgContext(supabase)

  const service = createServiceRoleClient()

  const { data: dataset } = await service
    .from('datasets').select('id, name, row_count, study_id, org_id, studies(id, name, config)').eq('id', params.datasetId).single()
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  if (!isAdmin && (dataset as any).org_id !== orgId) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })

  const { data: stateRow } = await service
    .from('dataset_state').select('schema_config, analytics, theme_model').eq('dataset_id', params.datasetId).single()
  if (!stateRow) return NextResponse.json({ error: 'Dataset state not found' }, { status: 404 })

  const schema    = stateRow.schema_config
  const analytics = stateRow.analytics
  const allThemes = (stateRow.theme_model as any)?.themes || []

  // Backfill prompts from study config
  const studyConfig = (dataset as any).studies?.config
  if (studyConfig && schema?.fields) {
    schema.fields.forEach(function(f: any) {
      if (f.prompt) return
      if (studyConfig.questions) {
        const q = studyConfig.questions.find((qq: any) => {
          const col = qq.exportLabel || qq.prompt || qq.id
          return f.field === col || f.field.includes(col)
        })
        if (q?.prompt) f.prompt = q.prompt
      }
      if (!f.prompt && f.field.startsWith('psycho_') && studyConfig.psychographicBank) {
        const san = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')
        const pq = studyConfig.psychographicBank.find((pp: any) => san(pp.key) === f.field.replace('psycho_',''))
        if (pq?.q) f.prompt = pq.q
      }
      if (!f.prompt && f.field.startsWith('demo_') && studyConfig.demoFields) {
        const san = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')
        const df = studyConfig.demoFields.find((dd: any) => san(dd.key) === f.field.replace('demo_',''))
        if (df) f.prompt = df.label
      }
    })
  }

  const themes      = selectedThemeIds.length > 0 ? allThemes.filter((t: any) => selectedThemeIds.includes(t.id)) : allThemes
  const sortedThemes = [...themes].sort((a: any, b: any) => (b.count||0) - (a.count||0))
  const datasetName  = dataset.name

  if (!analytics?.fieldSummaries) {
    return NextResponse.json({ error: 'Analytics not yet computed' }, { status: 400 })
  }

  const selectedFields: SelectedField[] = selectedFieldNames
    .map(fieldName => {
      const sf = (schema?.fields || []).find((f: any) => f.field === fieldName)
      if (!sf) return null
      return { field: fieldName, label: sf.label || fieldName, type: sf.type, summary: analytics.fieldSummaries[fieldName] || null, remapping: sf.remapping, valueAliases: sf.valueAliases, section: sf.section || undefined, prompt: sf.prompt }
    }).filter(Boolean) as SelectedField[]

  if (selectedFields.length === 0) {
    return NextResponse.json({ error: 'No valid fields selected' }, { status: 400 })
  }

  // Fetch rows from flat table (fast) with fallback to batched table.
  const allRows: Record<string,any>[] = []
  const MAX_ROWS = hasFilters ? 30_000 : 10_000

  const { count: flatCount } = await service
    .from('dataset_rows_flat')
    .select('id', { count: 'exact', head: true })
    .eq('dataset_id', params.datasetId)

  if ((flatCount || 0) > 0) {
    const FLAT_PAGE = 1000
    let flatOffset = 0
    while (allRows.length < MAX_ROWS) {
      const { data: flatRows, error: flatErr } = await service
        .from('dataset_rows_flat')
        .select('data')
        .eq('dataset_id', params.datasetId)
        .order('row_index', { ascending: true })
        .range(flatOffset, flatOffset + FLAT_PAGE - 1)
      if (flatErr || !flatRows || flatRows.length === 0) break
      for (const fr of flatRows) {
        allRows.push((fr as any).data || fr)
        if (allRows.length >= MAX_ROWS) break
      }
      if (flatRows.length < FLAT_PAGE) break
      flatOffset += FLAT_PAGE
    }
  } else {
    const PAGE = 200
    let page = 0, hasMore = true
    while (hasMore && allRows.length < MAX_ROWS) {
      const from = page * PAGE
      const { data: batchPage, error: bErr } = await service
        .from('dataset_rows')
        .select('rows')
        .eq('dataset_id', params.datasetId)
        .order('batch_index', { ascending: true })
        .range(from, from + PAGE - 1)
      if (bErr || !batchPage || batchPage.length === 0) { hasMore = false; break }
      for (const b of batchPage) {
        for (const r of ((b as any).rows || [])) {
          allRows.push(r)
          if (allRows.length >= MAX_ROWS) { hasMore = false; break }
        }
        if (!hasMore) break
      }
      if (batchPage.length < PAGE) hasMore = false
      page++
    }
  }

  const rowKeyMap: Record<string,string> = {}
  if (allRows.length > 0) for (const k of Object.keys(allRows[0])) rowKeyMap[normalize(k)] = k

  // Apply filters if provided
  if (hasFilters) {
    const filters = deserializeFilters(rawFilters as SerializedFilters)
    const filtered = applyFilters(allRows, filters)
    allRows.length = 0
    for (let fi = 0; fi < filtered.length; fi++) allRows.push(filtered[fi])
  }

  // Recompute field summaries from filtered rows when filters are active
  if (hasFilters) {
    for (const sf of selectedFields) {
      const key = rowKeyMap[normalize(sf.field)] || sf.field
      if (sf.type === 'categorical') {
        const counts: Record<string, number> = {}
        let nonNull = 0
        for (const row of allRows) {
          const v = row[key] != null ? String(row[key]).trim() : ''
          if (v) { counts[v] = (counts[v] || 0) + 1; nonNull++ }
        }
        sf.summary = { ...(sf.summary || {}), counts, nonNull, uniqueCount: Object.keys(counts).length }
      } else if (sf.type === 'numeric') {
        const vals: number[] = []
        for (const row of allRows) {
          const n = parseFloat(String(row[key] ?? ''))
          if (!isNaN(n)) vals.push(n)
        }
        if (vals.length > 0) {
          vals.sort((a, b) => a - b)
          const sum = vals.reduce((s, v) => s + v, 0)
          sf.summary = { ...(sf.summary || {}), nonNull: vals.length, min: vals[0], max: vals[vals.length - 1], avg: Math.round(sum / vals.length * 100) / 100, median: vals[Math.floor(vals.length / 2)] }
        }
      } else if (sf.type === 'open-ended') {
        let nonNull = 0
        for (const row of allRows) { if (row[key] != null && String(row[key]).trim()) nonNull++ }
        sf.summary = { ...(sf.summary || {}), nonNull }
      }
    }
  }

  // Build live verbatim samples for each OE field (20 evenly-spaced responses ≥ 30 chars).
  // For positively-framed fields ("liked most", "best", etc.) filter out complaint-pattern responses.
  if (allRows.length > 0) {
    const htmlRowVal = (row: Record<string,any>, key: string): string => {
      if (row[key] != null) return String(row[key]).trim()
      const actual = rowKeyMap[normalize(key)]
      return actual && row[actual] != null ? String(row[actual]).trim() : ''
    }
    const POSITIVE_FRAME_TERMS = ['liked', 'love', 'best', 'enjoy', 'favour', 'favor', 'positive', 'highlight', 'appreciate', 'great about', 'good about']
    const NEGATIVE_FRAME_TERMS = ['dislik', 'worst', 'complaint', 'problem', 'issue', 'improv', 'suggest', 'concern', 'disappoint', 'frustrat', 'bad about', 'difficult', 'challenge']
    const COMPLAINT_SIGNALS = ["no one", "nobody", "didn't", "did not", "wouldn't", "would not", "couldn't", "could not", "wasn't", "was not", "weren't", "were not", "never", "ignored", "waited", "wait", "rude", "horrible", "terrible", "awful", "unacceptable", "disappointing", "poor service", "not helpful"]
    const isPositiveFrame = (f: SelectedField) => {
      const lbl = (f.label + ' ' + (f.prompt || '')).toLowerCase()
      return POSITIVE_FRAME_TERMS.some(t => lbl.includes(t)) && !NEGATIVE_FRAME_TERMS.some(t => lbl.includes(t))
    }
    const looksLikeComplaint = (text: string) => {
      const lower = text.toLowerCase()
      return COMPLAINT_SIGNALS.filter(s => lower.includes(s)).length >= 2
    }
    selectedFields.forEach(function(f) {
      if (f.type !== 'open-ended') return
      const positiveFrame = isPositiveFrame(f)
      const texts = allRows.map(r => htmlRowVal(r, f.field)).filter(t => {
        if (t.length < 30) return false
        if (positiveFrame && looksLikeComplaint(t)) return false
        return true
      })
      const source = texts.length >= 5 ? texts : allRows.map(r => htmlRowVal(r, f.field)).filter(t => t.length >= 30)
      if (source.length === 0) return
      const n = Math.min(20, source.length)
      const step = source.length / n
      f.liveSample = Array.from({ length: n }, (_, i) => source[Math.floor(i * step)])
    })
  }

  // AI narratives
  let narratives: Narratives = {
    reportTitle: '', executiveSummary: [], keyTakeaways: [],
    fieldInsights: Object.fromEntries(selectedFields.map(f => [f.field, { keyFinding: f.label, narrative: '', implication: '' }])),
  }
  if (!skipAI) {
    try { narratives = await generateNarratives((dataset as any).org_id, datasetName, analytics.totalRows, audience, selectedFields, instructions || undefined) }
    catch (e) { console.error({ at: 'export/html', msg: "AI error", err: e }) }
  }

  // Per-request mutable state (no module-level sharing)
  const ctx: SlideCtx = { chartIndex: 0, charts: {}, manifest: [] }

  // Build slides
  const slides: string[] = []
  slides.push(buildTitleSlide(ctx, datasetName, narratives.reportTitle || '', analytics.totalRows, analytics.computedAt))
  slides.push(buildSummarySlide(ctx, analytics.totalRows, narratives.executiveSummary || [], narratives.keyTakeaways || [], sortedThemes, selectedFields))

  const coreFields   = selectedFields.filter(f => !f.section || f.section === 'core')
  const psychoFields = selectedFields.filter(f => f.section === 'psychographic')
  const demoFields   = selectedFields.filter(f => f.section === 'demographic')

  const openEndedFields = selectedFields.filter(f => f.type === 'open-ended')
  const multiOE = openEndedFields.length > 1

  // Re-compute theme counts per field: denominator = rows with text in THIS field,
  // multi-match so percentage = "% of respondents who mentioned this theme."
  function computeFieldThemes(fieldKey: string, themeList: any[]): any[] {
    if (!themeList.length || !allRows.length) return themeList
    function fRowVal(row: Record<string,any>, key: string): string {
      if (row[key] != null) return String(row[key]).trim()
      const actual = rowKeyMap[normalize(key)]
      return actual && row[actual] != null ? String(row[actual]).trim() : ''
    }
    const nonEmpty = allRows.filter(row => fRowVal(row, fieldKey).length > 0)
    const total = nonEmpty.length || 1
    var fieldThemeRegexes = themeList.map(function(t: any) { return (t.keywords || []).map(function(kw: string) { return buildKwRegex(kw) }) })
    return themeList
      .map(function(t: any, ti: number) {
        var regexes = fieldThemeRegexes[ti]
        const count = nonEmpty.filter(function(row) {
          const text = fRowVal(row, fieldKey).toLowerCase()
          return regexes.some(function(re: RegExp) { return re.test(text) })
        }).length
        return Object.assign({}, t, { count, percentage: Math.round(count / total * 100) })
      })
      .filter(function(t: any) { return t.count > 0 })
      .sort(function(a: any, b: any) { return b.count - a.count })
  }

  async function renderField(f: SelectedField) {
    const ai = narratives.fieldInsights[f.field] || { keyFinding: f.label, narrative: '', implication: '' }
    if (f.type === 'categorical') return buildCategoricalSlide(ctx, f, ai)
    if (f.type === 'numeric')     return buildNumericSlide(ctx, f, ai, allRows, rowKeyMap)
    if (f.type === 'open-ended') {
      const fieldThemes = includeThemeSlides && sortedThemes.length > 0
        ? (allRows.length > 0 ? computeFieldThemes(f.field, sortedThemes) : sortedThemes).slice(0, 8)
        : []
      return buildOpenEndedSlide(ctx, f, ai, fieldThemes)
    }
    return ''
  }

  async function renderFieldWithThemes(f: SelectedField) {
    const s = await renderField(f)
    if (s) slides.push(s)
    // After each open-ended slide, add per-theme detail slides with field-specific counts
    if (f.type === 'open-ended' && includeThemeSlides && sortedThemes.length > 0) {
      const fieldThemes = allRows.length > 0 ? computeFieldThemes(f.field, sortedThemes) : sortedThemes
      const themeSlides = await buildThemeDetailSlides(ctx, fieldThemes, f.label, allRows, rowKeyMap, [f.field], skipAI ? undefined : (dataset as any).org_id)
      themeSlides.forEach(ts => slides.push(ts))
    }
  }

  for (const f of coreFields) await renderFieldWithThemes(f)
  if (psychoFields.length > 0) for (const f of psychoFields) await renderFieldWithThemes(f)
  if (demoFields.length > 0) for (const f of demoFields) await renderFieldWithThemes(f)

  if (narratives.keyTakeaways?.length > 0) {
    slides.push(buildClosingSlide(ctx, datasetName, narratives.keyTakeaways))
  }

  const html     = buildHTML(datasetName, slides, JSON.stringify(ctx.charts), [...ctx.manifest])
  const safeName = datasetName.replace(/[^a-z0-9]/gi, '_').slice(0, 40)
  const filename = safeName + '_report.html'

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type':        'text/html; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  })
}
