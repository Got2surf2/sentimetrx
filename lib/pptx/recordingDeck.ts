// lib/pptx/recordingDeck.ts
//
// Datanautix-branded PowerPoint for a recorded Q&A session (docs/RECORDINGS.md
// §5.4 / §4.13). Pure builder — no auth, no I/O — so both the export route and
// the QC render harness call it with the same inputs.
//
// Deck shape:
//   1. Title
//   2. Executive summary + KPI strip
//   3. Sentiment overview (stacked bar)
//   4. Conversation themes (2 topic cards / slide)
//   5. Action items & decisions
//   6. Appendix — one Q&A pair per slide
//
// analysis_summary may be null (recording predates the synthesis pass) — slides
// 2-5 are each skipped individually; the appendix always renders from the pairs.
//
// Brand: Datanautix (NOT Sentimetrx) per CLAUDE.md — this is a deck export.

import 'server-only'
import { DN as DN_SHARED, W, H, HH, CY, PAD, FY, bgFill, trunc } from '@/lib/pptx/shared'
import { buildTimelineModel } from '@/lib/recordings/timeline'
import type {
  RecordingExtractionRow,
  RecordingAnalysisSummary,
  ProceedingsSummary,
  MeetingProfile,
  QaPairPayload,
  ActionItemPayload,
  QaSentiment,
} from '@/lib/recordings/types'
import { displayQuestion, displayAnswer } from '@/lib/recordings/qaDisplay'

const DN = {
  ...DN_SHARED,
  ink: '0D2B45', slateDark: '4A6572',
}

const TOPIC_COLORS = ['0F7173', 'E8B84B', '7C3AED', '059669', 'E85A1A', '1A5070', '0891B2', 'DB2777', '65A30D', '9333EA']

export interface RecordingDeckInput {
  name: string
  meeting_date: string | null
  location: string | null
  // Analysis attribution + intake (§2.8) — printed on the title slide / footer.
  analysis_org?: string | null            // consulting brand, default Datanautix
  analysts?: Array<{ name: string }>      // analyst names
  objectives?: { summary: string; questions: string[] } | null
  confidentiality_class?: string | null   // public | internal | client_confidential | restricted
  signoff?: { approved_by: string; approved_at?: string | null } | null
  config_version?: number | null          // analyzed_config_version, for the provenance stamp
  analysis_summary: RecordingAnalysisSummary | null
  proceedings_summary?: ProceedingsSummary | null   // presentation overview (meeting tool)
  meeting_profile?: MeetingProfile | null
  extractions: RecordingExtractionRow[]   // qa_pair + action_item, any order
  source_duration_sec?: number | null     // anchors the meeting-timeline slide
  // Use the public-shareable polished question/answer in the appendix when
  // available (falls back to verbatim per-pair). Default true — the deck is the
  // client deliverable. Pass false to render the raw verbatim transcript quotes.
  polished?: boolean
  // Unreviewed AI draft → DRAFT watermark + a "pending human review" note on the
  // title slide.
  draft?: boolean
}

// ── Local slide helpers (copied from the townhall export pattern) ────────────

function hdr(slide: any, pptx: any, title: string) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.06, fill: { color: DN.gold }, line: { width: 0 } })
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.06, w: W, h: HH - 0.06, fill: { color: DN.navy }, line: { width: 0 } })
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.06, w: 0.07, h: HH - 0.06, fill: { color: DN.teal }, line: { width: 0 } })
  slide.addText(title, { x: PAD, y: 0.1, w: W - PAD * 2 - 2.4, h: HH - 0.18, fontSize: 20, bold: true, color: DN.white, valign: 'middle', autoFit: true })
}

function logoRight(slide: any) {
  slide.addText(
    [
      { text: 'data',   options: { color: DN.tealLight, bold: true, italic: true } },
      { text: 'nautix', options: { color: DN.orangeLight, bold: true, italic: true } },
    ],
    { x: W - 2.3, y: 0.1, w: 2.1, h: HH - 0.18, fontSize: 15, valign: 'middle', align: 'right' }
  )
}

function footer(slide: any, pptx: any, name: string, classification = 'Proprietary and Confidential') {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: FY - 0.02, w: W, h: 0.015, fill: { color: DN.teal, transparency: 62 }, line: { width: 0 } })
  slide.addText('datanautix.com  ·  ' + name, { x: PAD, y: FY - 0.04, w: W * 0.5, h: 0.3, fontSize: 12, color: DN.slate, valign: 'middle', wrap: false })
  slide.addText(classification, { x: W * 0.5 - PAD, y: FY - 0.04, w: W * 0.5, h: 0.3, fontSize: 12, color: DN.slate, valign: 'middle', align: 'right', wrap: false })
}

