// lib/export/studyDesignPptx.ts
// Generate a branded PPTX study design summary for client sharing
// Uses the same Datanautix branding as the analytics export

import PptxGenJS from 'pptxgenjs'
import type { StudyConfig, RatingOption, LikertFollowUp, SurveyQuestion, PsychoQuestion, DemoField } from '@/lib/types'

interface StudyDesignInput {
  studyName:  string
  botName:    string
  botEmoji:   string
  surveyUrl:  string
  config:     Partial<StudyConfig> | null
}

// ── Datanautix brand palette (matches analytics export) ───────────────────────
const DN = {
  teal:       '0F7173',
  tealDark:   '0A4F51',
  tealLight:  '1DA39A',
  tealPale:   'E0F2F1',
  navy:       '0D2B45',
  navyMid:    '0F3A54',
  navyLight:  '1A5070',
  gold:       'E8B84B',
  goldLight:  'F5D98A',
  orange:     'E85A1A',
  orangeLight:'F07040',
  ink:        '0D2B45',
  slate:      '8FA3AE',
  slateDark:  '4A6572',
  slateLight: 'E8EDEF',
  slateCard:  'F4F7F8',
  divider:    'D4DDE2',
  white:      'FFFFFF',
}

// ── Layout (LAYOUT_WIDE = 13.33" × 7.5") ─────────────────────────────────────
const W   = 13.33
const H   = 7.5
const HH  = 0.9
const CY  = 1.05
const FY  = H - 0.28
const PAD = 0.42
const MAX_Y = FY - 0.15  // max content y before footer

// ── Shared slide helpers ──────────────────────────────────────────────────────

function bg(slide: PptxGenJS.Slide, pptx: PptxGenJS, color = DN.slateCard) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: H, fill: { color }, line: { width: 0 } })
}

function hdr(slide: PptxGenJS.Slide, pptx: PptxGenJS, title: string, subtitle?: string) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.06, fill: { color: DN.gold }, line: { width: 0 } })
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.06, w: W, h: HH - 0.06, fill: { color: DN.navy }, line: { width: 0 } })
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0.06, w: 0.07, h: HH - 0.06, fill: { color: DN.teal }, line: { width: 0 } })
  slide.addText(title, {
    x: PAD, y: 0.1, w: W - PAD * 2 - 2.4, h: subtitle ? 0.5 : HH - 0.18,
    fontSize: 17, bold: true, color: DN.white, valign: 'middle', wrap: true,
  })
  if (subtitle) {
    slide.addText(subtitle, {
      x: PAD, y: 0.56, w: W - PAD * 2 - 2.4, h: 0.32,
      fontSize: 10, color: DN.tealLight, valign: 'middle', italic: true,
    })
  }
}

function logo(slide: PptxGenJS.Slide) {
  slide.addText(
    [
      { text: 'data',   options: { color: DN.orangeLight, bold: true, italic: true } },
      { text: 'nautix', options: { color: DN.tealLight,   bold: true, italic: true } },
    ],
    { x: W - 2.3, y: 0.1, w: 2.1, h: HH - 0.18, fontSize: 15, valign: 'middle', align: 'right' }
  )
}

function footer(slide: PptxGenJS.Slide, pptx: PptxGenJS, studyName: string) {
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: FY - 0.02, w: W, h: 0.015, fill: { color: DN.teal }, line: { width: 0 }, rectRadius: 0 })
  slide.addText('datanautix.com  ·  ' + studyName, {
    x: PAD, y: FY, w: W * 0.5, h: 0.26, fontSize: 7.5, color: DN.slate, valign: 'middle', wrap: false,
  })
  slide.addText('Proprietary and Confidential', {
    x: W * 0.35, y: FY, w: W * 0.3, h: 0.26, fontSize: 7.5, color: DN.slate, valign: 'middle', align: 'center',
  })
}

function makeSlide(pptx: PptxGenJS, title: string, studyName: string, subtitle?: string) {
  const slide = pptx.addSlide()
  bg(slide, pptx)
  hdr(slide, pptx, title, subtitle)
  logo(slide)
  footer(slide, pptx, studyName)
  return slide
}

