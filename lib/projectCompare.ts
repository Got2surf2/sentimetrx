// lib/projectCompare.ts
//
// The comparison engine behind TWO collection-report purposes — they're the same
// shape (themes × columns), only the framing differs:
//   - competitive : each column is a COMPETITOR; compare & contrast (who owns
//                   each theme, who lags, where the gaps are).
//   - brand_360   : each column is a DATA SOURCE for ONE brand (Google reviews +
//                   CSAT + agent + town hall); triangulate (where sources agree
//                   vs diverge, what each uniquely surfaces).
//
// Each input carries per-input themes (lib/projectReport ProjectInputTheme). The
// AI aligns synonymous theme labels across columns into unified rows + a framed
// one-liner; the matrix cells (count / sentiment / rating) are computed in code
// so the numbers reconcile. Renders on the shared PDF design system (lib/pdf).

import { callAI } from '@/lib/ai'
import type { ProjectInputModel, ProjectInputTheme, ProjectSource } from '@/lib/projectReport'
import { PDF, pdfDoc, pdfCoverHeader, pdfSection, pdfKpiGrid, pdfSentPill, pdfPill, pdfEsc as esc } from '@/lib/pdf'

export type ComparePurpose = 'competitive' | 'brand_360'

export interface CompareCell {
  present: boolean
  count: number
  pct: number | null         // count ÷ that column's total rows × 100 — normalizes
                             // across different-sized competitors (the headline number)
  sentiment: string          // dominant
  avgRating: number | null
}
export interface CompareRow {
  theme: string
  insight: string
  cells: Record<string, CompareCell>   // keyed by column name
  total: number
}
export interface CompareReportModel {
  name: string
  purpose: ComparePurpose
  /** Competitive only — the focus competitor (column name) the report deep-dives;
   *  the others sit around it as the benchmark field. null for brand_360. */
  primary: string | null
  generatedAt: string
  columns: ProjectSource[]
  rows: CompareRow[]
  /** Second matrix over the ABSA taxonomy ("Dimensions") subs — same shape as
   *  rows, populated only when ≥1 input is taxonomy-classified; else []. */
  dimensionRows: CompareRow[]
  execSummary: string
  method: string
}

// Each input exposes its themes OR its dimensions as the same ProjectInputTheme
// shape — the matrix engine runs once per lens via this selector.
type LensSelector = (i: ProjectInputModel) => ProjectInputTheme[]

const norm = (s: string) => s.trim().toLowerCase()
function dominant(themes: { sentiment: string; count: number }[]): string {
  const tally: Record<string, number> = {}
  for (const t of themes) { const k = (t.sentiment || 'neutral').toLowerCase(); tally[k] = (tally[k] || 0) + (t.count || 0) }
  let best = 'neutral', bn = -1
  for (const [k, n] of Object.entries(tally)) if (n > bn) { best = k; bn = n }
  return best
}

// ── AI: align synonymous theme labels across columns into unified rows ────────
interface AlignedRow { theme: string; members: { column: string; label: string }[]; insight: string }

