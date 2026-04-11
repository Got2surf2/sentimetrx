'use client'

import { useCallback, useRef } from 'react'
import type { Study, StudyConfig, Sentiment, SurveyPayload, OpeningFlowItem, SectionKey } from '@/lib/types'
import { US_STATES, validateContactField, BUILTIN_UI_TRANSLATIONS } from '@/lib/types'

// ============================================================
// useSurveyEngine
// Contains ALL conversation logic -- nothing in this hook ever
// appears in page source. It runs in the browser but the
// config that drives it comes from the server-rendered page.
// ============================================================

interface Props {
  study: Study
  orgName?: string
  chatRef:    React.RefObject<HTMLDivElement>
  inputRef:   React.RefObject<HTMLDivElement>
  scrollBottom: () => void
  isLightBg?: boolean
  reducedMotion?: boolean
}

interface State {
  rating:          number | null
  ratingLabel:     string | null
  sentiment:       Sentiment | null
  npsScore:        number | null
  npsLabel:        string | null
  answers:         { q1: string; q2: string; q3: string; q4: string }
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
}

export function useSurveyEngine({ study, orgName = '', chatRef, inputRef, scrollBottom, isLightBg = false, reducedMotion = false }: Props) {
  const config = study.config as StudyConfig
  const confirmMode = config.confirmBeforeRecord === true
  // Adaptive colors — white text on dark bg, dark text on light bg
  const C = {
    text:       isLightBg ? 'rgba(0,0,0,0.85)' : 'rgba(255,255,255,0.9)',
    textMid:    isLightBg ? 'rgba(0,0,0,0.65)' : 'rgba(255,255,255,0.82)',
    textMute:   isLightBg ? 'rgba(0,0,0,0.4)'  : 'rgba(255,255,255,0.4)',
    textFaint:  isLightBg ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.3)',
    bubbleBg:   isLightBg ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.08)',
    bubbleBdr:  isLightBg ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.07)',
    inputBg:    isLightBg ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.06)',
    inputBdr:   isLightBg ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.12)',
    btnBg:      isLightBg ? 'rgba(0,0,0,0.07)' : 'rgba(255,255,255,0.10)',
    btnBdr:     isLightBg ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.18)',
    btnHoverBg: isLightBg ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.18)',
    btnHoverBdr: isLightBg ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.28)',
    disabledBg: isLightBg ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.15)',
    disabledTx: isLightBg ? 'rgba(0,0,0,0.3)'  : 'rgba(255,255,255,0.4)',
  }
  const state  = useRef<State>({
    rating: null, ratingLabel: null, sentiment: null,
    npsScore: null, npsLabel: null,
    answers: { q1: '', q2: '', q3: '', q4: '' },
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
  })

  // ── Session ID — persists for this browser tab, new on new visit ──────────
  const sessionId = useRef<string>('')
  if (!sessionId.current) {
    try {
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
      if (rid) recipientGuid.current = rid
      // Populate hidden field values from URL params
      const hiddenQuestions = (config.questions ?? []).filter(q => q.type === 'hidden')
      for (const q of hiddenQuestions) {
        const key = q.paramKey || (q.prompt || '').toLowerCase().replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_-]/g, '')
        if (!key) continue
        const val = params.get(key)
        if (val) {
          state.current.customAnswers[q.id] = val
        }
      }
    } catch {}
  }

  // ── Check device limit — returns true if already completed ────────────────
  const deviceBlocked = useRef<boolean>(false)
  if (config.allowMultipleResponses === false) {
    try {
      var completedKey = 'sentimetrx_completed_' + study.guid
      if (localStorage.getItem(completedKey)) deviceBlocked.current = true
    } catch {}
  }

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
      av.style.background = config.theme.botAvatarGradient
      av.textContent = study.bot_emoji
      const bub = document.createElement('div')
      bub.className = 'px-3.5 py-2.5 rounded-2xl rounded-bl-sm text-sm leading-relaxed'
      bub.style.cssText = 'background:' + C.bubbleBg + ';color:' + C.text + ';border:1px solid ' + C.bubbleBdr + ';'
      // Use innerHTML if text contains links, textContent otherwise (safer)
      if (text.includes('<a ')) {
        bub.innerHTML = text
        // Style links to match theme
        bub.querySelectorAll('a').forEach(a => {
          a.style.color = config.theme.accentColor || config.theme.primaryColor
          a.style.textDecoration = 'underline'
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
      bub.style.cssText = `background:${config.theme.primaryColor};color:#fff;`
      bub.textContent = text
      wrap.appendChild(bub)
      state.current.lastUserMsg = text
    }

    chatRef.current.appendChild(wrap)
    scrollBottom()
  }, [chatRef, config, study.bot_emoji, scrollBottom])

  const typingSpeed = config.typingSpeed ?? 1.0
  const showTyping = useCallback((dur = 1000): Promise<void> => {
    dur = Math.round(dur * typingSpeed)
    return new Promise(res => {
      if (!chatRef.current) { res(); return }
      // Reduced motion: skip the animation, use a minimal pause for readability
      if (reducedMotion) { setTimeout(res, Math.min(dur, 200)); return }
      const t = document.createElement('div')
      t.id = 'typing-indicator'
      t.className = 'flex items-end gap-2 self-start'
      const av = document.createElement('div')
      av.className = 'w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0'
      av.style.background = config.theme.botAvatarGradient
      av.textContent = study.bot_emoji
      const bub = document.createElement('div')
      bub.className = 'px-4 py-3 rounded-2xl rounded-bl-sm flex gap-1.5'
      bub.style.cssText = 'background:' + C.bubbleBg + ';border:1px solid ' + C.bubbleBdr + ';--dot-color:' + config.theme.primaryColor + ';'
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
  }, [chatRef, config, study.bot_emoji, scrollBottom])

  // -- Utility -----------------------------------------------

  const scrollInputBottom = useCallback(() => {
    const el = inputRef.current
    if (!el) return
    setTimeout(() => { el.scrollTop = el.scrollHeight }, 60)
  }, [inputRef])

  const isDecline = (text: string) => {
    const t = text.toLowerCase().trim()
    return /^(no|nope|nah|not really|nothing|none|n\/a|na|no thanks|skip|pass|all good|that'?s? (all|it)|i'?m good|nothing else|not at the moment)\.?$/.test(t) || t.length < 5
  }

  // Rules-based acknowledgment that adapts to what the respondent said
  const smartAck = (text: string): string => {
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
  }

  const isQuestionOrOffTopic = (text: string) => {
    const t = text.trim().toLowerCase()
    if (t.endsWith('?')) return true
    if (/\b(who are you|what are you|tell me|what is this|what do you|how do you|where (is|are|can)|can you tell|could you tell|explain|help me)\b/i.test(t)) return true
    return false
  }

  const shouldClarify = (text: string) =>
    !isDecline(text) && !isQuestionOrOffTopic(text) && text.trim().split(/\s+/).length < 12

  // AI-powered deflection: detects questions/off-topic and generates contextual redirect
  const checkDeflect = async (text: string, questionAsked: string) => {
    const qr = config.questionRedirect
    if (!qr?.enabled) return false
    try {
      const res = await fetch('/api/deflect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studyName:     orgName || study.name,
          orgName:       orgName || study.name,
          questionAsked,
          answer:        text,
          linkText:      qr.linkText || '',
          linkUrl:       qr.linkUrl || '',
          customMessage: qr.message || '',
          language:      activeLang.current !== 'en' ? activeLang.current : undefined,
        }),
      })
      if (!res.ok) return false
      const data = await res.json()
      if (!data.deflection) return false

      clearInput()
      await showTyping(900)
      // Log the deflection (strip HTML for clean log)
      const plainText = data.deflection.replace(/<[^>]+>/g, '')
      state.current.conversationLog.push({ who: 'bot', text: plainText, ai: true })
      // Render bot message with HTML link
      if (chatRef.current) {
        const wrap = document.createElement('div')
        wrap.className = 'msg-animate flex items-end gap-2 self-start max-w-[80%]'
        const av = document.createElement('div')
        av.className = 'w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0'
        av.style.background = config.theme.botAvatarGradient
        av.textContent = study.bot_emoji
        const bub = document.createElement('div')
        bub.className = 'px-3.5 py-2.5 rounded-2xl rounded-bl-sm text-sm leading-relaxed'
        bub.style.cssText = 'background:' + C.bubbleBg + ';color:' + C.text + ';border:1px solid ' + C.bubbleBdr + ';'
        // Style the link within the AI-generated response
        bub.innerHTML = data.deflection.replace(/<a /g, '<a style="color:' + config.theme.primaryColor + ';text-decoration:underline;font-weight:500" ')
        wrap.append(av, bub)
        chatRef.current.appendChild(wrap)
        scrollBottom()
      }
      await showTyping(2500)
      return true
    } catch {
      return false
    }
  }

  const buildClarify = async (text: string, qKey: 'q3' | 'q4'): Promise<string | null> => {
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
      const priorAnswers: Record<string, string> = {}
      if (qKey === 'q3' || qKey === 'q4') priorAnswers.q1 = s.answers.q1
      if (qKey === 'q4') priorAnswers.q3 = s.answers.q3

      const res = await fetch('/api/clarify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studyName:       orgName || study.name,
          studyPurpose:    config.greeting,
          questionAsked:   s.currentQuestion,
          questionKey:     qKey,
          answer:          text,
          sentiment:       s.sentiment || 'neutral',
          experienceScore: s.rating || 3,
          npsScore:        s.npsScore || 3,
          priorAnswers,
          language:        activeLang.current !== 'en' ? activeLang.current : undefined,
        }),
      })
      if (!res.ok) throw new Error('API error')
      const data = await res.json()
      if (data.question) return data.question
    } catch {
      // AI failed -- fall through to keyword matching
    }

    return keywordFallback()
  }

  const pickPsychoQuestions = (n = 3) => {
    const bank = [...config.psychographicBank]
    const picked = []
    while (picked.length < n && bank.length > 0) {
      const i = Math.floor(Math.random() * bank.length)
      picked.push(...bank.splice(i, 1))
    }
    state.current.psychoQuestions = picked
  }

  // -- Submit ------------------------------------------------

  const submitResponse = async () => {
    // Cancel any pending partial save to prevent it from overwriting the complete status
    if (savePartialTimer.current) { clearTimeout(savePartialTimer.current); savePartialTimer.current = null }
    const s = state.current
    const payload: Partial<SurveyPayload> = {
      agent:            study.bot_name,
      timestamp:        new Date().toISOString(),
      openEnded:        s.answers,
      customAnswers:    s.customAnswers,
      psychographics:   s.psychoAnswers,
      demographics:     s.demographics,
      contactInfo:      s.contactInfo,
      conversationLog:  s.conversationLog,
    }
    // Only include scores if they were actually collected
    if (s.rating != null) {
      payload.experienceRating = { score: s.rating, label: s.ratingLabel!, sentiment: s.sentiment! }
    }
    if (s.npsScore != null) {
      payload.npsRecommend = { score: s.npsScore, label: s.npsLabel! }
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
        // Mark device as having completed this survey
        try { localStorage.setItem('sentimetrx_completed_' + study.guid, new Date().toISOString()) } catch {}
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
            try { localStorage.setItem('sentimetrx_completed_' + study.guid, new Date().toISOString()) } catch {}
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
  }

  // -- Section ordering ----------------------------------------
  const sectionOrder: SectionKey[] = config.sectionOrder || ['customQuestions', 'psychographics', 'demographics', 'contact']
  const sectionIdx = useRef(0)
  const sectionRunners = useRef<Record<string, () => Promise<void>>>({} as any)

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
    await showTyping(1000)
    const closingMsgFallback = config.closingMessage || `Thank you so much -- ${study.bot_name} really appreciates you taking a moment to share. Your feedback makes a genuine difference. 💛`
    const closingMsgTranslated = t('closingMessage', closingMsgFallback)
    // If t() returned the English fallback unchanged and we're not in English, use built-in
    addMsg('bot', closingMsgTranslated === closingMsgFallback && activeLang.current !== 'en'
      ? tUI('closingMessageDefault', closingMsgFallback)
      : closingMsgTranslated)
    await showTyping(600)

    if (!chatRef.current) return
    const card = document.createElement('div')
    card.className = 'rounded-2xl p-5 text-center my-1'
    card.style.background = config.theme.headerGradient
    const closingCardFallback = config.closingCard || 'Your responses have been saved. Thank you for your time.'
    const closingCardTranslated = t('closingCard', closingCardFallback)
    const cardSubtitle = closingCardTranslated === closingCardFallback && activeLang.current !== 'en'
      ? tUI('closingCardDefault', closingCardFallback)
      : closingCardTranslated
    card.innerHTML = `
      <div class="text-4xl mb-2">${study.bot_emoji}</div>
      <div class="text-white font-semibold text-lg mb-1">${tUI('allDone', 'All done!')}</div>
      <div class="text-white/75 text-sm leading-snug">${cardSubtitle}</div>
    `
    chatRef.current.appendChild(card)
    scrollBottom()
    clearInput()
    await submitResponse()
  }, [addMsg, chatRef, clearInput, config, scrollBottom, showTyping, study])

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
      await showTyping(800)
      const msg = tTransition('demographics', demoTransition?.text || 'Almost done -- a couple of optional questions about you. Completely up to you.')
      addMsg('bot', msg)
      await showTyping(Math.max(2000, msg.length * 40))
    } else {
      await showTyping(350)
    }

    if (!inputRef.current) return
    var wrap = document.createElement('div')
    wrap.className = 'flex flex-col gap-1.5 mt-1.5'

    var selectStyle = 'padding:10px 13px;border-radius:10px;font-size:0.844rem;color:' + C.textMid + ';background:' + C.inputBg + ';border:1.5px solid ' + config.theme.primaryColor + '28;outline:none;cursor:pointer;appearance:none;font-family:inherit;'

    var fieldElements: { key: string; el: HTMLSelectElement | HTMLInputElement }[] = []

    for (var fi = 0; fi < activeFields.length; fi++) {
      var df = activeFields[fi]
      var tDemoLabel = tUI('demo_' + df.key, df.label)
      if (df.type === 'select' && df.options && df.options.length > 0) {
        var sel = document.createElement('select')
        sel.style.cssText = selectStyle
        var ph = document.createElement('option')
        ph.value = ''; ph.textContent = tDemoLabel + '...'
        sel.appendChild(ph)
        for (var oi = 0; oi < df.options.length; oi++) {
          var opt = document.createElement('option')
          opt.value = df.options[oi][0]; opt.textContent = tUI('demo_opt_' + df.options[oi][0], df.options[oi][1])
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
    submitBtn.className = 'mt-1 rounded-full font-semibold text-sm py-2.5 px-6 self-start transition-all'
    submitBtn.style.cssText = 'background:' + config.theme.primaryColor + ';color:#fff;border:none;cursor:pointer;font-family:inherit;'
    submitBtn.onclick = async function() {
      wrap.querySelectorAll('select,input,button').forEach(function(el) { (el as any).disabled = true })
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
  }, [addMsg, clearInput, config, inputRef, scrollBottom, showTyping, state, advanceSection])

  const stepContactInfo = useCallback(async () => {
    var contactFields = config.contactFields
    if (!contactFields) { await advanceSection(); return }
    var activeFields = contactFields.filter(function(f) { return f.enabled })
    if (activeFields.length === 0) { await advanceSection(); return }

    clearInput()
    var contactTransition = config.contactTransition
    if (contactTransition?.enabled !== false) {
      await showTyping(800)
      var msg = tTransition('contact', contactTransition?.text || "If you'd like us to follow up, please share your contact details below. Completely optional.")
      addMsg('bot', msg)
      await showTyping(Math.max(2000, msg.length * 40))
    } else {
      await showTyping(350)
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
        ph.value = ''; ph.textContent = cf.label + (cf.required ? ' *' : '') + '...'
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
        inp.placeholder = (cf.placeholder || cf.label) + (cf.required ? ' *' : ' (optional)')
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
    continueBtn.className = 'mt-1 rounded-full font-semibold text-sm py-2.5 px-6 self-start transition-all'
    continueBtn.style.cssText = 'background:' + config.theme.primaryColor + ';color:#fff;border:none;cursor:pointer;font-family:inherit;'
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
          var validationError = validateContactField(fe.type as any, val)
          if (validationError) {
            fe.errorEl.textContent = validationError
            fe.errorEl.style.display = 'block'
            hasError = true
          }
        }
      }
      if (hasError) return

      wrap.querySelectorAll('select,input,button').forEach(function(el) { (el as any).disabled = true })
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
  }, [addMsg, clearInput, config, inputRef, scrollBottom, showTyping, state, advanceSection])

  const stepPsychoQ = useCallback(async () => {
    const s = state.current
    if (s.psychoIdx >= s.psychoQuestions.length) { await advanceSection(); return }
    clearInput()
    const q = s.psychoQuestions[s.psychoIdx]
    await showTyping(750)
    addMsg('bot', tPsycho(q.key, 'q', q.q) as string)

    if (!inputRef.current) return
    const col = document.createElement('div')
    col.className = 'flex flex-col gap-1.5 mt-1.5'
    let psychoSel: string | null = null
    let psychoConfirmBtn: HTMLButtonElement | null = null
    const psychoBtns: HTMLButtonElement[] = []
    const tOpts = tPsycho(q.key, 'opts', q.opts) as string[]
    const commitPsycho = (opt: string) => {
      col.querySelectorAll('button').forEach((b: any) => b.disabled = true)
      addMsg('user', opt)
      // Store original English key for analytics consistency
      const origIdx = tOpts.indexOf(opt)
      state.current.psychoAnswers[q.key] = origIdx >= 0 && q.opts[origIdx] ? q.opts[origIdx] : opt
      state.current.psychoIdx++
      savePartial()
      stepPsychoQ()
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
  }, [addMsg, clearInput, config, inputRef, scrollBottom, showTyping, state, advanceSection])



  


  


  const showLikertFollowUpInput = useCallback((next: () => Promise<void>, storageKey?: 'q1' | 'q2') => {
    if (!inputRef.current) return
    const wrap = document.createElement('div')
    wrap.className = 'flex flex-col gap-2 mt-1.5'
    const row = document.createElement('div')
    row.className = 'flex gap-2 items-end w-full'
    const ta = document.createElement('textarea')
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
    skipBtn.className = 'text-xs self-start px-2 py-1'
    skipBtn.style.cssText = 'color:' + C.textFaint + ';background:none;border:none;cursor:pointer;font-family:inherit;'
    skipBtn.onmouseenter = () => { skipBtn.style.color = C.textMid }
    skipBtn.onmouseleave = () => { skipBtn.style.color = C.textFaint }
    const submit = async () => {
      const v = ta.value.trim()
      wrap.querySelectorAll('textarea,button').forEach((el: any) => el.disabled = true)
      if (v) {
        addMsg('user', v)
        if (storageKey) state.current.answers[storageKey] = v
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
      if (v && storageKey && shouldClarify(v) && state.current.clarifyCount < 2) {
        const cq = await buildClarify(v, storageKey === 'q1' ? 'q3' : 'q4')
        if (cq) {
          state.current.clarifyCount++
          await showTyping(1100)
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
  }, [addMsg, clearInput, config, inputRef, scrollBottom, showTyping])

  // Clarify input for likert follow-ups (q1/q2)
  const showLikertClarifyInput = useCallback((storageKey: 'q1' | 'q2', originalVal: string, next: () => Promise<void>) => {
    if (!inputRef.current) return
    const wrap = document.createElement('div')
    wrap.className = 'flex gap-2 items-end w-full mt-1.5'
    const ta = document.createElement('textarea')
    ta.cols = 1
    ta.className = 'flex-1 min-w-0 resize-none text-base leading-relaxed rounded-2xl px-4 py-2.5'
    ta.rows = 1
    ta.placeholder = tUI('clarifyPlaceholder', 'Feel free to add a bit more...')
    ta.style.cssText = `background:' + C.inputBg + ';border:1.5px solid ${config.theme.primaryColor}28;color:' + C.text + ';outline:none;font-family:inherit;max-height:110px;`
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
      wrap.querySelectorAll('textarea,button').forEach((el: any) => el.disabled = true)
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
  }, [addMsg, clearInput, config, inputRef, scrollBottom])


    const stepPsychoIntro = useCallback(async () => {
    clearInput()
    pickPsychoQuestions(config.psychoCount ?? 3)
    state.current.psychoIdx = 0
    const psychoTransition = config.sectionTransitions?.psychographics
    if (psychoTransition?.enabled !== false) {
      await showTyping(900)
      const msg = tTransition('psychographics', psychoTransition?.text || 'Just a few quick questions to round things out -- helps us understand the range of people sharing feedback.')
      addMsg('bot', msg)
      await showTyping(Math.max(2000, msg.length * 40))
    } else {
      await showTyping(200)
    }
    await stepPsychoQ()
  }, [addMsg, clearInput, showTyping, stepPsychoQ])

  const stepCustomQuestions = useCallback(async () => {
    const allQuestions = (config.questions ?? []).filter(q => !q.conversationPosition && q.enabled !== false && q.type !== 'hidden')
    if (allQuestions.length === 0) { await advanceSection(); return }

    // Show transition message if enabled
    const cqTransition = config.sectionTransitions?.customQuestions
    if (cqTransition?.enabled) {
      clearInput()
      await showTyping(800)
      const msg = tTransition('customQuestions', cqTransition.text || 'Now for a few more specific questions.')
      addMsg('bot', msg)
      await showTyping(Math.max(2000, msg.length * 40))
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
        await showTyping(Math.max(600, tPrompt.length * 30))
        addMsg('bot', tPrompt)
        await showTyping(Math.max(400, tPrompt.length * 20))
        continue
      }

      const tPrompt = tQuestion(q.id, 'prompt', q.prompt) as string
      await showTyping(800)
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
            if (val && (q.clarify !== false) && config.useAIClarify && shouldClarify(val) && state.current.clarifyCount < 2) {
              const cq = await buildClarify(val, 'q4')
              if (cq) {
                state.current.clarifyCount++
                clearInput()
                await showTyping(1000)
                addMsg('bot', cq, true)
                state.current.currentQuestion = cq
                showLikertFollowUpInput(async () => { resolve() })
                return
              }
            }
            clearInput()
            resolve()
          }
          if (q.required) {
            showTextInput('q4') // reuse showTextInput UI, answer stored separately
            // intercept: override the send handler below via resolve pattern
          }
          // Build inline to capture resolve
          const wrap = document.createElement('div')
          wrap.className = 'flex flex-col gap-2 mt-1.5'
          const row = document.createElement('div')
          row.className = 'flex gap-2 items-end w-full'
          const ta = document.createElement('textarea')
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
            if (!v && q.required) return
            wrap.querySelectorAll('textarea,button').forEach((el: any) => el.disabled = true)
            if (v) addMsg('user', v)
            await submit(v)
          }
          row.append(ta, sendBtn)
          wrap.appendChild(row)
          if (!q.required) {
            const skipBtn = document.createElement('button')
            skipBtn.textContent = tUI('skip', 'Skip')
            skipBtn.className = 'text-xs self-start px-2 py-1'
            skipBtn.style.cssText = 'color:' + C.textFaint + ';background:none;border:none;cursor:pointer;font-family:inherit;'
            skipBtn.onmouseenter = () => { skipBtn.style.color = C.textMid }
            skipBtn.onmouseleave = () => { skipBtn.style.color = C.textFaint }
            skipBtn.onclick = () => { wrap.querySelectorAll('button,textarea').forEach((el: any) => el.disabled = true); submit('') }
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
                col.querySelectorAll('button').forEach((b: any) => b.disabled = true)
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
              col.querySelectorAll('button').forEach((b: any) => b.disabled = true)
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
              doneBtn.style.background = selected.size > 0 ? config.theme.primaryColor : C.disabledBg
              doneBtn.style.color      = selected.size > 0 ? '#fff' : C.textMute
            }
            btns.push(btn)
            wrap.appendChild(btn)
          })
          const doneBtn = document.createElement('button')
          doneBtn.textContent = selected.size > 0 ? tUI('done', 'Done') : q.required ? tUI('selectAtLeastOne', 'Select at least one') : tUI('skip', 'Skip')
          doneBtn.className = 'mt-1 px-4 py-2 rounded-xl text-sm font-semibold transition-all'
          doneBtn.style.cssText = 'background:' + C.disabledBg + ';color:' + C.textMute + ';border:none;cursor:pointer;font-family:inherit;'
          doneBtn.onclick = () => {
            if (selected.size === 0 && q.required) return
            wrap.querySelectorAll('button').forEach((b: any) => b.disabled = true)
            const arr = Array.from(selected)
            if (arr.length > 0) addMsg('user', arr.join(', '))
            customAnswers[q.id] = arr
            clearInput()
            resolve()
          }
          wrap.appendChild(doneBtn)
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
            wrap.querySelectorAll('select,button').forEach((el: any) => el.disabled = true)
            if (sel.value) addMsg('user', sel.value)
            customAnswers[q.id] = sel.value
            clearInput()
            resolve()
          }
          if (!q.required) {
            const skipBtn = document.createElement('button')
            skipBtn.textContent = tUI('skip', 'Skip')
            skipBtn.style.cssText = 'color:' + C.textFaint + ';background:none;border:none;cursor:pointer;font-size:0.75rem;font-family:inherit;margin-left:4px;'
            skipBtn.onmouseenter = () => { skipBtn.style.color = C.textMid }
            skipBtn.onmouseleave = () => { skipBtn.style.color = C.textFaint }
            skipBtn.onclick = () => { wrap.querySelectorAll('select,button').forEach((el: any) => el.disabled = true); customAnswers[q.id] = ''; clearInput(); resolve() }
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
          const tLikertLabels = storedLabels || scale.map((s: any) => tRatingLabel(s.label))
          const likertConfirm = confirmMode
          let selectedScore: typeof scale[0] | null = null
          let likertConfirmBtn: HTMLButtonElement | null = null
          const likertWrap = document.createElement('div')
          likertWrap.className = 'flex flex-col gap-1.5 mt-1.5'
          const row = document.createElement('div')
          row.className = 'flex gap-1'
          const allLikertBtns: HTMLButtonElement[] = []

          const commitLikert = async (s: typeof scale[0]) => {
            likertWrap.querySelectorAll('button').forEach((b: any) => b.disabled = true)
            const selBtn = allLikertBtns[scale.indexOf(s)]
            if (selBtn) { selBtn.style.borderColor = config.theme.primaryColor; selBtn.style.background = config.theme.primaryColor + '20' }
            const tLabel = tLikertLabels[scale.indexOf(s)] || s.label
            addMsg('user', (s.emoji || '') + ' ' + tLabel)
            customAnswers[q.id] = String(s.score)
            if (q.followUp?.enabled) {
              const fu = q.followUp
              const pr = fu.mode === 'per-response' ? fu.perResponse?.[s.score] : null
              const prompt = pr ? pr.prompt : (fu.sharedPrompt || '')
              if (prompt.trim()) {
                clearInput()
                await showTyping(800)
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
            sb.innerHTML = '<span style="font-size:' + emojiSize.toFixed(2) + 'rem">' + (s.emoji || '⭐') + '</span><span style="font-size:0.5rem;font-weight:600;color:' + C.textMute + ';text-align:center">' + tLabel + '</span>'
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
                ratingRow.querySelectorAll('button').forEach((b: any) => b.disabled = true)
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
              ratingWrap.querySelectorAll('button').forEach((b: any) => b.disabled = true)
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
            wrap.querySelectorAll('input,button').forEach((el: any) => el.disabled = true)
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
            skipBtn.style.cssText = 'color:' + C.textFaint + ';background:none;border:none;cursor:pointer;font-size:0.75rem;font-family:inherit;margin-left:4px;'
            skipBtn.onmouseenter = () => { skipBtn.style.color = C.textMid }
            skipBtn.onmouseleave = () => { skipBtn.style.color = C.textFaint }
            skipBtn.onclick = () => { wrap.querySelectorAll('input,button').forEach((el: any) => el.disabled = true); customAnswers[q.id] = ''; clearInput(); resolve() }
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

    // Store all custom answers in state
    state.current.customAnswers = customAnswers
    savePartial()
    await advanceSection()
  }, [addMsg, clearInput, config, inputRef, scrollBottom, showLikertFollowUpInput, showTyping, state, advanceSection])

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
        await showTyping(Math.max(600, tPrompt.length * 30))
        addMsg('bot', tPrompt)
        await showTyping(Math.max(400, tPrompt.length * 20))
        continue
      }

      const tPrompt = tQuestion(q.id, 'prompt', q.prompt) as string
      await showTyping(800)
      addMsg('bot', tPrompt)
      state.current.currentQuestion = q.prompt

      await new Promise<void>(resolve => {
        if (!inputRef.current) { resolve(); return }

        if (q.type === 'open') {
          const wrap = document.createElement('div')
          wrap.className = 'flex flex-col gap-2 mt-1.5'
          const row = document.createElement('div')
          row.className = 'flex gap-2 items-end w-full'
          const ta = document.createElement('textarea')
          ta.cols = 1
          ta.className = 'flex-1 min-w-0 resize-none text-base leading-relaxed rounded-2xl px-4 py-2.5'
          ta.rows = 1
          ta.placeholder = tUI('sharePlaceholder', 'Share your thoughts...')
          ta.style.cssText = `background:' + C.inputBg + ';border:1.5px solid ${config.theme.primaryColor}28;color:' + C.text + ';outline:none;font-family:inherit;max-height:110px;transition:border-color 0.2s;`
          ta.onfocus = () => { ta.style.borderColor = config.theme.primaryColor }
          ta.onblur  = () => { ta.style.borderColor = `${config.theme.primaryColor}28` }
          ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 110) + 'px' }
          const sendBtn = document.createElement('button')
          sendBtn.textContent = '→'
          sendBtn.className = 'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-base transition-all'
          sendBtn.style.cssText = `background:' + C.disabledBg + ';color:' + C.textMute + ';border:none;cursor:pointer;font-family:inherit;`
          ta.oninput = () => {
            ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 110) + 'px'
            sendBtn.style.background = ta.value.trim() ? config.theme.primaryColor : C.disabledBg
            sendBtn.style.color      = ta.value.trim() ? '#fff' : C.textMute
          }
          ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click() } }
          sendBtn.onclick = () => {
            const v = ta.value.trim()
            if (!v && q.required) return
            wrap.querySelectorAll('textarea,button').forEach((el: any) => el.disabled = true)
            if (v) addMsg('user', v)
            customAnswers[q.id] = v
            clearInput(); resolve()
          }
          row.append(ta, sendBtn)
          wrap.appendChild(row)
          if (!q.required) {
            const skipBtn = document.createElement('button')
            skipBtn.textContent = tUI('skip', 'Skip')
            skipBtn.className = 'text-xs self-start px-2 py-1'
            skipBtn.style.cssText = 'color:' + C.textFaint + ';background:none;border:none;cursor:pointer;font-family:inherit;'
            skipBtn.onclick = () => { wrap.querySelectorAll('button,textarea').forEach((el: any) => el.disabled = true); customAnswers[q.id] = ''; clearInput(); resolve() }
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
              col.querySelectorAll('button').forEach((b: any) => b.disabled = true)
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
              doneBtn.style.background = selected.size > 0 ? config.theme.primaryColor : C.disabledBg
              doneBtn.style.color      = selected.size > 0 ? '#fff' : C.textMute
            }
            wrap.appendChild(btn)
          })
          const doneBtn = document.createElement('button')
          doneBtn.textContent = q.required ? tUI('selectAtLeastOne', 'Select at least one') : tUI('done', 'Done') + ' / ' + tUI('skip', 'Skip')
          doneBtn.className = 'mt-1 px-4 py-2 rounded-xl text-sm font-semibold transition-all'
          doneBtn.style.cssText = 'background:' + C.disabledBg + ';color:' + C.textMute + ';border:none;cursor:pointer;font-family:inherit;'
          doneBtn.onclick = () => {
            if (selected.size === 0 && q.required) return
            wrap.querySelectorAll('button').forEach((b: any) => b.disabled = true)
            const arr = Array.from(selected)
            if (arr.length > 0) addMsg('user', arr.join(', '))
            customAnswers[q.id] = arr; clearInput(); resolve()
          }
          wrap.appendChild(doneBtn)
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
  }, [addMsg, clearInput, config, inputRef, savePartial, scrollBottom, showTyping, state, sectionOrder, stepDone])

  const stepConversationExtrasRef = useRef(stepConversationExtras)
  stepConversationExtrasRef.current = stepConversationExtras

  // Register section runners for the section ordering dispatcher
  sectionRunners.current = {
    customQuestions: stepCustomQuestions,
    psychographics: stepPsychoIntro,
    demographics: stepDemographics,
    contact: stepContactInfo,
    _done: stepDone,
  } as any

  const progressFlow = useCallback(async (qKey: 'q3' | 'q4', skipAck?: boolean) => {
    // Also check flag set by deflection in clarify/likert handlers
    if (state.current.skipNextAck) { skipAck = true; state.current.skipNextAck = false }
    const lastMsg = state.current.lastUserMsg || ''
    if (qKey === 'q3') {
      // Skip Q4 if disabled
      if (config.q4Enabled === false) {
        if (!skipAck) { await showTyping(700); addMsg('bot', smartAck(lastMsg), true) }
        await stepConversationExtras()
        return
      }
      if (!skipAck) { await showTyping(700); addMsg('bot', smartAck(lastMsg), true) }
      await showTyping(800)
      addMsg('bot', t('q4', config.q4))
      state.current.currentQuestion = config.q4
      // q4: optional by default, required if q4Required === true
      if (config.q4Required === true) {
        showTextInput('q4')
      } else {
        showTextInputOptional('q4')
      }
    } else {
      if (!skipAck && !isDecline(lastMsg)) {
        await showTyping(700)
        addMsg('bot', smartAck(lastMsg), true)
      }
      await stepConversationExtras()
    }
  }, [addMsg, config, showTyping, stepConversationExtras])

  const handleOpenEnded = useCallback(async (qKey: 'q3' | 'q4', val: string) => {
    state.current.answers[qKey] = val
    savePartial()
    clearInput()
    // Smart deflection: if respondent asked a question, redirect and skip clarifier
    if (!isDecline(val) && await checkDeflect(val, state.current.currentQuestion || '')) {
      await progressFlow(qKey, true)
      return
    }
    // Only attempt clarification if enabled for this question (default: on)
    const clarifyEnabled = qKey === 'q3' ? config.q3Clarify !== false : config.q4Clarify !== false
    if (clarifyEnabled && state.current.clarifyCount < 2 && shouldClarify(val)) {
      const cq = await buildClarify(val, qKey)
      if (cq) {
        state.current.clarifyCount++
        await showTyping(1100)
        addMsg('bot', cq, true)
        showClarifyInput(qKey, val)
        return
      }
    }
    await progressFlow(qKey)
  }, [addMsg, clearInput, config, progressFlow, savePartial, showTyping, state])

  // Refs so imperative DOM handlers always call the latest function versions
  const handleOpenEndedRef = useRef(handleOpenEnded)
  handleOpenEndedRef.current = handleOpenEnded
  const progressFlowRef = useRef(progressFlow)
  progressFlowRef.current = progressFlow
  const savePartialRef = useRef(savePartial)
  savePartialRef.current = savePartial

  // -- Input Renderers ---------------------------------------

  const showTextInput = useCallback((qKey: 'q3' | 'q4') => {
    if (!inputRef.current) return
    const wrap = document.createElement('div')
    wrap.className = 'flex gap-2 items-end w-full mt-1.5'

    const ta = document.createElement('textarea')
    ta.cols = 1
    ta.className = 'flex-1 min-w-0 resize-none text-base leading-relaxed rounded-2xl px-4 py-2.5'
    ta.rows = 1
    ta.placeholder = tUI('sharePlaceholder', 'Share your thoughts...')
    ta.style.cssText = `
      background:' + C.inputBg + ';
      border:1.5px solid ${config.theme.primaryColor}28;
      color:' + C.text + ';outline:none;font-family:inherit;
      max-height:110px;transition:border-color 0.2s;
    `
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
    sendBtn.style.cssText = `background:' + C.disabledBg + ';color:' + C.textMute + ';border:none;cursor:default;`
    ta.addEventListener('input', () => {
      const hasText = ta.value.trim().length > 0
      sendBtn.style.background = hasText ? config.theme.primaryColor : C.disabledBg
      sendBtn.style.color      = hasText ? '#fff' : C.textMute
      sendBtn.style.cursor     = hasText ? 'pointer' : 'default'
    })
    sendBtn.onclick = () => {
      const val = ta.value.trim(); if (!val) return
      wrap.querySelectorAll('textarea,button').forEach((el: any) => el.disabled = true)
      addMsg('user', val)
      // Store immediately and save — belt-and-suspenders, don't rely solely on handleOpenEnded
      state.current.answers[qKey] = val
      savePartialRef.current()
      handleOpenEndedRef.current(qKey, val)
    }

    wrap.append(ta, sendBtn)
    inputRef.current.appendChild(wrap)
    setTimeout(() => ta.focus(), 100)
    scrollBottom()
  }, [addMsg, config, inputRef, scrollBottom])

  const showClarifyInput = useCallback((qKey: 'q3' | 'q4', originalVal: string) => {
    if (!inputRef.current) return
    const wrap = document.createElement('div')
    wrap.className = 'flex gap-2 items-end w-full mt-1.5'

    const ta = document.createElement('textarea')
    ta.cols = 1
    ta.className = 'flex-1 min-w-0 resize-none text-base leading-relaxed rounded-2xl px-4 py-2.5'
    ta.rows = 1
    ta.placeholder = tUI('clarifyPlaceholder', 'Feel free to add a bit more...')
    ta.style.cssText = `
      background:' + C.inputBg + ';
      border:1.5px solid ${config.theme.primaryColor}28;
      color:' + C.text + ';outline:none;font-family:inherit;
      max-height:110px;transition:border-color 0.2s;
    `
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
    sendBtn.style.cssText = `background:' + C.disabledBg + ';color:' + C.textMute + ';border:none;cursor:default;`
    ta.addEventListener('input', () => {
      const hasText = ta.value.trim().length > 0
      sendBtn.style.background = hasText ? config.theme.primaryColor : C.disabledBg
      sendBtn.style.color      = hasText ? '#fff' : C.textMute
      sendBtn.style.cursor     = hasText ? 'pointer' : 'default'
    })
    sendBtn.onclick = async () => {
      const val = ta.value.trim(); if (!val) return
      wrap.querySelectorAll('textarea,button').forEach((el: any) => el.disabled = true)
      addMsg('user', val)
      if (!isDecline(val)) state.current.answers[qKey] = originalVal + ' [+ ' + val + ']'
      savePartialRef.current()
      clearInput()
      // AI deflection: detect questions/off-topic and respond contextually
      const deflected = !isDecline(val) && await checkDeflect(val, state.current.currentQuestion || '')
      await progressFlowRef.current(qKey, deflected || undefined)
    }

    wrap.append(ta, sendBtn)
    inputRef.current.appendChild(wrap)
    setTimeout(() => ta.focus(), 100)
    scrollBottom()
  }, [addMsg, clearInput, config, inputRef, scrollBottom, state])



  // -- Likert adaptive follow-up input (text, then calls next()) --



    // -- Optional text input (with Skip button) ------------------
  const showTextInputOptional = useCallback((qKey: 'q3' | 'q4') => {
    if (!inputRef.current) return
    const wrap = document.createElement('div')
    wrap.className = 'flex flex-col gap-2 mt-1.5'

    const row = document.createElement('div')
    row.className = 'flex gap-2 items-end w-full'

    const ta = document.createElement('textarea')
    ta.cols = 1
    ta.className = 'flex-1 min-w-0 resize-none text-base leading-relaxed rounded-2xl px-4 py-2.5'
    ta.rows = 1
    ta.placeholder = tUI('sharePlaceholder', 'Share your thoughts...')
    ta.style.cssText = `
      background:' + C.inputBg + ';
      border:1.5px solid ${config.theme.primaryColor}28;
      color:' + C.text + ';outline:none;font-family:inherit;
      max-height:110px;transition:border-color 0.2s;
    `
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
    sendBtn.style.cssText = `background:' + C.disabledBg + ';color:' + C.textMute + ';border:none;cursor:pointer;font-family:inherit;`
    sendBtn.onclick = () => {
      const val = ta.value.trim()
      wrap.querySelectorAll('textarea,button').forEach((el: any) => el.disabled = true)
      if (val) {
        addMsg('user', val)
        state.current.answers[qKey] = val
        savePartialRef.current()
        handleOpenEndedRef.current(qKey, val)
      } else {
        addMsg('user', 'Skip')
        state.current.answers[qKey] = ''
        clearInput()
        progressFlowRef.current(qKey)
      }
    }

    const skipBtn = document.createElement('button')
    skipBtn.textContent = 'Skip this question'
    skipBtn.className = 'text-xs self-start transition-all px-2 py-1'
    skipBtn.style.cssText = `color:' + C.textFaint + ';background:none;border:none;cursor:pointer;font-family:inherit;`
    skipBtn.onmouseenter = () => { skipBtn.style.color = C.textMid }
    skipBtn.onmouseleave = () => { skipBtn.style.color = C.textFaint }
    skipBtn.onclick = () => {
      wrap.querySelectorAll('textarea,button').forEach((el: any) => el.disabled = true)
      addMsg('user', 'Skip')
      state.current.answers[qKey] = ''
      clearInput()
      progressFlowRef.current(qKey)
    }

    row.append(ta, sendBtn)
    wrap.append(row, skipBtn)
    inputRef.current.appendChild(wrap)
    setTimeout(() => ta.focus(), 100)
    scrollBottom()
  }, [addMsg, clearInput, config, inputRef, scrollBottom, state])

  // -- Main renderInput dispatcher ---------------------------

  // Active language for multi-language surveys
  const activeLang = useRef<string>('en')

  // Get translated content for the active language
  function t(key: string, fallback: string): string {
    if (activeLang.current === 'en' || !config.translations) return fallback
    const trans = config.translations[activeLang.current]
    if (!trans) return fallback
    return (trans as any)[key] || fallback
  }

  function tQuestion(qId: string, field: 'prompt' | 'options' | 'likertLabels', fallback: string | string[]): any {
    if (activeLang.current === 'en' || !config.translations) return fallback
    const trans = config.translations[activeLang.current]
    if (!trans?.questions?.[qId]) return fallback
    if (field === 'options') return trans.questions[qId].options || fallback
    if (field === 'likertLabels') return trans.questions[qId].likertLabels || fallback
    return trans.questions[qId].prompt || fallback
  }

  function tUI(key: string, fallback: string): string {
    if (activeLang.current === 'en') return fallback
    // Check stored translation first
    const trans = config.translations?.[activeLang.current]
    if (trans?.ui && (trans.ui as any)[key]) return (trans.ui as any)[key]
    // Fall back to built-in translations
    const builtin = BUILTIN_UI_TRANSLATIONS[activeLang.current]
    if (builtin?.[key]) return builtin[key]
    return fallback
  }

  function tRatingLabel(englishLabel: string): string {
    if (activeLang.current === 'en') return englishLabel
    const trans = config.translations?.[activeLang.current]
    if (trans?.ui?.ratingLabels?.[englishLabel]) return trans.ui.ratingLabels[englishLabel]
    // Fall back to built-in rating labels if available
    const builtin = BUILTIN_UI_TRANSLATIONS[activeLang.current]
    if (builtin?.['rating_' + englishLabel]) return builtin['rating_' + englishLabel]
    return englishLabel
  }

  function tNpsLabel(englishLabel: string): string {
    if (activeLang.current === 'en') return englishLabel
    const trans = config.translations?.[activeLang.current]
    if (trans?.ui?.npsLabels?.[englishLabel]) return trans.ui.npsLabels[englishLabel]
    // Fall back to built-in NPS labels
    const builtin = BUILTIN_UI_TRANSLATIONS[activeLang.current]
    if (builtin?.['nps_' + englishLabel]) return builtin['nps_' + englishLabel]
    return englishLabel
  }

  function tTransition(sectionKey: string, fallback: string): string {
    if (activeLang.current === 'en') return fallback
    const trans = config.translations?.[activeLang.current]
    if (trans?.ui?.transitions?.[sectionKey]) return trans.ui.transitions[sectionKey]
    // Fall back to built-in transition translations
    const builtin = BUILTIN_UI_TRANSLATIONS[activeLang.current]
    if (builtin?.['transition_' + sectionKey]) return builtin['transition_' + sectionKey]
    return fallback
  }

  function tPsycho(key: string, field: 'q' | 'opts', fallback: string | string[]): any {
    if (activeLang.current === 'en' || !config.translations) return fallback
    const trans = config.translations[activeLang.current]
    if (!trans?.psychographics?.[key]) return fallback
    if (field === 'opts') return trans.psychographics[key].opts || fallback
    return trans.psychographics[key].q || fallback
  }

  const renderInput = useCallback(async (phase: string) => {
    if (phase !== 'start') return

    // Language selection — show before greeting if multiple languages enabled
    if (config.languages && config.languages.length > 1) {
      await showTyping(600)
      addMsg('bot', 'Choose your language:')

      if (inputRef.current) {
        await new Promise<void>(resolve => {
          const wrap = document.createElement('div')
          wrap.className = 'flex flex-col gap-1.5 mt-1.5'

          const { SUPPORTED_LANGUAGES } = require('@/lib/types')
          const enabledLangs = SUPPORTED_LANGUAGES.filter((l: any) => config.languages!.includes(l.code))
          let selectedLang: string | null = null
          let confirmBtn: HTMLButtonElement | null = null
          const langBtns: HTMLButtonElement[] = []

          enabledLangs.forEach((lang: any) => {
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
            const langObj = enabledLangs.find((l: any) => l.code === selectedLang)
            addMsg('user', langObj?.nativeName || selectedLang)
            wrap.querySelectorAll('button').forEach((b: any) => b.disabled = true)
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
    await showTyping(900)
    addMsg('bot', t('greeting', config.greeting))

    // Ready prompt
    await showTyping(600)
    addMsg('bot', tUI('readyPrompt', 'Are you ready to share your feedback?'))

    if (!inputRef.current) return
    const row = document.createElement('div')
    row.className = 'flex gap-2 flex-wrap mt-1.5'

    ;[[tUI('readyYes', "Yes, let's go! 👍"), 'yes'], [tUI('readyNo', 'Not right now'), 'no']].forEach(([label, val]) => {
      const btn = document.createElement('button')
      btn.className = 'px-4 py-2.5 rounded-full text-sm font-medium transition-all'
      btn.style.cssText = 'background:' + C.btnBg + ';border:1.5px solid ' + C.btnBdr + ';color:' + C.textMid + ';cursor:pointer;font-family:inherit;'
      btn.textContent = label
      btn.onmouseenter = () => { btn.style.borderColor = config.theme.primaryColor; btn.style.background = config.theme.primaryColor + '18' }
      btn.onmouseleave = () => { btn.style.borderColor = C.btnBdr; btn.style.background = C.btnBg }
      btn.onclick = async () => {
        row.querySelectorAll('button').forEach((b: any) => b.disabled = true)
        addMsg('user', label)
        if (val === 'no') {
          clearInput()
          await showTyping(800)
          addMsg('bot', tUI('thankYouAck', 'No problem at all -- thanks for your time! 😊'))
          return
        }

        // Helper: show adaptive Likert follow-up then call next()
        const showLikertFollowUp = async (
          followUp: any,
          score: number,
          next: () => Promise<void>,
          storageKey?: 'q1' | 'q2'
        ) => {
          if (!followUp?.enabled) { await next(); return }
          const pr = followUp.mode === 'per-response'
            ? followUp.perResponse?.[score]
            : null
          const prompt = pr ? pr.prompt : (followUp.sharedPrompt || '')
          if (!prompt.trim()) { await next(); return }
          clearInput()
          await showTyping(900)
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
          await showTyping(800)
          addMsg('bot', t('q3', config.q3))
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
          await showTyping(900)
          addMsg('bot', t('ratingPrompt', config.ratingPrompt))
          await showTyping(300)
          if (!inputRef.current) return
          const expWrap = document.createElement('div')
          expWrap.className = 'flex flex-col gap-1.5 mt-1.5'
          const ratingRow = document.createElement('div')
          ratingRow.className = 'flex gap-1 flex-wrap'
          let expSel: any = null
          let expConfirmBtn: HTMLButtonElement | null = null
          const expBtns: HTMLButtonElement[] = []
          const commitExp = async (r: any) => {
            expWrap.querySelectorAll('button').forEach((b: any) => { b.disabled = true })
            const selBtn = expBtns[config.ratingScale.indexOf(r)]
            if (selBtn) { selBtn.style.borderColor = config.theme.primaryColor; selBtn.style.background = config.theme.primaryColor + '20' }
            state.current.rating = r.score
            state.current.ratingLabel = r.label
            var maxScore = Math.max.apply(null, config.ratingScale.map(function(x: any) { return x.score }))
            var minScore = Math.min.apply(null, config.ratingScale.map(function(x: any) { return x.score }))
            var range = maxScore - minScore || 1
            var pct = (r.score - minScore) / range
            state.current.sentiment = pct >= 0.6 ? 'positive' : pct <= 0.4 ? 'negative' : 'neutral'
            savePartial()
            addMsg('user', r.emoji + ' ' + tRatingLabel(r.label))
            await showLikertFollowUp(config.experienceFollowUp, r.score, next, 'q2')
          }
          config.ratingScale.forEach((r: any) => {
            const tLabel = tRatingLabel(r.label)
            const rb = document.createElement('button')
            rb.className = 'flex flex-col items-center gap-1 rounded-xl px-1 py-2 flex-1 min-w-0 transition-all'
            rb.style.cssText = 'background:' + C.btnBg + ';border:2px solid ' + C.inputBdr + ';cursor:pointer;font-family:inherit;'
            rb.innerHTML = '<span style="font-size:1.25rem">' + r.emoji + '</span><span style="font-size:0.5625rem;font-weight:600;color:' + C.textMute + ';text-align:center;white-space:nowrap">' + tLabel + '</span>'
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
          await showTyping(1000)
          const npsPrompt = config.npsPrompt || 'How likely are you to recommend us to a friend or someone you know?'
          addMsg('bot', t('npsPrompt', npsPrompt))
          await showTyping(300)
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
            npsWrap.querySelectorAll('button').forEach((b: any) => b.disabled = true)
            const selBtn = npsBtns[stars.indexOf(s)]
            if (selBtn) { selBtn.style.borderColor = config.theme.primaryColor; selBtn.style.background = config.theme.primaryColor + '20' }
            state.current.npsScore = s.score
            state.current.npsLabel = s.label
            state.current.sentiment = s.score >= 4 ? 'positive' : s.score >= 3 ? 'neutral' : 'negative'
            savePartial()
            addMsg('user', s.stars + ' ' + tNpsLabel(s.label))
            await showLikertFollowUp(config.npsFollowUp, s.score, next, 'q1')
          }
          stars.forEach(s => {
            const tLabel = tNpsLabel(s.label)
            const sb = document.createElement('button')
            sb.className = 'flex flex-col items-center gap-1 rounded-xl px-1 py-2 flex-1 min-w-0 transition-all'
            sb.style.cssText = 'background:' + C.btnBg + ';border:2px solid ' + C.inputBdr + ';cursor:pointer;font-family:inherit;'
            sb.innerHTML = '<span style="font-size:0.8125rem">' + s.stars + '</span><span style="font-size:0.5rem;font-weight:600;color:' + C.textMute + ';text-align:center">' + tLabel + '</span>'
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
          await showTyping(900)
          const prompt = item.prompt || 'In your own words, tell us about your experience.'
          addMsg('bot', prompt)
          if (!inputRef.current) return
          const oeWrap = document.createElement('div')
          oeWrap.className = 'flex flex-col gap-2 mt-1.5'
          const oeRow = document.createElement('div')
          oeRow.className = 'flex gap-2 items-end w-full'
          const ta = document.createElement('textarea')
          ta.cols = 1
          ta.className = 'flex-1 min-w-0 resize-none text-base leading-relaxed rounded-2xl px-4 py-2.5'
          ta.rows = 1
          ta.placeholder = tUI('sharePlaceholder', 'Share your thoughts...')
          ta.style.cssText = `background:' + C.inputBg + ';border:1.5px solid ${config.theme.primaryColor}28;color:' + C.text + ';outline:none;font-family:inherit;max-height:110px;transition:border-color 0.2s;`
          ta.onfocus = () => { ta.style.borderColor = config.theme.primaryColor }
          ta.onblur  = () => { ta.style.borderColor = `${config.theme.primaryColor}28` }
          const oeSendBtn = document.createElement('button')
          oeSendBtn.textContent = '→'
          oeSendBtn.className = 'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-base transition-all'
          oeSendBtn.style.cssText = `background:' + C.disabledBg + ';color:' + C.textMute + ';border:none;cursor:pointer;font-family:inherit;`
          ta.oninput = () => {
            ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 110) + 'px'
            oeSendBtn.style.background = ta.value.trim() ? config.theme.primaryColor : C.disabledBg
            oeSendBtn.style.color      = ta.value.trim() ? '#fff' : C.textMute
          }
          ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); oeSendBtn.click() } }
          oeSendBtn.onclick = async () => {
            const v = ta.value.trim()
            oeWrap.querySelectorAll('textarea,button').forEach((el: any) => el.disabled = true)
            if (v) { addMsg('user', v); state.current.openingAnswers[item.id] = v }
            savePartial()
            clearInput()
            await next()
          }
          oeRow.append(ta, oeSendBtn)
          oeWrap.appendChild(oeRow)
          const oeSkipBtn = document.createElement('button')
          oeSkipBtn.textContent = tUI('skip', 'Skip')
          oeSkipBtn.className = 'text-xs self-start px-2 py-1'
          oeSkipBtn.style.cssText = 'color:' + C.textFaint + ';background:none;border:none;cursor:pointer;font-family:inherit;'
          oeSkipBtn.onmouseenter = () => { oeSkipBtn.style.color = C.textMid }
          oeSkipBtn.onmouseleave = () => { oeSkipBtn.style.color = C.textFaint }
          oeSkipBtn.onclick = async () => {
            oeWrap.querySelectorAll('textarea,button').forEach((el: any) => el.disabled = true)
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
  }, [addMsg, clearInput, config, inputRef, progressFlow, scrollBottom, showLikertFollowUpInput, showTextInput, showTyping, state])

  return { renderInput, deviceBlocked: deviceBlocked.current }
}