function makeSectionSlide(pptx: PptxGenJS, title: string, subtitle: string, studyName: string) {
  const slide = pptx.addSlide()
  bg(slide, pptx, DN.navy)
  slide.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.06, fill: { color: DN.gold }, line: { width: 0 } })
  // Title ABOVE the accent line
  slide.addText(title, { x: PAD, y: 2.6, w: W - PAD * 2, fontSize: 28, bold: true, color: DN.white })
  // Teal accent line below title
  slide.addShape(pptx.ShapeType.rect, { x: PAD, y: 3.2, w: 2.5, h: 0.04, fill: { color: DN.teal }, line: { width: 0 } })
  slide.addText(subtitle, { x: PAD, y: 3.4, w: W - PAD * 2, fontSize: 13, color: DN.tealLight })
  logo(slide)
  footer(slide, pptx, studyName)
}

interface Item { label: string; value: string; note?: string; subItems?: string[] }

// Estimate height for a sub-item based on text length
// At font 8, ~160 chars fit per line on a LAYOUT_WIDE slide
function subItemH(text: string): number {
  const lines = Math.ceil(text.length / 140)
  return Math.max(0.2, lines * 0.16)
}

// Estimate height for an item
function itemHeight(item: Item): number {
  const valH = item.value.length > 120 ? 0.7 : item.value.length > 60 ? 0.5 : 0.35
  let h = 0.22 + valH + 0.05 + 0.12
  if (item.note) h += 0.2
  if (item.subItems?.length) {
    h += 0.22 // divider + label
    for (const sub of item.subItems) h += subItemH(sub)
    h += 0.1 // bottom padding
  }
  return h
}

// Adaptive content slide — returns items that didn't fit so caller can overflow
function addContentSlide(pptx: PptxGenJS, title: string, items: Item[], studyName: string, subtitle?: string): Item[] {
  const slide = makeSlide(pptx, title, studyName, subtitle)
  let y = CY + 0.1
  let i = 0

  for (; i < items.length; i++) {
    const item = items[i]
    const ih = itemHeight(item)

    if (y + ih > MAX_Y && i > 0) break

    // Label
    slide.addText(item.label, {
      x: PAD, y, w: W - PAD * 2, fontSize: 9, bold: true, color: DN.teal,
    })
    y += 0.22

    // Calculate card height — includes value + sub-items if present
    const valH = item.value.length > 120 ? 0.7 : item.value.length > 60 ? 0.5 : 0.35
    let subTotalH = 0
    if (item.subItems?.length) {
      subTotalH = 0.22 // divider + header
      for (const sub of item.subItems) subTotalH += subItemH(sub)
      subTotalH += 0.1 // bottom padding
    }
    const cardH = valH + subTotalH

    // Card background
    slide.addShape(pptx.ShapeType.rect, { x: PAD, y, w: W - PAD * 2, h: cardH, fill: { color: DN.white }, line: { color: DN.divider, width: 0.5 }, rectRadius: 0.06 })

    // Value text
    slide.addText(item.value, {
      x: PAD + 0.15, y, w: W - PAD * 2 - 0.3, h: valH,
      fontSize: 11, color: DN.ink, valign: 'middle', wrap: true,
    })

    // Sub-items (adaptive prompts) inside the card
    if (item.subItems?.length) {
      let subY = y + valH + 0.02
      // Subtle divider inside card
      slide.addShape(pptx.ShapeType.rect, { x: PAD + 0.15, y: subY, w: W - PAD * 2 - 0.3, h: 0.01, fill: { color: DN.divider }, line: { width: 0 } })
      subY += 0.06
      slide.addText('ADAPTIVE FOLLOW-UP', {
        x: PAD + 0.15, y: subY, w: 2, fontSize: 7, bold: true, color: DN.teal,
      })
      subY += 0.16
      for (const sub of item.subItems) {
        const h = subItemH(sub)
        slide.addText(sub, {
          x: PAD + 0.15, y: subY, w: W - PAD * 2 - 0.3, h, fontSize: 8, color: DN.slateDark, wrap: true, valign: 'top',
        })
        subY += h
      }
    }

    y += cardH + 0.05

    // Note below card
    if (item.note) {
      slide.addText(item.note, {
        x: PAD + 0.15, y, w: W - PAD * 2, fontSize: 8, italic: true, color: DN.slate,
      })
      y += 0.2
    }
    y += 0.12
  }

  return items.slice(i)
}

// Add content across multiple slides as needed
function addContentSlides(pptx: PptxGenJS, title: string, items: Item[], studyName: string, subtitle?: string) {
  let remaining = items
  let page = 1
  while (remaining.length > 0) {
    const slideTitle = page > 1 ? `${title} (cont.)` : title
    remaining = addContentSlide(pptx, slideTitle, remaining, studyName, subtitle)
    page++
  }
}

