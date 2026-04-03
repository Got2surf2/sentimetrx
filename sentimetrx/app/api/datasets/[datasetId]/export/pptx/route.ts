// app/api/datasets/[datasetId]/export/pptx/route.ts
// POST — generate a PowerPoint presentation from dataset analytics.
// Body: { fields: string[], audience: 'executive'|'stakeholder'|'full', datasetName?: string }
// Returns: binary .pptx stream

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic     = 'force-dynamic'
export const maxDuration = 60  // PPTX gen + AI call can take ~15-30s

interface Params { params: { datasetId: string } }

// ── Datanautix brand palette ──────────────────────────────────────────────────
const DN = {
  teal:       '2A7A6F',
  tealDark:   '1D5A52',
  tealLight:  '3D9E91',
  tealPale:   'E6F4F2',
  orange:     'E85A1A',
  orangeLight:'F57042',
  orangePale: 'FEF0E8',
  ink:        '1A1714',
  inkSoft:    '2E2A25',
  cream:      'FAF6F0',
  parchment:  'F2EBE0',
  warmMid:    '8C7E6E',
  warmLight:  'B8ADA0',
  divider:    'E4DDD4',
  white:      'FFFFFF',
}

// ── Layout constants (LAYOUT_WIDE = 13.33" × 7.5") ───────────────────────────
const W  = 13.33
const H  = 7.5
const HX = 0     // header x
const HY = 0     // header y
const HH = 1.0   // header height
const CY = 1.15  // content y (below header)
const CH = H - CY - 0.35  // content height
const FY = H - 0.3         // footer y
const PAD = 0.45  // horizontal padding

// ── Slide helpers ─────────────────────────────────────────────────────────────

function addBackground(slide: any, pptx: any, color = DN.cream) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: W, h: H,
    fill: { color },
    line: { width: 0 },
  })
}

function addHeader(slide: any, pptx: any, title: string, color = DN.teal) {
  slide.addShape(pptx.ShapeType.rect, {
    x: HX, y: HY, w: W, h: HH,
    fill: { color },
    line: { width: 0 },
  })
  slide.addText(title, {
    x: PAD, y: HY + 0.08, w: W - PAD * 2 - 2.8, h: HH - 0.16,
    fontSize: 20, bold: true, color: DN.white,
    valign: 'middle', wrap: true,
  })
}

function addFooter(slide: any, pptx: any, datasetName: string, pageNum: number) {
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: FY - 0.04, w: W, h: 0.02,
    fill: { color: DN.divider }, line: { width: 0 },
  })
  slide.addText('datanautix.com  ·  ' + datasetName, {
    x: PAD, y: FY, w: W * 0.6, h: 0.28,
    fontSize: 8, color: DN.warmMid, valign: 'middle',
  })
  slide.addText(String(pageNum), {
    x: W - PAD - 0.5, y: FY, w: 0.5, h: 0.28,
    fontSize: 8, color: DN.warmMid, align: 'right', valign: 'middle',
  })
}

function addHeaderLogo(slide: any, pptx: any) {
  // "Data" in teal, "nautix" in orange — placed in header right side
  slide.addText('Data', {
    x: W - 2.6, y: HY + 0.05, w: 1.05, h: HH - 0.1,
    fontSize: 18, bold: true, italic: true, color: DN.tealLight,
    valign: 'middle', align: 'right',
  })
  slide.addText('nautix', {
    x: W - 1.55, y: HY + 0.05, w: 1.1, h: HH - 0.1,
    fontSize: 18, bold: true, italic: true, color: DN.orangeLight,
    valign: 'middle', align: 'left',
  })
}

function card(slide: any, pptx: any, x: number, y: number, w: number, h: number, fill = DN.white) {
  slide.addShape(pptx.ShapeType.rect, {
    x, y, w, h,
    fill: { color: fill },
    line: { color: DN.divider, width: 1 },
    rectRadius: 0.08,
  })
}

function label(slide: any, text: string, x: number, y: number, w: number, opts?: any) {
  slide.addText(text, {
    x, y, w, h: 0.25,
    fontSize: 8, bold: true, color: DN.warmMid,
    textTransform: 'uppercase', charSpacing: 1,
    ...(opts || {}),
  })
}

