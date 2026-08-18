// @vitest-environment jsdom
//
// End-to-end regression harness for `useSurveyEngine`.
//
// The engine is 2,600+ lines of imperative DOM driving a respondent-facing
// data-collection flow, and it had ZERO test coverage. These tests drive a
// real survey to completion through the same buttons/textareas a respondent
// touches, then assert on the ONE artefact that has to stay stable: the
// `/api/respond` payload, which embeds the full conversation transcript.
//
// That makes this a behavioural pin for the dependency-graph refactor — if
// stabilising a callback changes what the respondent sees, what order it is
// shown in, or what we store, the transcript diverges and these fail.
//
// Determinism: `Math.random` is pinned to 0 (the engine uses it to shuffle
// psychographic + custom questions and to vary the acknowledgement wording;
// 0 selects source order and the first variant every time), and timers are
// faked so the typing animation, the 100ms focus timeouts and the 2s
// savePartial debounce all run instantly.

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { useRef, useEffect } from 'react'
import { render, act } from '@testing-library/react'
import { useSurveyEngine } from '@/components/survey/useSurveyEngine'
import type { Study, StudyConfig } from '@/lib/types'

// ── fixture ────────────────────────────────────────────────────────────────
const THEME = {
  primaryColor: '#00b4d8',
  backgroundColor: '#1a1a2e',
  headerGradient: 'linear-gradient(135deg,#00b4d8,#0077b6)',
} as StudyConfig['theme']

function baseConfig(over: Partial<StudyConfig> = {}): StudyConfig {
  return {
    greeting: 'Hi there! I have a few quick questions.',
    readyPrompt: 'Are you ready to share your feedback?',
    readyYes: "Yes, let's go!",
    readyNo: 'Not right now',
    ratingPrompt: 'How was your experience?',
    ratingScale: [
      { score: 1, label: 'Terrible', emoji: '😞' },
      { score: 3, label: 'Okay', emoji: '😐' },
      { score: 5, label: 'Excellent', emoji: '🤩' },
    ],
    q3: 'What stood out to you?',
    q4: 'Anything else we should know?',
    clarifiers: { default: 'Could you tell me a bit more about that?' },
    psychographicBank: [
      { key: 'p1', q: 'How do you usually decide where to eat?', opts: ['Reviews', 'Word of mouth'] },
      { key: 'p2', q: 'How often do you dine out?', opts: ['Weekly', 'Monthly'] },
    ],
    psychoCount: 1,
    theme: THEME,
    ...over,
  } as StudyConfig
}

/** A short flow: opening cascade off, q3 only, no sections but custom questions. */
function q3OnlyConfig(over: Partial<StudyConfig> = {}): StudyConfig {
  return baseConfig({
    npsEnabled: false,
    experienceEnabled: false,
    q4Enabled: false,
    // stepDemographics falls back to age/gender/zip when demoFields is empty,
    // so the only way to keep a focused test short is to narrow sectionOrder.
    sectionOrder: ['customQuestions'],
    ...over,
  } as Partial<StudyConfig>)
}

function makeStudy(config: StudyConfig): Study {
  return {
    id: 'study-1',
    guid: 'guid-abc',
    name: 'Harness Study',
    bot_name: 'Ana',
    bot_emoji: '🤖',
    config,
  } as unknown as Study
}

/** ≥12 words, so `shouldClarify` returns false and no clarifier fires. */
const LONG_ANSWER = 'The staff were genuinely welcoming and the room was spotless throughout our entire stay here'

// ── host ───────────────────────────────────────────────────────────────────
function Host({ study, kiosk = false, onVerboseRequest, onComplete }: {
  study: Study
  kiosk?: boolean
  onVerboseRequest?: (mode?: 'bypass') => void
  onComplete?: () => void
}) {
  const chatRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLDivElement>(null)
  const started = useRef(false)
  const { renderInput } = useSurveyEngine({
    study, orgName: 'Test Org', chatRef, inputRef,
    scrollBottom: () => {},
    reducedMotion: true,
    kiosk, onVerboseRequest, onComplete,
  })
  useEffect(() => {
    if (started.current) return
    started.current = true
    void renderInput('start')
  }, [renderInput])
  return (
    <div>
      <div data-testid="chat" ref={chatRef} />
      <div data-testid="input" ref={inputRef} />
    </div>
  )
}

