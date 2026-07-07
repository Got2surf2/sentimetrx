// app/api/townhall/sessions/[id]/export/pptx/route.ts
// POST — generate a branded Town Hall summary deck (PPTX)
// Returns the deck as a downloadable binary.

import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import type { NextRequest} from 'next/server';
import type PptxGenJS from 'pptxgenjs'
import { NextResponse } from 'next/server'
import { lexiconScore, classifySentiment, buildKwRegex } from '@/lib/themeUtils'
import { resolveTownHall, projectHallAsSession, fetchTopicsAsThemes, fetchTurnsAsLegacy } from '@/lib/townHallAdapter'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

interface Params { params: Promise<{ id: string }> }

import { DN as DN_SHARED, W, H, HH, CY, PAD, FY, bgFill, logo, trunc } from '@/lib/pptx/shared'

// Extended palette with townhall-specific colors
const DN = {
  ...DN_SHARED,
  tealDark: '0A4F51', tealPale: 'E0F2F1',
  navyMid: '0F3A54', navyLight: '1A5070',
  goldLight: 'F5D98A', goldPale: 'FFF8E1',
  ink: '0D2B45', slateDark: '4A6572',
}

const THEME_COLORS = ['0F7173', 'E8B84B', '7C3AED', '059669', 'E85A1A', '1A5070', '0891B2', 'DB2777', '65A30D', '9333EA']

// Round/pacing config carried on the projected legacy session.config blob.
interface SessionConfig {
  pacing_mode?: string
  rounds?: Array<{ number?: number | null; item_name?: string }>
}

// A projected theme after keyword/quote enrichment below — the shape the
// slide builders consume.
interface ThemeCard {
  id: string
  label: string
  keywords?: string[]
  sentiment?: string | null
  source: string
  state: string
  round_number?: number | null
  matchCount: number
  percentage: number
  quotes: string[]
}

function hdr(slide: PptxGenJS.Slide, pptx: PptxGenJS, title: string) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.06, fill: { color: DN.gold }, line: { width: 0 } })
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.06, w: W, h: HH - 0.06, fill: { color: DN.navy }, line: { width: 0 } })
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.06, w: 0.07, h: HH - 0.06, fill: { color: DN.teal }, line: { width: 0 } })
  slide.addText(title, { x: PAD, y: 0.1, w: W - PAD * 2 - 2.4, h: HH - 0.18, fontSize: 20, bold: true, color: DN.white, valign: 'middle', autoFit: true })
}

function footer(slide: PptxGenJS.Slide, pptx: PptxGenJS, sessionName: string) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: FY - 0.02, w: W, h: 0.015, fill: { color: DN.teal, transparency: 62 }, line: { width: 0 } })
  slide.addText('datanautix.com  ·  ' + sessionName, {
    x: PAD, y: FY, w: W * 0.5, h: 0.26, fontSize: 7.5, color: DN.slate, valign: 'middle', wrap: false,
  })
}

function kpi(slide: PptxGenJS.Slide, pptx: PptxGenJS, x: number, y: number, w: number, h: number, value: string, label: string, bg_ = DN.slateLight, valColor = DN.navy) {
  slide.addShape(pptx.ShapeType.rect, { x, y, w, h, fill: { color: bg_ }, line: { color: DN.divider, width: 1 }, rectRadius: 0.08 })
  slide.addText(value, { x: x + 0.14, y: y + 0.06, w: w - 0.28, h: h * 0.52, fontSize: 24, bold: true, color: valColor, valign: 'middle', autoFit: true })
  slide.addText(label, { x: x + 0.14, y: y + h * 0.52 + 0.06, w: w - 0.28, h: 0.22, fontSize: 9, bold: true, color: DN.slateDark, autoFit: true })
}

function sentColor(s: string) {
  if (s === 'positive') return DN.green
  if (s === 'negative') return DN.red
  if (s === 'mixed') return DN.amber
  return DN.slate
}

