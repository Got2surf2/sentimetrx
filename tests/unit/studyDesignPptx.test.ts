// lib/export/studyDesignPptx.ts — the client-facing study design deck, rendered
// through REAL pptxgenjs and inspected as an archive (the ENGINEERING §6 lesson:
// mocks can pass a deck PowerPoint calls corrupt). A rich config exercises every
// section and the overflow-to-"(cont.)" path; a null config pins the defaults.
import { describe, it, expect } from 'vitest'
import JSZip from 'jszip'
import { generateStudyDesignPptx } from '@/lib/export/studyDesignPptx'
import type { StudyConfig } from '@/lib/types'

async function render(config: Partial<StudyConfig> | null, studyName = 'Coastal Grill Guest Pulse') {
  const pptx = generateStudyDesignPptx({ studyName, botName: 'Sarina', botEmoji: '🌊', surveyUrl: 'https://www.sentimetrx.ai/s/abc', config })
  const buf = (await pptx.write({ outputType: 'nodebuffer' })) as Buffer
  const zip = await JSZip.loadAsync(buf)
  const names = Object.keys(zip.files).filter(f => /^ppt\/slides\/slide\d+\.xml$/.test(f)).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]))
  const slides: string[] = []
  for (const n of names) slides.push(await zip.files[n].async('string'))
  const core = await zip.files['docProps/core.xml']?.async('string')
  const app = await zip.files['docProps/app.xml']?.async('string')
  return { slides, all: slides.join('\n'), core: core || '', app: app || '' }
}
const decode = (s: string) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")

const RICH: Partial<StudyConfig> = {
  greeting: 'Hi! Two minutes on tonight’s visit?',
  experienceRatingLabel: 'Meal Rating',
  ratingPrompt: 'How was your meal?',
  ratingScale: [{ score: 1, emoji: '😠', label: 'Poor' }, { score: 3, emoji: '😐', label: 'Okay' }, { score: 5, emoji: '😍', label: 'Great' }],
  experienceFollowUp: { enabled: true, mode: 'per-response', sharedPrompt: '', shareClarify: false, shareAI: false, perResponse: { 1: { prompt: 'What went wrong?' }, 5: { prompt: 'What stood out?' } } } as unknown as StudyConfig['experienceFollowUp'],
  npsLabel: 'Recommend',
  npsPrompt: 'Would you recommend us?',
  npsFollowUp: { enabled: true, mode: 'shared', sharedPrompt: 'Tell us why', shareClarify: true, shareAI: false } as unknown as StudyConfig['npsFollowUp'],
  q3: 'What would bring you back sooner?', q3ExportLabel: 'Return driver', q3Clarify: true,
  q4: 'Anything else?', q4Required: true,
  questions: [
    ...Array.from({ length: 14 }, (_, i) => ({ id: 'q' + i, type: 'open' as const, prompt: 'Custom question number ' + (i + 1) + ' with a reasonably long prompt so the card grows and the slide has to overflow onto a continuation page', required: i % 2 === 0, exportLabel: i === 0 ? 'First custom' : undefined })),
    { id: 'mc', type: 'radio' as const, prompt: 'Pick a side', options: ['Fries', 'Salad'], clarify: false },
    { id: 'hid', type: 'hidden' as const, prompt: 'never shown' },
    { id: 'off', type: 'open' as const, prompt: 'disabled', enabled: false },
  ] as unknown as StudyConfig['questions'],
  customQCount: 5,
  useAIClarify: true, maxClarifierCount: 2,
  clarifiers: { default: 'Could you say a bit more?', price: 'Was it the value or the amount?' },
  questionRedirect: { enabled: true, linkText: 'our FAQ', linkUrl: 'https://example.com/faq', message: 'Great question — our team can help with that.' } as unknown as StudyConfig['questionRedirect'],
  psychographicBank: [{ key: 'p1', q: 'I plan meals ahead', opts: ['Agree', 'Disagree'] }, { key: 'p2', q: 'I try new places often', opts: [] }],
  psychoCount: 1,
  demoFields: [
    { key: 'age', label: 'Age range', type: 'select', options: [['18-24', '18 to 24'], ['25-34', '25 to 34']], enabled: true },
    { key: 'zip', label: 'ZIP', type: 'text', enabled: true },
    { key: 'gender', label: 'Gender', type: 'select', enabled: false },
  ],
  sectionTransitions: { customQuestions: { enabled: true, text: 'A few specifics next.' }, psychographics: { enabled: false }, demographics: { enabled: true } } as unknown as StudyConfig['sectionTransitions'],
  closingMessage: 'Thanks a million!', closingCard: 'Saved.',
  allowMultipleResponses: false, confirmBeforeRecord: true, surveyFontSize: 20, showBranding: true, brandingLabel: 'COASTAL', industry: 'Restaurants',
  theme: { primaryColor: '#123456', backgroundColor: '#000000' } as unknown as StudyConfig['theme'],
}