// ── driver ─────────────────────────────────────────────────────────────────
type Captured = { url: string; body: Record<string, unknown> }

let captured: Captured[]
let clarifyReply: string | null
let deflectReply: string | null

function installFetch() {
  captured = []
  clarifyReply = null
  deflectReply = null
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    let body: Record<string, unknown> = {}
    try { body = JSON.parse(String(init?.body ?? '{}')) } catch { /* non-JSON */ }
    captured.push({ url: String(url), body })
    if (String(url).includes('/api/clarify')) {
      return { ok: true, json: async () => ({ question: clarifyReply }) } as Response
    }
    if (String(url).includes('/api/deflect')) {
      return { ok: true, json: async () => ({ deflection: deflectReply }) } as Response
    }
    return { ok: true, json: async () => ({}) } as Response
  }))
}

/** Flush every pending timer + microtask so the async flow reaches its next input. */
async function settle() {
  await act(async () => { await vi.advanceTimersByTimeAsync(4000) })
}

function inputEl() { return document.querySelector('[data-testid="input"]') as HTMLDivElement }
function chatEl() { return document.querySelector('[data-testid="chat"]') as HTMLDivElement }

function buttons() {
  return Array.from(inputEl().querySelectorAll('button')).filter(b => !b.disabled)
}
function labels() { return buttons().map(b => (b.textContent || '').trim()) }

const isSend = (txt: string) => /^(→|->)$/.test(txt)

async function clickButton(match: string | RegExp) {
  const re = typeof match === 'string' ? null : match
  const btn = buttons().find(b => {
    const txt = (b.textContent || '').trim()
    return re ? re.test(txt) : txt.includes(match as string)
  })
  if (!btn) throw new Error(`no enabled button matching ${match}. Available: ${JSON.stringify(labels())}`)
  await act(async () => { btn.click() })
  await settle()
}

async function typeAndSend(text: string) {
  const ta = inputEl().querySelector('textarea') as HTMLTextAreaElement | null
  if (!ta) throw new Error(`no textarea present. Buttons: ${JSON.stringify(labels())}`)
  ta.value = text
  await act(async () => { ta.dispatchEvent(new Event('input', { bubbles: true })) })
  const send = buttons().find(b => isSend((b.textContent || '').trim()))
  if (!send) throw new Error('no send button')
  await act(async () => { send.click() })
  await settle()
}

/**
 * Answer whatever input the engine currently shows, without the test needing
 * to know which question type came up. Custom questions are shuffled by the
 * engine, so a fixed script would encode the shuffle rather than the behaviour.
 */
async function answerCurrentInput() {
  const el = inputEl()
  const num = el.querySelector('input[type="number"]') as HTMLInputElement | null
  if (num) {
    num.value = '4'
    await clickButton(/^(→|->)$/)
    return
  }
  const sel = el.querySelector('select') as HTMLSelectElement | null
  if (sel) {
    const opts = Array.from(sel.options).filter(o => o.value)
    sel.value = opts[opts.length - 1].value
    await clickButton(/^(→|->)$/)
    return
  }
  if (el.querySelector('textarea')) {
    await typeAndSend(LONG_ANSWER)
    return
  }
  // Checkbox questions carry a Done / "Select at least one" button.
  const done = buttons().find(b => /Done|Select at least one/.test(b.textContent || ''))
  if (done) {
    const opt = buttons().find(b => b !== done && !/Skip/.test(b.textContent || ''))
    if (opt) await act(async () => { opt.click() })
    await clickButton(/Done/)
    return
  }
  // Radio / rating / likert / NPS — take the last choice that isn't Skip.
  const choices = buttons().filter(b => !/^Skip$/.test((b.textContent || '').trim()))
  if (!choices.length) throw new Error(`nothing to answer. Buttons: ${JSON.stringify(labels())}`)
  await act(async () => { choices[choices.length - 1].click() })
  await settle()
}