function bullet(text: string): any {
  return { text, options: { bullet: { indent: 15 }, fontSize: 13, color: DN.inkSoft, paraSpaceAfter: 4 } }
}

// ── Truncate long strings ─────────────────────────────────────────────────────
function trunc(s: string, n: number) { return s.length > n ? s.slice(0, n - 1) + '…' : s }

// ── AI narrative generation ───────────────────────────────────────────────────
async function generateNarratives(
  apiKey: string,
  datasetName: string,
  totalRows: number,
  audience: string,
  fields: SelectedField[]
): Promise<{ executive: string[]; fieldInsights: Record<string, { narrative: string; insight: string }> }> {

  const fieldBlocks = fields.map(function(f) {
    let statsStr = ''
    const s = f.summary
    if (!s) return `${f.label} (${f.type}): no data`
    if (s.type === 'categorical') {
      const top5 = Object.entries(s.counts || {}).slice(0, 5).map(([k, v]) => `${k}: ${v}`).join(', ')
      statsStr = `top values: ${top5} | unique: ${s.uniqueCount} | n=${s.nonNull}`
    } else if (s.type === 'numeric') {
      statsStr = `avg=${s.avg?.toFixed?.(1)}, median=${s.median?.toFixed?.(1)}, min=${s.min}, max=${s.max}, n=${s.nonNull}`
    } else if (s.type === 'open-ended') {
      const sample = (s.sample || []).slice(0, 3).map((t: string) => `"${t.slice(0, 80)}"`).join(' | ')
      statsStr = `avg ${s.avgWordCount} words | sample: ${sample}`
    } else if (s.type === 'date') {
      statsStr = `range: ${s.min} to ${s.max} | n=${s.nonNull}`
    }
    return `${f.label} (${f.type}): ${statsStr}`
  }).join('\n')

  const audienceNote = audience === 'executive'
    ? 'Be very concise — C-suite audience. 1 sentence max per insight.'
    : audience === 'stakeholder'
    ? 'Be clear and data-driven. 2 sentences per field insight.'
    : 'Be thorough and detailed. Include nuance and context.'

  const prompt = `You are generating insights for a PowerPoint presentation about a feedback dataset.

Dataset: "${datasetName}" — ${totalRows.toLocaleString()} responses
Audience: ${audience} (${audienceNote})

Field statistics:
${fieldBlocks}

Return ONLY valid JSON with this exact structure:
{
  "executive": ["bullet1", "bullet2", "bullet3"],
  "fieldInsights": {
    ${fields.map(f => `"${f.field}": { "narrative": "...", "insight": "..." }`).join(',\n    ')}
  }
}`

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 2048,
      messages: [{ role: 'user', content: prompt }],
    }),
  })

  if (!res.ok) throw new Error('AI call failed: ' + res.status)
  const data = await res.json()
  const raw  = (data.content?.[0]?.text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')

  try {
    return JSON.parse(raw)
  } catch {
    return {
      executive: ['Dataset analyzed successfully.'],
      fieldInsights: Object.fromEntries(fields.map(f => [f.field, { narrative: '', insight: '' }])),
    }
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────
interface SelectedField {
  field: string
  label: string
  type:  string
  summary: any
}

// ── Slide builders ────────────────────────────────────────────────────────────

function buildTitleSlide(pptx: any, datasetName: string, totalRows: number, computedAt: string | null, pageNum: number) {
  const slide = pptx.addSlide()

  // Full dark background
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color: DN.ink }, line: { width: 0 } })

  // Teal accent strip on left
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 0.18, h: H, fill: { color: DN.teal }, line: { width: 0 } })

  // Logo: "Data" + "nautix"
  slide.addText('Data', { x: PAD + 0.18, y: 1.2, w: 2.2, h: 0.9, fontSize: 48, bold: true, italic: true, color: DN.tealLight, valign: 'middle' })
  slide.addText('nautix', { x: PAD + 2.3, y: 1.2, w: 2.6, h: 0.9, fontSize: 48, bold: true, italic: true, color: DN.orangeLight, valign: 'middle' })

  // Divider line under logo
  slide.addShape(pptx.ShapeType.line, {
    x: PAD + 0.18, y: 2.3, w: 5, h: 0,
    line: { color: DN.warmLight, width: 1 },
  })

  // Dataset name
  slide.addText(datasetName, {
    x: PAD + 0.18, y: 2.5, w: W - PAD * 2 - 0.36, h: 1.5,
    fontSize: 28, bold: true, color: DN.white, wrap: true, valign: 'top',
  })

  // Meta row
  const meta = totalRows.toLocaleString() + ' responses'
    + (computedAt ? '  ·  ' + new Date(computedAt).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : '')
  slide.addText(meta, {
    x: PAD + 0.18, y: 4.3, w: W - 2, h: 0.4,
    fontSize: 14, color: DN.warmLight, valign: 'middle',
  })

  // "Powered by Datanautix" badge
  slide.addText('Powered by datanautix.com', {
    x: W - 3.5, y: H - 0.55, w: 3, h: 0.35,
    fontSize: 9, color: DN.warmMid, align: 'right', italic: true,
  })
}