describe('generateStudyDesignPptx — full config', () => {
  it('renders every section, in order, with Datanautix metadata and no corrupt OOXML attributes', async () => {
    const { slides, all, core, app } = await render(RICH)
    const text = decode(all)
    // metadata is the Datanautix company brand (deck-export exception to Sentimetrx-everywhere)
    expect(core + app).toMatch(/Datanautix/)
    expect(core + app).not.toMatch(/Sentimetrx/i)
    // title slide
    expect(decode(slides[0])).toContain('Coastal Grill Guest Pulse')
    expect(decode(slides[0])).toContain('Study Design Summary')
    expect(decode(slides[0])).toContain('Bot: 🌊 Sarina  ·  https://www.sentimetrx.ai/s/abc')
    expect(decode(slides[0])).toContain('Proprietary and Confidential')
    // wordmark is ONE word split into two runs, never with a separator
    expect(text).toMatch(/>data<[\s\S]{0,400}>nautix</)
    expect(text).not.toContain('data·nautix')
    // opening + ratings with adaptive follow-ups
    expect(text).toContain('GREETING MESSAGE')
    expect(text).toContain('Hi! Two minutes on tonight’s visit?')
    expect(text).toContain('1. MEAL RATING')
    expect(text).toContain('Scale: 😠 Poor  ·  😐 Okay  ·  😍 Great')
    expect(text).toContain('ADAPTIVE FOLLOW-UP')
    expect(text).toContain('😠 Poor → "What went wrong?"')
    expect(text).toContain('😍 Great → "What stood out?"')
    expect(text).toContain('2. RECOMMEND RATING')
    expect(text).toContain('Shared prompt: "Tell us why"')
    // open-ended
    expect(text).toContain('1. RETURN DRIVER')
    expect(text).toContain('Required  ·  Clarifier follow-up enabled')
    expect(text).toContain('2. QUESTION 4')
    // custom questions: pool text, hidden/disabled excluded, options + flags, overflow pages
    expect(text).toContain('Respondent sees 5 randomly selected questions from a pool of 15 questions')
    expect(text).not.toContain('never shown')
    expect(text).not.toContain('disabled')
    expect(text).toContain('1. FIRST CUSTOM')
    expect(text).toContain('RADIO  ·  Options: Fries  ·  Salad')
    expect(text).toContain('OPEN  ·  Required  ·  Clarifier enabled')
    expect(text).toContain('Custom Questions (cont.)')
    // clarifiers + deflection
    expect(text).toContain('Maximum 2 clarifiers per session')
    expect(text).toContain('KEYWORD TRIGGER: "price"')
    expect(text).toContain('DEFAULT FALLBACK')
    expect(text).toContain('SMART DEFLECTION')
    expect(text).toContain('Link: "our FAQ" → https://example.com/faq')
    expect(text).toContain('DEFLECTION DEFAULT MESSAGE')
    // psychographics + demographics
    expect(text).toContain('Respondent sees 1 randomly selected questions from a pool of 2 questions')
    expect(text).toContain('1. PSYCHOGRAPHIC 1')
    expect(text).toContain('Options: Agree  ·  Disagree')
    expect(text).toContain('1. AGE RANGE')
    expect(text).toContain('Options: 18 to 24  ·  25 to 34')
    expect(text).toContain('2. ZIP')
    expect(text).toContain('Free text input')
    expect(text).not.toContain('GENDER')
    // transitions (psychographics disabled → omitted; demographics enabled → default copy)
    expect(text).toContain('BEFORE CUSTOM QUESTIONS')
    expect(text).toContain('A few specifics next.')
    expect(text).not.toContain('BEFORE PSYCHOGRAPHICS')
    expect(text).toContain('Almost done — a couple of optional questions about you.')
    // closing + settings
    expect(text).toContain('Thanks a million!')
    expect(text).toContain('No — limited to one per device')
    expect(text).toContain('Yes — require confirm button for single-tap questions')
    expect(text).toContain('20px base')
    expect(text).toContain('"by COASTAL"')
    expect(text).toContain('Restaurants')
    expect(text).toContain('Primary: #123456  ·  Background: #000000')
    // section order: title, Survey Flow, Opening, Ratings, Open-Ended, Custom section, Custom pages…
    const titles = slides.map(s => decode(s))
    expect(titles[1]).toContain('Survey Flow')
    expect(titles[2]).toContain('Opening')
    expect(titles[3]).toContain('Ratings')
    expect(slides.length).toBeGreaterThanOrEqual(14)
    // ENGINEERING §6 tripwire — the pattern that corrupted PowerPoint once
    const bad = all.match(/="\d{9,}"/g)?.filter(m => m !== '="4294967295"') || []
    expect(bad).toEqual([])
  })
})