/** Drive until the closing card renders (or we run out of patience). */
async function runToCompletion(max = 20) {
  for (let i = 0; i < max; i++) {
    if (chatEl().textContent?.includes('All done!')) return
    await answerCurrentInput()
  }
  throw new Error('survey did not reach the closing card')
}

/** The `/api/respond` call with status 'complete' — the survey's final artefact. */
function finalBody() {
  const done = captured.filter(c => c.url.includes('/api/respond') && c.body.status === 'complete')
  expect(done.length).toBe(1)
  return done[0].body as Record<string, unknown>
}
function finalPayload() { return finalBody().payload as Record<string, unknown> }
function partialCount() {
  return captured.filter(c => c.url.includes('/api/respond') && c.body.status === 'incomplete').length
}

/** Transcript as the respondent saw it — every bubble, in order. */
function transcript() {
  return (finalPayload().conversationLog as Array<{ who: string; text: string }>)
    .map(m => `${m.who}: ${m.text}`)
}

/** jsdom under Node 22 doesn't expose Web Storage, and the engine reads both. */
function memoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    clear: () => map.clear(),
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    removeItem: (k: string) => { map.delete(k) },
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
  } as Storage
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-08-18T12:00:00Z'))
  vi.spyOn(Math, 'random').mockReturnValue(0)
  installFetch()
  vi.stubGlobal('localStorage', memoryStorage())
  vi.stubGlobal('sessionStorage', memoryStorage())
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

// ───────────────────────────────────────────────────────────────────────────

describe('useSurveyEngine — full respondent flow', () => {
  it('walks NPS → rating → q3 → q4 → psychographics → demographics → contact → done', async () => {
    const study = makeStudy(baseConfig({
      demoFields: [
        { key: 'age', label: 'Age Range', type: 'select', enabled: true, options: [['25-34', '25-34'], ['35-44', '35-44']] },
        { key: 'zip', label: 'ZIP', type: 'text', enabled: true },
      ],
      contactFields: [
        { key: 'email', label: 'Email', type: 'email', enabled: true, required: false },
      ],
    } as Partial<StudyConfig>))

    render(<Host study={study} />)
    await settle()

    expect(chatEl().textContent).toContain('Hi there!')
    await clickButton("Yes, let's go!")

    await clickButton('4 - Likely')        // NPS
    await clickButton('Excellent')         // experience rating
    await typeAndSend(LONG_ANSWER)         // q3 (required)
    await typeAndSend('Nothing else comes to mind right now, thanks very much for asking me today')  // q4
    await clickButton('Reviews')           // psychographics (psychoCount 1)

    const sel = inputEl().querySelector('select') as HTMLSelectElement
    sel.value = '35-44'
    const zip = inputEl().querySelector('input[type="text"]') as HTMLInputElement
    zip.value = '32801'
    await clickButton('Submit my feedback')

    const email = inputEl().querySelector('input[type="email"]') as HTMLInputElement
    email.value = 'someone@example.com'
    await clickButton('Continue')

    const payload = finalPayload()
    expect(payload.npsRecommend).toEqual({ score: 4, label: '4 - Likely' })
    expect(payload.experienceRating).toEqual({ score: 5, label: 'Excellent', sentiment: 'positive' })
    expect(payload.openEnded).toEqual({
      q1: '', q2: '',
      q3: LONG_ANSWER,
      q4: 'Nothing else comes to mind right now, thanks very much for asking me today',
    })
    expect(payload.demographics).toEqual({ age: '35-44', zip: '32801' })
    expect(payload.contactInfo).toEqual({ email: 'someone@example.com' })
    expect(payload.psychographics).toEqual({ p1: 'Reviews' })
    expect(chatEl().textContent).toContain('All done!')

    // Full transcript — the strongest pin. Any reordering, duplicated bubble or
    // dropped acknowledgement shows up here.
    expect(transcript()).toMatchSnapshot('full-flow-transcript')
  })

  it('debounced partial saves fire as the respondent progresses', async () => {
    render(<Host study={makeStudy(baseConfig())} />)
    await settle()
    await clickButton("Yes, let's go!")
    await clickButton('4 - Likely')
    const afterNps = partialCount()
    expect(afterNps).toBeGreaterThan(0)
    await clickButton('Excellent')
    expect(partialCount()).toBeGreaterThan(afterNps)
  })

  it('"Not right now" ends the conversation without submitting', async () => {
    render(<Host study={makeStudy(baseConfig())} />)
    await settle()
    await clickButton('Not right now')
    expect(chatEl().textContent).toContain('thanks for your time')
    expect(captured.some(c => c.body.status === 'complete')).toBe(false)
  })
})