async function alignThemes(columns: ProjectInputModel[], selector: LensSelector, lensNoun: string, purpose: ComparePurpose, projectName: string, primary: string | null): Promise<AlignedRow[]> {
  const blocks = columns.map(c =>
    `## ${c.source.name} (${c.source.rowCount.toLocaleString()} total)${primary && c.source.name === primary ? ' [PRIMARY FOCUS]' : ''}\n` +
    selector(c).map(t => {
      const pct = c.source.rowCount > 0 ? Math.round((t.count / c.source.rowCount) * 100) : null
      return `- "${t.label}" (${pct != null ? pct + '% of reviews, ' : ''}${t.count} mentions, ${t.sentiment}${t.avgRating != null ? `, ${t.avgRating.toFixed(1)}★` : ''})`
    }).join('\n'),
  ).join('\n\n')
  const normalize = `IMPORTANT: the brands differ in total review volume, so compare on a NORMALIZED basis — use the % of each brand's reviews (the "% of reviews" figure), NOT raw mention counts. Lead with the %; put raw counts in parentheses if useful. Never imply one brand "leads" just because it has more raw mentions when it simply has more reviews.`
  const framing = purpose === 'competitive'
    ? `This is a deep-dive on "${primary}" with the other competitors as the benchmark field. For each unified theme write a one-sentence insight FROM ${primary}'s POV — does ${primary} lead or lag the field here (on a % basis), and against whom. ${normalize}`
    : `These are different DATA SOURCES for ONE brand. For each unified theme write a one-sentence TRIANGULATION insight — do the sources agree or diverge, and does any source uniquely surface it. ${normalize}`
  const res = await callAI({
    tier: 'standard', maxTokens: 2000, timeoutMs: 60000,
    system: `You are comparing ${columns.length} inputs for "${projectName}". Each input has its own mined ${lensNoun}. Merge ${lensNoun} that mean the same thing across inputs into unified rows (e.g. "Food Quality" + "Taste" → one). Use ONLY the labels provided. ${framing}
Return ONLY JSON, no markdown:
{"rows":[{"theme":"Unified Theme","members":[{"column":"exact input name","label":"exact raw label"}],"insight":"one sentence"}]}
Every raw label must map into exactly one row. Order rows by importance.`,
    messages: [{ role: 'user', content: blocks }],
  })
  try {
    const parsed = JSON.parse(res.text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim())
    const rows = Array.isArray(parsed.rows) ? parsed.rows : []
    return rows.filter((r: any) => r && typeof r.theme === 'string' && Array.isArray(r.members))
      .map((r: any) => ({
        theme: String(r.theme).trim(),
        members: r.members.filter((m: any) => m && m.column && m.label).map((m: any) => ({ column: String(m.column), label: String(m.label) })),
        insight: typeof r.insight === 'string' ? r.insight.trim() : '',
      }))
  } catch { return [] }
}

async function compareExec(model: Omit<CompareReportModel, 'execSummary'>): Promise<string> {
  const cols = model.columns.map(c => c.name).join(', ')
  const rowLines = model.rows.slice(0, 12).map(r => {
    const per = model.columns.map(c => { const cell = r.cells[c.name]; return cell?.present ? `${c.name}:${cell.pct != null ? cell.pct + '% ' : ''}${cell.sentiment}${cell.avgRating != null ? `/${cell.avgRating.toFixed(1)}★` : ''} (${cell.count})` : `${c.name}:—` }).join(', ')
    return `- ${r.theme}: ${per}${r.insight ? ` — ${r.insight}` : ''}`
  }).join('\n')
  const normalize = `Compare on a NORMALIZED basis: cite the % of each brand's reviews (shown per cell), not raw mention counts — the brands differ in size, so raw counts aren't comparable. Put raw counts in parentheses if useful.`
  const framing = model.purpose === 'competitive'
    ? `Write the executive summary of a COMPETITIVE deep-dive on "${model.primary}", benchmarked against the field (${cols}). Lead with how ${model.primary} performs overall, then where ${model.primary} leads the field and where it lags (and against whom), on the most important themes. ${normalize} 3-5 sentences, specific, no invented numbers.`
    : `Write the executive summary of a BRAND 360 report triangulating ${cols} (different sources for one brand). Name where the sources agree, where they diverge, and what each uniquely reveals. ${normalize} 3-5 sentences, specific, no invented numbers.`
  const res = await callAI({
    tier: 'standard', maxTokens: 700, timeoutMs: 45000,
    system: framing,
    messages: [{ role: 'user', content: `Themes across inputs:\n${rowLines}` }],
  })
  return res.text.trim()
}

// ── Build ────────────────────────────────────────────────────────────────────
export interface CompareBuildOpts { synthesize?: boolean; primaryId?: string }