function kpiCard(slide: any, pptx: any, x: number, y: number, w: number, h: number, value: string, label: string, valColor = DN.navy) {
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: DN.slateLight }, line: { color: DN.divider, width: 1 }, rectRadius: 0.08 })
  slide.addText(value, { x: x + 0.14, y: y + 0.06, w: w - 0.28, h: h * 0.52, fontSize: 22, bold: true, color: valColor, valign: 'middle', autoFit: true })
  slide.addText(label, { x: x + 0.14, y: y + h * 0.52 + 0.06, w: w - 0.28, h: 0.22, fontSize: 10, bold: true, color: DN.slateDark, autoFit: true })
}

function sentColor(s: QaSentiment | string): string {
  if (s === 'positive') return DN.green
  if (s === 'negative') return DN.red
  if (s === 'mixed') return DN.amber
  return DN.slate
}

function sentBg(s: QaSentiment | string): string {
  if (s === 'positive') return DN.greenLight
  if (s === 'negative') return DN.redLight
  if (s === 'mixed') return DN.amberLight
  return DN.slateLight
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s
}

// Truncate to fit a box, but end on a NATURAL boundary: prefer the last
// sentence end within the budget (no ellipsis — it's a complete thought),
// else fall back to the last word boundary + "…". Never cuts mid-word.
function truncBoundary(s: string, max: number): string {
  if (!s) return ''
  const clean = s.trim()
  if (clean.length <= max) return clean
  const slice = clean.slice(0, max)
  const windowStart = Math.floor(max * 0.5)
  // Last sentence terminator (.!?) in the back half of the budget.
  let sentenceEnd = -1
  for (let i = slice.length - 1; i >= windowStart; i--) {
    if (/[.!?]/.test(slice[i])) { sentenceEnd = i; break }
  }
  if (sentenceEnd >= 0) return slice.slice(0, sentenceEnd + 1).trim()
  // Else cut at the last space and add an ellipsis.
  const lastSpace = slice.lastIndexOf(' ')
  const base = lastSpace > windowStart ? slice.slice(0, lastSpace) : slice
  return base.trim().replace(/[,;:]+$/, '') + '…'
}

function badge(slide: any, pptx: any, x: number, y: number, w: number, label: string, fg: string, bg: string) {
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h: 0.28, fill: { color: bg }, line: { width: 0 }, rectRadius: 0.14 })
  slide.addText(label, { x, y, w, h: 0.3, fontSize: 12, bold: true, color: fg, valign: 'middle', align: 'center' })
}

// ── Builder ──────────────────────────────────────────────────────────────────