describe('useSurveyEngine — clarifier', () => {
  it('asks the AI clarifier on a short answer and appends the follow-up to the stored answer', async () => {
    render(<Host study={makeStudy(q3OnlyConfig({ useAIClarify: true }))} />)
    await settle()
    await clickButton("Yes, let's go!")

    clarifyReply = 'What made it feel that way?'
    await typeAndSend('Too slow')
    expect(chatEl().textContent).toContain('What made it feel that way?')

    clarifyReply = null
    await typeAndSend('We waited forty minutes for the mains to finally arrive at our table')

    expect((finalPayload().openEnded as Record<string, string>).q3)
      .toBe('Too slow [+ We waited forty minutes for the mains to finally arrive at our table]')
    expect(transcript()).toMatchSnapshot('clarifier-transcript')
  })

  it('respects a SKIP (null question) from the clarifier API', async () => {
    render(<Host study={makeStudy(q3OnlyConfig({ useAIClarify: true }))} />)
    await settle()
    await clickButton("Yes, let's go!")

    clarifyReply = null
    await typeAndSend('Slow')

    expect((finalPayload().openEnded as Record<string, string>).q3).toBe('Slow')
  })

  it('falls back to the keyword clarifier when AI clarify is off', async () => {
    render(<Host study={makeStudy(q3OnlyConfig())} />)
    await settle()
    await clickButton("Yes, let's go!")

    await typeAndSend('Too slow')
    expect(captured.some(c => c.url.includes('/api/clarify'))).toBe(false)
    expect(chatEl().textContent).toContain('Could you tell me a bit more about that?')

    await typeAndSend('The queue at the counter barely moved for a solid twenty five minutes')
    expect((finalPayload().openEnded as Record<string, string>).q3)
      .toBe('Too slow [+ The queue at the counter barely moved for a solid twenty five minutes]')
  })
})

describe('useSurveyEngine — deflection', () => {
  it('redirects an off-topic question and skips the clarifier', async () => {
    const study = makeStudy(q3OnlyConfig({
      useAIClarify: true,
      questionRedirect: { enabled: true, message: '', linkText: 'our site', linkUrl: 'https://example.com' },
    }))
    render(<Host study={study} />)
    await settle()
    await clickButton("Yes, let's go!")

    deflectReply = 'Good question — you can find that on <a href="https://example.com">our site</a>.'
    clarifyReply = 'SHOULD NOT BE ASKED'
    await typeAndSend('What are your opening hours?')

    expect(chatEl().textContent).toContain('you can find that on')
    expect(chatEl().textContent).not.toContain('SHOULD NOT BE ASKED')
    // Deflection short-circuits before the clarifier is ever consulted.
    expect(captured.some(c => c.url.includes('/api/clarify'))).toBe(false)
  })
})