function buildSummarySlide(pptx: any, datasetName: string, totalRows: number, bullets: string[], themes: any[], pageNum: number) {
  const slide = pptx.addSlide()
  addBackground(slide, pptx)
  addHeader(slide, pptx, 'Executive Summary', DN.teal)
  addHeaderLogo(slide, pptx)

  // Key metrics row
  const metrics = [
    { label: 'Responses', value: totalRows.toLocaleString() },
    { label: 'Themes Found', value: String(themes.length || '—') },
  ]
  metrics.forEach(function(m, i) {
    const x = PAD + i * 2.8
    card(slide, pptx, x, CY, 2.4, 1.1, DN.tealPale)
    slide.addText(m.value, { x: x + 0.15, y: CY + 0.1, w: 2.1, h: 0.55, fontSize: 28, bold: true, color: DN.teal, valign: 'middle' })
    slide.addText(m.label, { x: x + 0.15, y: CY + 0.65, w: 2.1, h: 0.3, fontSize: 9, color: DN.warmMid, bold: true })
  })

  // Key insights bullets
  label(slide, 'KEY INSIGHTS', PAD, CY + 1.3, 4)
  const bulletItems = bullets.slice(0, 5).map(bullet)
  if (bulletItems.length) {
    slide.addText(bulletItems, {
      x: PAD, y: CY + 1.6, w: W - PAD * 2 - 0.2, h: CH - 1.6,
      fontSize: 13, color: DN.inkSoft, valign: 'top',
    })
  }

  // Top themes if available
  if (themes.length > 0) {
    const themeX = W / 2 + 0.3
    label(slide, 'TOP THEMES', themeX, CY + 1.3, 5)
    themes.slice(0, 6).forEach(function(t, i) {
      const ty = CY + 1.65 + i * 0.62
      slide.addShape(pptx.ShapeType.rect, { x: themeX, y: ty, w: 0.08, h: 0.34, fill: { color: (t.color || '2A7A6F').replace('#', '') }, line: { width: 0 } })
      slide.addText(trunc(t.name, 32), { x: themeX + 0.18, y: ty, w: 4.5, h: 0.22, fontSize: 12, bold: true, color: DN.ink })
      slide.addText((t.count || 0) + ' hits · ' + (t.percentage || 0) + '%', { x: themeX + 0.18, y: ty + 0.22, w: 4.5, h: 0.18, fontSize: 9, color: DN.warmMid })
    })
  }

  addFooter(slide, pptx, datasetName, pageNum)
}