// Build ONE matrix (themes × columns) for a given lens. Same align→fallback→cell
// pipeline; called once for themes and once for dimensions.
async function buildMatrix(
  ordered: ProjectInputModel[], columns: ProjectSource[], selector: LensSelector,
  lensNoun: string, purpose: ComparePurpose, name: string, primary: string | null, synthesize: boolean,
): Promise<CompareRow[]> {
  // label(lower) → theme/dimension, per column
  const byCol = new Map(ordered.map(i => [i.source.name, new Map(selector(i).map(t => [norm(t.label), t]))]))

  let aligned: AlignedRow[] = []
  if (synthesize && ordered.some(i => selector(i).length)) {
    try { aligned = await alignThemes(ordered, selector, lensNoun, purpose, name, primary) } catch { aligned = [] }
  }
  // Fallback / unplaced labels → 1:1 rows by exact label across columns.
  const placed = new Set<string>()  // `${column}|${labelLower}`
  for (const r of aligned) for (const m of r.members) placed.add(`${m.column}|${norm(m.label)}`)
  for (const i of ordered) for (const t of selector(i)) {
    const key = `${i.source.name}|${norm(t.label)}`
    if (placed.has(key)) continue
    // group same label across columns into one row
    let row = aligned.find(r => norm(r.theme) === norm(t.label))
    if (!row) { row = { theme: t.label, members: [], insight: '' }; aligned.push(row) }
    row.members.push({ column: i.source.name, label: t.label })
    placed.add(key)
  }

  return aligned.map(r => {
    const cells: Record<string, CompareCell> = {}
    let total = 0
    for (const col of columns) {
      const colThemes = byCol.get(col.name)
      const members = r.members.filter(m => m.column === col.name).map(m => colThemes?.get(norm(m.label))).filter(Boolean) as { sentiment: string; count: number; avgRating: number | null }[]
      if (members.length === 0) { cells[col.name] = { present: false, count: 0, pct: null, sentiment: 'neutral', avgRating: null }; continue }
      const count = members.reduce((n, m) => n + (m.count || 0), 0)
      const ratings = members.map(m => m.avgRating).filter((x): x is number => typeof x === 'number')
      const pct = col.rowCount > 0 ? Math.round((count / col.rowCount) * 100) : null
      cells[col.name] = { present: true, count, pct, sentiment: dominant(members), avgRating: ratings.length ? ratings.reduce((a, b) => a + b, 0) / ratings.length : null }
      total += count
    }
    return { theme: r.theme, insight: r.insight, cells, total }
  }).sort((a, b) => b.total - a.total)
}

export async function buildCompareModel(name: string, purpose: ComparePurpose, inputs: ProjectInputModel[], generatedAt: string, opts: CompareBuildOpts = {}): Promise<CompareReportModel> {
  // Competitive deep-dives on a PRIMARY focus (the designated dataset, else the
  // first input) and orders it first; brand_360 has no primary.
  let ordered = inputs
  let primary: string | null = null
  if (purpose === 'competitive' && inputs.length > 0) {
    const focus = (opts.primaryId && inputs.find(i => i.source.id === opts.primaryId)) || inputs[0]
    primary = focus.source.name
    ordered = [focus, ...inputs.filter(i => i !== focus)]
  }

  const columns = ordered.map(i => i.source)
  const synthesize = opts.synthesize !== false

  const rows = await buildMatrix(ordered, columns, i => i.themes, 'themes', purpose, name, primary, synthesize)
  // Second matrix over ABSA Dimensions — only when ≥1 input is taxonomy-classified.
  const dimensionRows = ordered.some(i => i.dimensions.length)
    ? await buildMatrix(ordered, columns, i => i.dimensions, 'dimensions', purpose, name, primary, synthesize)
    : []

  const dimNote = dimensionRows.length > 0
    ? ' A second matrix compares the ABSA Dimensions (a fixed aspect taxonomy applied to the review text), where the inputs carry it.'
    : ''
  const base: Omit<CompareReportModel, 'execSummary'> = {
    name, purpose, primary, generatedAt, columns, rows, dimensionRows,
    method: (purpose === 'competitive'
      ? `Deep-dive on "${primary}" benchmarked against ${columns.length - 1} competitor(s). Each row is a theme aligned across inputs; cells show each competitor's volume + sentiment (+ avg rating for review data). Themes merged by AI; counts computed in code.`
      : `Triangulates ${columns.length} data sources for one brand. Each row is a theme aligned across sources; cells show each source's volume + sentiment. Themes merged by AI; counts computed in code.`) + dimNote,
  }
  let execSummary = ''
  if (opts.synthesize !== false && rows.length > 0) { try { execSummary = await compareExec(base) } catch { execSummary = '' } }
  return { ...base, execSummary }
}

