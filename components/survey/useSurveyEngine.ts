'use client'

import { useCallback, useMemo, useRef } from 'react'
import DOMPurify from 'isomorphic-dompurify'
import type { Study, StudyConfig, Sentiment, SurveyPayload, OpeningFlowItem, SectionKey, RatingOption, LikertFollowUp, ContactFieldType } from '@/lib/types'
import { US_STATES, validateContactField, BUILTIN_UI_TRANSLATIONS, SUPPORTED_LANGUAGES } from '@/lib/types'
import { pickBrandColor } from '@/components/survey/SurveyWidget'

// ============================================================
// useSurveyEngine
// Contains ALL conversation logic -- nothing in this hook ever
// appears in page source. It runs in the browser but the
// config that drives it comes from the server-rendered page.
// ============================================================

interface Props {
  study: Study
  orgName?: string
  chatRef:    React.RefObject<HTMLDivElement | null>
  inputRef:   React.RefObject<HTMLDivElement | null>
  scrollBottom: () => void
  isLightBg?: boolean
  reducedMotion?: boolean
  onVerboseRequest?: (mode?: 'bypass') => void
  /** Unattended kiosk mode: bypass the one-response-per-device lock, use a
   *  fresh session per guest, and never write the "completed" device lock. */
  kiosk?: boolean
  /** Fired once the survey reaches its closing card (used to schedule the
   *  kiosk auto-reset back to the attract screen). */
  onComplete?: () => void
}

interface State {
  rating:          number | null
  ratingLabel:     string | null
  sentiment:       Sentiment | null
  npsScore:        number | null
  npsLabel:        string | null
  answers:         { q1: string; q2: string; q3: string; q4: string }
  questionsAsked:  Record<string, string>
  clarifyCount:    number
  customAnswers:   Record<string, string | string[]>
  currentQuestion: string
  psychoQuestions: Array<{ key: string; q: string; opts: string[] }>
  psychoIdx:       number
  psychoAnswers:   Record<string, string>
  demographics:    Record<string, string>
  contactInfo:     Record<string, string>
  startTime:       number
  openingAnswers:  Record<string, string>
  lastUserMsg:     string
  conversationLog: Array<{ who: 'bot' | 'user'; text: string; ai?: boolean }>
  skipNextAck:     boolean
  urlParams:       Record<string, string>
}

// Hoisted to MODULE scope: every value here is a hard-coded constant, so the
// object never needed to be rebuilt per render. Declared inside the hook it was
// a fresh identity every time, which is why ~14 useCallback deps lists were
// flagged for missing `C.*` fields — adding them would have churned those
// callbacks on every render. At module scope it is stable and drops out of the
// dependency question entirely (react-hooks/exhaustive-deps).
// iMessage-style colors — always light background with gray bot bubbles / blue user bubbles
const IMSG_BLUE = '#007AFF'
const IMSG_GRAY = '#E9E9EB'
const C = {
  text:       'rgba(0,0,0,0.85)',
  textMid:    'rgba(0,0,0,0.65)',
  textMute:   'rgba(0,0,0,0.4)',
  textFaint:  'rgba(0,0,0,0.25)',
  bubbleBg:   IMSG_GRAY,
  bubbleBdr:  'transparent',
  userBubbleBg: IMSG_BLUE,
  inputBg:    'rgba(0,0,0,0.04)',
  inputBdr:   'rgba(0,0,0,0.12)',
  btnBg:      'rgba(0,0,0,0.05)',
  btnBdr:     'rgba(0,0,0,0.15)',
  btnHoverBg: 'rgba(0,0,0,0.10)',
  btnHoverBdr: 'rgba(0,0,0,0.22)',
  disabledBg: 'rgba(0,0,0,0.08)',
  disabledTx: 'rgba(0,0,0,0.3)',
}

// Pure text predicates — they close over nothing in the hook, so at module scope
// they are stable identities and drop out of the dependency question entirely.
function isDecline(text: string) {
  const t = text.toLowerCase().trim()
  if (!t) return true   // genuinely empty — nothing to clarify
  // Match actual refusal phrases only. NOT a blanket length cap: terse but
  // meaningful answers ("cold", "rude", "slow", "loud") are real feedback that
  // SHOULD earn a clarifier, not be brushed off as a non-answer.
  return /^(no|nope|nah|not really|nothing|none|n\/a|na|no thanks|skip|pass|all good|that'?s? (all|it)|i'?m good|nothing else|not at the moment)\.?$/.test(t)
}

function isQuestionOrOffTopic(text: string) {
  const t = text.trim().toLowerCase()
  if (t.endsWith('?')) return true
  if (/\b(who are you|what are you|tell me|what is this|what do you|how do you|where (is|are|can)|can you tell|could you tell|explain|help me)\b/i.test(t)) return true
  return false
}

// Consistent duration based on message length: ~30ms per char, clamped 400–1800ms
function typingDur(text: string) { return Math.max(400, Math.min(1800, text.length * 30)) }