export async function POST(req: NextRequest, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Cross-org gate: the session lookup uses the service role (bypasses RLS).
  // Without it any authed user could export another org's town hall by id.
  // Admin-org may export any (Phase E). Multi-tenancy invariant.
  const { orgId, isAdmin } = await getCallerOrgContext(supabase)

  const db = createServiceRoleClient()

  // Tranche 2 (docs/CONVERGENCE.md § 4.2): pulseiq_sessions only (uuid or
  // slug) — session, themes and turns all projected into the legacy shapes
  // the slide builders below already consume.
  const hall = await resolveTownHall(db, params.id)
  if (!hall) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  if (!isAdmin && hall.org_id !== orgId) return NextResponse.json({ error: 'Session not found' }, { status: 404 })
  const session = projectHallAsSession(hall)

  // Fetch themes (legacy-projected pulseiq_topics)
  const themes = await fetchTopicsAsThemes(db, hall.id, hall.org_id)

  // Fetch turns, projected into the legacy townhall_turns row shape
  const allTurns = await fetchTurnsAsLegacy(db, hall.id, hall.org_id)
  const responded = allTurns.filter(t => !t.skipped && (t.user_message_en || t.user_message))
  const responseTexts = responded.map(t => (t.user_message_en || t.user_message || '').trim()).filter(Boolean)
  const participants = new Set(allTurns.map(t => t.participant_id))

  // Fetch post-session responses (phase-3 storage column)
  const { data: postResponses } = await db
    .from('townhall_participant_responses')
    .select('participant_id, psychographics, demographics')
    .eq('town_hall_id', hall.id)

  // Build theme analytics
  const themeIdTexts: Record<string, string[]> = {}
  for (const t of responded) {
    if (t.theme_id) {
      if (!themeIdTexts[t.theme_id]) themeIdTexts[t.theme_id] = []
      themeIdTexts[t.theme_id].push((t.user_message_en || t.user_message || '').trim())
    }
  }

  // Include all themes — the full record of what was explored, parked, and dismissed
  const activeThemes = (themes || [])

  const enrichedThemes = activeThemes.map(t => {
    const keywords: string[] = t.keywords || []
    const regexes = keywords.slice(0, 15).map(kw => { try { return buildKwRegex(kw) } catch { return null } }).filter(Boolean) as RegExp[]

    let matchCount = 0
    const quotes: string[] = []

    if (regexes.length > 0) {
      for (const text of responseTexts) {
        if (regexes.some(re => re.test(text.toLowerCase()))) {
          matchCount++
          if (quotes.length < 3) quotes.push(text.slice(0, 300))
        }
      }
    } else {
      const tagged = themeIdTexts[t.id] || []
      matchCount = tagged.length
      for (const text of tagged) {
        if (quotes.length < 3) quotes.push(text.slice(0, 300))
      }
    }

    const percentage = responseTexts.length > 0 ? Math.round(matchCount / responseTexts.length * 100) : 0
    return { ...t, matchCount, percentage, quotes }
  })

  // Round-based pacing: group theme slides by tasting round (item) for the
  // per-item roll-up. Inert in open mode (flat theme slides as before).
  const roundsMode = (session.config as SessionConfig | undefined)?.pacing_mode === 'rounds'
  const roundItems: Record<number, string> = {}
  for (const r of ((session.config as SessionConfig | undefined)?.rounds || [])) if (r?.number != null) roundItems[r.number] = r.item_name || ''

  // Overall sentiment
  let posCount = 0, negCount = 0, mixCount = 0, neuCount = 0
  for (const text of responseTexts) {
    const score = lexiconScore(text)
    const sent = classifySentiment(score.pos, score.neg)
    if (sent === 'positive') posCount++
    else if (sent === 'negative') negCount++
    else if (sent === 'mixed') mixCount++
    else neuCount++
  }

  // Aggregate demographics
  const demoCounts: Record<string, Record<string, number>> = {}
  for (const pr of postResponses || []) {
    if (pr.demographics) {
      for (const [k, v] of Object.entries(pr.demographics as Record<string, unknown>)) {
        if (!v) continue
        if (!demoCounts[k]) demoCounts[k] = {}
        const sv = String(v)
        demoCounts[k][sv] = (demoCounts[k][sv] || 0) + 1
      }
    }
  }

  // ── Build the deck ──────────────────────────────────────────────────────────
  const PptxGenJS = (await import('pptxgenjs')).default
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'

  const sessionName = session.name || 'PulseIQ Session'
  const fullDate = new Date(session.started_at || session.created_at).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  // ── Slide 1: Title ──
  const s1 = pptx.addSlide()
  bgFill(s1, pptx, DN.navy)
  s1.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.08, fill: { color: DN.gold }, line: { width: 0 } })
  s1.addText(sessionName, { x: PAD, y: 2.0, w: W - PAD * 2, h: 1.2, fontSize: 36, bold: true, color: DN.white, valign: 'middle' })
  s1.addText('PulseIQ Session Summary', { x: PAD, y: 3.2, w: W - PAD * 2, h: 0.6, fontSize: 18, color: DN.tealLight })
  s1.addText(fullDate, { x: PAD, y: 3.9, w: W - PAD * 2, h: 0.5, fontSize: 14, color: DN.slate })
  s1.addText(
    [
      { text: 'data', options: { color: DN.orangeLight, bold: true, italic: true } },
      { text: 'nautix', options: { color: DN.tealLight, bold: true, italic: true } },
    ],
    { x: W - 2.8, y: H - 0.8, w: 2.4, h: 0.5, fontSize: 18, align: 'right' }
  )

  // ── Slide 2: Overview KPIs ──
  const s2 = pptx.addSlide()
  bgFill(s2, pptx)
  hdr(s2, pptx, 'Session Overview')
  logo(s2)

  const avgWords = responded.length > 0 ? Math.round(responded.reduce((sum, t) => sum + ((t.user_message_en || t.user_message || '').split(/\s+/).length), 0) / responded.length) : 0

  const kpiW = (W - PAD * 2 - 0.3 * 4) / 5
  const kpiY = CY + 0.3
  kpi(s2, pptx, PAD, kpiY, kpiW, 1.2, String(participants.size), 'Participants')
  kpi(s2, pptx, PAD + (kpiW + 0.3), kpiY, kpiW, 1.2, String(responseTexts.length), 'Responses')
  kpi(s2, pptx, PAD + (kpiW + 0.3) * 2, kpiY, kpiW, 1.2, String(avgWords), 'Avg Words')
  kpi(s2, pptx, PAD + (kpiW + 0.3) * 3, kpiY, kpiW, 1.2, String(activeThemes.length), 'Themes')
  kpi(s2, pptx, PAD + (kpiW + 0.3) * 4, kpiY, kpiW, 1.2, String((postResponses || []).length), 'Survey Responses')

  // Sentiment breakdown
  const sentTotal = posCount + negCount + mixCount + neuCount
  if (sentTotal > 0) {
    const sentY = kpiY + 1.8
    s2.addText('OVERALL SENTIMENT', { x: PAD, y: sentY, w: 3, h: 0.3, fontSize: 9, bold: true, color: DN.slateDark, charSpacing: 1.2 })
    const barW = W - PAD * 2
    const barY = sentY + 0.4
    const barH = 0.4
    let bx = PAD
    for (const [label, count, color] of [
      ['Positive', posCount, DN.green],
      ['Negative', negCount, DN.red],
      ['Mixed', mixCount, DN.amber],
      ['Neutral', neuCount, DN.slate],
    ] as [string, number, string][]) {
      const pctW = (count / sentTotal) * barW
      if (pctW > 0) {
        s2.addShape(pptx.ShapeType.rect, { x: bx, y: barY, w: pctW, h: barH, fill: { color }, line: { width: 0 } })
        if (pctW > 0.7) {
          s2.addText(Math.round(count / sentTotal * 100) + '%', { x: bx, y: barY, w: pctW, h: barH, fontSize: 11, bold: true, color: DN.white, valign: 'middle', align: 'center' })
        }
        bx += pctW
      }
    }
    // Legend
    const legY = barY + 0.55
    let lx = PAD
    for (const [label, count, color] of [
      ['Positive', posCount, DN.green],
      ['Negative', negCount, DN.red],
      ['Mixed', mixCount, DN.amber],
      ['Neutral', neuCount, DN.slate],
    ] as [string, number, string][]) {
      s2.addShape(pptx.ShapeType.rect, { x: lx, y: legY + 0.04, w: 0.16, h: 0.16, fill: { color }, line: { width: 0 }, rectRadius: 0.03 })
      s2.addText(label + ' (' + count + ')', { x: lx + 0.22, y: legY, w: 1.4, h: 0.24, fontSize: 9, color: DN.slateDark })
      lx += 1.7
    }
  }

  footer(s2, pptx, sessionName)

  // ── Slide 3+: Theme cards (2 per slide) ──
  const renderThemeCards = (list: ThemeCard[], headerTitle = 'Theme Analysis') => {
  for (let i = 0; i < list.length; i += 2) {
    const slide = pptx.addSlide()
    bgFill(slide, pptx)
    hdr(slide, pptx, headerTitle)
    logo(slide)

    for (let j = 0; j < 2 && i + j < list.length; j++) {
      const theme = list[i + j]
      const themeColor = THEME_COLORS[(i + j) % THEME_COLORS.length]
      const cx = PAD + j * ((W - PAD * 2 - 0.3) / 2 + 0.3)
      const cw = (W - PAD * 2 - 0.3) / 2

      // Theme card background
      slide.addShape(pptx.ShapeType.rect, { x: cx, y: CY + 0.1, w: cw, h: 5.5, fill: { color: DN.white }, line: { color: DN.divider, width: 1 }, rectRadius: 0.08 })
      // Top color bar
      slide.addShape(pptx.ShapeType.rect, { x: cx, y: CY + 0.1, w: cw, h: 0.06, fill: { color: themeColor }, line: { width: 0 } })

      // Theme name
      slide.addText(theme.label, { x: cx + 0.2, y: CY + 0.3, w: cw - 0.4, h: 0.4, fontSize: 16, bold: true, color: DN.ink })

      // Badges: sentiment + source
      const sent = theme.sentiment || 'neutral'
      slide.addShape(pptx.ShapeType.rect, { x: cx + 0.2, y: CY + 0.8, w: 0.9, h: 0.28, fill: { color: sentColor(sent) === DN.green ? DN.greenLight : sentColor(sent) === DN.red ? DN.redLight : sentColor(sent) === DN.amber ? DN.amberLight : DN.slateLight }, line: { width: 0 }, rectRadius: 0.14 })
      slide.addText(sent.charAt(0).toUpperCase() + sent.slice(1), { x: cx + 0.2, y: CY + 0.8, w: 0.9, h: 0.28, fontSize: 8, bold: true, color: sentColor(sent), valign: 'middle', align: 'center' })

      slide.addShape(pptx.ShapeType.rect, { x: cx + 1.2, y: CY + 0.8, w: 1.0, h: 0.28, fill: { color: DN.slateLight }, line: { width: 0 }, rectRadius: 0.14 })
      slide.addText(theme.source.replace('_', ' '), { x: cx + 1.2, y: CY + 0.8, w: 1.0, h: 0.28, fontSize: 8, color: DN.slateDark, valign: 'middle', align: 'center' })

      // State badge
      const stateLabel = (theme.state || 'active').charAt(0).toUpperCase() + (theme.state || 'active').slice(1)
      const stateBg: Record<string, string> = { active: DN.greenLight || 'dcfce7', completed: 'dbeafe', parked: 'dbeafe', paused: DN.amberLight || 'fef3c7', dismissed: DN.slateLight, detected: 'fef3c7' }
      const stateClr: Record<string, string> = { active: DN.green, completed: '2563eb', parked: '2563eb', paused: DN.amber || 'd97706', dismissed: DN.slate, detected: 'd97706' }
      slide.addShape(pptx.ShapeType.rect, { x: cx + 2.3, y: CY + 0.8, w: 1.0, h: 0.28, fill: { color: stateBg[theme.state] || DN.slateLight }, line: { width: 0 }, rectRadius: 0.14 })
      slide.addText(stateLabel, { x: cx + 2.3, y: CY + 0.8, w: 1.0, h: 0.28, fontSize: 8, bold: true, color: stateClr[theme.state] || DN.slate, valign: 'middle', align: 'center' })

      // Stats
      slide.addText(theme.matchCount + ' responses  ·  ' + theme.percentage + '% of total', { x: cx + 0.2, y: CY + 1.25, w: cw - 0.4, h: 0.3, fontSize: 10, color: DN.slateDark })

      // Percentage bar
      const barX = cx + 0.2, barY2 = CY + 1.6, barW2 = cw - 0.4
      slide.addShape(pptx.ShapeType.rect, { x: barX, y: barY2, w: barW2, h: 0.18, fill: { color: DN.slateLight }, line: { width: 0 }, rectRadius: 0.09 })
      if (theme.percentage > 0) {
        slide.addShape(pptx.ShapeType.rect, { x: barX, y: barY2, w: Math.max(0.05, barW2 * Math.min(theme.percentage, 100) / 100), h: 0.18, fill: { color: themeColor }, line: { width: 0 }, rectRadius: 0.09 })
      }

      // Keywords
      const kws = (theme.keywords || []).slice(0, 8)
      if (kws.length > 0) {
        slide.addText('KEYWORDS', { x: cx + 0.2, y: CY + 2.0, w: cw - 0.4, h: 0.22, fontSize: 7.5, bold: true, color: DN.slate, charSpacing: 1.2 })
        slide.addText(kws.join('  ·  '), { x: cx + 0.2, y: CY + 2.25, w: cw - 0.4, h: 0.3, fontSize: 9, color: DN.slateDark, wrap: true })
      }

      // Top quotes
      if (theme.quotes.length > 0) {
        slide.addText('TOP QUOTES', { x: cx + 0.2, y: CY + 2.7, w: cw - 0.4, h: 0.22, fontSize: 7.5, bold: true, color: DN.slate, charSpacing: 1.2 })
        let qy = CY + 2.95
        for (let qi = 0; qi < Math.min(3, theme.quotes.length); qi++) {
          const qText = '\u201C' + trunc(theme.quotes[qi], 200) + '\u201D'
          slide.addShape(pptx.ShapeType.rect, { x: cx + 0.2, y: qy, w: 0.04, h: 0.6, fill: { color: themeColor }, line: { width: 0 } })
          slide.addText(qText, { x: cx + 0.36, y: qy, w: cw - 0.6, h: 0.6, fontSize: 8.5, color: DN.slateDark, italic: true, wrap: true, autoFit: true })
          qy += 0.7
        }
      }
    }

    footer(slide, pptx, sessionName)
  }
  }

  if (roundsMode) {
    // One section divider per round (tasting item) + that round's theme cards.
    const rNums = Array.from(new Set(enrichedThemes.map((t: ThemeCard) => t.round_number ?? 0))).sort((a, b) => (a as number) - (b as number)) as number[]
    for (const rn of rNums) {
      const list = enrichedThemes.filter((t: ThemeCard) => (t.round_number ?? 0) === rn)
      const item = roundItems[rn] || ''
      const sec = pptx.addSlide()
      bgFill(sec, pptx, DN.navy)
      sec.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.08, fill: { color: DN.gold }, line: { width: 0 } })
      sec.addText('ROUND ' + (rn || '—'), { x: PAD, y: 2.4, w: W - PAD * 2, h: 0.5, fontSize: 16, bold: true, color: DN.gold, charSpacing: 2 })
      sec.addText(item || ('Round ' + rn), { x: PAD, y: 2.9, w: W - PAD * 2, h: 1.0, fontSize: 32, bold: true, color: DN.white })
      sec.addText(list.length + ' theme' + (list.length === 1 ? '' : 's') + '  ·  what guests said about this item', { x: PAD, y: 4.0, w: W - PAD * 2, h: 0.4, fontSize: 12, color: DN.teal })
      footer(sec, pptx, sessionName)
      renderThemeCards(list, 'Round ' + rn + (item ? ' — ' + item : ''))
    }
  } else {
    renderThemeCards(enrichedThemes)
  }

  // ── Demographics slide (if any) ──
  const demoKeys = Object.keys(demoCounts)
  if (demoKeys.length > 0) {
    const dSlide = pptx.addSlide()
    bgFill(dSlide, pptx)
    hdr(dSlide, pptx, 'Participant Demographics')
    logo(dSlide)

    let dx = PAD, dy = CY + 0.3
    const dCardW = (W - PAD * 2 - 0.3 * 2) / 3
    const dCardH = 2.2

    for (let di = 0; di < Math.min(6, demoKeys.length); di++) {
      const dk = demoKeys[di]
      const counts = demoCounts[dk]
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 6)
      const total = sorted.reduce((s, e) => s + e[1], 0)

      dSlide.addShape(pptx.ShapeType.rect, { x: dx, y: dy, w: dCardW, h: dCardH, fill: { color: DN.white }, line: { color: DN.divider, width: 1 }, rectRadius: 0.08 })
      dSlide.addText(dk.replace(/_/g, ' ').toUpperCase(), { x: dx + 0.15, y: dy + 0.1, w: dCardW - 0.3, h: 0.24, fontSize: 8, bold: true, color: DN.slateDark, charSpacing: 1 })

      let rowY = dy + 0.42
      for (const [val, cnt] of sorted) {
        const pctVal = Math.round(cnt / total * 100)
        dSlide.addText(val, { x: dx + 0.15, y: rowY, w: dCardW * 0.5, h: 0.22, fontSize: 9, color: DN.ink })
        dSlide.addShape(pptx.ShapeType.rect, { x: dx + dCardW * 0.55, y: rowY + 0.04, w: dCardW * 0.3, h: 0.14, fill: { color: DN.slateLight }, line: { width: 0 }, rectRadius: 0.07 })
        dSlide.addShape(pptx.ShapeType.rect, { x: dx + dCardW * 0.55, y: rowY + 0.04, w: Math.max(0.03, dCardW * 0.3 * pctVal / 100), h: 0.14, fill: { color: DN.teal }, line: { width: 0 }, rectRadius: 0.07 })
        dSlide.addText(pctVal + '%', { x: dx + dCardW * 0.87, y: rowY, w: 0.4, h: 0.22, fontSize: 8, color: DN.slateDark, align: 'right' })
        rowY += 0.26
      }

      dx += dCardW + 0.3
      if ((di + 1) % 3 === 0) { dx = PAD; dy += dCardH + 0.3 }
    }

    footer(dSlide, pptx, sessionName)
  }

  // Generate buffer
  const raw = await pptx.write({ outputType: 'nodebuffer' })
  const buf = new Uint8Array(raw as Buffer)

  const safeName = (session.name || 'townhall').replace(/[^a-z0-9]/gi, '-').toLowerCase()
  const date = new Date().toISOString().slice(0, 10)

  return new NextResponse(buf, {
    status: 200,
    headers: {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'Content-Disposition': `attachment; filename="${safeName}-summary-${date}.pptx"`,
    },
  })
}