export async function buildRecordingDeck(input: RecordingDeckInput): Promise<Uint8Array> {
  const PptxGenJS = (await import('pptxgenjs')).default
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author = 'Datanautix'
  pptx.company = 'Datanautix'
  pptx.title = `${input.name} — Q&A Session Report`

  const name = input.name || 'Q&A Session'
  // Attribution / distribution (§2.8) for the title slide + footer.
  const CONF_LABEL: Record<string, string> = {
    public: 'Public', internal: 'Internal — Not for Distribution',
    client_confidential: 'Confidential — Client Only', restricted: 'Restricted',
  }
  const classification = CONF_LABEL[input.confidentiality_class ?? ''] ?? 'Proprietary and Confidential'
  const analystStr = (input.analysts ?? []).map(a => a.name).filter(Boolean).join(', ')
  const preparedBy = `Prepared by ${analystStr ? analystStr + '  ·  ' : ''}${input.analysis_org || 'Datanautix'}${input.config_version != null ? `  ·  Config v${input.config_version}` : ''}`
  const summary = input.analysis_summary
  const proceedings = input.proceedings_summary || null
  const hasPresentation = !!proceedings && (!!proceedings.overview || (proceedings.items?.length ?? 0) > 0)
  const reportKind = hasPresentation ? 'Meeting Report' : 'Q&A Session Report'

  // Every Q&A pair, in sort order — must match the report page 1:1 (the page
  // shows flagged pairs too, just marked). Filtering flagged ones here silently
  // dropped a pair, so the deck showed 18 where the page showed 19.
  const qaPairs = input.extractions
    .filter(e => e.unit_type === 'qa_pair')
    .sort((a, b) => a.sort_order - b.sort_order)
  const actionItems = input.extractions
    .filter(e => e.unit_type === 'action_item')
    .sort((a, b) => a.sort_order - b.sort_order)

  // The theme slides' representative exchanges are verbatim quotes the synthesis
  // picked; map each back to its pair's polished text so they match the appendix
  // (unless polished is off). Keyed by a normalized question prefix.
  const usePolished = input.polished !== false
  const normQ = (s: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 60)
  const polishByQ = new Map<string, { q: string; a: string }>()
  if (usePolished) {
    for (const e of qaPairs) {
      const qa = e.payload as QaPairPayload
      if (!qa.edited_question && !qa.edited_answer && !qa.polished_question && !qa.polished_answer) continue
      polishByQ.set(normQ(qa.question), { q: displayQuestion(qa), a: displayAnswer(qa) })
    }
  }
  // Resolve a representative exchange to polished text when its verbatim question
  // matches a pair (exact, then prefix-overlap); falls back to the verbatim quote.
  const polishExchange = (ex: { question: string; answer: string }): { question: string; answer: string } => {
    if (!usePolished) return ex
    const k = normQ(ex.question)
    const hit = polishByQ.get(k)
    if (hit) return { question: hit.q, answer: hit.a }
    const short = k.slice(0, 40)
    for (const [pk, v] of polishByQ) if (pk.startsWith(short) || short.startsWith(pk.slice(0, 40))) return { question: v.q, answer: v.a }
    return ex
  }

  // Every count the deck prints is derived HERE from the pairs it actually
  // renders — never trusted from the stored summary, whose counts can lag a
  // re-extract (a stale summary computed over fewer pairs is what let the deck
  // disagree with itself / with the report page). One denominator: qaPairs.
  const sentimentBreakdown = { positive: 0, neutral: 0, negative: 0, mixed: 0 }
  const qaCountByTopic = new Map<string, number>()
  for (const e of qaPairs) {
    const sent = (e.payload as QaPairPayload).sentiment ?? 'neutral'
    sentimentBreakdown[sent]++
    const topic = e.topic || 'Other'
    qaCountByTopic.set(topic, (qaCountByTopic.get(topic) ?? 0) + 1)
  }

  // ── Slide 1: Title ──
  const s1 = pptx.addSlide()
  bgFill(s1, pptx, DN.navy)
  s1.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.08, fill: { color: DN.gold }, line: { width: 0 } })
  // Draft: large faint diagonal watermark behind the title + a top pill.
  if (input.draft) {
    s1.addText('DRAFT', { x: 0, y: H / 2 - 1.3, w: W, h: 2.6, fontSize: 140, bold: true, color: DN.gold, transparency: 84, align: 'center', valign: 'middle', rotate: 330 })
    s1.addText('⚠  DRAFT — PENDING HUMAN REVIEW', { x: PAD, y: 0.55, w: W - PAD * 2, h: 0.4, fontSize: 13, bold: true, color: DN.gold, charSpacing: 1.0, valign: 'middle' })
  }
  s1.addText(name, { x: PAD, y: 1.7, w: W - PAD * 2, h: 1.2, fontSize: 34, bold: true, color: DN.white, valign: 'middle' })
  s1.addText(reportKind, { x: PAD, y: 2.95, w: W - PAD * 2, h: 0.6, fontSize: 18, color: DN.tealLight })
  const metaBits = [
    input.meeting_date ? new Date(input.meeting_date).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : null,
    input.location || null,
  ].filter(Boolean).join('  ·  ')
  if (metaBits) s1.addText(metaBits, { x: PAD, y: 3.6, w: W - PAD * 2, h: 0.5, fontSize: 14, color: DN.slate })
  s1.addText(preparedBy, { x: PAD, y: 4.05, w: W - PAD * 2, h: 0.4, fontSize: 12, color: DN.tealLight, valign: 'middle' })
  if (summary?.headline) {
    s1.addText(summary.headline, { x: PAD, y: 4.55, w: W - PAD * 2, h: 1.0, fontSize: 14, color: DN.slate, valign: 'top', wrap: true })
  }
  // Objectives (§2.8) — what the analysis set out to answer.
  if (input.objectives?.summary) {
    s1.addText('OBJECTIVE', { x: PAD, y: 5.65, w: W - PAD * 2, h: 0.24, fontSize: 11, bold: true, color: DN.slate, charSpacing: 1.0 })
    s1.addText(trunc(input.objectives.summary, 220), { x: PAD, y: 5.92, w: W - PAD * 2, h: 0.55, fontSize: 12, italic: true, color: DN.slate, valign: 'top', wrap: true })
  }
  // Sign-off stamp (bottom-left, opposite the wordmark).
  if (input.signoff?.approved_by) {
    s1.addText(
      `Reviewed & approved by ${input.signoff.approved_by}${input.signoff.approved_at ? ' · ' + new Date(input.signoff.approved_at).toLocaleDateString() : ''}`,
      { x: PAD, y: H - 0.8, w: W - 3.2, h: 0.5, fontSize: 11, color: DN.green, valign: 'middle' },
    )
  }
  s1.addText(
    [
      { text: 'data',   options: { color: DN.orangeLight, bold: true, italic: true } },
      { text: 'nautix', options: { color: DN.tealLight, bold: true, italic: true } },
    ],
    { x: W - 2.8, y: H - 0.8, w: 2.4, h: 0.5, fontSize: 18, align: 'right' }
  )

  // ── Meeting Overview (presentation phase) ──
  if (hasPresentation && proceedings) {
    const items = proceedings.items || []

    // Overview slide: the narrative + a scannable agenda list.
    const ov = pptx.addSlide()
    bgFill(ov, pptx); hdr(ov, pptx, 'Meeting Overview'); logoRight(ov)
    if (proceedings.overview) {
      ov.addText(proceedings.overview, { x: PAD, y: CY + 0.2, w: W - PAD * 2, h: 1.7, fontSize: 13, color: DN.ink, valign: 'top', wrap: true, lineSpacingMultiple: 1.15 })
    }
    if (items.length > 0) {
      ov.addText('PRESENTED', { x: PAD, y: CY + 2.1, w: W - PAD * 2, h: 0.26, fontSize: 12, bold: true, color: DN.slate, charSpacing: 1.0 })
      let ly = CY + 2.45
      for (const it of items.slice(0, 8)) {
        ov.addShape(pptx.ShapeType.rect, { x: PAD, y: ly + 0.05, w: 0.05, h: 0.3, fill: { color: DN.teal }, line: { width: 0 } })
        ov.addText(
          [
            { text: trunc(it.title, 70), options: { bold: true, color: DN.ink } },
            ...(it.presenter ? [{ text: '   ·   ' + it.presenter, options: { color: DN.slateDark } }] : []),
          ],
          { x: PAD + 0.18, y: ly, w: W - PAD * 2 - 0.3, h: 0.36, fontSize: 12, valign: 'middle' }
        )
        ly += 0.42
      }
    }
    footer(ov, pptx, name, classification)

    // Detail slides: 2 item cards per slide.
    for (let i = 0; i < items.length; i += 2) {
      const s = pptx.addSlide()
      bgFill(s, pptx); hdr(s, pptx, 'What Was Presented'); logoRight(s)
      for (let j = 0; j < 2 && i + j < items.length; j++) {
        const it = items[i + j]
        const cw = (W - PAD * 2 - 0.3) / 2
        const cx = PAD + j * (cw + 0.3)
        const cardY = CY + 0.1
        const cardH = 5.45
        s.addShape(pptx.ShapeType.rect, { x: cx, y: cardY, w: cw, h: cardH, fill: { color: DN.white }, line: { color: DN.divider, width: 1 }, rectRadius: 0.08 })
        s.addShape(pptx.ShapeType.rect, { x: cx, y: cardY, w: cw, h: 0.06, fill: { color: DN.teal }, line: { width: 0 } })
        s.addText(trunc(it.title, 64), { x: cx + 0.2, y: cardY + 0.22, w: cw - 0.4, h: 0.5, fontSize: 16, bold: true, color: DN.ink, valign: 'middle' })
        if (it.presenter) s.addText(it.presenter, { x: cx + 0.2, y: cardY + 0.78, w: cw - 0.4, h: 0.28, fontSize: 12, italic: true, color: DN.slateDark })
        s.addText(truncBoundary(it.what_was_presented, 460), { x: cx + 0.2, y: cardY + 1.15, w: cw - 0.4, h: 3.0, fontSize: 12, color: DN.slateDark, valign: 'top', wrap: true, lineSpacingMultiple: 1.05 })
        if (it.key_figures.length > 0) {
          s.addText('KEY FIGURES', { x: cx + 0.2, y: cardY + 4.25, w: cw - 0.4, h: 0.24, fontSize: 12, bold: true, color: DN.slate, charSpacing: 1.0 })
          let fy = cardY + 4.55
          for (const f of it.key_figures.slice(0, 3)) {
            s.addText(
              [ { text: f.value + '  ', options: { bold: true, color: DN.teal } }, { text: f.label, options: { color: DN.slateDark } } ],
              { x: cx + 0.2, y: fy, w: cw - 0.4, h: 0.26, fontSize: 12, valign: 'middle' }
            )
            fy += 0.28
          }
        }
      }
      footer(s, pptx, name, classification)
    }
  }

  // ── Slide 2: Executive summary ──
  if (summary && summary.executive_summary) {
    const s = pptx.addSlide()
    bgFill(s, pptx)
    hdr(s, pptx, 'Executive Summary')
    logoRight(s)

    if (summary.headline) {
      s.addText(summary.headline, { x: PAD, y: CY + 0.2, w: W - PAD * 2, h: 0.6, fontSize: 18, bold: true, color: DN.teal, valign: 'middle' })
    }
    s.addText(summary.executive_summary, {
      x: PAD, y: CY + 0.95, w: W - PAD * 2, h: 2.6, fontSize: 14, color: DN.ink, valign: 'top', wrap: true, lineSpacingMultiple: 1.15,
    })

    // KPI strip
    const kpiW = (W - PAD * 2 - 0.3 * 3) / 4
    const kpiY = CY + 3.85
    kpiCard(s, pptx, PAD, kpiY, kpiW, 1.2, String(qaPairs.length), 'Questions')
    kpiCard(s, pptx, PAD + (kpiW + 0.3), kpiY, kpiW, 1.2, String(summary.topic_summaries.length), 'Topics')
    kpiCard(s, pptx, PAD + (kpiW + 0.3) * 2, kpiY, kpiW, 1.2, String(actionItems.length), 'Action Items')
    kpiCard(s, pptx, PAD + (kpiW + 0.3) * 3, kpiY, kpiW, 1.2, cap(summary.sentiment_overall), 'Overall Tone', sentColor(summary.sentiment_overall))

    footer(s, pptx, name, classification)
  }

  // ── Slide 3: Sentiment overview ──
  if (summary) {
    const b = sentimentBreakdown
    const total = b.positive + b.neutral + b.negative + b.mixed
    if (total > 0) {
      const s = pptx.addSlide()
      bgFill(s, pptx)
      hdr(s, pptx, 'Sentiment Overview')
      logoRight(s)

      s.addText('Tone of audience exchanges across the session', { x: PAD, y: CY + 0.2, w: W - PAD * 2, h: 0.4, fontSize: 12, color: DN.slateDark })

      const rows: [string, number, string][] = [
        ['Positive', b.positive, DN.green],
        ['Negative', b.negative, DN.red],
        ['Mixed', b.mixed, DN.amber],
        ['Neutral', b.neutral, DN.slate],
      ]
      const barW = W - PAD * 2
      const barY = CY + 1.1
      const barH = 0.55
      let bx = PAD
      for (const [, count, color] of rows) {
        const pctW = (count / total) * barW
        if (pctW > 0) {
          s.addShape(pptx.ShapeType.rect, { x: bx, y: barY, w: pctW, h: barH, fill: { color }, line: { width: 0 } })
          if (pctW > 0.8) s.addText(Math.round(count / total * 100) + '%', { x: bx, y: barY, w: pctW, h: barH, fontSize: 12, bold: true, color: DN.white, valign: 'middle', align: 'center' })
          bx += pctW
        }
      }
      // Legend as cards
      const legY = barY + 1.1
      const cardW = (W - PAD * 2 - 0.3 * 3) / 4
      let lx = PAD
      for (const [label, count, color] of rows) {
        s.addShape(pptx.ShapeType.rect, { x: lx, y: legY, w: cardW, h: 1.1, fill: { color: DN.white }, line: { color: DN.divider, width: 1 }, rectRadius: 0.08 })
        s.addShape(pptx.ShapeType.rect, { x: lx, y: legY, w: cardW, h: 0.06, fill: { color }, line: { width: 0 } })
        s.addText(String(count), { x: lx + 0.14, y: legY + 0.18, w: cardW - 0.28, h: 0.5, fontSize: 22, bold: true, color, valign: 'middle' })
        s.addText(label + '  ·  ' + Math.round(count / total * 100) + '%', { x: lx + 0.14, y: legY + 0.72, w: cardW - 0.28, h: 0.3, fontSize: 12, bold: true, color: DN.slateDark })
        lx += cardW + 0.3
      }

      footer(s, pptx, name, classification)
    }
  }

  // ── Meeting timeline ── one block per Q&A pair, placed by when it occurred.
  // Overlapping Opus spans are de-overlapped upstream (analyze-time tightening),
  // and any residual overlap staggers into lanes. Single brand colour — the
  // internal "flagged" state is never shown on the client deck.
  const tlModel = buildTimelineModel(qaPairs, input.source_duration_sec ?? null)
  if (tlModel) {
    const s = pptx.addSlide()
    bgFill(s, pptx)
    hdr(s, pptx, 'Meeting Timeline')
    logoRight(s)
    s.addText(`${tlModel.count} questions across ${tlModel.durationLabel}`, { x: PAD, y: CY + 0.2, w: W - PAD * 2, h: 0.4, fontSize: 12, color: DN.slateDark })

    const barW = W - PAD * 2
    const laneH = 0.34
    const laneGap = 0.1
    const trackY = CY + 1.2
    const trackH = tlModel.laneCount * laneH + (tlModel.laneCount - 1) * laneGap
    s.addShape(pptx.ShapeType.rect, { x: PAD, y: trackY, w: barW, h: trackH, fill: { color: DN.slateLight }, line: { width: 0 }, rectRadius: 0.04 })

    for (const seg of tlModel.segments) {
      const x = PAD + (seg.leftPct / 100) * barW
      const w = Math.max(0.2, (seg.widthPct / 100) * barW)
      const y = trackY + seg.lane * (laneH + laneGap)
      s.addShape(pptx.ShapeType.rect, { x, y, w, h: laneH, fill: { color: DN.teal }, line: { color: DN.white, width: 1 }, rectRadius: 0.03 })
      const cD = 0.2
      s.addShape(pptx.ShapeType.ellipse, { x: x + 0.03, y: y + (laneH - cD) / 2, w: cD, h: cD, fill: { color: DN.white }, line: { width: 0 } })
      s.addText(String(seg.index), { x: x + 0.03, y: y + (laneH - cD) / 2, w: cD, h: cD, fontSize: 8, bold: true, color: DN.teal, align: 'center', valign: 'middle' })
    }

    const axisY = trackY + trackH + 0.08
    for (const t of tlModel.ticks) {
      s.addText(t.label, { x: PAD + (t.pct / 100) * barW - 0.4, y: axisY, w: 0.8, h: 0.22, fontSize: 9, color: DN.slate, align: 'center' })
    }
    s.addText('Each block is a Q&A pair, placed + sized by when it occurred in the meeting.', { x: PAD, y: axisY + 0.35, w: W - PAD * 2, h: 0.3, fontSize: 10, italic: true, color: DN.slate })
    footer(s, pptx, name, classification)
  }

  // ── Slide 4+: Conversation themes (2 cards / slide) ──
  const topics = summary?.topic_summaries ?? []
  for (let i = 0; i < topics.length; i += 2) {
    const s = pptx.addSlide()
    bgFill(s, pptx)
    hdr(s, pptx, 'Conversation Themes')
    logoRight(s)

    for (let j = 0; j < 2 && i + j < topics.length; j++) {
      const t = topics[i + j]
      const color = TOPIC_COLORS[(i + j) % TOPIC_COLORS.length]
      const cw = (W - PAD * 2 - 0.3) / 2
      const cx = PAD + j * (cw + 0.3)
      const cardY = CY + 0.1
      const cardH = 5.45

      s.addShape(pptx.ShapeType.rect, { x: cx, y: cardY, w: cw, h: cardH, fill: { color: DN.white }, line: { color: DN.divider, width: 1 }, rectRadius: 0.08 })
      s.addShape(pptx.ShapeType.rect, { x: cx, y: cardY, w: cw, h: 0.06, fill: { color }, line: { width: 0 } })

      s.addText(trunc(t.topic, 60), { x: cx + 0.2, y: cardY + 0.22, w: cw - 0.4, h: 0.5, fontSize: 16, bold: true, color: DN.ink, valign: 'middle' })

      const tQaCount = qaCountByTopic.get(t.topic) ?? t.qa_count
      badge(s, pptx, cx + 0.2, cardY + 0.82, 1.25, cap(t.sentiment), sentColor(t.sentiment), sentBg(t.sentiment))
      badge(s, pptx, cx + 1.55, cardY + 0.82, 1.6, `${tQaCount} question${tQaCount === 1 ? '' : 's'}`, DN.slateDark, DN.slateLight)

      // Cap the summary so a long one can't collide with the exchange below;
      // truncBoundary ends it on a sentence so it never reads as cut off.
      s.addText(truncBoundary(t.summary, 250), { x: cx + 0.2, y: cardY + 1.3, w: cw - 0.4, h: 1.0, fontSize: 12, color: DN.slateDark, valign: 'top', wrap: true, lineSpacingMultiple: 1.0 })

      // One representative Q&A exchange, parties identified.
      const ex = t.representative_exchanges[0]
      if (ex) {
        const px = polishExchange(ex)   // polished text to match the appendix
        s.addText('REPRESENTATIVE EXCHANGE', { x: cx + 0.2, y: cardY + 2.4, w: cw - 0.4, h: 0.26, fontSize: 12, bold: true, color: DN.slate, charSpacing: 1.0 })
        // Q
        const qy = cardY + 2.74
        s.addShape(pptx.ShapeType.rect, { x: cx + 0.2, y: qy, w: 0.04, h: 1.0, fill: { color: DN.teal }, line: { width: 0 } })
        s.addText('Q' + (ex.asker ? ' · ' + ex.asker : ''), { x: cx + 0.34, y: qy, w: cw - 0.55, h: 0.24, fontSize: 12, bold: true, color: DN.teal })
        s.addText('“' + truncBoundary(px.question, 210) + '”', { x: cx + 0.34, y: qy + 0.26, w: cw - 0.55, h: 0.78, fontSize: 12, italic: true, color: DN.ink, valign: 'top', wrap: true, lineSpacingMultiple: 1.0 })
        // A
        const ay = qy + 1.14
        s.addShape(pptx.ShapeType.rect, { x: cx + 0.2, y: ay, w: 0.04, h: 1.05, fill: { color: DN.orange }, line: { width: 0 } })
        s.addText('A' + (ex.panelist ? ' · ' + ex.panelist : ''), { x: cx + 0.34, y: ay, w: cw - 0.55, h: 0.24, fontSize: 12, bold: true, color: DN.orange })
        s.addText(truncBoundary(px.answer, 230), { x: cx + 0.34, y: ay + 0.26, w: cw - 0.55, h: 0.82, fontSize: 12, color: DN.slateDark, valign: 'top', wrap: true, lineSpacingMultiple: 1.0 })
      }
    }

    footer(s, pptx, name, classification)
  }

  // ── Slide: Action items & decisions ──
  const decisions = summary?.decisions ?? []
  if (actionItems.length > 0 || decisions.length > 0) {
    const s = pptx.addSlide()
    bgFill(s, pptx)
    hdr(s, pptx, 'Action Items & Decisions')
    logoRight(s)

    const colW = (W - PAD * 2 - 0.4) / 2
    const colY = CY + 0.2
    const colH = 5.3

    // Left: action items
    s.addText('ACTION ITEMS', { x: PAD, y: colY, w: colW, h: 0.3, fontSize: 12, bold: true, color: DN.teal, charSpacing: 1 })
    if (actionItems.length === 0) {
      s.addText('None recorded.', { x: PAD, y: colY + 0.4, w: colW, h: 0.4, fontSize: 12, italic: true, color: DN.slate })
    } else {
      const aiCap = 5
      let ay = colY + 0.42
      for (const ex of actionItems.slice(0, aiCap)) {
        const ai = ex.payload as ActionItemPayload
        const rowH = 0.9
        s.addShape(pptx.ShapeType.rect, { x: PAD, y: ay, w: colW, h: rowH, fill: { color: DN.white }, line: { color: DN.divider, width: 1 }, rectRadius: 0.06 })
        s.addShape(pptx.ShapeType.rect, { x: PAD, y: ay, w: 0.05, h: rowH, fill: { color: DN.teal }, line: { width: 0 } })
        s.addText(truncBoundary(ai.description, 150), { x: PAD + 0.18, y: ay + 0.08, w: colW - 0.32, h: rowH - 0.36, fontSize: 12, color: DN.ink, valign: 'top', wrap: true, lineSpacingMultiple: 1.0 })
        const meta = [ai.owner ? 'Owner: ' + ai.owner : null, ai.due_date ? 'Due: ' + ai.due_date : null].filter(Boolean).join('  ·  ')
        if (meta) s.addText(meta, { x: PAD + 0.18, y: ay + rowH - 0.26, w: colW - 0.32, h: 0.22, fontSize: 12, bold: true, color: DN.slateDark })
        ay += rowH + 0.12
      }
      if (actionItems.length > aiCap) s.addText(`+ ${actionItems.length - aiCap} more`, { x: PAD, y: ay, w: colW, h: 0.24, fontSize: 12, italic: true, color: DN.slate })
    }

    // Right: decisions
    const rx = PAD + colW + 0.4
    s.addText('DECISIONS & COMMITMENTS', { x: rx, y: colY, w: colW, h: 0.3, fontSize: 12, bold: true, color: DN.orange, charSpacing: 1 })
    if (decisions.length === 0) {
      s.addText('None recorded.', { x: rx, y: colY + 0.4, w: colW, h: 0.4, fontSize: 12, italic: true, color: DN.slate })
    } else {
      const decCap = 6
      let dy = colY + 0.42
      for (const d of decisions.slice(0, decCap)) {
        const rowH = 0.78
        s.addShape(pptx.ShapeType.rect, { x: rx, y: dy, w: colW, h: rowH, fill: { color: DN.white }, line: { color: DN.divider, width: 1 }, rectRadius: 0.06 })
        s.addShape(pptx.ShapeType.rect, { x: rx, y: dy, w: 0.05, h: rowH, fill: { color: DN.orange }, line: { width: 0 } })
        s.addText(truncBoundary(d.decision, 160), { x: rx + 0.18, y: dy + 0.08, w: colW - 0.32, h: rowH - 0.16, fontSize: 12, color: DN.ink, valign: 'top', wrap: true, lineSpacingMultiple: 1.0 })
        dy += rowH + 0.12
      }
      if (decisions.length > decCap) s.addText(`+ ${decisions.length - decCap} more`, { x: rx, y: dy, w: colW, h: 0.24, fontSize: 12, italic: true, color: DN.slate })
    }
    // keep colH referenced for layout intent
    void colH

    footer(s, pptx, name, classification)
  }

  // ── Section divider: Appendix ──
  // A navy break slide (matches the title) so the per-question detail reads as
  // a distinct section after the analysis, not a continuation of it.
  if (qaPairs.length > 0) {
    const d = pptx.addSlide()
    bgFill(d, pptx, DN.navy)
    d.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.08, fill: { color: DN.gold }, line: { width: 0 } })
    d.addText('APPENDIX', { x: PAD, y: 2.9, w: W - PAD * 2, h: 0.5, fontSize: 16, bold: true, color: DN.gold, charSpacing: 3, align: 'center' })
    d.addText('Question & Answer Detail', { x: PAD, y: 3.45, w: W - PAD * 2, h: 0.8, fontSize: 30, bold: true, color: DN.white, align: 'center' })
    d.addText(`One slide per question  ·  ${qaPairs.length} question${qaPairs.length === 1 ? '' : 's'}`, { x: PAD, y: 4.35, w: W - PAD * 2, h: 0.5, fontSize: 14, color: DN.tealLight, align: 'center' })
    d.addText(
      [
        { text: 'data',   options: { color: DN.orangeLight, bold: true, italic: true } },
        { text: 'nautix', options: { color: DN.tealLight, bold: true, italic: true } },
      ],
      { x: W - 2.8, y: H - 0.8, w: 2.4, h: 0.5, fontSize: 18, align: 'right' }
    )
  }

  // ── Appendix: one Q&A pair per slide ──
  // Prefer the polished (public-shareable) text when present; fall back to the
  // verbatim quote per pair. `polished: false` forces verbatim throughout
  // (`usePolished` computed above, shared with the theme-slide exchanges).
  qaPairs.forEach((ex, idx) => {
    const qa = ex.payload as QaPairPayload
    const qQuestion = displayQuestion(qa, { verbatim: !usePolished })
    const qAnswer = displayAnswer(qa, { verbatim: !usePolished })
    const s = pptx.addSlide()
    bgFill(s, pptx)
    hdr(s, pptx, `Appendix — Q&A ${idx + 1} of ${qaPairs.length}`)
    logoRight(s)

    // Badge row: topic + sentiment + typology
    let bxx = PAD
    badge(s, pptx, bxx, CY + 0.12, 3.0, trunc(ex.topic || 'Other', 32), DN.white, DN.teal); bxx += 3.15
    const sent = qa.sentiment ?? 'neutral'
    badge(s, pptx, bxx, CY + 0.12, 1.25, cap(sent), sentColor(sent), sentBg(sent)); bxx += 1.4
    badge(s, pptx, bxx, CY + 0.12, 1.7, cap(qa.question_typology), DN.slateDark, DN.slateLight)

    // Question card
    const qY = CY + 0.65
    const qH = 2.2
    s.addShape(pptx.ShapeType.rect, { x: PAD, y: qY, w: W - PAD * 2, h: qH, fill: { color: DN.white }, line: { color: DN.divider, width: 1 }, rectRadius: 0.08 })
    s.addShape(pptx.ShapeType.rect, { x: PAD, y: qY, w: 0.07, h: qH, fill: { color: DN.teal }, line: { width: 0 } })
    s.addText('QUESTION' + (qa.asker_name ? '  ·  ' + qa.asker_name : ''), { x: PAD + 0.25, y: qY + 0.12, w: W - PAD * 2 - 0.5, h: 0.3, fontSize: 12, bold: true, color: DN.teal, charSpacing: 1 })
    s.addText('“' + qQuestion + '”', { x: PAD + 0.25, y: qY + 0.45, w: W - PAD * 2 - 0.5, h: qH - 0.6, fontSize: 13, color: DN.ink, valign: 'top', wrap: true, lineSpacingMultiple: 1.1 })

    // Answer card
    const aY = qY + qH + 0.25
    const aH = FY - 0.3 - aY
    s.addShape(pptx.ShapeType.rect, { x: PAD, y: aY, w: W - PAD * 2, h: aH, fill: { color: DN.slateCard }, line: { color: DN.divider, width: 1 }, rectRadius: 0.08 })
    s.addShape(pptx.ShapeType.rect, { x: PAD, y: aY, w: 0.07, h: aH, fill: { color: DN.orange }, line: { width: 0 } })
    s.addText('RESPONSE' + (qa.panelist_name ? '  ·  ' + qa.panelist_name : ''), { x: PAD + 0.25, y: aY + 0.12, w: W - PAD * 2 - 0.5, h: 0.3, fontSize: 12, bold: true, color: DN.orange, charSpacing: 1 })
    s.addText(qAnswer, { x: PAD + 0.25, y: aY + 0.45, w: W - PAD * 2 - 0.5, h: aH - 0.6, fontSize: 12, color: DN.slateDark, valign: 'top', wrap: true, lineSpacingMultiple: 1.1 })

    footer(s, pptx, name, classification)
  })

  const raw = await pptx.write({ outputType: 'nodebuffer' })
  return new Uint8Array(raw as Buffer)
}
