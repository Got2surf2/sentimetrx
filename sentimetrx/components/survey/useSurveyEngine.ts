'use client'

import { useCallback, useRef } from 'react'
import type { Study, StudyConfig, Sentiment, SurveyPayload } from '@/lib/types'

// ============================================================
// useSurveyEngine
// Contains ALL conversation logic — nothing in this hook ever
// appears in page source. It runs in the browser but the
// config that drives it comes from the server-rendered page.
// ============================================================

interface Props {
  study: Study
  chatRef:    React.RefObject<HTMLDivElement>
  inputRef:   React.RefObject<HTMLDivElement>
  scrollBottom: () => void
}

interface State {
  rating:          number | null
  ratingLabel:     string | null
  sentiment:       Sentiment | null
  npsScore:        number | null
  npsLabel:        string | null
  answers:         { q1: string; q3: string; q4: string }
  clarifyCount:    number
  psychoQuestions: Array<{ key: string; q: string; opts: string[] }>
  psychoIdx:       number
  psychoAnswers:   Record<string, string>
  demographics:    { age: string; gender: string; zip: string }
  startTime:       number
}

export function useSurveyEngine({ study, chatRef, inputRef, scrollBottom }: Props) {
  const config = study.config as StudyConfig
  const state  = useRef<State>({
    rating: null, ratingLabel: null, sentiment: null,
    npsScore: null, npsLabel: null,
    answers: { q1: '', q3: '', q4: '' },
    clarifyCount: 0,
    psychoQuestions: [], psychoIdx: 0, psychoAnswers: {},
    demographics: { age: '', gender: '', zip: '' },
    startTime: Date.now(),
  })

  // ── Helpers ───────────────────────────────────────────────

  const clearInput = useCallback(() => {
    if (inputRef.current) inputRef.current.innerHTML = ''
  }, [inputRef])

  const addMsg = useCallback((who: 'bot' | 'user', text: string) => {
    if (!chatRef.current) return
    const wrap = document.createElement('div')
    wrap.className = `msg-animate flex items-end gap-2 ${who === 'user' ? 'flex-row-reverse self-end max-w-[85%]' : 'self-start max-w-[85%]'}`

    if (who === 'bot') {
      const av = document.createElement('div')
      av.className = 'w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0'
      av.style.background = config.theme.botAvatarGradient
      av.textContent = study.bot_emoji
      const bub = document.createElement('div')
      bub.className = 'px-3.5 py-2.5 rounded-2xl rounded-bl-sm text-sm leading-relaxed'
      bub.style.cssText = 'background:rgba(255,255,255,0.08);color:rgba(255,255,255,0.9);border:1px solid rgba(255,255,255,0.07);'
      bub.textContent = text
      wrap.append(av, bub)
    } else {
      const bub = document.createElement('div')
      bub.className = 'px-3.5 py-2.5 rounded-2xl rounded-br-sm text-sm leading-relaxed font-medium'
      bub.style.cssText = `background:${config.theme.primaryColor};color:#fff;`
      bub.textContent = text
      wrap.appendChild(bub)
    }

    chatRef.current.appendChild(wrap)
    scrollBottom()
  }, [chatRef, config, study.bot_emoji, scrollBottom])

  const showTyping = useCallback((dur = 1000): Promise<void> => {
    return new Promise(res => {
      if (!chatRef.current) { res(); return }
      const t = document.createElement('div')
      t.id = 'typing-indicator'
      t.className = 'flex items-end gap-2 self-start'
      const av = document.createElement('div')
      av.className = 'w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0'
      av.style.background = config.theme.botAvatarGradient
      av.textContent = study.bot_emoji
      const bub = document.createElement('div')
      bub.className = 'px-4 py-3 rounded-2xl rounded-bl-sm flex gap-1.5'
      bub.style.cssText = 'background:rgba(255,255,255,0.08);border:1px solid rgba(255,255,255,0.07);'
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

  // ── Utility ───────────────────────────────────────────────

  const isDecline = (text: string) => {
    const t = text.toLowerCase().trim()
    return /^(no|nope|nah|not really|nothing|none|n\/a|na|no thanks|skip|pass|all good|that'?s? (all|it)|i'?m good|nothing else|not at the moment)\.?$/.test(t) || t.length < 5
  }

  const shouldClarify = (text: string) =>
    !isDecline(text) && text.trim().split(/\s+/).length < 10

  const buildClarify = (text: string): string | null => {
    const t = text.toLowerCase()
    const pool = config.clarifiers
    for (const [kw, q] of Object.entries(pool)) {
      if (kw === 'default') continue
      if (t.includes(kw)) return q as string
    }
    return pool.default || null
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

  // ── Submit ────────────────────────────────────────────────

  const submitResponse = async () => {
    const s = state.current
    const payload: SurveyPayload = {
      agent:            study.bot_name,
      timestamp:        new Date().toISOString(),
      experienceRating: {
        score:     s.rating!,
        label:     s.ratingLabel!,
        sentiment: s.sentiment!,
      },
      npsRecommend: { score: s.npsScore!, label: s.npsLabel! },
      openEnded:    s.answers,
      psychographics: s.psychoAnswers,
      demographics:   s.demographics,
    }

    const duration_sec = Math.round((Date.now() - s.startTime) / 1000)

    try {
      await fetch('/api/respond', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ study_guid: study.guid, payload, duration_sec }),
      })
    } catch (err) {
      console.error('Failed to submit response:', err)
      // Fail silently — the user has already seen the thank-you screen
    }
  }

  // ── Flow Steps ────────────────────────────────────────────

  const stepDone = useCallback(async () => {
    await showTyping(1000)
    addMsg('bot', `Thank you so much — ${study.bot_name} really appreciates you taking a moment to share. Your feedback makes a genuine difference. 💛`)
    await showTyping(600)

    if (!chatRef.current) return
    const card = document.createElement('div')
    card.className = 'rounded-2xl p-5 text-center my-1'
    card.style.background = config.theme.headerGradient
    card.innerHTML = `
      <div class="text-4xl mb-2">${study.bot_emoji}</div>
      <div class="text-white font-semibold text-lg mb-1">All done!</div>
      <div class="text-white/75 text-sm leading-snug">Your responses have been saved. Thank you for your time.</div>
    `
    chatRef.current.appendChild(card)
    scrollBottom()
    clearInput()
    await submitResponse()
  }, [addMsg, chatRef, clearInput, config, scrollBottom, showTyping, study])

  const stepDemographics = useCallback(async () => {
    clearInput()
    await showTyping(800)
    addMsg('bot', 'Almost done — a couple of optional questions about you. Completely up to you.')
    await showTyping(350)

    if (!inputRef.current) return
    const wrap = document.createElement('div')
    wrap.className = 'flex flex-col gap-1.5 mt-1.5'

    const selectStyle = `
      padding:10px 13px;border-radius:10px;font-size:13.5px;
      color:rgba(255,255,255,0.82);background:rgba(255,255,255,0.06);
      border:1.5px solid ${config.theme.primaryColor}28;
      outline:none;cursor:pointer;appearance:none;font-family:inherit;
    `

    const makeSelect = (placeholder: string, options: [string, string][]) => {
      const s = document.createElement('select')
      s.style.cssText = selectStyle
      const ph = document.createElement('option')
      ph.value = ''; ph.textContent = placeholder
      s.appendChild(ph)
      options.forEach(([v, l]) => {
        const o = document.createElement('option')
        o.value = v; o.textContent = l
        s.appendChild(o)
      })
      return s
    }

    const ageS = makeSelect('Age range...', [
      ['18-24','18–24'],['25-34','25–34'],['35-44','35–44'],
      ['45-54','45–54'],['55-64','55–64'],['65+','65 or over'],
    ])
    const genderS = makeSelect('Gender...', [
      ['male','Male'],['female','Female'],['nonbinary','Non-binary'],
      ['other','Prefer to self-describe'],['prefer_not','Prefer not to say'],
    ])
    const zipInput = document.createElement('input')
    zipInput.type = 'text'
    zipInput.placeholder = 'ZIP code (optional)'
    zipInput.style.cssText = selectStyle + 'border-radius:10px;'

    const submitBtn = document.createElement('button')
    submitBtn.textContent = 'Submit my feedback →'
    submitBtn.className = 'mt-1 rounded-full font-semibold text-sm py-2.5 px-6 self-start transition-all'
    submitBtn.style.cssText = `background:${config.theme.primaryColor};color:#fff;border:none;cursor:pointer;font-family:inherit;`
    submitBtn.onclick = async () => {
      wrap.querySelectorAll('select,input,button').forEach((el: any) => el.disabled = true)
      state.current.demographics.age    = ageS.value
      state.current.demographics.gender = genderS.value
      state.current.demographics.zip    = zipInput.value
      clearInput()
      await stepDone()
    }

    wrap.append(ageS, genderS, zipInput, submitBtn)
    inputRef.current.appendChild(wrap)
    scrollBottom()
  }, [addMsg, clearInput, config, inputRef, scrollBottom, showTyping, state, stepDone])

  const stepPsychoQ = useCallback(async () => {
    const s = state.current
    if (s.psychoIdx >= s.psychoQuestions.length) { await stepDemographics(); return }
    clearInput()
    const q = s.psychoQuestions[s.psychoIdx]
    await showTyping(750)
    addMsg('bot', q.q)

    if (!inputRef.current) return
    const col = document.createElement('div')
    col.className = 'flex flex-col gap-1.5 mt-1.5'
    q.opts.forEach(opt => {
      const btn = document.createElement('button')
      btn.className = 'text-left px-4 py-2.5 rounded-xl text-sm font-medium transition-all'
      btn.style.cssText = `background:rgba(255,255,255,0.05);border:1.5px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.82);cursor:pointer;font-family:inherit;`
      btn.textContent = opt
      btn.onmouseenter = () => { btn.style.borderColor = config.theme.primaryColor; btn.style.background = `${config.theme.primaryColor}18` }
      btn.onmouseleave = () => { btn.style.borderColor = 'rgba(255,255,255,0.12)'; btn.style.background = 'rgba(255,255,255,0.05)' }
      btn.onclick = () => {
        col.querySelectorAll('button').forEach((b: any) => b.disabled = true)
        addMsg('user', opt)
        state.current.psychoAnswers[q.key] = opt
        state.current.psychoIdx++
        stepPsychoQ()
      }
      col.appendChild(btn)
    })
    inputRef.current.appendChild(col)
    scrollBottom()
  }, [addMsg, clearInput, config, inputRef, scrollBottom, showTyping, state, stepDemographics])

  const stepPsychoIntro = useCallback(async () => {
    clearInput()
    pickPsychoQuestions(3)
    state.current.psychoIdx = 0
    await showTyping(900)
    addMsg('bot', 'Just a few quick questions to round things out — helps us understand the range of people sharing feedback.')
    await stepPsychoQ()
  }, [addMsg, clearInput, showTyping, stepPsychoQ])

  const progressFlow = useCallback(async (qKey: 'q1' | 'q3' | 'q4') => {
    if (qKey === 'q1') {
      await showTyping(700)
      addMsg('bot', 'Thanks — really appreciate you sharing that.')
      state.current.clarifyCount = 0
      await showTyping(800)
      addMsg('bot', config.q3)
      showTextInput('q3')
    } else if (qKey === 'q3') {
      await showTyping(700)
      addMsg('bot', 'Got it — that\'s genuinely helpful.')
      state.current.clarifyCount = 0
      await showTyping(800)
      addMsg('bot', config.q4)
      showTextInput('q4')
    } else {
      if (!isDecline(state.current.answers.q4)) {
        await showTyping(700)
        addMsg('bot', 'Thank you — we\'ll make sure that gets to the right people.')
      }
      await stepPsychoIntro()
    }
  }, [addMsg, config, showTyping, stepPsychoIntro])

  const handleOpenEnded = useCallback(async (qKey: 'q1' | 'q3' | 'q4', val: string) => {
    state.current.answers[qKey] = val
    clearInput()
    if (state.current.clarifyCount < 1 && shouldClarify(val)) {
      const cq = buildClarify(val)
      if (cq) {
        state.current.clarifyCount++
        await showTyping(1100)
        addMsg('bot', cq)
        showClarifyInput(qKey, val)
        return
      }
    }
    await progressFlow(qKey)
  }, [addMsg, clearInput, config, progressFlow, showTyping, state])

  // ── Input Renderers ───────────────────────────────────────

  const showTextInput = useCallback((qKey: 'q1' | 'q3' | 'q4') => {
    if (!inputRef.current) return
    const wrap = document.createElement('div')
    wrap.className = 'flex gap-2 items-end mt-1.5'

    const ta = document.createElement('textarea')
    ta.className = 'flex-1 resize-none text-sm leading-relaxed rounded-2xl px-4 py-2.5'
    ta.rows = 1
    ta.placeholder = 'Share your thoughts here...'
    ta.style.cssText = `
      background:rgba(255,255,255,0.06);
      border:1.5px solid ${config.theme.primaryColor}28;
      color:rgba(255,255,255,0.9);outline:none;font-family:inherit;
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
    sendBtn.style.cssText = `background:rgba(255,255,255,0.15);color:rgba(255,255,255,0.4);border:none;cursor:default;`
    ta.addEventListener('input', () => {
      const hasText = ta.value.trim().length > 0
      sendBtn.style.background = hasText ? config.theme.primaryColor : 'rgba(255,255,255,0.15)'
      sendBtn.style.color      = hasText ? '#fff' : 'rgba(255,255,255,0.4)'
      sendBtn.style.cursor     = hasText ? 'pointer' : 'default'
    })
    sendBtn.onclick = () => {
      const val = ta.value.trim(); if (!val) return
      wrap.querySelectorAll('textarea,button').forEach((el: any) => el.disabled = true)
      addMsg('user', val)
      handleOpenEnded(qKey, val)
    }

    wrap.append(ta, sendBtn)
    inputRef.current.appendChild(wrap)
    setTimeout(() => ta.focus(), 100)
    scrollBottom()
  }, [addMsg, config, handleOpenEnded, inputRef, scrollBottom])

  const showClarifyInput = useCallback((qKey: 'q1' | 'q3' | 'q4', originalVal: string) => {
    if (!inputRef.current) return
    const wrap = document.createElement('div')
    wrap.className = 'flex gap-2 items-end mt-1.5'

    const ta = document.createElement('textarea')
    ta.className = 'flex-1 resize-none text-sm leading-relaxed rounded-2xl px-4 py-2.5'
    ta.rows = 1
    ta.placeholder = 'Feel free to add a bit more...'
    ta.style.cssText = `
      background:rgba(255,255,255,0.06);
      border:1.5px solid ${config.theme.primaryColor}28;
      color:rgba(255,255,255,0.9);outline:none;font-family:inherit;
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
    sendBtn.style.cssText = `background:rgba(255,255,255,0.15);color:rgba(255,255,255,0.4);border:none;cursor:default;`
    ta.addEventListener('input', () => {
      const hasText = ta.value.trim().length > 0
      sendBtn.style.background = hasText ? config.theme.primaryColor : 'rgba(255,255,255,0.15)'
      sendBtn.style.color      = hasText ? '#fff' : 'rgba(255,255,255,0.4)'
      sendBtn.style.cursor     = hasText ? 'pointer' : 'default'
    })
    sendBtn.onclick = async () => {
      const val = ta.value.trim(); if (!val) return
      wrap.querySelectorAll('textarea,button').forEach((el: any) => el.disabled = true)
      addMsg('user', val)
      if (!isDecline(val)) state.current.answers[qKey] = originalVal + ' [+ ' + val + ']'
      clearInput()
      state.current.clarifyCount = 0
      await progressFlow(qKey)
    }

    wrap.append(ta, sendBtn)
    inputRef.current.appendChild(wrap)
    setTimeout(() => ta.focus(), 100)
    scrollBottom()
  }, [addMsg, clearInput, config, inputRef, progressFlow, scrollBottom, state])

  // ── Main renderInput dispatcher ───────────────────────────

  const renderInput = useCallback(async (phase: string) => {
    if (phase !== 'start') return

    // Greeting — single message on mobile to keep buttons visible above fold
    await showTyping(900)
    addMsg('bot', config.greeting)

    if (!inputRef.current) return
    const row = document.createElement('div')
    row.className = 'flex gap-2 flex-wrap mt-1.5'

    ;[['Yes, let\'s go! 👍', 'yes'], ['Not right now', 'no']].forEach(([label, val]) => {
      const btn = document.createElement('button')
      btn.className = 'px-4 py-2.5 rounded-full text-sm font-medium transition-all'
      btn.style.cssText = `background:rgba(255,255,255,0.05);border:1.5px solid rgba(255,255,255,0.14);color:rgba(255,255,255,0.8);cursor:pointer;font-family:inherit;`
      btn.textContent = label
      btn.onmouseenter = () => { btn.style.borderColor = config.theme.primaryColor; btn.style.background = `${config.theme.primaryColor}18` }
      btn.onmouseleave = () => { btn.style.borderColor = 'rgba(255,255,255,0.14)'; btn.style.background = 'rgba(255,255,255,0.05)' }
      btn.onclick = async () => {
        row.querySelectorAll('button').forEach((b: any) => b.disabled = true)
        addMsg('user', label)
        if (val === 'no') {
          clearInput()
          await showTyping(800)
          addMsg('bot', 'No problem at all — thanks for your time! 😊')
          return
        }
        // Rating
        clearInput()
        await showTyping(1000)
        addMsg('bot', config.ratingPrompt)
        await showTyping(350)

        if (!inputRef.current) return
        const ratingRow = document.createElement('div')
        ratingRow.className = 'flex gap-1 mt-1.5'
        config.ratingScale.forEach(r => {
          const rb = document.createElement('button')
          rb.className = 'flex flex-col items-center gap-1 rounded-xl px-1 py-2 flex-1 min-w-0 transition-all'
          rb.style.cssText = `background:rgba(255,255,255,0.05);border:2px solid rgba(255,255,255,0.1);cursor:pointer;font-family:inherit;`
          rb.innerHTML = `<span style="font-size:20px">${r.emoji}</span><span style="font-size:9px;font-weight:600;color:rgba(255,255,255,0.45);text-align:center;white-space:nowrap">${r.label}</span>`
          rb.onmouseenter = () => { rb.style.borderColor = config.theme.primaryColor; rb.style.background = `${config.theme.primaryColor}18` }
          rb.onmouseleave = () => {
            if (!rb.classList.contains('selected')) {
              rb.style.borderColor = 'rgba(255,255,255,0.1)'
              rb.style.background = 'rgba(255,255,255,0.05)'
            }
          }
          rb.onclick = async () => {
            ratingRow.querySelectorAll('button').forEach((b: any) => { b.disabled = true; b.style.borderColor = 'rgba(255,255,255,0.1)'; b.style.background = 'rgba(255,255,255,0.05)' })
            rb.style.borderColor = config.theme.primaryColor
            rb.style.background  = `${config.theme.primaryColor}20`
            state.current.rating      = r.score
            state.current.ratingLabel = r.label
            state.current.sentiment   = r.score >= 5 ? 'promoter' : r.score >= 4 ? 'passive' : 'detractor'
            addMsg('user', `${r.emoji} ${r.label}`)

            // NPS
            clearInput()
            await showTyping(900)
            addMsg('bot', 'And how likely are you to recommend us to a friend or someone you know?')
            await showTyping(300)

            if (!inputRef.current) return
            const stars = [
              { stars: '⭐',          label: '1 — No',         score: 1 },
              { stars: '⭐⭐',        label: '2 — Unlikely',   score: 2 },
              { stars: '⭐⭐⭐',      label: '3 — Maybe',      score: 3 },
              { stars: '⭐⭐⭐⭐',    label: '4 — Likely',     score: 4 },
              { stars: '⭐⭐⭐⭐⭐',  label: '5 — Definitely!',score: 5 },
            ]
            const npsRow = document.createElement('div')
            npsRow.className = 'flex gap-1 mt-1.5'
            stars.forEach(s => {
              const sb = document.createElement('button')
              sb.className = 'flex flex-col items-center gap-1 rounded-xl px-1 py-2 flex-1 min-w-0 transition-all'
              sb.style.cssText = `background:rgba(255,255,255,0.05);border:2px solid rgba(255,255,255,0.1);cursor:pointer;font-family:inherit;`
              sb.innerHTML = `<span style="font-size:13px">${s.stars}</span><span style="font-size:8px;font-weight:600;color:rgba(255,255,255,0.4);text-align:center">${s.label}</span>`
              sb.onmouseenter = () => { sb.style.borderColor = config.theme.primaryColor; sb.style.background = `${config.theme.primaryColor}18` }
              sb.onmouseleave = () => {
                if (!sb.classList.contains('selected')) {
                  sb.style.borderColor = 'rgba(255,255,255,0.1)'
                  sb.style.background = 'rgba(255,255,255,0.05)'
                }
              }
              sb.onclick = async () => {
                npsRow.querySelectorAll('button').forEach((b: any) => b.disabled = true)
                sb.style.borderColor = config.theme.primaryColor
                sb.style.background  = `${config.theme.primaryColor}20`
                state.current.npsScore = s.score
                state.current.npsLabel = s.label
                addMsg('user', `${s.stars} ${s.label}`)

                // Q1 (sentiment-adapted)
                clearInput()
                await showTyping(1100)
                const q1 = state.current.sentiment === 'promoter' ? config.promoterQ1
                         : state.current.sentiment === 'passive'   ? config.passiveQ1
                         : config.detractorQ1
                addMsg('bot', q1)
                showTextInput('q1')
              }
              npsRow.appendChild(sb)
            })
            inputRef.current.appendChild(npsRow)
            scrollBottom()
          }
          ratingRow.appendChild(rb)
        })
        inputRef.current.appendChild(ratingRow)
        scrollBottom()
      }
      row.appendChild(btn)
    })

    inputRef.current.appendChild(row)
    scrollBottom()
  }, [addMsg, clearInput, config, inputRef, progressFlow, scrollBottom, showTextInput, showTyping, state])

  return { renderInput }
}