// Helper to get per-response adaptive prompts
function getAdaptivePrompts(followUp: LikertFollowUp | undefined, scale: RatingOption[]): string[] {
  if (!followUp?.enabled) return []
  if (followUp.mode === 'per-response' && followUp.perResponse) {
    const prompts: string[] = []
    for (const opt of scale) {
      const pr = followUp.perResponse[opt.score]
      if (pr?.prompt) prompts.push(`${opt.emoji || ''} ${opt.label} → "${pr.prompt}"`)
    }
    return prompts
  }
  if (followUp.sharedPrompt) return [`Shared prompt: "${followUp.sharedPrompt}"`]
  return []
}

// ── Main export function ──────────────────────────────────────────────────────

export function generateStudyDesignPptx(input: StudyDesignInput) {
  const pptx = new PptxGenJS()
  pptx.layout = 'LAYOUT_WIDE'
  pptx.author  = 'Datanautix'
  pptx.company = 'Datanautix'
  pptx.title   = `${input.studyName} — Study Design`

  const c = input.config || {}
  const name = input.studyName

  // ── Title slide ─────────────────────────────────────────────────────────────
  const title = pptx.addSlide()
  bg(title, pptx, DN.navy)
  title.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: W, h: 0.06, fill: { color: DN.gold }, line: { width: 0 } })
  // Large logo above the title
  title.addText(
    [
      { text: 'data',   options: { color: DN.orangeLight, bold: true, italic: true } },
      { text: 'nautix', options: { color: DN.tealLight,   bold: true, italic: true } },
    ],
    { x: PAD, y: 1.4, w: W - PAD * 2, fontSize: 36, valign: 'middle' }
  )
  // Study name
  title.addText(input.studyName, { x: PAD, y: 2.6, w: W - PAD * 2, fontSize: 32, bold: true, color: DN.white })
  // Subtitle
  title.addText('Study Design Summary', { x: PAD, y: 3.3, w: W - PAD * 2, fontSize: 16, color: DN.tealLight })
  // Teal accent line below title text
  title.addShape(pptx.ShapeType.rect, { x: PAD, y: 3.75, w: 3, h: 0.05, fill: { color: DN.teal }, line: { width: 0 } })
  // Meta
  title.addText(`Bot: ${input.botEmoji} ${input.botName}  ·  ${input.surveyUrl}`, { x: PAD, y: 4.2, w: W - PAD * 2, fontSize: 16, color: DN.slate })
  title.addText(new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }), { x: PAD, y: 4.8, w: W - PAD * 2, fontSize: 16, color: DN.slate })
  // Confidential — centered at bottom, no logo/footer
  title.addText('Proprietary and Confidential', { x: 0, y: FY, w: W, h: 0.26, fontSize: 9, color: DN.slate, valign: 'middle', align: 'center' })

  // ── Survey Flow Overview ────────────────────────────────────────────────────
  makeSectionSlide(pptx, 'Survey Flow', 'The respondent journey from start to finish', name)

  // ── Greeting & Consent ──────────────────────────────────────────────────────
  addContentSlides(pptx, 'Opening', [
    { label: 'GREETING MESSAGE', value: c.greeting || '(not configured)' },
    { label: 'CONSENT PROMPT', value: 'Are you ready to share your feedback?' },
    { label: 'RESPONSE OPTIONS', value: 'Yes, let\'s go! 👍  |  Not right now' },
  ], name)

  // ── Ratings ─────────────────────────────────────────────────────────────────
  const ratingItems: Item[] = []
  const ratingScale = c.ratingScale || []

  let ratingNum = 1
  if (c.experienceEnabled !== false) {
    const expLabel = c.experienceRatingLabel || 'Experience Rating'
    const expAdaptive = c.experienceFollowUp?.enabled ? getAdaptivePrompts(c.experienceFollowUp, ratingScale) : []
    ratingItems.push({
      label: `${ratingNum}. ${expLabel.toUpperCase()}`,
      value: c.ratingPrompt || '(default prompt)',
      note: 'Scale: ' + ratingScale.map((r: RatingOption) => `${r.emoji} ${r.label}`).join('  ·  '),
      subItems: expAdaptive.length > 0 ? expAdaptive : undefined,
    })
    ratingNum++
  }

  if (c.npsEnabled !== false) {
    const npsLabel = c.npsLabel || 'NPS'
    const npsScale = [1,2,3,4,5].map(s => ({ score: s, emoji: '⭐'.repeat(s), label: `${s} star${s > 1 ? 's' : ''}` }))
    const npsAdaptive = c.npsFollowUp?.enabled ? getAdaptivePrompts(c.npsFollowUp, npsScale) : []
    ratingItems.push({
      label: `${ratingNum}. ${npsLabel.toUpperCase()} RATING`,
      value: c.npsPrompt || 'How likely are you to recommend us?',
      note: 'Scale: 1–5 stars',
      subItems: npsAdaptive.length > 0 ? npsAdaptive : undefined,
    })
    ratingNum++
  }

  if (ratingItems.length > 0) addContentSlides(pptx, 'Ratings', ratingItems, name)

  // ── Open-Ended Questions ────────────────────────────────────────────────────
  const oeItems: Item[] = []
  let oeNum = 1
  if (c.q3Enabled !== false && c.q3) {
    const q3Label = c.q3ExportLabel || 'Question 3'
    const q3Notes: string[] = []
    if (c.q3Required !== false) q3Notes.push('Required')
    else q3Notes.push('Optional')
    if (c.q3Clarify) q3Notes.push('Clarifier follow-up enabled')
    oeItems.push({ label: `${oeNum}. ${q3Label.toUpperCase()}`, value: c.q3, note: q3Notes.join('  ·  ') })
    oeNum++
  }
  if (c.q4Enabled !== false && c.q4) {
    const q4Label = c.q4ExportLabel || 'Question 4'
    const q4Notes: string[] = []
    if (c.q4Required === true) q4Notes.push('Required')
    else q4Notes.push('Optional')
    if (c.q4Clarify) q4Notes.push('Clarifier follow-up enabled')
    oeItems.push({ label: `${oeNum}. ${q4Label.toUpperCase()}`, value: c.q4, note: q4Notes.join('  ·  ') })
    oeNum++
  }
  if (oeItems.length > 0) addContentSlides(pptx, 'Open-Ended Questions', oeItems, name)

  // ── Custom Questions ────────────────────────────────────────────────────────
  const questions = (c.questions || []).filter((q: SurveyQuestion) => q.type !== 'hidden' && q.enabled !== false)
  if (questions.length > 0) {
    const shown = c.customQCount && c.customQCount < questions.length ? c.customQCount : questions.length
    const poolText = c.customQCount && c.customQCount < questions.length
      ? `Respondent sees ${shown} randomly selected questions from a pool of ${questions.length} questions`
      : `Respondent sees all ${questions.length} questions`
    makeSectionSlide(pptx, 'Custom Questions', poolText, name)

    const qItems: Item[] = questions.map((q: SurveyQuestion, i: number) => {
      const label = q.exportLabel || `Question ${i + 1}`
      const notes: string[] = [q.type.toUpperCase()]
      if (q.required) notes.push('Required')
      if (q.clarify !== false && c.useAIClarify) notes.push('Clarifier enabled')
      if (q.options?.length) notes.push('Options: ' + q.options.join('  ·  '))
      return { label: `${i + 1}. ${label.toUpperCase()}`, value: q.prompt || '(no prompt)', note: notes.join('  ·  ') }
    })

    addContentSlides(pptx, 'Custom Questions', qItems, name, poolText)
  }

  // ── Clarifiers & AI Features ────────────────────────────────────────────────
  const clarifierItems: Item[] = []
  if (c.useAIClarify) {
    clarifierItems.push({ label: 'AI CLARIFIERS', value: 'Enabled — AI generates contextual follow-up questions based on study context, sentiment, and prior answers', note: c.maxClarifierCount ? `Maximum ${c.maxClarifierCount} clarifiers per session` : 'Unlimited clarifiers per session' })
  }
  const keywords = Object.entries(c.clarifiers || {}).filter(([k]) => k !== 'default')
  for (const [kw, response] of keywords) {
    clarifierItems.push({ label: `KEYWORD TRIGGER: "${kw}"`, value: response as string })
  }
  if (c.clarifiers?.default) {
    clarifierItems.push({ label: 'DEFAULT FALLBACK', value: c.clarifiers.default })
  }
  if (c.questionRedirect?.enabled) {
    const qr = c.questionRedirect
    clarifierItems.push({
      label: 'SMART DEFLECTION',
      value: 'Enabled — AI detects off-topic questions, requests for information, and responses directed at the bot. Generates a contextual, conversational redirect that acknowledges what the respondent said and directs them to the resource link.',
      note: `Link: "${qr.linkText || 'our website'}" → ${qr.linkUrl || '(not set)'}`,
    })
    if (qr.message) {
      clarifierItems.push({ label: 'DEFLECTION DEFAULT MESSAGE', value: qr.message })
    }
  }
  if (clarifierItems.length > 0) addContentSlides(pptx, 'Clarifiers & AI Features', clarifierItems, name)

  // ── Psychographics ──────────────────────────────────────────────────────────
  const psychoBank = c.psychographicBank || []
  if (psychoBank.length > 0) {
    const psychoShown = c.psychoCount || 3
    const psychoPoolText = `Respondent sees ${psychoShown} randomly selected questions from a pool of ${psychoBank.length} questions`
    makeSectionSlide(pptx, 'Psychographic Questions', psychoPoolText, name)

    const psychoItems: Item[] = psychoBank.map((q: PsychoQuestion, i: number) => ({
      label: `${i + 1}. ${(q.exportLabel || `Psychographic ${i + 1}`).toUpperCase()}`,
      value: q.q,
      note: q.opts?.length ? 'Options: ' + q.opts.join('  ·  ') : undefined,
    }))

    addContentSlides(pptx, 'Psychographic Questions', psychoItems, name, psychoPoolText)
  }

  // ── Demographics ────────────────────────────────────────────────────────────
  const demoFields = (c.demoFields || []).filter((f: DemoField) => f.enabled)
  if (demoFields.length > 0) {
    addContentSlides(pptx, 'Demographics', demoFields.map((f: DemoField, i: number) => ({
      label: `${i + 1}. ${(f.label || f.key).toUpperCase()}`,
      value: f.type === 'select' && f.options ? 'Options: ' + f.options.map((o: [string, string] | string) => o[1] || o).join('  ·  ') : 'Free text input',
    })), name)
  }

  // ── Section Transitions ─────────────────────────────────────────────────────
  const transitions: NonNullable<StudyConfig['sectionTransitions']> = c.sectionTransitions || {}
  const transItems: Item[] = []
  if (transitions.customQuestions?.enabled) transItems.push({ label: 'BEFORE CUSTOM QUESTIONS', value: transitions.customQuestions.text || '(default)' })
  if (transitions.psychographics?.enabled !== false) transItems.push({ label: 'BEFORE PSYCHOGRAPHICS', value: transitions.psychographics?.text || 'Just a few quick questions to round things out — helps us understand the range of people sharing feedback.' })
  if (transitions.demographics?.enabled !== false) transItems.push({ label: 'BEFORE DEMOGRAPHICS', value: transitions.demographics?.text || 'Almost done — a couple of optional questions about you. Completely up to you.' })
  if (transItems.length > 0) addContentSlides(pptx, 'Section Transitions', transItems, name)

  // ── Closing ─────────────────────────────────────────────────────────────────
  addContentSlides(pptx, 'Closing Message', [
    { label: 'BOT MESSAGE', value: c.closingMessage || `Thank you so much — ${input.botName} really appreciates you taking a moment to share. Your feedback makes a genuine difference.` },
    { label: 'COMPLETION CARD', value: c.closingCard || 'Your responses have been saved. Thank you for your time.' },
  ], name)

  // ── Study Settings ──────────────────────────────────────────────────────────
  addContentSlides(pptx, 'Study Settings', [
    { label: 'MULTIPLE RESPONSES', value: c.allowMultipleResponses === false ? 'No — limited to one per device' : 'Yes — multiple responses allowed' },
    { label: 'CONFIRM BEFORE RECORD', value: c.confirmBeforeRecord ? 'Yes — require confirm button for single-tap questions' : 'No — auto-record on tap' },
    { label: 'FONT SIZE', value: (c.surveyFontSize || 18) + 'px base (scales with device accessibility settings)' },
    { label: 'BRANDING', value: c.showBranding === false ? 'Hidden' : `"by ${c.brandingLabel || 'DATANAUTIX'}"` },
    { label: 'INDUSTRY', value: c.industry || '(not set)' },
    { label: 'THEME COLORS', value: `Primary: ${c.theme?.primaryColor || '#00b4d8'}  ·  Background: ${c.theme?.backgroundColor || '#0a1628'}` },
  ], name)

  return pptx
}