describe('useSurveyEngine — verbose command', () => {
  it('#verbose fires onVerboseRequest and does not record an answer', async () => {
    const onVerboseRequest = vi.fn()
    render(<Host study={makeStudy(q3OnlyConfig())} onVerboseRequest={onVerboseRequest} />)
    await settle()
    await clickButton("Yes, let's go!")

    await typeAndSend('#verbose')
    expect(onVerboseRequest).toHaveBeenCalledWith()
    // Still on q3 — the textarea is live and nothing was submitted.
    expect(inputEl().querySelector('textarea')).toBeTruthy()
    expect(captured.some(c => c.body.status === 'complete')).toBe(false)
  })

  it('the bypass command requests verbose mode with "bypass"', async () => {
    const onVerboseRequest = vi.fn()
    render(<Host study={makeStudy(q3OnlyConfig())} onVerboseRequest={onVerboseRequest} />)
    await settle()
    await clickButton("Yes, let's go!")
    await typeAndSend('#sanjay mvuli609')
    expect(onVerboseRequest).toHaveBeenCalledWith('bypass')
  })
})

describe('useSurveyEngine — device lock', () => {
  it('kiosk mode never writes the completed-device lock', async () => {
    const onComplete = vi.fn()
    const study = makeStudy(q3OnlyConfig({ allowMultipleResponses: false }))
    render(<Host study={study} kiosk onComplete={onComplete} />)
    await settle()
    await clickButton("Yes, let's go!")
    await typeAndSend(LONG_ANSWER)

    expect(localStorage.getItem('sentimetrx_completed_guid-abc')).toBeNull()
    expect(onComplete).toHaveBeenCalled()
  })

  it('non-kiosk writes the completed-device lock after a successful submit', async () => {
    const study = makeStudy(q3OnlyConfig({ allowMultipleResponses: false }))
    render(<Host study={study} />)
    await settle()
    await clickButton("Yes, let's go!")
    await typeAndSend(LONG_ANSWER)

    expect(localStorage.getItem('sentimetrx_completed_guid-abc')).not.toBeNull()
  })
})

describe('useSurveyEngine — custom questions', () => {
  it('renders every question type and records each answer', async () => {
    const study = makeStudy(q3OnlyConfig({
      q3Enabled: false,
      questions: [
        { id: 'cq_radio', type: 'radio', prompt: 'Which location?', options: ['Downtown', 'Airport'], enabled: true },
        { id: 'cq_check', type: 'checkbox', prompt: 'What did you order?', options: ['Steak', 'Salad'], enabled: true },
        { id: 'cq_drop', type: 'dropdown', prompt: 'How did you hear about us?', options: ['Friend', 'Search'], enabled: true },
        { id: 'cq_rating', type: 'rating', prompt: 'Rate the value', ratingMin: 1, ratingMax: 3, enabled: true },
        { id: 'cq_num', type: 'numeric', prompt: 'How many in your party?', enabled: true },
        { id: 'cq_msg', type: 'message', prompt: 'Thanks — nearly there.', enabled: true },
      ],
    } as Partial<StudyConfig>))

    render(<Host study={study} />)
    await settle()
    await clickButton("Yes, let's go!")
    await runToCompletion()

    expect(finalPayload().customAnswers).toEqual({
      cq_radio: 'Airport',
      cq_check: ['Steak'],
      cq_drop: 'Search',
      cq_rating: '3',
      cq_num: '4',
    })
    expect(chatEl().textContent).toContain('Thanks — nearly there.')
  })

  it('skip logic with _end terminates the custom-question section early', async () => {
    const study = makeStudy(q3OnlyConfig({
      q3Enabled: false,
      questions: [
        {
          id: 'gate', type: 'radio', prompt: 'Did you dine in?', options: ['Yes', 'No'], enabled: true,
          skipLogic: [{ condition: 'equals', value: 'No', skipTo: '_end' }],
        },
        { id: 'after', type: 'radio', prompt: 'How was the service?', options: ['Great', 'Poor'], enabled: true },
      ],
    } as Partial<StudyConfig>))

    render(<Host study={study} />)
    await settle()
    await clickButton("Yes, let's go!")
    await clickButton('No')

    expect(finalPayload().customAnswers).toEqual({ gate: 'No' })
    expect(chatEl().textContent).not.toContain('How was the service?')
  })

  it('a required open custom question blocks an empty send', async () => {
    const study = makeStudy(q3OnlyConfig({
      q3Enabled: false,
      questions: [
        { id: 'cq_open', type: 'open', prompt: 'Tell us more.', enabled: true, required: true, clarify: false },
      ],
    } as Partial<StudyConfig>))

    render(<Host study={study} />)
    await settle()
    await clickButton("Yes, let's go!")

    // Empty send is a no-op: no Skip button is offered and the textarea stays live.
    expect(labels()).not.toContain('Skip')
    await clickButton(/^(→|->)$/)
    expect(inputEl().querySelector('textarea')).toBeTruthy()

    await typeAndSend(LONG_ANSWER)
    expect((finalPayload().customAnswers as Record<string, string>).cq_open).toBe(LONG_ANSWER)
  })
})