export function useSurveyEngine({ study, orgName = '', chatRef, inputRef, scrollBottom, isLightBg = false, reducedMotion = false, onVerboseRequest, kiosk = false, onComplete }: Props) {
  const config = study.config as StudyConfig
  const confirmMode = config.confirmBeforeRecord === true

  // Verbose/debug command check — returns true if command was handled (caller should return early)
  const checkVerbose = useCallback((v: string, ta?: HTMLTextAreaElement): boolean => {
    if (/^#verbose$/i.test(v)) { if (ta) ta.value = ''; if (onVerboseRequest) onVerboseRequest(); return true }
    if (/^#sanjay\s+mvuli609$/i.test(v)) { if (ta) ta.value = ''; if (onVerboseRequest) onVerboseRequest('bypass'); return true }
    return false
  }, [onVerboseRequest])

  /* eslint-disable react-hooks/refs, react-hooks/purity --
   * Render-phase lazy initialisation (session id, device fingerprint, hidden
   * fields, device lock). These read and write refs and call Math.random /
   * Date.now / Web Storage during render, which the react-hooks compiler rules
   * correctly flag as impure.
   *
   * They are PRE-EXISTING and are NOT suppressed lightly. Until the
   * 2026-08-18 declaration reorder, the compiler rules bailed out of this hook
   * entirely at the first forward reference and reported nothing anywhere in
   * the file — so this whole class was invisible, not absent. Restructuring it
   * (useState lazy initialisers, or moving the work into an effect) changes
   * respondent session identity, the one-response-per-device lock and the
   * campaign ?rid= capture, which is its own piece of work with its own browser
   * verification — not a rider on a dependency-graph refactor. Each guard here
   * is one-shot (`if (!someRef.current)`), so a StrictMode double-render of the
   * same mount does not re-run it.
   */
  const state  = useRef<State>({
    rating: null, ratingLabel: null, sentiment: null,
    npsScore: null, npsLabel: null,
    answers: { q1: '', q2: '', q3: '', q4: '' },
    questionsAsked: {},
    clarifyCount: 0,
    customAnswers: {},
    currentQuestion: '',
    psychoQuestions: [], psychoIdx: 0, psychoAnswers: {},
    demographics: {},
    contactInfo: {},
    startTime: Date.now(),
    openingAnswers: {},
    lastUserMsg: '',
    conversationLog: [],
    skipNextAck: false,
    urlParams: {},
  })

  // ── Session ID — persists for this browser tab, new on new visit ──────────
  const sessionId = useRef<string>('')
  if (!sessionId.current) {
    if (kiosk) {
      // Kiosk: a fresh session per guest. The component remounts between
      // guests, so a new id here means a new respondent each time — never
      // reused from sessionStorage.
      sessionId.current = 'ses_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
    } else try {
      var existing = sessionStorage.getItem('sentimetrx_session_' + study.guid)
      if (existing) { sessionId.current = existing }
      else {
        sessionId.current = 'ses_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
        sessionStorage.setItem('sentimetrx_session_' + study.guid, sessionId.current)
      }
    } catch { sessionId.current = 'ses_' + Math.random().toString(36).slice(2) + Date.now().toString(36) }
  }

  // ── Device fingerprint — screen + timezone + platform + language ───────────
  const deviceFingerprint = useRef<string>('')
  if (!deviceFingerprint.current) {
    try {
      var parts = [
        screen.width + 'x' + screen.height,
        screen.colorDepth,
        Intl.DateTimeFormat().resolvedOptions().timeZone,
        navigator.language,
        navigator.platform,
        navigator.hardwareConcurrency || 0,
      ]
      deviceFingerprint.current = parts.join('|')
    } catch { deviceFingerprint.current = 'unknown' }
  }

  // ── Hidden fields — read URL params and inject into customAnswers ─────────
  // Capture campaign recipient GUID from URL (?rid=xxx)
  const recipientGuid = useRef<string | null>(null)
  const hiddenFieldsPopulated = useRef(false)
  if (!hiddenFieldsPopulated.current) {
    hiddenFieldsPopulated.current = true
    try {
      const params = new URLSearchParams(window.location.search)
      // Capture campaign recipient tracking ID
      const rid = params.get('rid')
      if (rid) {
        recipientGuid.current = rid
        // Resend Free plan doesn't fire `email.clicked` webhooks, so we
        // self-track click as soon as a ?rid= survey URL is opened.
        // Fire-and-forget; the endpoint always 200s and only upgrades
        // status from pending/sent (never overwrites completed).
        try {
          fetch('/api/campaigns/click', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ rid }),
            keepalive: true,
          }).catch(() => {})
        } catch {}
      }
      // Populate hidden field values from URL params
      const hiddenQuestions = (config.questions ?? []).filter(q => q.type === 'hidden')
      const hiddenKeys = new Set<string>()
      for (const q of hiddenQuestions) {
        const key = q.paramKey || (q.prompt || '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '')
        if (!key) continue
        hiddenKeys.add(key)
        const val = params.get(key)
        if (val) {
          state.current.customAnswers[q.id] = val
        }
      }
      // Capture all remaining URL params as dynamic fields
      const INTERNAL_KEYS = new Set(['rid', 'token', 'preview'])
      params.forEach((val, key) => {
        if (!INTERNAL_KEYS.has(key) && !hiddenKeys.has(key) && val) {
          state.current.urlParams[key] = val
        }
      })
    } catch {}
  }

  // ── Check device limit — returns true if already completed ────────────────
  const deviceBlocked = useRef<boolean>(false)
  if (config.allowMultipleResponses === false && !kiosk) {
    try {
      var completedKey = 'sentimetrx_completed_' + study.guid
      if (localStorage.getItem(completedKey)) deviceBlocked.current = true
    } catch {}
  }
  /* eslint-enable react-hooks/refs, react-hooks/purity */

  // -- Translation layer -------------------------------------
  //
  // Declared here, at the top of the hook, because ~40 callbacks below depend
  // on these. Every one reads exactly two things: the `activeLang` ref (stable
  // by definition) and `config.translations`. Wrapping each in useCallback keyed
  // on `config.translations` therefore makes them stable for the life of the
  // study config — which is what lets the callbacks downstream name them as
  // dependencies instead of silently capturing a stale closure.

  // Active language for multi-language surveys
  const activeLang = useRef<string>('en')

  // Get translated content for the active language
  const t = useCallback((key: string, fallback: string): string => {
    if (activeLang.current === 'en' || !config.translations) return fallback
    const trans = config.translations[activeLang.current]
    if (!trans) return fallback
    return (trans as unknown as Record<string, string>)[key] || fallback
  }, [config.translations])

  const tQuestion = useCallback((qId: string, field: 'prompt' | 'options' | 'likertLabels', fallback: string | string[]): string | string[] => {
    if (activeLang.current === 'en' || !config.translations) return fallback
    const trans = config.translations[activeLang.current]
    if (!trans?.questions?.[qId]) return fallback
    if (field === 'options') return trans.questions[qId].options || fallback
    if (field === 'likertLabels') return trans.questions[qId].likertLabels || fallback
    return trans.questions[qId].prompt || fallback
  }, [config.translations])

  const tUI = useCallback((key: string, fallback: string): string => {
    if (activeLang.current === 'en') return fallback
    // Check stored translation first
    const trans = config.translations?.[activeLang.current]
    if (trans?.ui && (trans.ui as unknown as Record<string, string>)[key]) return (trans.ui as unknown as Record<string, string>)[key]
    // Fall back to built-in translations
    const builtin = BUILTIN_UI_TRANSLATIONS[activeLang.current]
    if (builtin?.[key]) return builtin[key]
    return fallback
  }, [config.translations])

  const tRatingLabel = useCallback((englishLabel: string): string => {
    if (activeLang.current === 'en') return englishLabel
    const trans = config.translations?.[activeLang.current]
    if (trans?.ui?.ratingLabels?.[englishLabel]) return trans.ui.ratingLabels[englishLabel]
    // Fall back to built-in rating labels if available
    const builtin = BUILTIN_UI_TRANSLATIONS[activeLang.current]
    if (builtin?.['rating_' + englishLabel]) return builtin['rating_' + englishLabel]
    return englishLabel
  }, [config.translations])

  const tNpsLabel = useCallback((englishLabel: string): string => {
    if (activeLang.current === 'en') return englishLabel
    const trans = config.translations?.[activeLang.current]
    if (trans?.ui?.npsLabels?.[englishLabel]) return trans.ui.npsLabels[englishLabel]
    // Fall back to built-in NPS labels
    const builtin = BUILTIN_UI_TRANSLATIONS[activeLang.current]
    if (builtin?.['nps_' + englishLabel]) return builtin['nps_' + englishLabel]
    return englishLabel
  }, [config.translations])

  const tTransition = useCallback((sectionKey: string, fallback: string): string => {
    if (activeLang.current === 'en') return fallback
    const trans = config.translations?.[activeLang.current]
    if (trans?.ui?.transitions?.[sectionKey]) return trans.ui.transitions[sectionKey]
    // Fall back to built-in transition translations
    const builtin = BUILTIN_UI_TRANSLATIONS[activeLang.current]
    if (builtin?.['transition_' + sectionKey]) return builtin['transition_' + sectionKey]
    return fallback
  }, [config.translations])

  const tPsycho = useCallback((key: string, field: 'q' | 'opts', fallback: string | string[]): string | string[] => {
    if (activeLang.current === 'en' || !config.translations) return fallback
    const trans = config.translations[activeLang.current]
    if (!trans?.psychographics?.[key]) return fallback
    if (field === 'opts') return trans.psychographics[key].opts || fallback
    return trans.psychographics[key].q || fallback
  }, [config.translations])

  // Translate adaptive follow-up prompts (experience, NPS, custom question)
  const tFollowUp = useCallback((followUpKey: string, score: number, sharedPrompt: string, perResponse?: Record<string, { prompt: string }>): string => {
    const pr = perResponse?.[score]
    const englishPrompt = pr ? pr.prompt : sharedPrompt
    if (activeLang.current === 'en' || !config.translations) return englishPrompt
    const trans = config.translations[activeLang.current]
    if (!trans?.followUps?.[followUpKey]) return englishPrompt
    const fu = trans.followUps[followUpKey]
    if (pr && fu.perResponse?.[score]) return fu.perResponse[score]
    if (fu.sharedPrompt) return fu.sharedPrompt
    return englishPrompt
  }, [config.translations])

  // Translate opening flow open-end prompts
  const tOpeningFlow = useCallback((itemId: string, fallback: string): string => {
    if (activeLang.current === 'en' || !config.translations) return fallback
    const trans = config.translations[activeLang.current]
    return trans?.openingFlow?.[itemId] || fallback
  }, [config.translations])

  // Translate demographic labels and options
  const tDemoLabel_ = useCallback((key: string, fallback: string): string => {
    if (activeLang.current === 'en' || !config.translations) return fallback
    const trans = config.translations[activeLang.current]
    return trans?.demoLabels?.[key] || tUI('demo_' + key, fallback)
  }, [config.translations, tUI])
  const tDemoOption = useCallback((fieldKey: string, optIndex: number, fallback: string): string => {
    if (activeLang.current === 'en' || !config.translations) return fallback
    const trans = config.translations[activeLang.current]
    return trans?.demoOptions?.[fieldKey]?.[optIndex] || tUI('demo_opt_' + fallback.toLowerCase().replace(/\s+/g, '_'), fallback)
  }, [config.translations, tUI])

  // Translate contact field labels
  const tContactLabel = useCallback((key: string, fallback: string): string => {
    if (activeLang.current === 'en' || !config.translations) return fallback
    const trans = config.translations[activeLang.current]
    return trans?.contactLabels?.[key] || fallback
  }, [config.translations])

  // Translate contact transition
  const tContactTransition = useCallback((fallback: string): string => {
    if (activeLang.current === 'en' || !config.translations) return fallback
    const trans = config.translations[activeLang.current]
    return trans?.contactTransition || tUI('transition_contact', fallback)
  }, [config.translations, tUI])
  // ── Partial save — debounced fire-and-forget POST after each answered question ──
  const savePartialTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const savePartial = useCallback(() => {
    if (savePartialTimer.current) clearTimeout(savePartialTimer.current)
    savePartialTimer.current = setTimeout(() => {
      try {
        var s = state.current
        var partialPayload: Record<string, unknown> = {
          agent:     study.bot_name,
          timestamp: new Date().toISOString(),
          language:  activeLang.current,
          deviceFingerprint: deviceFingerprint.current,
        }
        if (s.npsScore != null) partialPayload.npsRecommend = { score: s.npsScore, label: s.npsLabel || '' }
        if (s.rating != null) partialPayload.experienceRating = { score: s.rating, label: s.ratingLabel || '', sentiment: s.sentiment || 'neutral' }
        if (s.answers.q1 || s.answers.q2 || s.answers.q3 || s.answers.q4) partialPayload.openEnded = s.answers
        if (Object.keys(s.openingAnswers).length) partialPayload.openingAnswers = s.openingAnswers
        if (Object.keys(s.customAnswers).length) partialPayload.customAnswers = s.customAnswers
        if (Object.keys(s.psychoAnswers).length) partialPayload.psychographics = s.psychoAnswers
        if (Object.values(s.demographics).some(function(v) { return !!v })) partialPayload.demographics = s.demographics
        if (Object.values(s.contactInfo).some(function(v) { return !!v })) partialPayload.contactInfo = s.contactInfo
        if (s.conversationLog.length > 0) partialPayload.conversationLog = s.conversationLog
        if (Object.keys(s.urlParams).length) partialPayload.urlParams = s.urlParams

        var duration_sec = Math.round((Date.now() - s.startTime) / 1000)
        fetch('/api/respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            study_guid:   study.guid,
            payload:      partialPayload,
            duration_sec: duration_sec,
            session_id:   sessionId.current,
            status:       'incomplete',
          }),
        }).catch(function() { /* fail silently */ })
      } catch { /* fail silently */ }
    }, 2000)
  }, [study])

  // -- Helpers -----------------------------------------------

  const clearInput = useCallback(() => {
    if (inputRef.current) inputRef.current.innerHTML = ''
  }, [inputRef])

  const addMsg = useCallback((who: 'bot' | 'user', text: string, ai?: boolean) => {
    if (!chatRef.current) return

    // Log every message for conversation replay
    state.current.conversationLog.push({ who, text, ...(ai ? { ai: true } : {}) })

    const wrap = document.createElement('div')
    wrap.className = `msg-animate flex items-end gap-2 ${who === 'user' ? 'flex-row-reverse self-end max-w-[80%]' : 'self-start max-w-[80%]'}`

    if (who === 'bot') {
      const av = document.createElement('div')
      av.className = 'w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0'
      av.style.cssText = 'background:#C7C7CC;'
      av.textContent = study.bot_emoji
      const bub = document.createElement('div')
      bub.className = 'px-3.5 py-2.5 rounded-2xl rounded-bl-sm text-sm leading-relaxed'
      bub.style.cssText = 'background:' + C.bubbleBg + ';color:#000;white-space:pre-wrap;'
      // Use innerHTML if text contains links, textContent otherwise (safer)
      if (text.includes('<a ')) {
        bub.innerHTML = DOMPurify.sanitize(text)
        // Style links to match theme
        bub.querySelectorAll('a').forEach(a => {
          a.style.color = '#00b4d8'
          a.style.textDecoration = 'underline'
          a.style.fontWeight = '600'
          a.setAttribute('target', '_blank')
          a.setAttribute('rel', 'noopener noreferrer')
        })
      } else {
        bub.textContent = text
      }
      wrap.append(av, bub)
    } else {
      const bub = document.createElement('div')
      bub.className = 'px-3.5 py-2.5 rounded-2xl rounded-br-sm text-sm leading-relaxed font-medium'
      bub.style.cssText = 'background:' + C.userBubbleBg + ';color:#fff;'
      bub.textContent = text
      wrap.appendChild(bub)
      state.current.lastUserMsg = text
    }

    chatRef.current.appendChild(wrap)
    scrollBottom()
    // `config` was listed but never read in this callback — an unused dep only
    // churns the callback's identity whenever config changes.
  }, [chatRef, study.bot_emoji, scrollBottom])

  // Testing mode: show AI reasoning panel below the latest bot message
  const showDebugPanel = useCallback((lines: string[]) => {
    if (!chatRef.current || !config.testing) return
    const panel = document.createElement('div')
    panel.style.cssText = 'margin:4px 0 8px 36px;padding:8px 12px;background:#fef3c7;border:1px solid #fbbf24;border-radius:12px;font-size:11px;color:#92400e;line-height:1.5;max-width:80%;'
    const label = document.createElement('div')
    label.style.cssText = 'font-weight:700;font-size:10px;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px;color:#78350f;'
    label.textContent = 'AI Thinking'
    panel.appendChild(label)
    for (const line of lines) {
      const p = document.createElement('div')
      p.textContent = line
      p.style.cssText = 'margin-bottom:2px;'
      panel.appendChild(p)
    }
    chatRef.current.appendChild(panel)
    scrollBottom()
  }, [chatRef, config.testing, scrollBottom])

  const typingSpeed = config.typingSpeed ?? 0.5

  // Start typing indicator (returns remove function)
  const startTypingIndicator = useCallback(() => {
    if (!chatRef.current) return () => {}
    // Remove any existing indicator first
    document.getElementById('typing-indicator')?.remove()
    if (reducedMotion) return () => {}
    const t = document.createElement('div')
    t.id = 'typing-indicator'
    t.className = 'flex items-end gap-2 self-start'
    const av = document.createElement('div')
    av.className = 'w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0'
    av.style.cssText = 'background:#C7C7CC;'
    av.textContent = study.bot_emoji
    const bub = document.createElement('div')
    bub.className = 'px-4 py-3 rounded-2xl rounded-bl-sm flex gap-1.5'
    bub.style.cssText = 'background:' + C.bubbleBg + ';--dot-color:#8E8E93;color:#000;'
    ;[0, 200, 400].forEach(delay => {
      const dot = document.createElement('span')
      dot.className = 'typing-dot'
      dot.style.animationDelay = `${delay}ms`
      bub.appendChild(dot)
    })
    t.append(av, bub)
    chatRef.current.appendChild(t)
    scrollBottom()
    return () => { document.getElementById('typing-indicator')?.remove() }
  }, [chatRef, reducedMotion, scrollBottom, study.bot_emoji])

  // Show typing during an async operation. The typing indicator stays visible
  // for at least minDur AND until the promise resolves — whichever is longer.
  const showTypingDuring = useCallback(async <T,>(promise: Promise<T>, minDur = 800): Promise<T> => {
    minDur = Math.round(minDur * typingSpeed)
    const removeIndicator = startTypingIndicator()
    const minWait = new Promise<void>(res => setTimeout(res, reducedMotion ? Math.min(minDur, 200) : minDur))
    const [result] = await Promise.all([promise, minWait])
    removeIndicator()
    return result
  }, [reducedMotion, startTypingIndicator, typingSpeed])

  const showTyping = useCallback((dur = 1000): Promise<void> => {
    dur = Math.round(dur * typingSpeed)
    return new Promise(res => {
      if (!chatRef.current) { res(); return }
      // Reduced motion: skip the animation, use a minimal pause for readability
      if (reducedMotion) { setTimeout(res, Math.min(dur, 200)); return }
      // Remove any existing indicator to prevent duplicates
      document.getElementById('typing-indicator')?.remove()
      const t = document.createElement('div')
      t.id = 'typing-indicator'
      t.className = 'flex items-end gap-2 self-start'
      const av = document.createElement('div')
      av.className = 'w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0'
      av.style.cssText = 'background:#C7C7CC;'
      av.textContent = study.bot_emoji
      const bub = document.createElement('div')
      bub.className = 'px-4 py-3 rounded-2xl rounded-bl-sm flex gap-1.5'
      bub.style.cssText = 'background:' + C.bubbleBg + ';--dot-color:#8E8E93;color:#000;'
      ;[0, 200, 400].forEach(delay => {
        const dot = document.createElement('span')
        dot.className = 'typing-dot'
        dot.style.animationDelay = `${delay}ms`
        bub.appendChild(dot)
      })
      t.append(av, bub)
      chatRef.current.appendChild(t)
      scrollBottom()
      setTimeout(() => { document.getElementById('typing-indicator')?.remove(); res() }, dur)
    })
  }, [chatRef, reducedMotion, scrollBottom, study.bot_emoji, typingSpeed])

  // -- Utility -----------------------------------------------

  const scrollInputBottom = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    setTimeout(() => { el.scrollTop = el.scrollHeight }, 60)
  }, [inputRef])

  // Rules-based acknowledgment that adapts to what the respondent said
  const smartAck = useCallback((text: string): string => {
    const t = text.trim().toLowerCase()
    // Decline / refusal / negative
    if (isDecline(t) || /^(no|nope|nah|not really|nothing|i don'?t know|idk|unsure|not sure|can'?t think)/.test(t)) {
      const opts = [
        tUI('ackDecline1', 'No worries at all -- thanks for being honest.'),
        tUI('ackDecline2', 'Totally fine -- appreciate you letting me know.'),
        tUI('ackDecline3', 'That\'s okay -- thanks for taking the time.'),
        tUI('ackDecline4', 'Understood -- let\'s keep going.'),
      ]
      return opts[Math.floor(Math.random() * opts.length)]
    }
    // Very short response (1-3 words that aren't a decline)
    if (t.split(/\s+/).length <= 3) {
      return tUI('ackShort', 'Got it -- thanks for sharing that.')
    }
    // Positive / enthusiastic
    if (/\b(love|great|awesome|amazing|fantastic|excellent|wonderful|best|happy|impressed)\b/.test(t)) {
      return tUI('ackPositive', 'That\'s wonderful to hear -- thank you for sharing!')
    }
    // Negative / frustrated
    if (/\b(terrible|awful|worst|horrible|hate|frustrated|angry|disappointed|annoying|unacceptable)\b/.test(t)) {
      return tUI('ackNegative', 'We really appreciate you sharing that -- it helps us understand what needs to change.')
    }
    // Default for substantive feedback
    const opts = [
      tUI('ackDefault1', 'Got it -- that\'s genuinely helpful.'),
      tUI('ackDefault2', 'Thank you -- that\'s really useful feedback.'),
      tUI('ackDefault3', 'Appreciate you sharing that -- it makes a difference.'),
    ]
    return opts[Math.floor(Math.random() * opts.length)]
  }, [tUI])

  const shouldClarify = useCallback((text: string) => {
    if (isDecline(text) || isQuestionOrOffTopic(text)) return false
    // Force mode (config.forceClarify): always probe — even long, detailed answers —
    // so a demo shows a tailored follow-up every time. Declines/off-topic still skip (above).
    if (config.forceClarify) return true
    // Negative / low-rating answers are where a follow-up matters most — probe them
    // regardless of length. The AI clarifier decides if the answer is already
    // detailed enough (it returns SKIP for 3+ specific points), so a long, specific
    // complaint still gets a deeper question instead of being skipped for being
    // "long enough". Other answers keep the short-answer heuristic.
    if (state.current.sentiment === 'negative') return true
    return text.trim().split(/\s+/).length < 12
  }, [config.forceClarify])

  // AI-powered deflection: detects questions/off-topic and generates contextual redirect
  const checkDeflect = useCallback(async (text: string, questionAsked: string) => {
    const qr = config.questionRedirect
    if (!qr?.enabled) return false
    try {
      // Show typing during the API call so there's no visible lag
      const data = await showTypingDuring(
        fetch('/api/deflect', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            studyName:     orgName || study.name,
            orgName:       orgName || study.name,
            studyGuid:     study.guid,
            questionAsked,
            answer:        text,
            linkText:      qr.linkText || '',
            linkUrl:       qr.linkUrl || '',
            customMessage: qr.message || '',
            language:      activeLang.current !== 'en' ? activeLang.current : undefined,
            testing:       config.testing || undefined,
          }),
        }).then(r => r.ok ? r.json() : null),
        800,
      )
      if (!data?.deflection) {
        if (data?._debug && config.testing) {
          showDebugPanel(data._debug)
          state.current.conversationLog.push({ who: 'bot', text: '[AI Thinking] ' + data._debug.join(' | '), ai: true })
        }
        return false
      }

      clearInput()
      if (data._debug && config.testing) {
        showDebugPanel(data._debug)
        state.current.conversationLog.push({ who: 'bot', text: '[AI Thinking] ' + data._debug.join(' | '), ai: true })
      }
      // Log the deflection (strip HTML for clean log)
      const plainText = data.deflection.replace(/<[^>]+>/g, '')
      state.current.conversationLog.push({ who: 'bot', text: plainText, ai: true })
      // Render bot message with HTML link
      if (chatRef.current) {
        const wrap = document.createElement('div')
        wrap.className = 'msg-animate flex items-end gap-2 self-start max-w-[80%]'
        const av = document.createElement('div')
        av.className = 'w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0'
        av.style.cssText = 'background:#C7C7CC;'
        av.textContent = study.bot_emoji
        const bub = document.createElement('div')
        bub.className = 'px-3.5 py-2.5 rounded-2xl rounded-bl-sm text-sm leading-relaxed'
        bub.style.cssText = 'background:' + C.bubbleBg + ';color:#000;'
        // Style the link within the AI-generated response
        bub.innerHTML = DOMPurify.sanitize(data.deflection.replace(/<a /g, '<a style="color:#00b4d8;text-decoration:underline;font-weight:600" '))
        wrap.append(av, bub)
        chatRef.current.appendChild(wrap)
        scrollBottom()
      }
      await showTyping(typingDur(plainText))
      return true
    } catch {
      return false
    }
  }, [chatRef, clearInput, config.questionRedirect, config.testing, orgName, scrollBottom, showDebugPanel, showTyping, showTypingDuring, study.bot_emoji, study.guid, study.name])

  const buildClarify = useCallback(async (text: string, qKey: 'q3' | 'q4'): Promise<string | null> => {
    const s = state.current

    // Keyword fallback (always available, used if AI disabled or fails)
    const keywordFallback = (): string | null => {
      const t = text.toLowerCase()
      const pool = config.clarifiers
      for (const [kw, q] of Object.entries(pool)) {
        if (kw === 'default') continue
        if (t.includes(kw)) return q as string
      }
      // Use translated default clarifier if available
      return tUI('clarifierDefault', pool.default || 'Could you tell me a bit more about that?')
    }

    // Only use AI if enabled in study config
    if (!config.useAIClarify) return keywordFallback()

    try {
      // Send every earlier open-ended Q/A so the AI won't re-probe detail the
      // respondent already gave under a previous question (e.g. answering "the
      // slow pacing I mentioned earlier" on the good/bad/ugly question).
      const order: Array<'q1' | 'q2' | 'q3' | 'q4'> = ['q1', 'q2', 'q3', 'q4']
      const priorQA: Array<{ question: string; answer: string }> = []
      for (const k of order) {
        if (k === qKey) break
        const a = s.answers[k]
        if (a) priorQA.push({ question: s.questionsAsked[k] || '', answer: a })
      }

      const res = await fetch('/api/clarify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studyName:       orgName || study.name,
          studyPurpose:    config.greeting,
          studyGuid:       study.guid,
          session_id:      sessionId.current,   // per-session rate-limit key (venue-NAT safe)
          questionAsked:   s.currentQuestion,
          questionKey:     qKey,
          answer:          text,
          sentiment:       s.sentiment || 'neutral',
          experienceScore: s.rating || 3,
          npsScore:        s.npsScore || 3,
          priorQA,
          language:        activeLang.current !== 'en' ? activeLang.current : undefined,
          testing:         config.testing || undefined,
          force:           config.forceClarify || undefined,
        }),
      })
      if (!res.ok) throw new Error('API error')
      const data = await res.json()
      if (data._debug && config.testing) {
        showDebugPanel(data._debug)
        state.current.conversationLog.push({ who: 'bot', text: '[AI Thinking] ' + data._debug.join(' | '), ai: true })
      }
      // The AI returns a question, or null when it judges the answer complete /
      // off-topic / unsafe (SKIP). Respect SKIP — do NOT force a keyword clarifier,
      // or every answer that clears the gate gets nagged with the default prompt.
      return data.question || null
    } catch {
      // AI call FAILED (network / rate-limit / parse error) — degrade to the
      // keyword default so a transient failure still asks something sensible.
      return keywordFallback()
    }
  }, [config.clarifiers, config.forceClarify, config.greeting, config.testing, config.useAIClarify, orgName, showDebugPanel, study.guid, study.name, tUI])

  const pickPsychoQuestions = useCallback((n = 3) => {
    const bank = [...config.psychographicBank]
    const picked = []
    while (picked.length < n && bank.length > 0) {
      const i = Math.floor(Math.random() * bank.length)
      picked.push(...bank.splice(i, 1))
    }
    state.current.psychoQuestions = picked
  }, [config.psychographicBank])

  // -- Submit ------------------------------------------------

  const submitResponse = useCallback(async () => {
    // Cancel any pending partial save to prevent it from overwriting the complete status
    if (savePartialTimer.current) { clearTimeout(savePartialTimer.current); savePartialTimer.current = null }
    const s = state.current
    const lang = activeLang.current
    const payload: Partial<SurveyPayload> = {
      agent:            study.bot_name,
      timestamp:        new Date().toISOString(),
      language:         lang,
      openEnded:        s.answers,
      customAnswers:    s.customAnswers,
      psychographics:   s.psychoAnswers,
      demographics:     s.demographics,
      contactInfo:      s.contactInfo,
      conversationLog:  s.conversationLog,
      ...(Object.keys(s.urlParams).length > 0 ? { urlParams: s.urlParams } : {}),
    }
    // Only include scores if they were actually collected
    if (s.rating != null) {
      payload.experienceRating = { score: s.rating, label: s.ratingLabel!, sentiment: s.sentiment! }
    }
    if (s.npsScore != null) {
      payload.npsRecommend = { score: s.npsScore, label: s.npsLabel! }
    }

    // Auto-translate non-English open-ended responses back to English
    if (lang !== 'en' && config.autoTranslateResponses) {
      try {
        const textsToTranslate: Record<string, string> = {}
        if (s.answers.q1) textsToTranslate.q1 = s.answers.q1
        if (s.answers.q2) textsToTranslate.q2 = s.answers.q2
        if (s.answers.q3) textsToTranslate.q3 = s.answers.q3
        if (s.answers.q4) textsToTranslate.q4 = s.answers.q4
        const customTexts: Record<string, string> = {}
        for (const [k, v] of Object.entries(s.customAnswers)) {
          if (typeof v === 'string' && v.trim()) customTexts[k] = v
        }
        if (Object.keys(textsToTranslate).length > 0 || Object.keys(customTexts).length > 0) {
          const res = await fetch('/api/translate-responses', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ texts: textsToTranslate, customTexts, fromLanguage: lang, studyGuid: study.guid }),
          })
          if (res.ok) {
            const data = await res.json()
            // Store originals, replace with translated
            if (data.texts && Object.keys(data.texts).length > 0) {
              payload.openEndedOriginal = { ...s.answers }
              payload.openEnded = { ...s.answers, ...data.texts }
            }
            if (data.customTexts && Object.keys(data.customTexts).length > 0) {
              payload.customAnswersOriginal = { ...s.customAnswers }
              payload.customAnswers = { ...s.customAnswers, ...data.customTexts }
            }
          }
        }
      } catch { /* translation failed — submit originals */ }
    }

    // Add device fingerprint to payload for server-side duplicate check
    const fullPayload = Object.assign({}, payload, { deviceFingerprint: deviceFingerprint.current })

    const duration_sec = Math.round((Date.now() - s.startTime) / 1000)

    try {
      const res = await fetch('/api/respond', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          study_guid:   study.guid,
          payload:      fullPayload,
          duration_sec,
          session_id:   sessionId.current,
          status:       'complete',
          recipient_guid: recipientGuid.current || undefined,
        }),
      })
      if (res.ok) {
        // Mark device as having completed this survey (skipped on kiosk —
        // a shared tablet must accept the next guest)
        if (!kiosk) try { localStorage.setItem('sentimetrx_completed_' + study.guid, new Date().toISOString()) } catch {}
        // Clear session so next survey attempt from same tab gets a fresh session_id
        try { sessionStorage.removeItem('sentimetrx_session_' + study.guid) } catch {}
      } else {
        const errBody = await res.json().catch(() => ({}))
        console.error('Response save failed:', res.status, errBody)
        // Retry once after a short delay
        try {
          const retry = await fetch('/api/respond', {
            method:  'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              study_guid:   study.guid,
              payload:      fullPayload,
              duration_sec,
              session_id:   sessionId.current,
              status:       'complete',
              recipient_guid: recipientGuid.current || undefined,
            }),
          })
          if (retry.ok) {
            if (!kiosk) try { localStorage.setItem('sentimetrx_completed_' + study.guid, new Date().toISOString()) } catch {}
            try { sessionStorage.removeItem('sentimetrx_session_' + study.guid) } catch {}
          } else {
            console.error('Response save retry failed:', retry.status)
          }
        } catch (retryErr) {
          console.error('Response save retry error:', retryErr)
        }
      }
    } catch (err) {
      console.error('Failed to submit response:', err)
    }
  }, [config.autoTranslateResponses, kiosk, study.bot_name, study.guid])

  // -- Section ordering ----------------------------------------
  // useMemo, not a bare `||`: the fallback array literal was a new identity on
  // every render, which churned every callback that depends on the ordering.
  const sectionOrder: SectionKey[] = useMemo(
    () => config.sectionOrder || ['customQuestions', 'psychographics', 'demographics', 'contact'],
    [config.sectionOrder],
  )
  const sectionIdx = useRef(0)
  const sectionRunners = useRef<Record<string, () => Promise<void>>>({} as Record<string, () => Promise<void>>)

  const advanceSection = useCallback(async () => {
    sectionIdx.current++
    while (sectionIdx.current < sectionOrder.length) {
      const key = sectionOrder[sectionIdx.current]
      const runner = sectionRunners.current[key]
      if (runner) { await runner(); return }
      sectionIdx.current++
    }
    // All sections done
    await sectionRunners.current._done?.()
  }, [sectionOrder])

  // -- Flow Steps --------------------------------------------

  const stepDone = useCallback(async () => {
    const closingMsgFallback = config.closingMessage || `Thank you so much -- ${study.bot_name} really appreciates you taking a moment to share. Your feedback makes a genuine difference. 💛`
    const closingMsgTranslated = t('closingMessage', closingMsgFallback)
    const closingFinal = closingMsgTranslated === closingMsgFallback && activeLang.current !== 'en'
      ? tUI('closingMessageDefault', closingMsgFallback)
      : closingMsgTranslated
    await showTyping(typingDur(closingFinal))
    // If t() returned the English fallback unchanged and we're not in English, use built-in
    addMsg('bot', closingFinal)
    await showTyping(400)

    if (!chatRef.current) return
    const card = document.createElement('div')
    card.className = 'rounded-2xl p-5 text-center my-1'
    card.style.background = config.theme.headerGradient
    const closingCardFallback = config.closingCard || 'Your responses have been saved. Thank you for your time.'
    const closingCardTranslated = t('closingCard', closingCardFallback)
    const cardSubtitle = closingCardTranslated === closingCardFallback && activeLang.current !== 'en'
      ? tUI('closingCardDefault', closingCardFallback)
      : closingCardTranslated
    card.innerHTML = DOMPurify.sanitize(`
      <div class="text-4xl mb-2">${study.bot_emoji}</div>
      <div class="text-white font-semibold text-lg mb-1">${tUI('allDone', 'All done!')}</div>
      <div class="text-white/75 text-sm leading-snug" style="white-space:pre-wrap">${cardSubtitle}</div>
    `)
    // Style links in the card to be visible and clickable
    card.querySelectorAll('a').forEach(a => {
      a.style.color = '#00b4d8'
      a.style.textDecoration = 'underline'
      a.style.fontWeight = '600'
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
    })
    chatRef.current.appendChild(card)
    scrollBottom()
    clearInput()
    await submitResponse()
    onComplete?.()
  }, [addMsg, chatRef, clearInput, config, onComplete, scrollBottom, showTyping, study, submitResponse, t, tUI])

  const stepDemographics = useCallback(async () => {
    // Get enabled demo fields from config, or default to age/gender/zip
    var demoFields = config.demoFields
    if (!demoFields || demoFields.length === 0) {
      demoFields = [
        { key: 'age', label: 'Age Range', type: 'select' as const, enabled: true, options: [['18-24','18-24'],['25-34','25-34'],['35-44','35-44'],['45-54','45-54'],['55-64','55-64'],['65+','65 or over']] },
        { key: 'gender', label: 'Gender', type: 'select' as const, enabled: true, options: [['male','Male'],['female','Female'],['nonbinary','Non-binary'],['other','Prefer to self-describe'],['prefer_not','Prefer not to say']] },
        { key: 'zip', label: 'ZIP / Postal Code', type: 'text' as const, enabled: true },
      ]
    }
    var activeFields = demoFields.filter(function(f) { return f.enabled })
    if (activeFields.length === 0) { await advanceSection(); return }

    clearInput()
    const demoTransition = config.sectionTransitions?.demographics
    if (demoTransition?.enabled !== false) {
      const msg = tTransition('demographics', demoTransition?.text || 'Almost done -- a couple of optional questions about you. Completely up to you.')
      await showTyping(typingDur(msg))
      addMsg('bot', msg)
      await showTyping(400)
    } else {
      await showTyping(400)
    }

    if (!inputRef.current) return
    var wrap = document.createElement('div')
    wrap.className = 'flex flex-col gap-1.5 mt-1.5'

    var selectStyle = 'padding:10px 13px;border-radius:10px;font-size:0.844rem;color:' + C.textMid + ';background:' + C.inputBg + ';border:1.5px solid ' + config.theme.primaryColor + '28;outline:none;cursor:pointer;appearance:none;font-family:inherit;'

    var fieldElements: { key: string; el: HTMLSelectElement | HTMLInputElement }[] = []

    for (var fi = 0; fi < activeFields.length; fi++) {
      var df = activeFields[fi]
      var tDemoLabel = tDemoLabel_(df.key, df.label)
      if (df.type === 'select' && df.options && df.options.length > 0) {
        var sel = document.createElement('select')
        sel.style.cssText = selectStyle
        var ph = document.createElement('option')
        ph.value = ''; ph.textContent = tDemoLabel + '...'
        sel.appendChild(ph)
        for (var oi = 0; oi < df.options.length; oi++) {
          var opt = document.createElement('option')
          opt.value = df.options[oi][0]; opt.textContent = tDemoOption(df.key, oi, df.options[oi][1])
          sel.appendChild(opt)
        }
        wrap.appendChild(sel)
        fieldElements.push({ key: df.key, el: sel })
      } else {
        var inp = document.createElement('input')
        inp.type = 'text'
        inp.placeholder = tDemoLabel + ' (' + tUI('optional', 'optional') + ')'
        inp.style.cssText = selectStyle + 'border-radius:10px;'
        wrap.appendChild(inp)
        fieldElements.push({ key: df.key, el: inp })
      }
    }

    var submitBtn = document.createElement('button')
    submitBtn.textContent = tUI('submitFeedback', 'Submit my feedback') + ' \u2192'
    submitBtn.className = 'rounded-full font-semibold text-sm py-2.5 px-6 self-start transition-all'
    submitBtn.style.cssText = 'background:' + config.theme.primaryColor + ';color:#fff;border:none;cursor:pointer;font-family:inherit;margin-top:4px;'
    submitBtn.onclick = async function() {
      wrap.querySelectorAll<HTMLSelectElement | HTMLInputElement | HTMLButtonElement>('select,input,button').forEach(function(el) { el.disabled = true })
      for (var ei = 0; ei < fieldElements.length; ei++) {
        state.current.demographics[fieldElements[ei].key] = fieldElements[ei].el.value
      }
      savePartial()
      clearInput()
      await advanceSection()
    }

    wrap.appendChild(submitBtn)
    inputRef.current.appendChild(wrap)
    scrollBottom()
  }, [addMsg, advanceSection, clearInput, config, inputRef, savePartial, scrollBottom, showTyping, state, tDemoLabel_, tDemoOption, tTransition, tUI])

  const stepContactInfo = useCallback(async () => {
    var contactFields = config.contactFields
    if (!contactFields) { await advanceSection(); return }
    var activeFields = contactFields.filter(function(f) { return f.enabled })
    if (activeFields.length === 0) { await advanceSection(); return }

    clearInput()
    var contactTransition = config.contactTransition
    if (contactTransition?.enabled !== false) {
      var msg = tContactTransition(contactTransition?.text || "If you'd like us to follow up, please share your contact details below. Completely optional.")
      await showTyping(typingDur(msg))
      addMsg('bot', msg)
      await showTyping(400)
    } else {
      await showTyping(400)
    }

    if (!inputRef.current) return
    var wrap = document.createElement('div')
    wrap.className = 'flex flex-col gap-1.5 mt-1.5'

    var baseStyle = 'padding:10px 13px;border-radius:10px;font-size:0.844rem;color:' + C.textMid + ';background:' + C.inputBg + ';border:1.5px solid ' + config.theme.primaryColor + '28;outline:none;font-family:inherit;'
    var errorStyle = 'font-size:0.75rem;color:#ef4444;margin-top:2px;display:none;'

    var fieldElements: { key: string; type: string; el: HTMLSelectElement | HTMLInputElement; errorEl: HTMLDivElement; required: boolean }[] = []

    for (var fi = 0; fi < activeFields.length; fi++) {
      var cf = activeFields[fi]
      var fieldWrap = document.createElement('div')

      if (cf.type === 'us_state') {
        var sel = document.createElement('select')
        sel.style.cssText = baseStyle + 'cursor:pointer;appearance:none;'
        var ph = document.createElement('option')
        ph.value = ''; ph.textContent = tContactLabel(cf.key, cf.label) + (cf.required ? ' *' : '') + '...'
        sel.appendChild(ph)
        for (var si = 0; si < US_STATES.length; si++) {
          var opt = document.createElement('option')
          opt.value = US_STATES[si][0]; opt.textContent = US_STATES[si][1]
          sel.appendChild(opt)
        }
        fieldWrap.appendChild(sel)
        var errDiv1 = document.createElement('div')
        errDiv1.style.cssText = errorStyle
        fieldWrap.appendChild(errDiv1)
        fieldElements.push({ key: cf.key, type: cf.type, el: sel, errorEl: errDiv1, required: !!cf.required })
      } else {
        var inp = document.createElement('input')
        inp.type = cf.type === 'email' ? 'email' : cf.type === 'phone' ? 'tel' : 'text'
        var cfLabel = tContactLabel(cf.key, cf.placeholder || cf.label)
        inp.placeholder = cfLabel + (cf.required ? ' *' : ' (' + tUI('optional', 'optional') + ')')
        inp.style.cssText = baseStyle
        if (cf.type === 'phone') inp.inputMode = 'tel'
        if (cf.type === 'zip_code') inp.inputMode = 'numeric'
        fieldWrap.appendChild(inp)
        var errDiv2 = document.createElement('div')
        errDiv2.style.cssText = errorStyle
        fieldWrap.appendChild(errDiv2)
        fieldElements.push({ key: cf.key, type: cf.type, el: inp, errorEl: errDiv2, required: !!cf.required })
      }

      wrap.appendChild(fieldWrap)
    }

    var continueBtn = document.createElement('button')
    continueBtn.textContent = tUI('continue', 'Continue') + ' \u2192'
    continueBtn.className = 'rounded-full font-semibold text-sm py-2.5 px-6 self-start transition-all'
    continueBtn.style.cssText = 'background:' + config.theme.primaryColor + ';color:#fff;border:none;cursor:pointer;font-family:inherit;margin-top:4px;'
    continueBtn.onclick = async function() {
      // Validate
      var hasError = false
      for (var vi = 0; vi < fieldElements.length; vi++) {
        var fe = fieldElements[vi]
        var val = fe.el.value.trim()
        fe.errorEl.style.display = 'none'

        if (fe.required && !val) {
          fe.errorEl.textContent = fe.key.charAt(0).toUpperCase() + fe.key.slice(1) + ' is required'
          fe.errorEl.style.display = 'block'
          hasError = true
          continue
        }

        if (val) {
          var validationError = validateContactField(fe.type as ContactFieldType, val)
          if (validationError) {
            fe.errorEl.textContent = validationError
            fe.errorEl.style.display = 'block'
            hasError = true
          }
        }
      }
      if (hasError) return

      wrap.querySelectorAll<HTMLSelectElement | HTMLInputElement | HTMLButtonElement>('select,input,button').forEach(function(el) { el.disabled = true })
      for (var ci = 0; ci < fieldElements.length; ci++) {
        var value = fieldElements[ci].el.value.trim()
        if (value) state.current.contactInfo[fieldElements[ci].key] = value
      }
      savePartial()
      clearInput()
      await advanceSection()
    }

    wrap.appendChild(continueBtn)
    inputRef.current.appendChild(wrap)
    scrollBottom()
  }, [addMsg, advanceSection, clearInput, config, inputRef, savePartial, scrollBottom, showTyping, state, tContactLabel, tContactTransition, tUI])

  const stepPsychoQ = useCallback(async () => {
    const s = state.current
    if (s.psychoIdx >= s.psychoQuestions.length) { await advanceSection(); return }
    clearInput()
    const q = s.psychoQuestions[s.psychoIdx]
    const qText = tPsycho(q.key, 'q', q.q) as string
    await showTyping(typingDur(qText))
    addMsg('bot', qText)

    if (!inputRef.current) return
    const col = document.createElement('div')
    col.className = 'flex flex-col gap-1.5 mt-1.5'
    let psychoSel: string | null = null
    let psychoConfirmBtn: HTMLButtonElement | null = null
    const psychoBtns: HTMLButtonElement[] = []
    const tOpts = tPsycho(q.key, 'opts', q.opts) as string[]
    const commitPsycho = (opt: string) => {
      col.querySelectorAll('button').forEach((b) => { b.disabled = true })
      addMsg('user', opt)
      // Store original English key for analytics consistency
      const origIdx = tOpts.indexOf(opt)
      state.current.psychoAnswers[q.key] = origIdx >= 0 && q.opts[origIdx] ? q.opts[origIdx] : opt
      state.current.psychoIdx++
      savePartial()
      // eslint-disable-next-line react-hooks/immutability -- self-recursive useCallback: `stepPsychoQ` is referenced inside its own body to advance to the next psychographic question. The reference is only evaluated on click, long after the declaration has been initialised.
      void stepPsychoQ()
    }
    tOpts.forEach(opt => {
      const btn = document.createElement('button')
      btn.className = 'text-left px-4 py-2.5 rounded-xl text-sm font-medium transition-all'
      btn.style.cssText = 'background:' + C.btnBg + ';border:1.5px solid ' + C.inputBdr + ';color:' + C.textMid + ';cursor:pointer;font-family:inherit;'
      btn.textContent = opt
      btn.onmouseenter = () => { if (!confirmMode || psychoSel !== opt) { btn.style.borderColor = config.theme.primaryColor; btn.style.background = C.btnHoverBg } }
      btn.onmouseleave = () => { if (!confirmMode || psychoSel !== opt) { btn.style.borderColor = C.inputBdr; btn.style.background = C.btnBg } }
      btn.onclick = () => {
        if (confirmMode) {
          psychoSel = opt
          psychoBtns.forEach(b => { b.style.borderColor = C.inputBdr; b.style.background = C.btnBg })
          btn.style.borderColor = config.theme.primaryColor; btn.style.background = config.theme.primaryColor + '20'
          if (psychoConfirmBtn) { psychoConfirmBtn.style.display = 'block'; psychoConfirmBtn.style.background = config.theme.primaryColor; psychoConfirmBtn.style.color = '#fff' }
        } else {
          commitPsycho(opt)
        }
      }
      psychoBtns.push(btn)
      col.appendChild(btn)
    })
    if (confirmMode) {
      psychoConfirmBtn = document.createElement('button')
      psychoConfirmBtn.textContent = tUI('confirm', 'Confirm')
      psychoConfirmBtn.className = 'mt-1 px-4 py-2 rounded-xl text-sm font-semibold transition-all'
      psychoConfirmBtn.style.cssText = 'display:none;background:' + C.disabledBg + ';color:' + C.disabledTx + ';border:none;cursor:pointer;font-family:inherit;'
      psychoConfirmBtn.onclick = () => { if (psychoSel) commitPsycho(psychoSel) }
      col.appendChild(psychoConfirmBtn)
    }
    inputRef.current.appendChild(col)
    scrollBottom()
    if (confirmMode) scrollInputBottom()
  }, [addMsg, advanceSection, clearInput, config, confirmMode, inputRef, savePartial, scrollBottom, scrollInputBottom, showTyping, state, tPsycho, tUI])

  // Clarify input for likert follow-ups (q1/q2)
  const showLikertClarifyInput = useCallback((storageKey: 'q1' | 'q2', originalVal: string, next: () => Promise<void>) => {
    if (!inputRef.current) return
    const wrap = document.createElement('div')
    wrap.className = 'flex gap-2 items-end w-full mt-1.5'
    const ta = document.createElement('textarea'); ta.lang = activeLang.current
    ta.cols = 1
    ta.className = 'flex-1 min-w-0 resize-none text-base leading-relaxed rounded-2xl px-4 py-2.5'
    ta.rows = 1
    ta.placeholder = tUI('clarifyPlaceholder', 'Feel free to add a bit more...')
    ta.style.cssText = 'background:' + C.inputBg + ';border:1.5px solid ' + config.theme.primaryColor + '28;color:' + C.text + ';outline:none;font-family:inherit;max-height:110px;'
    ta.onfocus  = () => { ta.style.borderColor = config.theme.primaryColor }
    ta.onblur   = () => { ta.style.borderColor = `${config.theme.primaryColor}28` }
    ta.oninput  = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 110) + 'px' }
    ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click() } }
    const sendBtn = document.createElement('button')
    sendBtn.textContent = '→'
    sendBtn.className = 'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-base transition-all'
    sendBtn.style.cssText = `background:${config.theme.primaryColor};color:#fff;border:none;cursor:pointer;font-family:inherit;`
    sendBtn.onclick = async () => {
      const val = ta.value.trim()
      if (checkVerbose(val, ta)) return
      wrap.querySelectorAll<HTMLTextAreaElement | HTMLButtonElement>('textarea,button').forEach((el) => { el.disabled = true })
      if (val && !isDecline(val)) {
        addMsg('user', val)
        state.current.answers[storageKey] = originalVal + ' [+ ' + val + ']'
      }
      savePartialRef.current()
      clearInput()
      // AI deflection: detect questions/off-topic and respond contextually — deflection serves as the ack
      if (val && !isDecline(val) && await checkDeflect(val, state.current.currentQuestion || '')) {
        state.current.skipNextAck = true
      }
      await next()
    }
    wrap.append(ta, sendBtn)
    inputRef.current.appendChild(wrap)
    setTimeout(() => ta.focus(), 100)
    scrollBottom()
  }, [addMsg, checkDeflect, checkVerbose, clearInput, config, inputRef, scrollBottom, tUI])



  


  


  const showLikertFollowUpInput = useCallback((next: () => Promise<void>, storageKey?: 'q1' | 'q2') => {
    if (!inputRef.current) return
    const wrap = document.createElement('div')
    wrap.className = 'flex flex-col gap-2 mt-1.5'
    const row = document.createElement('div')
    row.className = 'flex gap-2 items-end w-full'
    const ta = document.createElement('textarea'); ta.lang = activeLang.current
    ta.cols = 1
    ta.className = 'flex-1 min-w-0 resize-none text-base leading-relaxed rounded-2xl px-4 py-2.5'
    ta.rows = 1
    ta.placeholder = tUI('sharePlaceholder', 'Share your thoughts...')
    ta.style.cssText = 'background:' + C.inputBg + ';border:1.5px solid ' + C.inputBdr + ';color:' + C.text + ';outline:none;font-family:inherit;max-height:110px;transition:border-color 0.2s;width:0;min-width:0;box-sizing:border-box;'
    ta.onfocus  = () => { ta.style.borderColor = config.theme.primaryColor }
    ta.onblur   = () => { ta.style.borderColor = C.inputBdr }
    ta.oninput  = () => {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 110) + 'px'
      sendBtn.style.background = ta.value.trim() ? config.theme.primaryColor : C.disabledBg
      sendBtn.style.color      = ta.value.trim() ? '#fff' : C.textMute
    }
    ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click() } }
    const sendBtn = document.createElement('button')
    sendBtn.textContent = '->'
    sendBtn.className = 'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-base transition-all'
    sendBtn.style.cssText = 'background:' + C.disabledBg + ';color:' + C.textMute + ';border:none;cursor:pointer;font-family:inherit;'
    const skipBtn = document.createElement('button')
    skipBtn.textContent = tUI('skip', 'Skip')
    skipBtn.className = 'rounded-full text-sm font-medium px-4 py-2 transition-all self-start'
    skipBtn.style.cssText = 'background:transparent;border:1.5px solid ' + C.textMute + ';color:' + C.textMid + ';cursor:pointer;font-family:inherit;'
    const submit = async () => {
      const v = ta.value.trim()
      if (checkVerbose(v, ta)) return
      wrap.querySelectorAll<HTMLTextAreaElement | HTMLButtonElement>('textarea,button').forEach((el) => { el.disabled = true })
      if (v) {
        addMsg('user', v)
        if (storageKey) {
          state.current.answers[storageKey] = v
          state.current.questionsAsked[storageKey] = state.current.currentQuestion
        }
      }
      savePartialRef.current()
      clearInput()
      // Smart deflection: if respondent asked a question or went off-topic, redirect and skip clarifier
      if (v && !isDecline(v) && await checkDeflect(v, state.current.currentQuestion || '')) {
        state.current.skipNextAck = true
        await next()
        return
      }
      // Check for clarifier on short responses
      if (v && storageKey && shouldClarify(v) && state.current.clarifyCount < (config.maxClarifierCount || 5)) {
        const cq = await showTypingDuring(buildClarify(v, storageKey === 'q1' ? 'q3' : 'q4'), 800)
        if (cq) {
          state.current.clarifyCount++
          addMsg('bot', cq, true)
          // Show clarify input — on submit, append to existing answer then proceed
          showLikertClarifyInput(storageKey, v, next)
          return
        }
      }
      await next()
    }
    sendBtn.onclick = submit
    skipBtn.onclick = submit
    row.append(ta, sendBtn)
    wrap.append(row, skipBtn)
    inputRef.current.appendChild(wrap)
    setTimeout(() => ta.focus(), 100)
    scrollBottom()
  }, [addMsg, buildClarify, checkDeflect, checkVerbose, clearInput, config, inputRef, scrollBottom, shouldClarify, showLikertClarifyInput, showTypingDuring, tUI])


    const stepPsychoIntro = useCallback(async () => {
    clearInput()
    pickPsychoQuestions(config.psychoCount ?? 3)
    state.current.psychoIdx = 0
    const psychoTransition = config.sectionTransitions?.psychographics
    if (psychoTransition?.enabled !== false) {
      const msg = tTransition('psychographics', psychoTransition?.text || 'Just a few quick questions to round things out -- helps us understand the range of people sharing feedback.')
      await showTyping(typingDur(msg))
      addMsg('bot', msg)
      await showTyping(400)
    } else {
      await showTyping(400)
    }
    await stepPsychoQ()
  }, [addMsg, clearInput, config.psychoCount, config.sectionTransitions?.psychographics, pickPsychoQuestions, showTyping, stepPsychoQ, tTransition])

  const stepCustomQuestions = useCallback(async () => {
    const allQuestions = (config.questions ?? []).filter(q => !q.conversationPosition && q.enabled !== false && q.type !== 'hidden')
    if (allQuestions.length === 0) { await advanceSection(); return }

    // Show transition message if enabled
    const cqTransition = config.sectionTransitions?.customQuestions
    if (cqTransition?.enabled) {
      clearInput()
      const msg = tTransition('customQuestions', cqTransition.text || 'Now for a few more specific questions.')
      await showTyping(typingDur(msg))
      addMsg('bot', msg)
      await showTyping(400)
    }

    // Randomly sample customQCount questions if set, otherwise show all
    const n = config.customQCount && config.customQCount > 0 && config.customQCount < allQuestions.length
      ? config.customQCount
      : allQuestions.length
    const pool = [...allQuestions]
    const questions: typeof pool = []
    while (questions.length < n && pool.length > 0) {
      const i = Math.floor(Math.random() * pool.length)
      questions.push(...pool.splice(i, 1))
    }

    const customAnswers: Record<string, string | string[]> = {}

    // Skip logic evaluator
    function evaluateSkipLogic(q: typeof questions[0], answer: string | string[]): string | null {
      if (!q.skipLogic || q.skipLogic.length === 0) return null
      const answerStr = Array.isArray(answer) ? answer.join(',') : answer
      for (const rule of q.skipLogic) {
        if (!rule.skipTo) continue
        const ruleVal = Array.isArray(rule.value) ? rule.value[0] : rule.value
        let match = false
        switch (rule.condition) {
          case 'equals': match = answerStr === ruleVal; break
          case 'not_equals': match = answerStr !== ruleVal; break
          case 'any_of': match = (Array.isArray(rule.value) ? rule.value : [ruleVal]).some(v => answerStr.includes(v)); break
          case 'none_of': match = !(Array.isArray(rule.value) ? rule.value : [ruleVal]).some(v => answerStr.includes(v)); break
          case 'greater_than': match = parseFloat(answerStr) > parseFloat(ruleVal); break
          case 'less_than': match = parseFloat(answerStr) < parseFloat(ruleVal); break
        }
        if (match) return rule.skipTo
      }
      return null
    }

    // confirmMode is defined at the hook top level

    let qi = 0
    while (qi < questions.length) {
      const q = questions[qi]
      clearInput()

      // ── message — display only, no response expected ─────────
      if (q.type === 'message') {
        const tPrompt = tQuestion(q.id, 'prompt', q.prompt) as string
        await showTyping(typingDur(tPrompt))
        addMsg('bot', tPrompt)
        await showTyping(400)
        qi++
        continue
      }

      const tPrompt = tQuestion(q.id, 'prompt', q.prompt) as string
      await showTyping(typingDur(tPrompt))
      addMsg('bot', tPrompt)
      state.current.currentQuestion = q.prompt

      await new Promise<void>(resolve => {
        if (!inputRef.current) { resolve(); return }

        // ── open-ended ──────────────────────────────────────────
        if (q.type === 'open') {
          const submit = async (val: string) => {
            customAnswers[q.id] = val
            // Smart deflection: if respondent asked a question, redirect and skip clarifier
            if (val && !isDecline(val) && await checkDeflect(val, q.prompt)) {
              clearInput()
              resolve()
              return
            }
            // Clarifier follow-up for non-trivial responses
            if (val && (q.clarify !== false) && config.useAIClarify && shouldClarify(val) && state.current.clarifyCount < (config.maxClarifierCount || 5)) {
              const cq = await showTypingDuring(buildClarify(val, 'q4'), 800)
              if (cq) {
                state.current.clarifyCount++
                clearInput()
                addMsg('bot', cq, true)
                state.current.currentQuestion = cq
                showLikertFollowUpInput(async () => { resolve() })
                return
              }
            }
            clearInput()
            resolve()
          }
          // Build inline to capture resolve
          const wrap = document.createElement('div')
          wrap.className = 'flex flex-col gap-2 mt-1.5'
          const row = document.createElement('div')
          row.className = 'flex gap-2 items-end w-full'
          const ta = document.createElement('textarea'); ta.lang = activeLang.current
    ta.cols = 1
          ta.className = 'flex-1 min-w-0 resize-none text-base leading-relaxed rounded-2xl px-4 py-2.5'
          ta.rows = 1
          ta.placeholder = tUI('sharePlaceholder', 'Share your thoughts...')
          ta.style.cssText = 'background:' + C.inputBg + ';border:1.5px solid ' + C.inputBdr + ';color:' + C.text + ';outline:none;font-family:inherit;max-height:110px;transition:border-color 0.2s;width:0;min-width:0;box-sizing:border-box;'
          ta.onfocus = () => { ta.style.borderColor = config.theme.primaryColor }
          ta.onblur  = () => { ta.style.borderColor = C.inputBdr }
          ta.oninput = () => {
            ta.style.height = 'auto'
            ta.style.height = Math.min(ta.scrollHeight, 110) + 'px'
            sendBtn.style.background = ta.value.trim() ? config.theme.primaryColor : C.disabledBg
            sendBtn.style.color      = ta.value.trim() ? '#fff' : C.textMute
          }
          const sendBtn = document.createElement('button')
          sendBtn.textContent = '->'
          sendBtn.className = 'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-base transition-all'
          sendBtn.style.cssText = 'background:' + C.disabledBg + ';color:' + C.textMute + ';border:none;cursor:pointer;font-family:inherit;'
          ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click() } }
          sendBtn.onclick = async () => {
            const v = ta.value.trim()
            if (checkVerbose(v, ta)) return
            if (!v && q.required) return
            wrap.querySelectorAll<HTMLTextAreaElement | HTMLButtonElement>('textarea,button').forEach((el) => { el.disabled = true })
            if (v) addMsg('user', v)
            await submit(v)
          }
          row.append(ta, sendBtn)
          wrap.appendChild(row)
          if (!q.required) {
            const skipBtn = document.createElement('button')
            skipBtn.textContent = tUI('skip', 'Skip')
            skipBtn.className = 'rounded-full text-sm font-medium px-4 py-2 transition-all self-start'
            skipBtn.style.cssText = 'background:transparent;border:1.5px solid ' + C.textMute + ';color:' + C.textMid + ';cursor:pointer;font-family:inherit;'
            skipBtn.onmouseenter = () => { skipBtn.style.borderColor = C.text; skipBtn.style.color = C.text }
            skipBtn.onmouseleave = () => { skipBtn.style.borderColor = C.textMute; skipBtn.style.color = C.textMid }
            skipBtn.onclick = () => { wrap.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button,textarea').forEach((el) => { el.disabled = true }); void submit('') }
            wrap.appendChild(skipBtn)
          }
          clearInput()
          inputRef.current.appendChild(wrap)
          setTimeout(() => ta.focus(), 100)
          scrollBottom()

        // ── radio ───────────────────────────────────────────────
        } else if (q.type === 'radio') {
          const opts = tQuestion(q.id, 'options', q.options ?? []) as string[]
          const col = document.createElement('div')
          col.className = 'flex flex-col gap-1.5 mt-1.5'
          const confirm = confirmMode
          let selectedOpt: string | null = null
          let confirmBtn: HTMLButtonElement | null = null
          const allBtns: HTMLButtonElement[] = []
          opts.forEach(opt => {
            const btn = document.createElement('button')
            btn.className = 'text-left px-4 py-2.5 rounded-xl text-sm font-medium transition-all'
            btn.style.cssText = 'background:' + C.btnBg + ';border:1.5px solid ' + C.inputBdr + ';color:' + C.textMid + ';cursor:pointer;font-family:inherit;'
            btn.textContent = opt
            btn.onmouseenter = () => { if (!confirm || selectedOpt !== opt) { btn.style.borderColor = config.theme.primaryColor; btn.style.background = C.btnHoverBg } }
            btn.onmouseleave = () => { if (!confirm || selectedOpt !== opt) { btn.style.borderColor = C.inputBdr; btn.style.background = C.btnBg } }
            btn.onclick = () => {
              if (confirm) {
                selectedOpt = opt
                allBtns.forEach(b => { b.style.borderColor = C.inputBdr; b.style.background = C.btnBg })
                btn.style.borderColor = config.theme.primaryColor
                btn.style.background  = config.theme.primaryColor + '20'
                if (confirmBtn) { confirmBtn.style.display = 'block'; confirmBtn.style.background = config.theme.primaryColor; confirmBtn.style.color = '#fff' }
              } else {
                col.querySelectorAll('button').forEach((b) => { b.disabled = true })
                btn.style.borderColor = config.theme.primaryColor
                btn.style.background  = config.theme.primaryColor + '20'
                addMsg('user', opt)
                customAnswers[q.id] = opt
                clearInput()
                resolve()
              }
            }
            allBtns.push(btn)
            col.appendChild(btn)
          })
          if (confirm) {
            confirmBtn = document.createElement('button')
            confirmBtn.textContent = tUI('confirm', 'Confirm')
            confirmBtn.className = 'mt-1 px-4 py-2 rounded-xl text-sm font-semibold transition-all'
            confirmBtn.style.cssText = 'display:none;background:' + C.disabledBg + ';color:' + C.textMute + ';border:none;cursor:pointer;font-family:inherit;'
            confirmBtn.onclick = () => {
              if (!selectedOpt) return
              col.querySelectorAll('button').forEach((b) => { b.disabled = true })
              addMsg('user', selectedOpt)
              customAnswers[q.id] = selectedOpt
              clearInput()
              resolve()
            }
            col.appendChild(confirmBtn)
          }
          clearInput()
          inputRef.current.appendChild(col)
          scrollBottom()
          if (confirm) scrollInputBottom()

        // ── checkbox ────────────────────────────────────────────
        } else if (q.type === 'checkbox') {
          const opts = tQuestion(q.id, 'options', q.options ?? []) as string[]
          const selected = new Set<string>()
          const wrap = document.createElement('div')
          wrap.className = 'flex flex-col gap-1.5 mt-1.5'
          const btns: HTMLButtonElement[] = []
          const optScroll = document.createElement('div')
          optScroll.className = 'flex flex-col gap-1.5'
          optScroll.style.cssText = 'max-height:40vh;overflow-y:auto;'
          opts.forEach(opt => {
            const btn = document.createElement('button')
            btn.className = 'text-left px-4 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center gap-2.5'
            btn.style.cssText = 'background:' + C.btnBg + ';border:1.5px solid ' + C.inputBdr + ';color:' + C.textMid + ';cursor:pointer;font-family:inherit;'
            const icon = document.createElement('span')
            icon.className = 'flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-xs font-bold'
            icon.style.cssText = 'background:' + C.inputBdr + ';color:' + C.textMute + ';'
            icon.textContent = '✕'
            const label = document.createElement('span')
            label.textContent = opt
            btn.append(icon, label)
            btn.onclick = () => {
              if (selected.has(opt)) {
                selected.delete(opt)
                btn.style.borderColor = C.inputBdr
                btn.style.background  = C.btnBg
                icon.style.background = C.inputBdr
                icon.style.color = C.textMute
                icon.textContent = '✕'
              } else {
                selected.add(opt)
                btn.style.borderColor = config.theme.primaryColor
                btn.style.background  = config.theme.primaryColor + '20'
                icon.style.background = '#22c55e'
                icon.style.color = '#fff'
                icon.textContent = '✓'
              }
              doneBtn.textContent = selected.size > 0 ? tUI('done', 'Done') : q.required ? tUI('selectAtLeastOne', 'Select at least one') : tUI('done', 'Done')
              doneBtn.style.background = selected.size > 0 ? 'transparent' : C.disabledBg
              doneBtn.style.color      = selected.size > 0 ? C.text : C.textMute
              doneBtn.style.borderColor = selected.size > 0 ? C.text : 'transparent'
              doneBtn.style.display    = selected.size > 0 ? 'block' : q.required ? 'block' : 'none'
            }
            btns.push(btn)
            optScroll.appendChild(btn)
          })
          wrap.appendChild(optScroll)
          const btnRow = document.createElement('div')
          btnRow.className = 'flex items-center gap-3 pt-2'
          const doneBtn = document.createElement('button')
          doneBtn.textContent = q.required ? tUI('selectAtLeastOne', 'Select at least one') : tUI('done', 'Done')
          doneBtn.className = 'px-4 py-2 rounded-xl text-sm font-semibold transition-all'
          doneBtn.style.cssText = 'background:' + C.disabledBg + ';color:' + C.textMute + ';border:2px solid transparent;cursor:pointer;font-family:inherit;display:' + (q.required ? 'block' : 'none') + ';'
          doneBtn.onclick = () => {
            if (selected.size === 0 && q.required) return
            wrap.querySelectorAll('button').forEach((b) => { b.disabled = true })
            const arr = Array.from(selected)
            if (arr.length > 0) addMsg('user', arr.join(', '))
            customAnswers[q.id] = arr
            clearInput()
            resolve()
          }
          btnRow.appendChild(doneBtn)
          if (!q.required) {
            const skipBtn = document.createElement('button')
            skipBtn.textContent = tUI('skip', 'Skip')
            skipBtn.className = 'rounded-full text-sm font-medium px-4 py-2 transition-all'
            skipBtn.style.cssText = 'background:transparent;border:1.5px solid ' + C.textMute + ';color:' + C.textMid + ';cursor:pointer;font-family:inherit;'
            skipBtn.onclick = () => {
              wrap.querySelectorAll('button').forEach((b) => { b.disabled = true })
              customAnswers[q.id] = []
              clearInput()
              resolve()
            }
            btnRow.appendChild(skipBtn)
          }
          wrap.appendChild(btnRow)
          clearInput()
          inputRef.current.appendChild(wrap)
          scrollBottom()

        // ── dropdown ────────────────────────────────────────────
        } else if (q.type === 'dropdown') {
          const opts = tQuestion(q.id, 'options', q.options ?? []) as string[]
          const wrap = document.createElement('div')
          wrap.className = 'flex gap-2 mt-1.5 items-center'
          const sel = document.createElement('select')
          sel.className = 'flex-1 rounded-xl text-base px-3 py-2.5 outline-none cursor-pointer'
          sel.style.cssText = 'background:' + C.bubbleBdr + ';border:1.5px solid ' + C.disabledBg + ';color:' + C.text + ';font-family:inherit;'
          const placeholder = document.createElement('option')
          placeholder.value = ''
          placeholder.textContent = tUI('selectOption', 'Select an option...')
          placeholder.disabled = true
          placeholder.selected = true
          sel.appendChild(placeholder)
          opts.forEach(opt => {
            const o = document.createElement('option')
            o.value = opt; o.textContent = opt
            o.style.cssText = 'background:#1e293b;color:white;'
            sel.appendChild(o)
          })
          const goBtn = document.createElement('button')
          goBtn.textContent = '->'
          goBtn.className = 'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-base'
          goBtn.style.cssText = 'background:' + C.disabledBg + ';color:' + C.textMute + ';border:none;cursor:pointer;font-family:inherit;'
          sel.onchange = () => {
            goBtn.style.background = config.theme.primaryColor
            goBtn.style.color = '#fff'
          }
          goBtn.onclick = () => {
            if (!sel.value && q.required) return
            wrap.querySelectorAll<HTMLSelectElement | HTMLButtonElement>('select,button').forEach((el) => { el.disabled = true })
            if (sel.value) addMsg('user', sel.value)
            customAnswers[q.id] = sel.value
            clearInput()
            resolve()
          }
          if (!q.required) {
            const skipBtn = document.createElement('button')
            skipBtn.textContent = tUI('skip', 'Skip')
            skipBtn.className = 'rounded-full text-sm font-medium px-4 py-2 transition-all'
            skipBtn.style.cssText = 'background:transparent;border:1.5px solid ' + C.textMute + ';color:' + C.textMid + ';cursor:pointer;font-family:inherit;margin-left:4px;'
            skipBtn.onclick = () => { wrap.querySelectorAll<HTMLSelectElement | HTMLButtonElement>('select,button').forEach((el) => { el.disabled = true }); customAnswers[q.id] = ''; clearInput(); resolve() }
            wrap.append(sel, goBtn, skipBtn)
          } else {
            wrap.append(sel, goBtn)
          }
          clearInput()
          inputRef.current.appendChild(wrap)
          scrollBottom()

        // ── likert ──────────────────────────────────────────────
        } else if (q.type === 'likert') {
          const scale = q.likertScale ?? []
          // Translate likert labels: stored translation → built-in rating labels → original
          const storedLabels = ((): string[] | null => {
            if (activeLang.current === 'en' || !config.translations) return null
            const tr = config.translations[activeLang.current]?.questions?.[q.id]
            return tr?.likertLabels || null
          })()
          const tLikertLabels = storedLabels || scale.map((s) => tRatingLabel(s.label))
          const likertConfirm = confirmMode
          let selectedScore: typeof scale[0] | null = null
          let likertConfirmBtn: HTMLButtonElement | null = null
          const likertWrap = document.createElement('div')
          likertWrap.className = 'flex flex-col gap-1.5 mt-1.5'
          const row = document.createElement('div')
          row.className = 'flex gap-1'
          const allLikertBtns: HTMLButtonElement[] = []

          const commitLikert = async (s: typeof scale[0]) => {
            likertWrap.querySelectorAll('button').forEach((b) => { b.disabled = true })
            const selBtn = allLikertBtns[scale.indexOf(s)]
            if (selBtn) { selBtn.style.borderColor = config.theme.primaryColor; selBtn.style.background = config.theme.primaryColor + '20' }
            const tLabel = tLikertLabels[scale.indexOf(s)] || s.label
            addMsg('user', (s.emoji || '') + ' ' + tLabel)
            customAnswers[q.id] = String(s.score)
            if (q.followUp?.enabled) {
              const fu = q.followUp
              const pr = fu.mode === 'per-response' ? fu.perResponse?.[s.score] : null
              const englishPrompt = pr ? pr.prompt : (fu.sharedPrompt || '')
              if (englishPrompt.trim()) {
                const prompt = tFollowUp('question_' + q.id, s.score, fu.sharedPrompt || '', fu.perResponse)
                clearInput()
                await showTyping(typingDur(prompt))
                addMsg('bot', prompt, true)
                state.current.currentQuestion = prompt
                showLikertFollowUpInput(async () => { resolve() })
                return
              }
            }
            clearInput()
            resolve()
          }

          scale.forEach((s, si) => {
            const tLabel = tLikertLabels[si] || s.label
            const sb = document.createElement('button')
            sb.className = 'flex flex-col items-center gap-1 rounded-xl px-1 py-2 flex-1 min-w-0 transition-all'
            sb.style.cssText = 'background:' + C.btnBg + ';border:2px solid ' + C.inputBdr + ';cursor:pointer;font-family:inherit;'
            var emojiSize = scale.length > 1 ? (0.9 + (s.score - 1) / (scale.length - 1) * 0.6) : 1.125
            sb.innerHTML = DOMPurify.sanitize('<span style="font-size:' + emojiSize.toFixed(2) + 'rem">' + (s.emoji || '⭐') + '</span><span style="font-size:0.5rem;font-weight:600;color:' + C.textMute + ';text-align:center;line-height:1.2;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word">' + tLabel + '</span>')
            sb.onmouseenter = () => { if (!likertConfirm || selectedScore !== s) { sb.style.borderColor = config.theme.primaryColor; sb.style.background = C.btnHoverBg } }
            sb.onmouseleave = () => { if (!likertConfirm || selectedScore !== s) { sb.style.borderColor = C.inputBdr; sb.style.background = C.btnBg } }
            sb.onclick = async () => {
              if (likertConfirm) {
                selectedScore = s
                allLikertBtns.forEach(b => { b.style.borderColor = C.inputBdr; b.style.background = C.btnBg })
                sb.style.borderColor = config.theme.primaryColor
                sb.style.background  = config.theme.primaryColor + '20'
                if (likertConfirmBtn) { likertConfirmBtn.style.display = 'block'; likertConfirmBtn.style.background = config.theme.primaryColor; likertConfirmBtn.style.color = '#fff' }
              } else {
                await commitLikert(s)
              }
            }
            allLikertBtns.push(sb)
            row.appendChild(sb)
          })
          likertWrap.appendChild(row)
          if (likertConfirm) {
            likertConfirmBtn = document.createElement('button')
            likertConfirmBtn.textContent = tUI('confirm', 'Confirm')
            likertConfirmBtn.className = 'mt-1 px-4 py-2 rounded-xl text-sm font-semibold transition-all self-end'
            likertConfirmBtn.style.cssText = 'display:none;background:' + C.disabledBg + ';color:' + C.textMute + ';border:none;cursor:pointer;font-family:inherit;'
            likertConfirmBtn.onclick = async () => { if (selectedScore) await commitLikert(selectedScore) }
            likertWrap.appendChild(likertConfirmBtn)
          }
          clearInput()
          inputRef.current.appendChild(likertWrap)
          scrollBottom()
          if (likertConfirm) scrollInputBottom()
        } else if (q.type === 'rating') {
          const rMin = q.ratingMin ?? 1
          const rMax = q.ratingMax ?? 5
          const scores: number[] = []
          for (let i = rMin; i <= rMax; i++) scores.push(i)
          const ratingConfirm = confirmMode
          let selectedRating: number | null = null
          let ratingConfirmBtn: HTMLButtonElement | null = null
          const ratingWrap = document.createElement('div')
          ratingWrap.className = 'flex flex-col gap-1.5 mt-1.5'
          const ratingRow = document.createElement('div')
          ratingRow.className = 'flex gap-1 flex-wrap'
          const allRatingBtns: HTMLButtonElement[] = []
          scores.forEach(score => {
            const sb = document.createElement('button')
            sb.className = 'flex items-center justify-center rounded-xl font-bold text-sm transition-all'
            sb.style.cssText = 'width:40px;height:40px;background:' + C.btnBg + ';border:2px solid ' + C.inputBdr + ';color:' + C.textMid + ';cursor:pointer;font-family:inherit;'
            sb.textContent = String(score)
            sb.onmouseenter = () => { if (!ratingConfirm || selectedRating !== score) { sb.style.borderColor = config.theme.primaryColor; sb.style.background = C.btnHoverBg } }
            sb.onmouseleave = () => { if (!ratingConfirm || selectedRating !== score) { sb.style.borderColor = C.inputBdr; sb.style.background = C.btnBg } }
            sb.onclick = () => {
              if (ratingConfirm) {
                selectedRating = score
                allRatingBtns.forEach(b => { b.style.borderColor = C.inputBdr; b.style.background = C.btnBg })
                sb.style.borderColor = config.theme.primaryColor
                sb.style.background  = config.theme.primaryColor + '20'
                if (ratingConfirmBtn) { ratingConfirmBtn.style.display = 'block'; ratingConfirmBtn.style.background = config.theme.primaryColor; ratingConfirmBtn.style.color = '#fff' }
              } else {
                ratingRow.querySelectorAll('button').forEach((b) => { b.disabled = true })
                sb.style.borderColor = config.theme.primaryColor
                sb.style.background  = config.theme.primaryColor + '20'
                addMsg('user', String(score))
                customAnswers[q.id] = String(score)
                clearInput()
                resolve()
              }
            }
            allRatingBtns.push(sb)
            ratingRow.appendChild(sb)
          })
          ratingWrap.appendChild(ratingRow)
          if (ratingConfirm) {
            ratingConfirmBtn = document.createElement('button')
            ratingConfirmBtn.textContent = tUI('confirm', 'Confirm')
            ratingConfirmBtn.className = 'mt-1 px-4 py-2 rounded-xl text-sm font-semibold transition-all self-end'
            ratingConfirmBtn.style.cssText = 'display:none;background:' + C.disabledBg + ';color:' + C.textMute + ';border:none;cursor:pointer;font-family:inherit;'
            ratingConfirmBtn.onclick = () => {
              if (selectedRating === null) return
              ratingWrap.querySelectorAll('button').forEach((b) => { b.disabled = true })
              addMsg('user', String(selectedRating))
              customAnswers[q.id] = String(selectedRating)
              clearInput()
              resolve()
            }
            ratingWrap.appendChild(ratingConfirmBtn)
          }
          clearInput()
          inputRef.current.appendChild(ratingWrap)
          scrollBottom()
          if (ratingConfirm) scrollInputBottom()

        // -- numeric input ---------------------------------------
        } else if (q.type === 'numeric') {
          const wrap = document.createElement('div')
          wrap.className = 'flex gap-2 items-center mt-1.5'
          const inp = document.createElement('input')
          inp.type = 'number'
          inp.placeholder = 'Enter a number...'
          inp.className = 'flex-1 min-w-0 rounded-2xl px-4 py-2.5 text-base outline-none'
          inp.style.cssText = 'background:' + C.inputBg + ';border:1.5px solid ' + C.inputBdr + ';color:' + C.text + ';font-family:inherit;'
          inp.onfocus = () => { inp.style.borderColor = config.theme.primaryColor }
          inp.onblur  = () => { inp.style.borderColor = C.inputBdr }
          inp.oninput = () => {
            goBtn.style.background = inp.value.trim() ? config.theme.primaryColor : C.disabledBg
            goBtn.style.color      = inp.value.trim() ? '#fff' : C.textMute
          }
          const goBtn = document.createElement('button')
          goBtn.textContent = '->'
          goBtn.className = 'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-base transition-all'
          goBtn.style.cssText = 'background:' + C.disabledBg + ';color:' + C.textMute + ';border:none;cursor:pointer;font-family:inherit;'
          goBtn.onclick = () => {
            const v = inp.value.trim()
            if (!v && q.required) return
            wrap.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach((el) => { el.disabled = true })
            if (v) addMsg('user', v)
            customAnswers[q.id] = v
            clearInput()
            resolve()
          }
          inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); goBtn.click() } }
          wrap.append(inp, goBtn)
          if (!q.required) {
            const skipBtn = document.createElement('button')
            skipBtn.textContent = tUI('skip', 'Skip')
            skipBtn.className = 'rounded-full text-sm font-medium px-4 py-2 transition-all'
            skipBtn.style.cssText = 'background:transparent;border:1.5px solid ' + C.textMute + ';color:' + C.textMid + ';cursor:pointer;font-family:inherit;margin-left:4px;'
            skipBtn.onclick = () => { wrap.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input,button').forEach((el) => { el.disabled = true }); customAnswers[q.id] = ''; clearInput(); resolve() }
            wrap.appendChild(skipBtn)
          }
          clearInput()
          inputRef.current.appendChild(wrap)
          setTimeout(() => inp.focus(), 100)
          scrollBottom()
        }
      })

      // Evaluate skip logic after the question is answered
      const answer = customAnswers[q.id]
      if (answer != null && answer !== '') {
        const skipTarget = evaluateSkipLogic(q, answer)
        if (skipTarget === '_end') {
          break // End survey early
        }
        if (skipTarget) {
          const targetIdx = questions.findIndex(tq => tq.id === skipTarget)
          if (targetIdx > qi) {
            qi = targetIdx
            continue // Jump to target question
          }
        }
      }
      qi++
    }

    // MERGE, never replace. `state.current.customAnswers` already holds the
    // hidden-field values captured from the URL at mount, and any
    // conversation-position answers stepConversationExtras merged in before the
    // section dispatcher started. A wholesale assignment here dropped both from
    // the final payload — and only from the final one, since the debounced
    // partial saves had already shipped them, so the data appeared to be
    // captured right up until the response was completed.
    state.current.customAnswers = { ...state.current.customAnswers, ...customAnswers }
    savePartial()
    await advanceSection()
  }, [addMsg, advanceSection, buildClarify, checkDeflect, checkVerbose, clearInput, config, confirmMode, inputRef, savePartial, scrollBottom, scrollInputBottom, shouldClarify, showLikertFollowUpInput, showTyping, showTypingDuring, state, tFollowUp, tQuestion, tRatingLabel, tTransition, tUI])

  // Run conversation-position extras (questions shown after Q4, before custom-Q phase)
  const stepConversationExtras = useCallback(async () => {
    const extras = (config.questions ?? []).filter(q => q.conversationPosition && q.enabled !== false && q.type !== 'hidden')
    if (extras.length === 0) {
      // Start the section dispatcher from the first section
      sectionIdx.current = 0
      const firstRunner = sectionRunners.current[sectionOrder[0]]
      if (firstRunner) { await firstRunner(); return }
      await stepDone(); return
    }

    const customAnswers: Record<string, string | string[]> = { ...state.current.customAnswers }

    for (const q of extras) {
      clearInput()

      // ── message — display only, no response expected ─────────
      if (q.type === 'message') {
        const tPrompt = tQuestion(q.id, 'prompt', q.prompt) as string
        await showTyping(typingDur(tPrompt))
        addMsg('bot', tPrompt)
        await showTyping(400)
        continue
      }

      const tPrompt = tQuestion(q.id, 'prompt', q.prompt) as string
      await showTyping(typingDur(tPrompt))
      addMsg('bot', tPrompt)
      state.current.currentQuestion = q.prompt

      await new Promise<void>(resolve => {
        if (!inputRef.current) { resolve(); return }

        if (q.type === 'open') {
          const wrap = document.createElement('div')
          wrap.className = 'flex flex-col gap-2 mt-1.5'
          const row = document.createElement('div')
          row.className = 'flex gap-2 items-end w-full'
          const ta = document.createElement('textarea'); ta.lang = activeLang.current
          ta.cols = 1
          ta.className = 'flex-1 min-w-0 resize-none text-base leading-relaxed rounded-2xl px-4 py-2.5'
          ta.rows = 1
          ta.placeholder = tUI('sharePlaceholder', 'Share your thoughts...')
          ta.style.cssText = 'background:' + C.inputBg + ';border:1.5px solid ' + config.theme.primaryColor + '28;color:' + C.text + ';outline:none;font-family:inherit;max-height:110px;transition:border-color 0.2s;'
          ta.onfocus = () => { ta.style.borderColor = config.theme.primaryColor }
          ta.onblur  = () => { ta.style.borderColor = `${config.theme.primaryColor}28` }
          ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 110) + 'px' }
          const sendBtn = document.createElement('button')
          sendBtn.textContent = '→'
          sendBtn.className = 'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-base transition-all'
          sendBtn.style.cssText = 'background:' + C.disabledBg + ';color:' + C.textMute + ';border:none;cursor:pointer;font-family:inherit;'
          ta.oninput = () => {
            ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 110) + 'px'
            sendBtn.style.background = ta.value.trim() ? config.theme.primaryColor : C.disabledBg
            sendBtn.style.color      = ta.value.trim() ? '#fff' : C.textMute
          }
          ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click() } }
          sendBtn.onclick = () => {
            const v = ta.value.trim()
            if (checkVerbose(v, ta)) return
            if (!v && q.required) return
            wrap.querySelectorAll<HTMLTextAreaElement | HTMLButtonElement>('textarea,button').forEach((el) => { el.disabled = true })
            if (v) addMsg('user', v)
            customAnswers[q.id] = v
            clearInput(); resolve()
          }
          row.append(ta, sendBtn)
          wrap.appendChild(row)
          if (!q.required) {
            const skipBtn = document.createElement('button')
            skipBtn.textContent = tUI('skip', 'Skip')
            skipBtn.className = 'rounded-full text-sm font-medium px-4 py-2 transition-all self-start'
            skipBtn.style.cssText = 'background:transparent;border:1.5px solid ' + C.textMute + ';color:' + C.textMid + ';cursor:pointer;font-family:inherit;'
            skipBtn.onmouseenter = () => { skipBtn.style.borderColor = C.text; skipBtn.style.color = C.text }
            skipBtn.onmouseleave = () => { skipBtn.style.borderColor = C.textMute; skipBtn.style.color = C.textMid }
            skipBtn.onclick = () => { wrap.querySelectorAll<HTMLButtonElement | HTMLTextAreaElement>('button,textarea').forEach((el) => { el.disabled = true }); customAnswers[q.id] = ''; clearInput(); resolve() }
            wrap.appendChild(skipBtn)
          }
          clearInput()
          inputRef.current.appendChild(wrap)
          setTimeout(() => ta.focus(), 100)
          scrollBottom()

        } else if (q.type === 'radio') {
          const opts = tQuestion(q.id, 'options', q.options ?? []) as string[]
          const col = document.createElement('div')
          col.className = 'flex flex-col gap-1.5 mt-1.5'
          opts.forEach(opt => {
            const btn = document.createElement('button')
            btn.className = 'text-left px-4 py-2.5 rounded-xl text-sm font-medium transition-all'
            btn.style.cssText = 'background:' + C.btnBg + ';border:1.5px solid ' + C.inputBdr + ';color:' + C.textMid + ';cursor:pointer;font-family:inherit;'
            btn.textContent = opt
            btn.onmouseenter = () => { btn.style.borderColor = config.theme.primaryColor; btn.style.background = C.btnHoverBg }
            btn.onmouseleave = () => { btn.style.borderColor = C.inputBdr; btn.style.background = C.btnBg }
            btn.onclick = () => {
              col.querySelectorAll('button').forEach((b) => { b.disabled = true })
              btn.style.borderColor = config.theme.primaryColor; btn.style.background = config.theme.primaryColor + '20'
              addMsg('user', opt); customAnswers[q.id] = opt; clearInput(); resolve()
            }
            col.appendChild(btn)
          })
          clearInput()
          inputRef.current.appendChild(col)
          scrollBottom()

        } else if (q.type === 'checkbox') {
          const opts = tQuestion(q.id, 'options', q.options ?? []) as string[]
          const selected = new Set<string>()
          const wrap = document.createElement('div')
          wrap.className = 'flex flex-col gap-1.5 mt-1.5'
          const optScroll = document.createElement('div')
          optScroll.className = 'flex flex-col gap-1.5'
          optScroll.style.cssText = 'max-height:40vh;overflow-y:auto;'
          opts.forEach(opt => {
            const btn = document.createElement('button')
            btn.className = 'text-left px-4 py-2.5 rounded-xl text-sm font-medium transition-all flex items-center gap-2.5'
            btn.style.cssText = 'background:' + C.btnBg + ';border:1.5px solid ' + C.inputBdr + ';color:' + C.textMid + ';cursor:pointer;font-family:inherit;'
            const icon = document.createElement('span')
            icon.className = 'flex-shrink-0 w-5 h-5 rounded flex items-center justify-center text-xs font-bold'
            icon.style.cssText = 'background:' + C.inputBdr + ';color:' + C.textMute + ';'
            icon.textContent = '✕'
            const label = document.createElement('span')
            label.textContent = opt
            btn.append(icon, label)
            btn.onclick = () => {
              if (selected.has(opt)) {
                selected.delete(opt); btn.style.borderColor = C.inputBdr; btn.style.background = C.btnBg
                icon.style.background = C.inputBdr; icon.style.color = C.textMute; icon.textContent = '✕'
              } else {
                selected.add(opt); btn.style.borderColor = config.theme.primaryColor; btn.style.background = config.theme.primaryColor + '20'
                icon.style.background = '#22c55e'; icon.style.color = '#fff'; icon.textContent = '✓'
              }
              doneBtn.textContent = selected.size > 0 ? tUI('done', 'Done') : q.required ? tUI('selectAtLeastOne', 'Select at least one') : tUI('done', 'Done')
              doneBtn.style.background = selected.size > 0 ? 'transparent' : C.disabledBg
              doneBtn.style.color      = selected.size > 0 ? C.text : C.textMute
              doneBtn.style.borderColor = selected.size > 0 ? C.text : 'transparent'
              doneBtn.style.display    = selected.size > 0 ? 'block' : q.required ? 'block' : 'none'
            }
            optScroll.appendChild(btn)
          })
          wrap.appendChild(optScroll)
          const btnRow = document.createElement('div')
          btnRow.className = 'flex items-center gap-3 pt-2'
          const doneBtn = document.createElement('button')
          doneBtn.textContent = q.required ? tUI('selectAtLeastOne', 'Select at least one') : tUI('done', 'Done')
          doneBtn.className = 'px-4 py-2 rounded-xl text-sm font-semibold transition-all'
          doneBtn.style.cssText = 'background:' + C.disabledBg + ';color:' + C.textMute + ';border:2px solid transparent;cursor:pointer;font-family:inherit;display:' + (q.required ? 'block' : 'none') + ';'
          doneBtn.onclick = () => {
            if (selected.size === 0 && q.required) return
            wrap.querySelectorAll('button').forEach((b) => { b.disabled = true })
            const arr = Array.from(selected)
            if (arr.length > 0) addMsg('user', arr.join(', '))
            customAnswers[q.id] = arr; clearInput(); resolve()
          }
          btnRow.appendChild(doneBtn)
          if (!q.required) {
            const skipBtn = document.createElement('button')
            skipBtn.textContent = tUI('skip', 'Skip')
            skipBtn.className = 'rounded-full text-sm font-medium px-4 py-2 transition-all'
            skipBtn.style.cssText = 'background:transparent;border:1.5px solid ' + C.textMute + ';color:' + C.textMid + ';cursor:pointer;font-family:inherit;'
            skipBtn.onclick = () => {
              wrap.querySelectorAll('button').forEach((b) => { b.disabled = true })
              customAnswers[q.id] = []; clearInput(); resolve()
            }
            btnRow.appendChild(skipBtn)
          }
          wrap.appendChild(btnRow)
          clearInput()
          inputRef.current.appendChild(wrap)
          scrollBottom()
        } else {
          resolve()
        }
      })
    }

    state.current.customAnswers = { ...state.current.customAnswers, ...customAnswers }
    savePartial()
    // Start the section dispatcher
    sectionIdx.current = 0
    const firstRunner = sectionRunners.current[sectionOrder[0]]
    if (firstRunner) await firstRunner()
    else await stepDone()
  }, [addMsg, checkVerbose, clearInput, config, inputRef, savePartial, scrollBottom, sectionOrder, showTyping, state, stepDone, tQuestion, tUI])

  /* eslint-disable react-hooks/refs --
   * The latest-value ref idiom: imperative DOM handlers created inside one
   * callback have to call the CURRENT version of another, so the assignment has
   * to happen during render. Pre-existing throughout this file, and unmasked
   * (not introduced) by the 2026-08-18 reorder — see the note above the lazy
   * initialisation block.
   */
  const stepConversationExtrasRef = useRef(stepConversationExtras)
  stepConversationExtrasRef.current = stepConversationExtras

  // Register section runners for the section ordering dispatcher
  sectionRunners.current = {
    customQuestions: stepCustomQuestions,
    psychographics: stepPsychoIntro,
    demographics: stepDemographics,
    contact: stepContactInfo,
    _done: stepDone,
  }
  /* eslint-enable react-hooks/refs */

  // -- Input Renderers ---------------------------------------

  const showTextInput = useCallback((qKey: 'q3' | 'q4') => {
    if (!inputRef.current) return
    const wrap = document.createElement('div')
    wrap.className = 'flex gap-2 items-end w-full mt-1.5'

    const ta = document.createElement('textarea'); ta.lang = activeLang.current
    ta.cols = 1
    ta.className = 'flex-1 min-w-0 resize-none text-base leading-relaxed rounded-2xl px-4 py-2.5'
    ta.rows = 1
    ta.placeholder = tUI('sharePlaceholder', 'Share your thoughts...')
    ta.style.cssText = 'background:' + C.inputBg + ';border:1.5px solid ' + config.theme.primaryColor + '28;color:' + C.text + ';outline:none;font-family:inherit;max-height:110px;transition:border-color 0.2s;'
    ta.onfocus  = () => { ta.style.borderColor = config.theme.primaryColor }
    ta.onblur   = () => { ta.style.borderColor = `${config.theme.primaryColor}28` }
    ta.oninput  = () => {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 110) + 'px'
      sendBtn.disabled = ta.value.trim().length === 0
    }
    ta.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sendBtn.disabled) sendBtn.click() }
    }

    const sendBtn = document.createElement('button')
    sendBtn.textContent = '→'
    sendBtn.disabled = true
    sendBtn.className = 'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-base transition-all'
    sendBtn.style.cssText = 'background:' + C.disabledBg + ';color:' + C.textMute + ';border:none;cursor:default;'
    ta.addEventListener('input', () => {
      const hasText = ta.value.trim().length > 0
      sendBtn.style.background = hasText ? config.theme.primaryColor : C.disabledBg
      sendBtn.style.color      = hasText ? '#fff' : C.textMute
      sendBtn.style.cursor     = hasText ? 'pointer' : 'default'
    })
    sendBtn.onclick = () => {
      const val = ta.value.trim(); if (!val) return
      if (checkVerbose(val, ta)) return
      wrap.querySelectorAll<HTMLTextAreaElement | HTMLButtonElement>('textarea,button').forEach((el) => { el.disabled = true })
      addMsg('user', val)
      // Store immediately and save — belt-and-suspenders, don't rely solely on handleOpenEnded
      state.current.answers[qKey] = val
      savePartialRef.current()
      void handleOpenEndedRef.current(qKey, val)
    }

    wrap.append(ta, sendBtn)
    inputRef.current.appendChild(wrap)
    setTimeout(() => ta.focus(), 100)
    scrollBottom()
  }, [addMsg, checkVerbose, config, inputRef, scrollBottom, tUI])

  const showClarifyInput = useCallback((qKey: 'q3' | 'q4', originalVal: string, depthSoFar: number = 1) => {
    if (!inputRef.current) return
    const wrap = document.createElement('div')
    wrap.className = 'flex gap-2 items-end w-full mt-1.5'

    const ta = document.createElement('textarea'); ta.lang = activeLang.current
    ta.cols = 1
    ta.className = 'flex-1 min-w-0 resize-none text-base leading-relaxed rounded-2xl px-4 py-2.5'
    ta.rows = 1
    ta.placeholder = tUI('clarifyPlaceholder', 'Feel free to add a bit more...')
    ta.style.cssText = 'background:' + C.inputBg + ';border:1.5px solid ' + config.theme.primaryColor + '28;color:' + C.text + ';outline:none;font-family:inherit;max-height:110px;transition:border-color 0.2s;'
    ta.onfocus  = () => { ta.style.borderColor = config.theme.primaryColor }
    ta.onblur   = () => { ta.style.borderColor = `${config.theme.primaryColor}28` }
    ta.oninput  = () => {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 110) + 'px'
      sendBtn.disabled = ta.value.trim().length === 0
    }
    ta.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); if (!sendBtn.disabled) sendBtn.click() }
    }

    const sendBtn = document.createElement('button')
    sendBtn.textContent = '→'
    sendBtn.disabled = true
    sendBtn.className = 'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-base transition-all'
    sendBtn.style.cssText = 'background:' + C.disabledBg + ';color:' + C.textMute + ';border:none;cursor:default;'
    ta.addEventListener('input', () => {
      const hasText = ta.value.trim().length > 0
      sendBtn.style.background = hasText ? config.theme.primaryColor : C.disabledBg
      sendBtn.style.color      = hasText ? '#fff' : C.textMute
      sendBtn.style.cursor     = hasText ? 'pointer' : 'default'
    })
    sendBtn.onclick = async () => {
      const val = ta.value.trim(); if (!val) return
      if (checkVerbose(val, ta)) return
      wrap.querySelectorAll<HTMLTextAreaElement | HTMLButtonElement>('textarea,button').forEach((el) => { el.disabled = true })
      addMsg('user', val)
      const accumulated = isDecline(val) ? originalVal : originalVal + ' [+ ' + val + ']'
      if (!isDecline(val)) state.current.answers[qKey] = accumulated
      savePartialRef.current()
      clearInput()
      // AI deflection: detect questions/off-topic and respond contextually
      const deflected = !isDecline(val) && await checkDeflect(val, state.current.currentQuestion || '')
      // Per-prompt clarify depth: probe again only while the answer stays vague and depth allows.
      // depthSoFar counts clarifiers already fired on THIS prompt; default depth 1 = single-shot (unchanged).
      const maxDepth = Math.max(1, qKey === 'q3' ? (config.q3ClarifyDepth ?? 1) : (config.q4ClarifyDepth ?? 1))
      if (!deflected && !isDecline(val) && depthSoFar < maxDepth &&
          state.current.clarifyCount < (config.maxClarifierCount || 5) && shouldClarify(val)) {
        const cq = await showTypingDuring(buildClarify(accumulated, qKey), 800)
        if (cq) {
          state.current.clarifyCount++
          addMsg('bot', cq, true)
          showClarifyInputRef.current(qKey, accumulated, depthSoFar + 1)
          return
        }
      }
      await progressFlowRef.current(qKey, deflected || undefined)
    }

    wrap.append(ta, sendBtn)
    inputRef.current.appendChild(wrap)
    setTimeout(() => ta.focus(), 100)
    scrollBottom()
  }, [addMsg, buildClarify, checkDeflect, checkVerbose, clearInput, config, inputRef, scrollBottom, shouldClarify, showTypingDuring, state, tUI])
  // Ref so the recursive (depth > 1) re-probe always calls the latest version
  const showClarifyInputRef = useRef(showClarifyInput)
  // eslint-disable-next-line react-hooks/refs, react-hooks/immutability -- latest-value ref, assigned during render by design (see the note above sectionRunners)
  showClarifyInputRef.current = showClarifyInput



  // -- Likert adaptive follow-up input (text, then calls next()) --



    // -- Optional text input (with Skip button) ------------------
  const showTextInputOptional = useCallback((qKey: 'q3' | 'q4') => {
    if (!inputRef.current) return
    const wrap = document.createElement('div')
    wrap.className = 'flex flex-col gap-2 mt-1.5'

    const row = document.createElement('div')
    row.className = 'flex gap-2 items-end w-full'

    const ta = document.createElement('textarea'); ta.lang = activeLang.current
    ta.cols = 1
    ta.className = 'flex-1 min-w-0 resize-none text-base leading-relaxed rounded-2xl px-4 py-2.5'
    ta.rows = 1
    ta.placeholder = tUI('sharePlaceholder', 'Share your thoughts...')
    ta.style.cssText = 'background:' + C.inputBg + ';border:1.5px solid ' + config.theme.primaryColor + '28;color:' + C.text + ';outline:none;font-family:inherit;max-height:110px;transition:border-color 0.2s;'
    ta.onfocus  = () => { ta.style.borderColor = config.theme.primaryColor }
    ta.onblur   = () => { ta.style.borderColor = `${config.theme.primaryColor}28` }
    ta.oninput  = () => {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 110) + 'px'
      sendBtn.style.background = ta.value.trim() ? config.theme.primaryColor : C.disabledBg
      sendBtn.style.color      = ta.value.trim() ? '#fff' : C.textMute
    }
    ta.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click() }
    }

    const sendBtn = document.createElement('button')
    sendBtn.textContent = '→'
    sendBtn.className = 'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-base transition-all'
    sendBtn.style.cssText = 'background:' + C.disabledBg + ';color:' + C.textMute + ';border:none;cursor:pointer;font-family:inherit;'
    sendBtn.onclick = () => {
      const val = ta.value.trim()
      if (checkVerbose(val, ta)) return
      wrap.querySelectorAll<HTMLTextAreaElement | HTMLButtonElement>('textarea,button').forEach((el) => { el.disabled = true })
      if (val) {
        addMsg('user', val)
        state.current.answers[qKey] = val
        savePartialRef.current()
        void handleOpenEndedRef.current(qKey, val)
      } else {
        addMsg('user', 'Skip')
        state.current.answers[qKey] = ''
        clearInput()
        void progressFlowRef.current(qKey)
      }
    }

    const skipBtn = document.createElement('button')
    skipBtn.textContent = tUI('skip', 'Skip')
    skipBtn.className = 'rounded-full text-sm font-medium px-4 py-2 transition-all self-start'
    skipBtn.style.cssText = 'background:transparent;border:1.5px solid ' + C.textMute + ';color:' + C.textMid + ';cursor:pointer;font-family:inherit;'
    skipBtn.onclick = () => {
      wrap.querySelectorAll<HTMLTextAreaElement | HTMLButtonElement>('textarea,button').forEach((el) => { el.disabled = true })
      addMsg('user', 'Skip')
      state.current.answers[qKey] = ''
      clearInput()
      void progressFlowRef.current(qKey)
    }

    row.append(ta, sendBtn)
    wrap.append(row, skipBtn)
    inputRef.current.appendChild(wrap)
    setTimeout(() => ta.focus(), 100)
    scrollBottom()
  }, [addMsg, checkVerbose, clearInput, config, inputRef, scrollBottom, state, tUI])

  const progressFlow = useCallback(async (qKey: 'q3' | 'q4', skipAck?: boolean) => {
    // Also check flag set by deflection in clarify/likert handlers
    if (state.current.skipNextAck) { skipAck = true; state.current.skipNextAck = false }
    const lastMsg = state.current.lastUserMsg || ''
    if (qKey === 'q3') {
      // Skip Q4 if disabled
      if (config.q4Enabled === false) {
        if (!skipAck) { const ack = smartAck(lastMsg); await showTyping(typingDur(ack)); addMsg('bot', ack, true) }
        await stepConversationExtras()
        return
      }
      if (!skipAck) { const ack = smartAck(lastMsg); await showTyping(typingDur(ack)); addMsg('bot', ack, true) }
      const q4Text = t('q4', config.q4)
      await showTyping(typingDur(q4Text))
      addMsg('bot', q4Text)
      state.current.currentQuestion = config.q4
      // q4: optional by default, required if q4Required === true
      if (config.q4Required === true) {
        showTextInput('q4')
      } else {
        showTextInputOptional('q4')
      }
    } else {
      if (!skipAck && !isDecline(lastMsg)) {
        const ack = smartAck(lastMsg)
        await showTyping(typingDur(ack))
        addMsg('bot', ack, true)
      }
      await stepConversationExtras()
    }
  }, [addMsg, config, showTextInput, showTextInputOptional, showTyping, smartAck, stepConversationExtras, t])

  const handleOpenEnded = useCallback(async (qKey: 'q3' | 'q4', val: string) => {
    state.current.answers[qKey] = val
    state.current.questionsAsked[qKey] = state.current.currentQuestion
    savePartial()
    clearInput()
    // Smart deflection: if respondent asked a question, redirect and skip clarifier
    if (!isDecline(val) && await checkDeflect(val, state.current.currentQuestion || '')) {
      await progressFlow(qKey, true)
      return
    }
    // Only attempt clarification if enabled for this question (default: on)
    const clarifyEnabled = qKey === 'q3' ? config.q3Clarify !== false : config.q4Clarify !== false
    if (clarifyEnabled && state.current.clarifyCount < (config.maxClarifierCount || 5) && shouldClarify(val)) {
      const cq = await showTypingDuring(buildClarify(val, qKey), 800)
      if (cq) {
        state.current.clarifyCount++
        addMsg('bot', cq, true)
        showClarifyInput(qKey, val)
        return
      }
    }
    await progressFlow(qKey)
  }, [addMsg, buildClarify, checkDeflect, clearInput, config, progressFlow, savePartial, shouldClarify, showClarifyInput, showTypingDuring, state])

  // Refs so imperative DOM handlers always call the latest function versions
  /* eslint-disable react-hooks/refs, react-hooks/immutability -- latest-value refs, assigned during render by design (see the note above sectionRunners) */
  const handleOpenEndedRef = useRef(handleOpenEnded)
  handleOpenEndedRef.current = handleOpenEnded
  const progressFlowRef = useRef(progressFlow)
  progressFlowRef.current = progressFlow
  const savePartialRef = useRef(savePartial)
  savePartialRef.current = savePartial
  /* eslint-enable react-hooks/refs, react-hooks/immutability */


  const renderInput = useCallback(async (phase: string) => {
    if (phase !== 'start') return

    // Language selection — show before greeting if multiple languages enabled
    if (config.languages && config.languages.length > 1) {
      await showTyping(typingDur('Choose your language:'))
      addMsg('bot', 'Choose your language:')

      if (inputRef.current) {
        await new Promise<void>(resolve => {
          const wrap = document.createElement('div')
          wrap.className = 'flex flex-col gap-1.5 mt-1.5'

          const enabledLangs = SUPPORTED_LANGUAGES.filter((l) => config.languages!.includes(l.code))
          let selectedLang: string | null = null
          let confirmBtn: HTMLButtonElement | null = null
          const langBtns: HTMLButtonElement[] = []

          enabledLangs.forEach((lang) => {
            const btn = document.createElement('button')
            btn.className = 'text-left px-4 py-2.5 rounded-xl text-sm font-medium transition-all'
            btn.style.cssText = 'background:' + C.btnBg + ';border:1.5px solid ' + C.inputBdr + ';color:' + C.textMid + ';cursor:pointer;font-family:inherit;'
            btn.textContent = lang.nativeName + (lang.name !== lang.nativeName ? ' (' + lang.name + ')' : '')
            btn.onclick = () => {
              selectedLang = lang.code
              langBtns.forEach(b => { b.style.borderColor = C.inputBdr; b.style.background = C.btnBg })
              btn.style.borderColor = config.theme.primaryColor
              btn.style.background = config.theme.primaryColor + '20'
              if (confirmBtn) {
                confirmBtn.style.display = 'block'
                confirmBtn.textContent = lang.confirmLabel
                confirmBtn.style.background = config.theme.primaryColor
                confirmBtn.style.color = '#fff'
              }
            }
            langBtns.push(btn)
            wrap.appendChild(btn)
          })

          confirmBtn = document.createElement('button')
          confirmBtn.className = 'mt-1 rounded-full font-semibold text-sm py-2.5 px-6 self-start transition-all'
          confirmBtn.style.cssText = 'display:none;background:' + C.disabledBg + ';color:' + C.disabledTx + ';border:none;cursor:pointer;font-family:inherit;'
          confirmBtn.textContent = tUI('confirm', 'Confirm')
          confirmBtn.onclick = () => {
            if (!selectedLang) return
            activeLang.current = selectedLang
            // Set lang on containers so mobile browsers switch keyboard language
            if (chatRef.current) chatRef.current.lang = selectedLang
            if (inputRef.current) inputRef.current.lang = selectedLang
            // Also set on closest survey wrapper if available
            const surveyRoot = chatRef.current?.closest('[data-survey]') as HTMLElement | null
            if (surveyRoot) surveyRoot.lang = selectedLang
            const langObj = enabledLangs.find((l) => l.code === selectedLang)
            addMsg('user', langObj?.nativeName || selectedLang)
            wrap.querySelectorAll('button').forEach((b) => { b.disabled = true })
            clearInput()
            resolve()
          }
          wrap.appendChild(confirmBtn)

          inputRef.current!.appendChild(wrap)
          scrollBottom()
        })
      }
    }

    // Greeting -- single message on mobile to keep buttons visible above fold
    const greetingText = t('greeting', config.greeting)
    await showTyping(typingDur(greetingText))
    addMsg('bot', greetingText)

    // Ready prompt
    const readyDefault = config.readyPrompt || 'Are you ready to share your feedback?'
    const readyText = t('readyPrompt', readyDefault) !== readyDefault ? t('readyPrompt', readyDefault) : tUI('readyPrompt', readyDefault)
    await showTyping(typingDur(readyText))
    addMsg('bot', readyText)

    if (!inputRef.current) return
    const row = document.createElement('div')
    row.className = 'flex gap-2 flex-wrap mt-1.5'

    const yesDefault = config.readyYes || "Yes, let's go! 👍"
    const noDefault = config.readyNo || 'Not right now'
    const yesLabel = t('readyYes', yesDefault) !== yesDefault ? t('readyYes', yesDefault) : tUI('readyYes', yesDefault)
    const noLabel = t('readyNo', noDefault) !== noDefault ? t('readyNo', noDefault) : tUI('readyNo', noDefault)
    ;[[yesLabel, 'yes'], [noLabel, 'no']].forEach(([label, val]) => {
      const btn = document.createElement('button')
      btn.className = 'px-4 py-2.5 rounded-full text-sm font-medium transition-all'
      btn.style.cssText = 'background:' + C.btnBg + ';border:1.5px solid ' + C.btnBdr + ';color:' + C.textMid + ';cursor:pointer;font-family:inherit;'
      btn.textContent = label
      btn.onmouseenter = () => { btn.style.borderColor = config.theme.primaryColor; btn.style.background = config.theme.primaryColor + '18' }
      btn.onmouseleave = () => { btn.style.borderColor = C.btnBdr; btn.style.background = C.btnBg }
      btn.onclick = async () => {
        row.querySelectorAll('button').forEach((b) => { b.disabled = true })
        addMsg('user', label)
        if (val === 'no') {
          clearInput()
          const noThanks = tUI('thankYouAck', 'No problem at all -- thanks for your time! 😊')
          await showTyping(typingDur(noThanks))
          addMsg('bot', noThanks)
          return
        }

        // Helper: show adaptive Likert follow-up then call next()
        const showLikertFollowUp = async (
          followUp: LikertFollowUp | undefined,
          score: number,
          next: () => Promise<void>,
          storageKey?: 'q1' | 'q2',
          followUpKey?: string
        ) => {
          if (!followUp?.enabled) { await next(); return }
          const pr = followUp.mode === 'per-response'
            ? followUp.perResponse?.[score]
            : null
          const englishPrompt = pr ? pr.prompt : (followUp.sharedPrompt || '')
          if (!englishPrompt.trim()) { await next(); return }
          const prompt = followUpKey ? tFollowUp(followUpKey, score, followUp.sharedPrompt || '', followUp.perResponse) : englishPrompt
          clearInput()
          await showTyping(typingDur(prompt))
          addMsg('bot', prompt, true)
          state.current.currentQuestion = prompt
          showLikertFollowUpInput(next, storageKey)
        }

        // Jump straight to Q3 after opening flow is complete
        const stepQ3 = async () => {
          if (config.q3Enabled === false) {
            await progressFlowRef.current('q3')
            return
          }
          clearInput()
          const q3Text = t('q3', config.q3)
          await showTyping(typingDur(q3Text))
          addMsg('bot', q3Text)
          state.current.currentQuestion = config.q3
          if (config.q3Required === false) {
            showTextInputOptional('q3')
          } else {
            showTextInput('q3')
          }
        }

        // Parameterized experience rating — calls next() when done
        const doExperienceRating = async (next: () => Promise<void>) => {
          clearInput()
          const ratingText = t('ratingPrompt', config.ratingPrompt)
          await showTyping(typingDur(ratingText))
          addMsg('bot', ratingText)
          await showTyping(400)
          if (!inputRef.current) return
          const expWrap = document.createElement('div')
          expWrap.className = 'flex flex-col gap-1.5 mt-1.5'
          const ratingRow = document.createElement('div')
          ratingRow.className = 'flex gap-1 flex-wrap'
          let expSel: RatingOption | null = null
          let expConfirmBtn: HTMLButtonElement | null = null
          const expBtns: HTMLButtonElement[] = []
          const commitExp = async (r: RatingOption) => {
            expWrap.querySelectorAll('button').forEach((b) => { b.disabled = true })
            const selBtn = expBtns[config.ratingScale.indexOf(r)]
            if (selBtn) { selBtn.style.borderColor = config.theme.primaryColor; selBtn.style.background = config.theme.primaryColor + '20' }
            state.current.rating = r.score
            state.current.ratingLabel = r.label
            var maxScore = Math.max.apply(null, config.ratingScale.map(function(x) { return x.score }))
            var minScore = Math.min.apply(null, config.ratingScale.map(function(x) { return x.score }))
            var range = maxScore - minScore || 1
            var pct = (r.score - minScore) / range
            state.current.sentiment = pct >= 0.6 ? 'positive' : pct <= 0.4 ? 'negative' : 'neutral'
            savePartial()
            addMsg('user', r.emoji + ' ' + tRatingLabel(r.label))
            await showLikertFollowUp(config.experienceFollowUp, r.score, next, 'q2', 'experienceFollowUp')
          }
          config.ratingScale.forEach((r) => {
            const tLabel = tRatingLabel(r.label)
            const rb = document.createElement('button')
            rb.className = 'flex flex-col items-center gap-1 rounded-xl px-1 py-2 flex-1 min-w-0 transition-all'
            rb.style.cssText = 'background:' + C.btnBg + ';border:2px solid ' + C.inputBdr + ';cursor:pointer;font-family:inherit;'
            rb.innerHTML = DOMPurify.sanitize('<span style="font-size:1.25rem">' + r.emoji + '</span><span style="font-size:0.5rem;font-weight:600;color:' + C.textMute + ';text-align:center;line-height:1.2;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word">' + tLabel + '</span>')
            rb.onmouseenter = () => { if (!confirmMode || expSel !== r) { rb.style.borderColor = config.theme.primaryColor; rb.style.background = C.btnHoverBg } }
            rb.onmouseleave = () => { if (!confirmMode || expSel !== r) { rb.style.borderColor = C.inputBdr; rb.style.background = C.btnBg } }
            rb.onclick = async () => {
              if (confirmMode) {
                expSel = r
                expBtns.forEach(b => { b.style.borderColor = C.inputBdr; b.style.background = C.btnBg })
                rb.style.borderColor = config.theme.primaryColor; rb.style.background = config.theme.primaryColor + '20'
                if (expConfirmBtn) { expConfirmBtn.style.display = 'block'; expConfirmBtn.style.background = config.theme.primaryColor; expConfirmBtn.style.color = '#fff' }
              } else {
                await commitExp(r)
              }
            }
            expBtns.push(rb)
            ratingRow.appendChild(rb)
          })
          expWrap.appendChild(ratingRow)
          if (confirmMode) {
            expConfirmBtn = document.createElement('button')
            expConfirmBtn.textContent = tUI('confirm', 'Confirm')
            expConfirmBtn.className = 'mt-1 px-4 py-2 rounded-xl text-sm font-semibold transition-all self-end'
            expConfirmBtn.style.cssText = 'display:none;background:' + C.disabledBg + ';color:' + C.disabledTx + ';border:none;cursor:pointer;font-family:inherit;'
            expConfirmBtn.onclick = async () => { if (expSel) await commitExp(expSel) }
            expWrap.appendChild(expConfirmBtn)
          }
          inputRef.current.appendChild(expWrap)
          scrollBottom()
          if (confirmMode) scrollInputBottom()
        }

        // Parameterized NPS — calls next() when done
        const doNPS = async (next: () => Promise<void>) => {
          clearInput()
          const npsPrompt = config.npsPrompt || 'How likely are you to recommend us to a friend or someone you know?'
          const npsText = t('npsPrompt', npsPrompt)
          await showTyping(typingDur(npsText))
          addMsg('bot', npsText)
          await showTyping(400)
          if (!inputRef.current) return
          const stars = [
            { stars: '😞',  label: '1 - No',         score: 1 },
            { stars: '😕',  label: '2 - Unlikely',   score: 2 },
            { stars: '😐',  label: '3 - Maybe',      score: 3 },
            { stars: '😊',  label: '4 - Likely',     score: 4 },
            { stars: '🤩',  label: '5 - Definitely!', score: 5 },
          ]
          const npsWrap = document.createElement('div')
          npsWrap.className = 'flex flex-col gap-1.5 mt-1.5'
          const npsRow = document.createElement('div')
          npsRow.className = 'flex gap-1 flex-wrap'
          let npsSel: typeof stars[0] | null = null
          let npsConfirmBtn: HTMLButtonElement | null = null
          const npsBtns: HTMLButtonElement[] = []
          const commitNps = async (s: typeof stars[0]) => {
            npsWrap.querySelectorAll('button').forEach((b) => { b.disabled = true })
            const selBtn = npsBtns[stars.indexOf(s)]
            if (selBtn) { selBtn.style.borderColor = config.theme.primaryColor; selBtn.style.background = config.theme.primaryColor + '20' }
            state.current.npsScore = s.score
            state.current.npsLabel = s.label
            state.current.sentiment = s.score >= 4 ? 'positive' : s.score >= 3 ? 'neutral' : 'negative'
            savePartial()
            addMsg('user', s.stars + ' ' + tNpsLabel(s.label))
            await showLikertFollowUp(config.npsFollowUp, s.score, next, 'q1', 'npsFollowUp')
          }
          stars.forEach(s => {
            const tLabel = tNpsLabel(s.label)
            const sb = document.createElement('button')
            sb.className = 'flex flex-col items-center gap-1 rounded-xl px-1 py-2 flex-1 min-w-0 transition-all'
            sb.style.cssText = 'background:' + C.btnBg + ';border:2px solid ' + C.inputBdr + ';cursor:pointer;font-family:inherit;'
            sb.innerHTML = DOMPurify.sanitize('<span style="font-size:0.8125rem">' + s.stars + '</span><span style="font-size:0.5rem;font-weight:600;color:' + C.textMute + ';text-align:center;line-height:1.2;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word">' + tLabel + '</span>')
            sb.onmouseenter = () => { if (!confirmMode || npsSel !== s) { sb.style.borderColor = config.theme.primaryColor; sb.style.background = C.btnHoverBg } }
            sb.onmouseleave = () => { if (!confirmMode || npsSel !== s) { sb.style.borderColor = C.inputBdr; sb.style.background = C.btnBg } }
            sb.onclick = async () => {
              if (confirmMode) {
                npsSel = s
                npsBtns.forEach(b => { b.style.borderColor = C.inputBdr; b.style.background = C.btnBg })
                sb.style.borderColor = config.theme.primaryColor; sb.style.background = config.theme.primaryColor + '20'
                if (npsConfirmBtn) { npsConfirmBtn.style.display = 'block'; npsConfirmBtn.style.background = config.theme.primaryColor; npsConfirmBtn.style.color = '#fff' }
              } else {
                await commitNps(s)
              }
            }
            npsBtns.push(sb)
            npsRow.appendChild(sb)
          })
          npsWrap.appendChild(npsRow)
          if (confirmMode) {
            npsConfirmBtn = document.createElement('button')
            npsConfirmBtn.textContent = tUI('confirm', 'Confirm')
            npsConfirmBtn.className = 'mt-1 px-4 py-2 rounded-xl text-sm font-semibold transition-all self-end'
            npsConfirmBtn.style.cssText = 'display:none;background:' + C.disabledBg + ';color:' + C.disabledTx + ';border:none;cursor:pointer;font-family:inherit;'
            npsConfirmBtn.onclick = async () => { if (npsSel) await commitNps(npsSel) }
            npsWrap.appendChild(npsConfirmBtn)
          }
          inputRef.current.appendChild(npsWrap)
          scrollBottom()
          if (confirmMode) scrollInputBottom()
        }

        // Opening open-end — calls next() when done
        const doOpeningOpenEnd = async (item: OpeningFlowItem, next: () => Promise<void>) => {
          clearInput()
          const rawPrompt = item.prompt || 'In your own words, tell us about your experience.'
          const prompt = tOpeningFlow(item.id, rawPrompt)
          await showTyping(typingDur(prompt))
          addMsg('bot', prompt)
          if (!inputRef.current) return
          const oeWrap = document.createElement('div')
          oeWrap.className = 'flex flex-col gap-2 mt-1.5'
          const oeRow = document.createElement('div')
          oeRow.className = 'flex gap-2 items-end w-full'
          const ta = document.createElement('textarea'); ta.lang = activeLang.current
          ta.cols = 1
          ta.className = 'flex-1 min-w-0 resize-none text-base leading-relaxed rounded-2xl px-4 py-2.5'
          ta.rows = 1
          ta.placeholder = tUI('sharePlaceholder', 'Share your thoughts...')
          ta.style.cssText = 'background:' + C.inputBg + ';border:1.5px solid ' + config.theme.primaryColor + '28;color:' + C.text + ';outline:none;font-family:inherit;max-height:110px;transition:border-color 0.2s;'
          ta.onfocus = () => { ta.style.borderColor = config.theme.primaryColor }
          ta.onblur  = () => { ta.style.borderColor = `${config.theme.primaryColor}28` }
          const oeSendBtn = document.createElement('button')
          oeSendBtn.textContent = '→'
          oeSendBtn.className = 'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-base transition-all'
          oeSendBtn.style.cssText = 'background:' + C.disabledBg + ';color:' + C.textMute + ';border:none;cursor:pointer;font-family:inherit;'
          ta.oninput = () => {
            ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 110) + 'px'
            oeSendBtn.style.background = ta.value.trim() ? config.theme.primaryColor : C.disabledBg
            oeSendBtn.style.color      = ta.value.trim() ? '#fff' : C.textMute
          }
          ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); oeSendBtn.click() } }
          oeSendBtn.onclick = async () => {
            const v = ta.value.trim()
            if (checkVerbose(v, ta)) return
            oeWrap.querySelectorAll<HTMLTextAreaElement | HTMLButtonElement>('textarea,button').forEach((el) => { el.disabled = true })
            if (v) { addMsg('user', v); state.current.openingAnswers[item.id] = v }
            savePartial()
            clearInput()
            await next()
          }
          oeRow.append(ta, oeSendBtn)
          oeWrap.appendChild(oeRow)
          const oeSkipBtn = document.createElement('button')
          oeSkipBtn.textContent = tUI('skip', 'Skip')
          oeSkipBtn.className = 'rounded-full text-sm font-medium px-4 py-2 transition-all self-start'
          oeSkipBtn.style.cssText = 'background:transparent;border:1.5px solid ' + C.textMute + ';color:' + C.textMid + ';cursor:pointer;font-family:inherit;'
          oeSkipBtn.onclick = async () => {
            oeWrap.querySelectorAll<HTMLTextAreaElement | HTMLButtonElement>('textarea,button').forEach((el) => { el.disabled = true })
            clearInput(); await next()
          }
          oeWrap.appendChild(oeSkipBtn)
          clearInput()
          inputRef.current.appendChild(oeWrap)
          setTimeout(() => ta.focus(), 100)
          scrollBottom()
        }

        // Build opening flow — respects config.openingFlow; falls back to legacy flags
        const openingFlow: OpeningFlowItem[] | undefined = config.openingFlow
        if (!openingFlow || openingFlow.length === 0) {
          const npsEnabledLegacy        = config.npsEnabled !== false
          const experienceEnabledLegacy = config.experienceEnabled !== false
          if (!npsEnabledLegacy && !experienceEnabledLegacy) { await stepQ3(); return }
          if (!npsEnabledLegacy) { await doExperienceRating(stepQ3); return }
          if (!experienceEnabledLegacy) { await doNPS(stepQ3); return }
          await doNPS(async () => doExperienceRating(stepQ3))
          return
        }

        // Build chain right-to-left so each item wraps its successor
        let openingNext: () => Promise<void> = stepQ3
        for (let oi = openingFlow.length - 1; oi >= 0; oi--) {
          const item = openingFlow[oi]
          const capturedNext = openingNext
          if (item.type === 'nps') {
            openingNext = async () => doNPS(capturedNext)
          } else if (item.type === 'experience_rating') {
            openingNext = async () => doExperienceRating(capturedNext)
          } else if (item.type === 'open_end') {
            const capturedItem = item
            openingNext = async () => doOpeningOpenEnd(capturedItem, capturedNext)
          }
        }
        await openingNext()
      }
      row.appendChild(btn)
    })

    inputRef.current.appendChild(row)
    scrollBottom()
  }, [addMsg, chatRef, checkVerbose, clearInput, config, confirmMode, inputRef, savePartial, scrollBottom, scrollInputBottom, showLikertFollowUpInput, showTextInput, showTextInputOptional, showTyping, state, t, tFollowUp, tNpsLabel, tOpeningFlow, tRatingLabel, tUI])

  // eslint-disable-next-line react-hooks/refs -- `deviceBlocked` is resolved once during the same render-phase init block above and is part of this hook's public API; the caller gates the whole widget on it before any effect runs.
  return { renderInput, deviceBlocked: deviceBlocked.current }
}