function buildOpenEndedSlide(pptx: any, datasetName: string, f: SelectedField, ai: { narrative: string; insight: string }, audience: string, themes: any[], pageNum: number) {
  const slide = pptx.addSlide()
  addBackground(slide, pptx)
  addHeader(slide, pptx, f.label, DN.teal)
  addHeaderLogo(slide, pptx)

  const s = f.summary
  const quotes: string[] = (s?.sample || []).slice(0, audience === 'full' ? 8 : audience === 'stakeholder' ? 5 : 3)
  const quoteCols = quotes.length > 4 ? 2 : 1
  const colW = quoteCols === 2 ? (W - PAD * 2 - 0.3) / 2 : W - PAD * 2

  // Stats bar
  if (s) {
    const stats = [
      { k: 'Responses', v: (s.nonNull || 0).toLocaleString() },
      { k: 'Avg Words', v: String(s.avgWordCount || '—') },
    ]
    stats.forEach(function(st, i) {
      const x = PAD + i * 2.4
      slide.addText(st.v, { x, y: CY, w: 2.1, h: 0.48, fontSize: 22, bold: true, color: DN.teal })
      slide.addText(st.k, { x, y: CY + 0.46, w: 2.1, h: 0.22, fontSize: 9, color: DN.warmMid, bold: true })
    })
  }

  // AI narrative
  if (ai.narrative) {
    slide.addText(ai.narrative, {
      x: PAD + 5.1, y: CY - 0.02, w: W - PAD - 5.4, h: 0.8,
      fontSize: 12, color: DN.inkSoft, italic: true, valign: 'middle', wrap: true,
    })
  }

  const quotesY = CY + 0.9

  // Quotes
  label(slide, 'SAMPLE RESPONSES', PAD, quotesY - 0.22, 4)
  quotes.forEach(function(q, i) {
    const col = quoteCols === 2 ? (i % 2) : 0
    const row = quoteCols === 2 ? Math.floor(i / 2) : i
    const qx = PAD + col * (colW + 0.3)
    const availH = CH - quotesY + CY - 0.18
    const qh = availH / (quoteCols === 2 ? Math.ceil(quotes.length / 2) : quotes.length) - 0.12
    const qy = quotesY + row * (qh + 0.12)

    slide.addShape(pptx.ShapeType.rect, { x: qx, y: qy, w: colW, h: qh, fill: { color: DN.parchment }, line: { color: DN.divider, width: 1 }, rectRadius: 0.06 })
    slide.addShape(pptx.ShapeType.rect, { x: qx, y: qy, w: 0.06, h: qh, fill: { color: DN.teal }, line: { width: 0 } })
    slide.addText('\u201C' + trunc(q, 180) + '\u201D', { x: qx + 0.15, y: qy + 0.06, w: colW - 0.22, h: qh - 0.12, fontSize: 10, color: DN.inkSoft, italic: true, valign: 'top', wrap: true })
  })

  addFooter(slide, pptx, datasetName, pageNum)
}

function buildCategoricalSlide(pptx: any, datasetName: string, f: SelectedField, ai: { narrative: string; insight: string }, pageNum: number) {
  const slide = pptx.addSlide()
  addBackground(slide, pptx)
  addHeader(slide, pptx, f.label, DN.tealDark)
  addHeaderLogo(slide, pptx)

  const s = f.summary
  const entries = Object.entries(s?.counts || {} as Record<string, number>)
    .sort((a, b) => (b[1] as number) - (a[1] as number))
    .slice(0, 12)

  if (entries.length > 0) {
    const total = entries.reduce((sum, [, v]) => sum + (v as number), 0)
    const labels = entries.map(([k]) => trunc(k, 24))
    const values = entries.map(([, v]) => v as number)

    const CHART_COLORS = [DN.teal, DN.orange, DN.tealLight, DN.orangeLight,
      '4BA89A', 'F58A5C', '2E7A6F', 'D4501A',
      '5CB3A6', 'E87A4A', '3D9E91', 'B84010'].map(c => c.replace('#', ''))

    slide.addChart('bar', [{ name: f.label, labels, values }], {
      x: PAD, y: CY + 0.1, w: W * 0.58 - PAD, h: CH - 0.5,
      barDir: 'bar',  // horizontal bars
      chartColors: CHART_COLORS,
      showLegend: false,
      showValue: true,
      dataLabelColor: DN.white,
      dataLabelFontSize: 9,
      valAxisLabelColor: DN.warmMid,
      catAxisLabelColor: DN.inkSoft,
      catAxisLabelFontSize: 10,
    })

    // Stats + AI insight on right
    const rx = W * 0.58 + 0.2
    const rw = W - rx - 0.2

    card(slide, pptx, rx, CY, rw, 0.85, DN.tealPale)
    slide.addText((s.nonNull || 0).toLocaleString(), { x: rx + 0.15, y: CY + 0.06, w: rw - 0.3, h: 0.42, fontSize: 26, bold: true, color: DN.teal })
    slide.addText('Responses  ·  ' + (s.uniqueCount || 0) + ' unique values', { x: rx + 0.15, y: CY + 0.5, w: rw - 0.3, h: 0.24, fontSize: 9, color: DN.warmMid, bold: true })

    if (ai.narrative) {
      label(slide, 'INSIGHT', rx, CY + 1.05, rw)
      slide.addText(ai.narrative, { x: rx, y: CY + 1.3, w: rw, h: CH - 1.3, fontSize: 12, color: DN.inkSoft, italic: true, valign: 'top', wrap: true })
    }
  }

  addFooter(slide, pptx, datasetName, pageNum)
}