// ── Render (on the shared PDF design system) ─────────────────────────────────
function kindBadge(kind: string): string {
  const map: Record<string, [string, string, string]> = {
    reviews: ['★ Reviews', PDF.teal, '#f0fdfa'], survey: ['◔ CSAT', '#7c3aed', '#f5f3ff'],
    town_hall: ['🎙 Town Hall', PDF.orange, '#fff7ed'], agent: ['🤖 Agent', PDF.teal, '#f0fdfa'],
    dataset: ['◻ Data', PDF.mute, '#f1f5f9'],
  }
  const [label, fg, bg] = map[kind] || map.dataset
  return `<span style="font-size:${PDF.size.micro}px;font-weight:700;color:${fg};background:${bg};border-radius:5px;padding:1px 7px;white-space:nowrap">${label}</span>`
}

function cellHtml(cell: CompareCell): string {
  if (!cell.present) return `<td style="text-align:center;color:${PDF.faint};border:1px solid ${PDF.line};padding:6px 4px;font-size:${PDF.size.tiny}px">—</td>`
  const pal: Record<string, string> = { positive: '#ecfdf5', negative: '#fef2f2', mixed: '#fffbeb', neutral: '#f1f5f9' }
  const fg: Record<string, string> = { positive: '#059669', negative: '#dc2626', mixed: '#b45309', neutral: '#475569' }
  const s = (cell.sentiment || 'neutral').toLowerCase()
  const rating = cell.avgRating != null ? ` · ${cell.avgRating.toFixed(1)}★` : ''
  // Normalized: % of that competitor's rows on this theme (the headline), raw count
  // in parens — so different-sized competitors are comparable.
  const vol = cell.pct != null ? `${cell.pct}% <span style="color:${PDF.faint}">(${cell.count.toLocaleString()})</span>` : cell.count.toLocaleString()
  return `<td style="text-align:center;border:1px solid ${PDF.line};padding:6px 4px;background:${pal[s] || pal.neutral}"><div style="font-size:${PDF.size.tiny}px;font-weight:700;color:${fg[s] || fg.neutral};text-transform:capitalize">${esc(s)}</div><div style="font-size:${PDF.size.micro}px;color:${PDF.mute}">${vol}${rating}</div></td>`
}