describe('generateStudyDesignPptx — null config', () => {
  it('falls back to defaults and skips the optional sections', async () => {
    const { slides, all } = await render(null, 'Bare Study')
    const text = decode(all)
    expect(text).toContain('(not configured)')                 // greeting
    expect(text).toContain('1. EXPERIENCE RATING')
    expect(text).toContain('(default prompt)')
    expect(text).toContain('2. NPS RATING')
    expect(text).toContain('How likely are you to recommend us?')
    expect(text).not.toContain('Open-Ended Questions')
    expect(text).not.toContain('Custom Questions')
    expect(text).not.toContain('Clarifiers')
    expect(text).not.toContain('Psychographic')
    expect(text).not.toContain('Demographics')
    // transitions default to enabled with default copy
    expect(text).toContain('Just a few quick questions to round things out')
    // closing defaults are personified with the bot's name
    expect(text).toContain('Thank you so much — Sarina really appreciates you taking a moment to share.')
    expect(text).toContain('Your responses have been saved. Thank you for your time.')
    expect(text).toContain('Yes — multiple responses allowed')
    expect(text).toContain('No — auto-record on tap')
    expect(text).toContain('18px base')
    expect(text).toContain('"by DATANAUTIX"')
    expect(text).toContain('(not set)')
    expect(text).toContain('Primary: #00b4d8  ·  Background: #0a1628')
    // title + Survey Flow + Opening + Ratings + Transitions + Closing + Settings
    expect(slides).toHaveLength(7)
    expect(text).toContain('datanautix.com  ·  Bare Study')
  })
  it('disabling both ratings and hiding branding drops the Ratings slide and says Hidden', async () => {
    const { all } = await render({ experienceEnabled: false, npsEnabled: false, showBranding: false, greeting: 'Hey' })
    const text = decode(all)
    expect(text).not.toContain('Ratings')
    expect(text).toContain('Hidden')
    expect(text).toContain('Hey')
  })
})