function buildNumericSlide(pptx: any, datasetName: string, f: SelectedField, ai: { narrative: string; insight: string }, pageNum: number) {
  const slide = pptx.addSlide()
  addBackground(slide, pptx)
  addHeader(slide, pptx, f.label, DN.tealDark)
  addHeaderLogo(slide, pptx)

  const s = f.summary

  // Stats row
  const stats = [
    { k: 'Avg', v: s?.avg?.toFixed?.(1) ?? '—' },
    { k: 'Median', v: s?.median?.toFixed?.(1) ?? '—' },
    { k: 'Min', v: String(s?.min ?? '—') },
    { k: 'Max', v: String(s?.max ?? '—') },
    { k: 'Responses', v: (s?.nonNull || 0).toLocaleString() },
  ]
  const sw = (W - PAD * 2) / stats.length
  stats.forEach(function(st, i) {
    const sx = PAD + i * sw
    card(slide, pptx, sx, CY, sw - 0.12, 0.9, i === 0 ? DN.tealPale : DN.cream)
    slide.addText(st.v, { x: sx + 0.1, y: CY + 0.05, w: sw - 0.3, h: 0.5, fontSize: 22, bold: true, color: i === 0 ? DN.teal : DN.inkSoft })
    slide.addText(st.k, { x: sx + 0.1, y: CY + 0.58, w: sw - 0.3, h: 0.22, fontSize: 9, color: DN.warmMid, bold: true })
  })

  // Histogram chart
  const histBuckets: any[] = s?.histogram || []
  if (histBuckets.length > 0) {
    const hLabels = histBuckets.map((b: any) => Number(b.min.toFixed(1)) + '–' + Number(b.max.toFixed(1)))
    const hValues = histBuckets.map((b: any) => b.count)
    slide.addChart('bar', [{ name: f.label, labels: hLabels, values: hValues }], {
      x: PAD, y: CY + 1.1, w: W * 0.6 - PAD, h: CH - 1.15,
      barDir: 'col',
      chartColors: [DN.teal],
      showLegend: false,
      showValue: false,
      valAxisLabelColor: DN.warmMid,
      catAxisLabelColor: DN.warmMid,
      catAxisLabelFontSize: 8,
    })
  }

  // AI insight on right
  const rx = W * 0.6 + 0.15
  const rw = W - rx - 0.2
  if (ai.narrative) {
    label(slide, 'ANALYSIS', rx, CY + 1.1, rw)
    slide.addText(ai.narrative, { x: rx, y: CY + 1.35, w: rw, h: CH - 1.35, fontSize: 12, color: DN.inkSoft, italic: true, valign: 'top', wrap: true })
  }

  addFooter(slide, pptx, datasetName, pageNum)
}

// ── Main route handler ────────────────────────────────────────────────────────