export function renderCompareReportHtml(model: CompareReportModel): string {
  const isComp = model.purpose === 'competitive'
  const colName = isComp ? 'competitor' : 'source'

  const head = isComp
    ? pdfCoverHeader({
        eyebrow: 'Competitive Deep-Dive',
        title: model.primary || model.name,
        subtitle: `Benchmarked against ${model.columns.length - 1} competitor${model.columns.length - 1 === 1 ? '' : 's'} · ${model.rows.length} themes · generated ${esc(fmt(model.generatedAt))}`,
      })
    : pdfCoverHeader({
        eyebrow: 'Brand 360 Report',
        title: model.name,
        subtitle: `${model.columns.length} source${model.columns.length === 1 ? '' : 's'} · ${model.rows.length} themes · generated ${esc(fmt(model.generatedAt))}`,
      })

  const overview = pdfSection('Executive summary',
    (model.execSummary ? `<p style="font-size:${PDF.size.body}px;line-height:1.65;color:${PDF.body};margin:0 0 14px;white-space:pre-wrap">${esc(model.execSummary)}</p>` : '') +
    pdfKpiGrid([
      { value: model.columns.length, label: isComp ? 'Competitors' : 'Sources' },
      { value: model.rows.length, label: 'Themes compared' },
      { value: model.columns.reduce((n, c) => n + c.rowCount, 0).toLocaleString(), label: 'Rows analyzed' },
    ]),
    { keepWith: '', margin: '22px' })

  // Columns manifest
  const manifest = pdfSection(isComp ? 'Competitors' : 'Sources',
    `<div style="display:flex;flex-direction:column;gap:8px">` +
    model.columns.map(c => {
      const isFocus = isComp && c.name === model.primary
      return `<div style="display:flex;align-items:center;gap:10px;border:1px solid ${isFocus ? PDF.teal : PDF.line};border-radius:10px;padding:9px 12px;background:${isFocus ? '#f0fdfa' : '#fff'}">${kindBadge(c.kind)}<span style="font-weight:700;color:${PDF.ink};font-size:13px">${esc(c.name)}</span>${isFocus ? pdfPill('★ Focus', { fg: '#fff', bg: PDF.teal }) : ''}<span style="margin-left:auto;font-size:${PDF.size.tiny}px;color:${PDF.faint}">${c.rowCount.toLocaleString()} rows</span></div>`
    }).join('') +
    `</div>`,
    { keepWith: '' })

  // Comparison matrix (themes × columns) — reused for the Dimensions lens.
  const matrixTable = (rows: CompareRow[], rowHeader: string): string => {
    const header = `<tr><th style="text-align:left;border:1px solid ${PDF.line};padding:6px 8px;background:${PDF.panel};font-size:${PDF.size.tiny}px;color:${PDF.ink}">${esc(rowHeader)}</th>` +
      model.columns.map(c => {
        const isFocus = isComp && c.name === model.primary
        return `<th style="border:1px solid ${PDF.line};padding:6px 4px;background:${isFocus ? PDF.teal : PDF.panel};font-size:${PDF.size.micro}px;color:${isFocus ? '#fff' : PDF.ink}">${esc(c.name)}${isFocus ? ' ★' : ''}</th>`
      }).join('') + `</tr>`
    const body = rows.map(r =>
      `<tr class="keep"><td style="border:1px solid ${PDF.line};padding:6px 8px;font-size:${PDF.size.tiny}px;font-weight:700;color:${PDF.ink}">${esc(r.theme)}</td>` +
      model.columns.map(c => cellHtml(r.cells[c.name])).join('') + `</tr>`).join('')
    return `<table style="width:100%;border-collapse:collapse;table-layout:fixed">${header}${body}</table>`
  }
  const matrixNote = (unit: string): string =>
    `<p class="faint" style="font-size:${PDF.size.tiny}px;margin:8px 0 0">Each cell: the dominant sentiment + the <strong>% of that ${colName}'s reviews</strong> on the ${unit} (raw count in parentheses)${isComp ? ', plus avg rating' : ''} — normalized so different-sized ${colName}s are comparable. "—" = the ${unit} didn't surface for that ${colName}.</p>`
  const insightsHtml = (rows: CompareRow[]): string =>
    rows.filter(r => r.insight).slice(0, 14).map(r =>
      `<div class="keep" style="margin:0 0 10px"><div style="font-size:13px;font-weight:800;color:${PDF.ink}">${esc(r.theme)}</div><p style="font-size:13px;line-height:1.55;color:${PDF.body};margin:2px 0 0">${esc(r.insight)}</p></div>`).join('')

  const matrix = pdfSection('Theme comparison', matrixTable(model.rows, 'Theme') + matrixNote('theme'), { keepWith: '', margin: '26px' })

  // Per-theme insights (the comparative/triangulation one-liners)
  const insights = model.rows.some(r => r.insight)
    ? pdfSection(isComp ? 'Where they differ' : 'Agreement & divergence', insightsHtml(model.rows), { keepWith: '', margin: '26px' })
    : ''

  // Dimensions lens (ABSA taxonomy) — second matrix, only when present. Each row
  // is a "Axis: Sub" dimension shared across the inputs' keyword taxonomy.
  const dims = model.dimensionRows.length > 0
    ? pdfSection('Dimensions comparison',
        `<p style="font-size:${PDF.size.tiny}px;color:${PDF.mute};margin:0 0 10px">Aspect-based dimensions (a fixed taxonomy applied to the review text), compared across ${colName}s alongside the organic themes above.</p>` +
        matrixTable(model.dimensionRows, 'Dimension') + matrixNote('dimension') +
        (model.dimensionRows.some(r => r.insight) ? `<div style="margin-top:16px">${insightsHtml(model.dimensionRows)}</div>` : ''),
        { keepWith: '', margin: '26px' })
    : ''

  const footer = `<p class="faint" style="font-size:${PDF.size.tiny}px;margin:24px 0 0;border-top:1px solid ${PDF.line};padding-top:10px">${esc(model.method)}</p>` +
    `<div class="faint" style="text-align:center;font-size:${PDF.size.tiny}px;margin-top:18px">Prepared by datanautix.com</div>`

  return pdfDoc({ title: model.name, body: head + overview + manifest + matrix + insights + dims + footer })
}

function fmt(s: string): string {
  try { return new Date(s).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }) } catch { return '' }
}