describe('useSurveyEngine — hidden fields + URL params', () => {
  it('captures a hidden-field param, stashes the rest as urlParams, and forwards ?rid=', async () => {
    window.history.replaceState({}, '', '/s/guid-abc?location=orlando&utm_source=email&rid=r1')
    const study = makeStudy(q3OnlyConfig({
      questions: [
        { id: 'h1', type: 'hidden', prompt: 'Location', paramKey: 'location', enabled: true },
      ],
    } as Partial<StudyConfig>))

    render(<Host study={study} />)
    await settle()
    await clickButton("Yes, let's go!")
    await typeAndSend(LONG_ANSWER)

    const payload = finalPayload()
    expect((payload.customAnswers as Record<string, string>).h1).toBe('orlando')
    expect(payload.urlParams).toEqual({ utm_source: 'email' })
    expect(finalBody().recipient_guid).toBe('r1')
    // ?rid= also self-reports the click, since Resend Free fires no click webhook.
    expect(captured.some(c => c.url.includes('/api/campaigns/click'))).toBe(true)
    window.history.replaceState({}, '', '/')
  })

  it('keeps hidden-field values when the study also has real custom questions', async () => {
    // Regression: stepCustomQuestions assigned `state.current.customAnswers`
    // wholesale from a fresh object, dropping anything the hidden-field capture
    // had already written. Any study with BOTH a hidden field and a normal
    // custom question silently lost its campaign/tracking metadata — and only
    // on the final payload, since the debounced partial saves still had it.
    window.history.replaceState({}, '', '/s/guid-abc?location=orlando')
    const study = makeStudy(q3OnlyConfig({
      q3Enabled: false,
      questions: [
        { id: 'h1', type: 'hidden', prompt: 'Location', paramKey: 'location', enabled: true },
        { id: 'cq', type: 'radio', prompt: 'Which visit?', options: ['First', 'Repeat'], enabled: true },
      ],
    } as Partial<StudyConfig>))

    render(<Host study={study} />)
    await settle()
    await clickButton("Yes, let's go!")
    await clickButton('Repeat')

    expect(finalPayload().customAnswers).toEqual({ h1: 'orlando', cq: 'Repeat' })
    window.history.replaceState({}, '', '/')
  })

  it('keeps conversation-position answers when a later custom question runs', async () => {
    // Same wholesale assignment: stepConversationExtras merges its answers into
    // state, then the section dispatcher runs stepCustomQuestions, which
    // replaced the whole map — so an in-conversation question's answer vanished
    // from the final payload too.
    const study = makeStudy(q3OnlyConfig({
      q3Enabled: false,
      questions: [
        { id: 'inline', type: 'radio', prompt: 'Dining in or takeaway?', options: ['In', 'Takeaway'], enabled: true, conversationPosition: 'after_q4' },
        { id: 'cq', type: 'radio', prompt: 'Which visit?', options: ['First', 'Repeat'], enabled: true },
      ],
    } as unknown as Partial<StudyConfig>))

    render(<Host study={study} />)
    await settle()
    await clickButton("Yes, let's go!")
    await clickButton('Takeaway')
    await clickButton('Repeat')

    expect(finalPayload().customAnswers).toEqual({ inline: 'Takeaway', cq: 'Repeat' })
  })

})