export async function POST(req: Request, { params }: Params) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const selectedFieldNames: string[] = body.fields || []
  const audience: string             = body.audience || 'stakeholder'

  if (selectedFieldNames.length === 0) {
    return NextResponse.json({ error: 'Select at least one field' }, { status: 400 })
  }

  const service = createServiceRoleClient()

  // Load dataset + state
  const { data: dataset } = await service
    .from('datasets').select('id, name, row_count, ana_library').eq('id', params.datasetId).single()

  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })

  const { data: stateRow } = await service
    .from('dataset_state')
    .select('schema_config, analytics, theme_model')
    .eq('dataset_id', params.datasetId)
    .single()

  if (!stateRow) return NextResponse.json({ error: 'Dataset state not found' }, { status: 404 })

  const schema    = stateRow.schema_config
  const analytics = stateRow.analytics
  const themes    = (stateRow.theme_model as any)?.themes || []
  const datasetName = dataset.name

  if (!analytics?.fieldSummaries) {
    return NextResponse.json({ error: 'Analytics not yet computed — run compute first' }, { status: 400 })
  }

  // Build selected fields list with summaries
  const selectedFields: SelectedField[] = selectedFieldNames
    .map(function(fieldName) {
      const schemaField = (schema?.fields || []).find((f: any) => f.field === fieldName)
      if (!schemaField) return null
      const summary = analytics.fieldSummaries[fieldName] || null
      return {
        field:   fieldName,
        label:   schemaField.label || fieldName,
        type:    schemaField.type,
        summary,
      }
    })
    .filter(Boolean) as SelectedField[]

  if (selectedFields.length === 0) {
    return NextResponse.json({ error: 'No valid fields selected' }, { status: 400 })
  }

  // AI summaries
  let narratives: any = { executive: [], fieldInsights: {} }
  const apiKey = process.env.ANTHROPIC_API_KEY
  if (apiKey) {
    try {
      narratives = await generateNarratives(apiKey, datasetName, analytics.totalRows, audience, selectedFields)
    } catch (e) {
      console.error('[export/pptx] AI error:', e)
    }
  }

  // ── Build PPTX ─────────────────────────────────────────────────────────────
  const pptxgen = (await import('pptxgenjs')).default
  const pptx    = new pptxgen()
  pptx.layout   = 'LAYOUT_WIDE'
  pptx.author   = 'Datanautix'
  pptx.company  = 'Datanautix'
  pptx.subject  = datasetName + ' — Analysis Report'
  pptx.title    = datasetName

  let page = 1

  // Slide 1: Title
  buildTitleSlide(pptx, datasetName, analytics.totalRows, analytics.computedAt, page++)

  // Slide 2: Executive Summary (always included)
  buildSummarySlide(pptx, datasetName, analytics.totalRows, narratives.executive || [], themes, page++)

  // Field slides — ordered by type (open-ended first, then categorical, then numeric, then date)
  const ordered = [
    ...selectedFields.filter(f => f.type === 'open-ended'),
    ...selectedFields.filter(f => f.type === 'categorical'),
    ...selectedFields.filter(f => f.type === 'numeric'),
    ...selectedFields.filter(f => f.type === 'date'),
  ]

  for (const f of ordered) {
    const ai = narratives.fieldInsights?.[f.field] || { narrative: '', insight: '' }

    if (f.type === 'open-ended') {
      buildOpenEndedSlide(pptx, datasetName, f, ai, audience, themes, page++)
    } else if (f.type === 'categorical') {
      if (audience !== 'executive') buildCategoricalSlide(pptx, datasetName, f, ai, page++)
    } else if (f.type === 'numeric') {
      if (audience !== 'executive') buildNumericSlide(pptx, datasetName, f, ai, page++)
    }
  }

  // Write to buffer
  const buffer = await pptx.write({ outputType: 'nodebuffer' }) as Buffer
  const safeName = datasetName.replace(/[^a-z0-9]/gi, '_').slice(0, 40)
  const filename = safeName + '_report_' + new Date().toISOString().slice(0, 10) + '.pptx'

  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': 'attachment; filename="' + filename + '"',
      'Content-Length': String(buffer.length),
    },
  })
}
