'use client'

import { useCallback, useRef } from 'react'
import type { Study, StudyConfig, Sentiment, SurveyPayload } from '@/lib/types'

// ============================================================
// useSurveyEngine
// Contains ALL conversation logic -- nothing in this hook ever
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
  customAnswers:   Record<string, string | string[]>
  currentQuestion: string   // the exact question text currently being answered
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
    customAnswers: {},
    currentQuestion: '',
    psychoQuestions: [], psychoIdx: 0, psychoAnswers: {},
    demographics: { age: '', gender: '', zip: '' },
    startTime: Date.now(),
  })

  // -- Helpers -----------------------------------------------

  const clearInput = useCallback(() => {
    if (inputRef.current) inputRef.current.innerHTML = ''
  }, [inputRef])

  const addMsg = useCallback((who: 'bot' | 'user', text: string) => {
    if (!chatRef.current) return
    const wrap = document.createElement('div')
    wrap.className = `msg-animate flex items-end gap-2 ${who === 'user' ? 'flex-row-reverse self-end max-w-[80%]' : 'self-start max-w-[80%]'}`

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

  // -- Utility -----------------------------------------------

  const isDecline = (text: string) => {
    const t = text.toLowerCase().trim()
    return /^(no|nope|nah|not really|nothing|none|n\/a|na|no thanks|skip|pass|all good|that'?s? (all|it)|i'?m good|nothing else|not at the moment)\.?$/.test(t) || t.length < 5
  }

  const shouldClarify = (text: string) =>
    !isDecline(text) && text.trim().split(/\s+/).length < 12

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
      return pool.default || null
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
          studyName:       study.bot_name,
          studyPurpose:    config.greeting,
          questionAsked:   s.currentQuestion,
          questionKey:     qKey,
          answer:          text,
          sentiment:       s.sentiment || 'passive',
          experienceScore: s.rating || 3,
          npsScore:        s.npsScore || 3,
          priorAnswers,
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
    const s = state.current
    const payload: SurveyPayload = {
      agent:            study.bot_name,
      timestamp:        new Date().toISOString(),
      experienceRating: {
        score:     s.rating!,
        label:     s.ratingLabel!,
        sentiment: s.sentiment!,
      },
      npsRecommend:  { score: s.npsScore!, label: s.npsLabel! },
      openEnded:     s.answers,
      customAnswers: s.customAnswers,
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
      // Fail silently -- the user has already seen the thank-you screen
    }
  }

  // -- Flow Steps --------------------------------------------

  const stepDone = useCallback(async () => {
    await showTyping(1000)
    addMsg('bot', `Thank you so much -- ${study.bot_name} really appreciates you taking a moment to share. Your feedback makes a genuine difference. 💛`)
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
    addMsg('bot', 'Almost done -- a couple of optional questions about you. Completely up to you.')
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
      ['18-24','18-24'],['25-34','25-34'],['35-44','35-44'],
      ['45-54','45-54'],['55-64','55-64'],['65+','65 or over'],
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



  

const stepCustomQuestions = useCallback(async () => {
    const questions = config.questions ?? []
    if (questions.length === 0) { await stepPsychoIntro(); return }

    const customAnswers: Record<string, string | string[]> = {}

    for (const q of questions) {
      clearInput()
      await showTyping(800)
      addMsg('bot', q.prompt)
      state.current.currentQuestion = q.prompt

      await new Promise<void>(resolve => {
        if (!inputRef.current) { resolve(); return }

        // ── open-ended ──────────────────────────────────────────
        if (q.type === 'open') {
          const submit = async (val: string) => {
            customAnswers[q.id] = val
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
          row.className = 'flex gap-2 items-end'
          const ta = document.createElement('textarea')
          ta.className = 'flex-1 resize-none text-sm leading-relaxed rounded-2xl px-4 py-2.5'
          ta.rows = 1
          ta.placeholder = 'Share your thoughts...'
          ta.style.cssText = 'background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.9);outline:none;font-family:inherit;max-height:110px;transition:border-color 0.2s;'
          ta.onfocus = () => { ta.style.borderColor = config.theme.primaryColor }
          ta.onblur  = () => { ta.style.borderColor = 'rgba(255,255,255,0.1)' }
          ta.oninput = () => {
            ta.style.height = 'auto'
            ta.style.height = Math.min(ta.scrollHeight, 110) + 'px'
            sendBtn.style.background = ta.value.trim() ? config.theme.primaryColor : 'rgba(255,255,255,0.15)'
            sendBtn.style.color      = ta.value.trim() ? '#fff' : 'rgba(255,255,255,0.4)'
          }
          const sendBtn = document.createElement('button')
          sendBtn.textContent = '->'
          sendBtn.className = 'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-base transition-all'
          sendBtn.style.cssText = 'background:rgba(255,255,255,0.15);color:rgba(255,255,255,0.4);border:none;cursor:pointer;font-family:inherit;'
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
            skipBtn.textContent = 'Skip'
            skipBtn.className = 'text-xs self-start px-2 py-1'
            skipBtn.style.cssText = 'color:rgba(255,255,255,0.3);background:none;border:none;cursor:pointer;font-family:inherit;'
            skipBtn.onmouseenter = () => { skipBtn.style.color = 'rgba(255,255,255,0.6)' }
            skipBtn.onmouseleave = () => { skipBtn.style.color = 'rgba(255,255,255,0.3)' }
            skipBtn.onclick = () => { wrap.querySelectorAll('button,textarea').forEach((el: any) => el.disabled = true); submit('') }
            wrap.appendChild(skipBtn)
          }
          clearInput()
          inputRef.current.appendChild(wrap)
          setTimeout(() => ta.focus(), 100)
          scrollBottom()

        // ── radio ───────────────────────────────────────────────
        } else if (q.type === 'radio') {
          const opts = q.options ?? []
          const col = document.createElement('div')
          col.className = 'flex flex-col gap-1.5 mt-1.5'
          opts.forEach(opt => {
            const btn = document.createElement('button')
            btn.className = 'text-left px-4 py-2.5 rounded-xl text-sm font-medium transition-all'
            btn.style.cssText = 'background:rgba(255,255,255,0.05);border:1.5px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.82);cursor:pointer;font-family:inherit;'
            btn.textContent = opt
            btn.onmouseenter = () => { btn.style.borderColor = config.theme.primaryColor; btn.style.background = config.theme.primaryColor + '18' }
            btn.onmouseleave = () => { btn.style.borderColor = 'rgba(255,255,255,0.12)'; btn.style.background = 'rgba(255,255,255,0.05)' }
            btn.onclick = () => {
              col.querySelectorAll('button').forEach((b: any) => b.disabled = true)
              btn.style.borderColor = config.theme.primaryColor
              btn.style.background  = config.theme.primaryColor + '20'
              addMsg('user', opt)
              customAnswers[q.id] = opt
              clearInput()
              resolve()
            }
            col.appendChild(btn)
          })
          clearInput()
          inputRef.current.appendChild(col)
          scrollBottom()

        // ── checkbox ────────────────────────────────────────────
        } else if (q.type === 'checkbox') {
          const opts = q.options ?? []
          const selected = new Set<string>()
          const wrap = document.createElement('div')
          wrap.className = 'flex flex-col gap-1.5 mt-1.5'
          const btns: HTMLButtonElement[] = []
          opts.forEach(opt => {
            const btn = document.createElement('button')
            btn.className = 'text-left px-4 py-2.5 rounded-xl text-sm font-medium transition-all'
            btn.style.cssText = 'background:rgba(255,255,255,0.05);border:1.5px solid rgba(255,255,255,0.12);color:rgba(255,255,255,0.82);cursor:pointer;font-family:inherit;'
            btn.textContent = opt
            btn.onclick = () => {
              if (selected.has(opt)) {
                selected.delete(opt)
                btn.style.borderColor = 'rgba(255,255,255,0.12)'
                btn.style.background  = 'rgba(255,255,255,0.05)'
              } else {
                selected.add(opt)
                btn.style.borderColor = config.theme.primaryColor
                btn.style.background  = config.theme.primaryColor + '20'
              }
              doneBtn.style.background = selected.size > 0 ? config.theme.primaryColor : 'rgba(255,255,255,0.15)'
              doneBtn.style.color      = selected.size > 0 ? '#fff' : 'rgba(255,255,255,0.4)'
            }
            btns.push(btn)
            wrap.appendChild(btn)
          })
          const doneBtn = document.createElement('button')
          doneBtn.textContent = selected.size > 0 ? 'Done' : q.required ? 'Select at least one' : 'Skip'
          doneBtn.className = 'mt-1 px-4 py-2 rounded-xl text-sm font-semibold transition-all'
          doneBtn.style.cssText = 'background:rgba(255,255,255,0.15);color:rgba(255,255,255,0.4);border:none;cursor:pointer;font-family:inherit;'
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
          const opts = q.options ?? []
          const wrap = document.createElement('div')
          wrap.className = 'flex gap-2 mt-1.5 items-center'
          const sel = document.createElement('select')
          sel.className = 'flex-1 rounded-xl text-sm px-3 py-2.5 outline-none cursor-pointer'
          sel.style.cssText = 'background:rgba(255,255,255,0.07);border:1.5px solid rgba(255,255,255,0.15);color:rgba(255,255,255,0.85);font-family:inherit;'
          const placeholder = document.createElement('option')
          placeholder.value = ''
          placeholder.textContent = 'Select an option...'
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
          goBtn.style.cssText = 'background:rgba(255,255,255,0.15);color:rgba(255,255,255,0.4);border:none;cursor:pointer;font-family:inherit;'
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
            skipBtn.textContent = 'Skip'
            skipBtn.style.cssText = 'color:rgba(255,255,255,0.3);background:none;border:none;cursor:pointer;font-size:12px;font-family:inherit;margin-left:4px;'
            skipBtn.onmouseenter = () => { skipBtn.style.color = 'rgba(255,255,255,0.6)' }
            skipBtn.onmouseleave = () => { skipBtn.style.color = 'rgba(255,255,255,0.3)' }
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
          const row = document.createElement('div')
          row.className = 'flex gap-1 mt-1.5'
          scale.forEach(s => {
            const sb = document.createElement('button')
            sb.className = 'flex flex-col items-center gap-1 rounded-xl px-1 py-2 flex-1 min-w-0 transition-all'
            sb.style.cssText = 'background:rgba(255,255,255,0.05);border:2px solid rgba(255,255,255,0.1);cursor:pointer;font-family:inherit;'
            sb.innerHTML = '<span style="font-size:18px">' + (s.emoji || '⭐') + '</span><span style="font-size:8px;font-weight:600;color:rgba(255,255,255,0.4);text-align:center">' + s.label + '</span>'
            sb.onmouseenter = () => { sb.style.borderColor = config.theme.primaryColor; sb.style.background = config.theme.primaryColor + '18' }
            sb.onmouseleave = () => { sb.style.borderColor = 'rgba(255,255,255,0.1)'; sb.style.background = 'rgba(255,255,255,0.05)' }
            sb.onclick = async () => {
              row.querySelectorAll('button').forEach((b: any) => b.disabled = true)
              sb.style.borderColor = config.theme.primaryColor
              sb.style.background  = config.theme.primaryColor + '20'
              addMsg('user', (s.emoji || '') + ' ' + s.label)
              customAnswers[q.id] = String(s.score)
              // Likert follow-up
              if (q.followUp?.enabled) {
                const fu = q.followUp
                const pr = fu.mode === 'per-response' ? fu.perResponse?.[s.score] : null
                const prompt = pr ? pr.prompt : (fu.sharedPrompt || '')
                if (prompt.trim()) {
                  clearInput()
                  await showTyping(800)
                  addMsg('bot', prompt)
                  state.current.currentQuestion = prompt
                  showLikertFollowUpInput(async () => { resolve() })
                  return
                }
              }
              clearInput()
              resolve()
            }
            row.appendChild(sb)
          })
          clearInput()
          inputRef.current.appendChild(row)
          scrollBottom()
        }
      })
    }

    // Store all custom answers in state
    state.current.customAnswers = customAnswers
    await stepPsychoIntro()
  }, [addMsg, clearInput, config, inputRef, scrollBottom, showLikertFollowUpInput, showTyping, state, stepPsychoIntro])

    const stepPsychoIntro = useCallback(async () => {
    clearInput()
    pickPsychoQuestions(3)
    state.current.psychoIdx = 0
    await showTyping(900)
    addMsg('bot', 'Just a few quick questions to round things out -- helps us understand the range of people sharing feedback.')
    await showTyping(200)
    await stepPsychoQ()
  }, [addMsg, clearInput, showTyping, stepPsychoQ])

  const progressFlow = useCallback(async (qKey: 'q3' | 'q4') => {
    if (qKey === 'q3') {
      await showTyping(700)
      addMsg('bot', 'Got it -- that\'s genuinely helpful.')
      await showTyping(800)
      addMsg('bot', config.q4)
      state.current.currentQuestion = config.q4
      // q4: optional by default, required if q4Required === true
      if (config.q4Required === true) {
        showTextInput('q4')
      } else {
        showTextInputOptional('q4')
      }
    } else {
      if (!isDecline(state.current.answers.q4)) {
        await showTyping(700)
        addMsg('bot', 'Thank you -- we\'ll make sure that gets to the right people.')
      }
      await stepCustomQuestions()
    }
  }, [addMsg, config, showTyping, stepCustomQuestions])

  const handleOpenEnded = useCallback(async (qKey: 'q3' | 'q4', val: string) => {
    state.current.answers[qKey] = val
    clearInput()
    if (state.current.clarifyCount < 2 && shouldClarify(val)) {
      const cq = await buildClarify(val, qKey)
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

  // -- Input Renderers ---------------------------------------

  const showTextInput = useCallback((qKey: 'q3' | 'q4') => {
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

  const showClarifyInput = useCallback((qKey: 'q3' | 'q4', originalVal: string) => {
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
      await progressFlow(qKey)
    }

    wrap.append(ta, sendBtn)
    inputRef.current.appendChild(wrap)
    setTimeout(() => ta.focus(), 100)
    scrollBottom()
  }, [addMsg, clearInput, config, inputRef, progressFlow, scrollBottom, state])



  // -- Likert adaptive follow-up input (text, then calls next()) --
  const showLikertFollowUpInput = useCallback((next: () => Promise<void>) => {
    if (!inputRef.current) return
    const wrap = document.createElement('div')
    wrap.className = 'flex flex-col gap-2 mt-1.5'
    const row = document.createElement('div')
    row.className = 'flex gap-2 items-end'
    const ta = document.createElement('textarea')
    ta.className = 'flex-1 resize-none text-sm leading-relaxed rounded-2xl px-4 py-2.5'
    ta.rows = 1
    ta.placeholder = 'Share your thoughts...'
    ta.style.cssText = 'background:rgba(255,255,255,0.06);border:1.5px solid rgba(255,255,255,0.1);color:rgba(255,255,255,0.9);outline:none;font-family:inherit;max-height:110px;transition:border-color 0.2s;'
    ta.onfocus  = () => { ta.style.borderColor = config.theme.primaryColor }
    ta.onblur   = () => { ta.style.borderColor = 'rgba(255,255,255,0.1)' }
    ta.oninput  = () => {
      ta.style.height = 'auto'
      ta.style.height = Math.min(ta.scrollHeight, 110) + 'px'
      sendBtn.style.background = ta.value.trim() ? config.theme.primaryColor : 'rgba(255,255,255,0.15)'
      sendBtn.style.color      = ta.value.trim() ? '#fff' : 'rgba(255,255,255,0.4)'
    }
    ta.onkeydown = (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click() } }
    const sendBtn = document.createElement('button')
    sendBtn.textContent = '->'
    sendBtn.className = 'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-base transition-all'
    sendBtn.style.cssText = 'background:rgba(255,255,255,0.15);color:rgba(255,255,255,0.4);border:none;cursor:pointer;font-family:inherit;'
    const skipBtn = document.createElement('button')
    skipBtn.textContent = 'Skip'
    skipBtn.className = 'text-xs self-start px-2 py-1'
    skipBtn.style.cssText = 'color:rgba(255,255,255,0.3);background:none;border:none;cursor:pointer;font-family:inherit;'
    skipBtn.onmouseenter = () => { skipBtn.style.color = 'rgba(255,255,255,0.6)' }
    skipBtn.onmouseleave = () => { skipBtn.style.color = 'rgba(255,255,255,0.3)' }
    const submit = async () => {
      const v = ta.value.trim()
      wrap.querySelectorAll('textarea,button').forEach((el: any) => el.disabled = true)
      if (v) addMsg('user', v)
      clearInput()
      await next()
    }
    sendBtn.onclick = submit
    skipBtn.onclick = submit
    row.append(ta, sendBtn)
    wrap.append(row, skipBtn)
    inputRef.current.appendChild(wrap)
    setTimeout(() => ta.focus(), 100)
    scrollBottom()
  }, [addMsg, clearInput, config, inputRef, scrollBottom])


    // -- Optional text input (with Skip button) ------------------
  const showTextInputOptional = useCallback((qKey: 'q3' | 'q4') => {
    if (!inputRef.current) return
    const wrap = document.createElement('div')
    wrap.className = 'flex flex-col gap-2 mt-1.5'

    const row = document.createElement('div')
    row.className = 'flex gap-2 items-end'

    const ta = document.createElement('textarea')
    ta.className = 'flex-1 resize-none text-sm leading-relaxed rounded-2xl px-4 py-2.5'
    ta.rows = 1
    ta.placeholder = 'Share your thoughts, or skip...'
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
      sendBtn.style.background = ta.value.trim() ? config.theme.primaryColor : 'rgba(255,255,255,0.15)'
      sendBtn.style.color      = ta.value.trim() ? '#fff' : 'rgba(255,255,255,0.4)'
    }
    ta.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendBtn.click() }
    }

    const sendBtn = document.createElement('button')
    sendBtn.textContent = '→'
    sendBtn.className = 'w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 font-bold text-base transition-all'
    sendBtn.style.cssText = `background:rgba(255,255,255,0.15);color:rgba(255,255,255,0.4);border:none;cursor:pointer;font-family:inherit;`
    sendBtn.onclick = () => {
      const val = ta.value.trim()
      wrap.querySelectorAll('textarea,button').forEach((el: any) => el.disabled = true)
      if (val) {
        addMsg('user', val)
        handleOpenEnded(qKey, val)
      } else {
        addMsg('user', 'Skip')
        state.current.answers[qKey] = ''
        clearInput()
        progressFlow(qKey)
      }
    }

    const skipBtn = document.createElement('button')
    skipBtn.textContent = 'Skip this question'
    skipBtn.className = 'text-xs self-start transition-all px-2 py-1'
    skipBtn.style.cssText = `color:rgba(255,255,255,0.3);background:none;border:none;cursor:pointer;font-family:inherit;`
    skipBtn.onmouseenter = () => { skipBtn.style.color = 'rgba(255,255,255,0.6)' }
    skipBtn.onmouseleave = () => { skipBtn.style.color = 'rgba(255,255,255,0.3)' }
    skipBtn.onclick = () => {
      wrap.querySelectorAll('textarea,button').forEach((el: any) => el.disabled = true)
      addMsg('user', 'Skip')
      state.current.answers[qKey] = ''
      clearInput()
      progressFlow(qKey)
    }

    row.append(ta, sendBtn)
    wrap.append(row, skipBtn)
    inputRef.current.appendChild(wrap)
    setTimeout(() => ta.focus(), 100)
    scrollBottom()
  }, [addMsg, clearInput, config, handleOpenEnded, inputRef, progressFlow, scrollBottom, state])

  // -- Main renderInput dispatcher ---------------------------

  const renderInput = useCallback(async (phase: string) => {
    if (phase !== 'start') return

    // Greeting -- single message on mobile to keep buttons visible above fold
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
          addMsg('bot', 'No problem at all -- thanks for your time! 😊')
          return
        }

        // Helper: show adaptive Likert follow-up then call next()
        const showLikertFollowUp = async (
          followUp: any,
          score: number,
          next: () => Promise<void>
        ) => {
          if (!followUp?.enabled) { await next(); return }
          const pr = followUp.mode === 'per-response'
            ? followUp.perResponse?.[score]
            : null
          const prompt = pr ? pr.prompt : (followUp.sharedPrompt || '')
          if (!prompt.trim()) { await next(); return }
          clearInput()
          await showTyping(900)
          addMsg('bot', prompt)
          state.current.currentQuestion = prompt
          showLikertFollowUpInput(next)
        }

        const npsEnabled        = config.npsEnabled !== false
        const experienceEnabled = config.experienceEnabled !== false

        // Jump straight to Q3 after scores are captured
        const stepQ3 = async () => {
          clearInput()
          await showTyping(800)
          addMsg('bot', config.q3)
          state.current.currentQuestion = config.q3
          if (config.q3Required === false) {
            showTextInputOptional('q3')
          } else {
            showTextInput('q3')
          }
        }

        // Experience rating step
        const doExperienceRating = async () => {
          if (!experienceEnabled) { await stepQ3(); return }
          clearInput()
          await showTyping(900)
          addMsg('bot', config.ratingPrompt)
          await showTyping(300)
          if (!inputRef.current) return
          const ratingRow = document.createElement('div')
          ratingRow.className = 'flex gap-1 mt-1.5'
          config.ratingScale.forEach((r: any) => {
            const rb = document.createElement('button')
            rb.className = 'flex flex-col items-center gap-1 rounded-xl px-1 py-2 flex-1 min-w-0 transition-all'
            rb.style.cssText = 'background:rgba(255,255,255,0.05);border:2px solid rgba(255,255,255,0.1);cursor:pointer;font-family:inherit;'
            rb.innerHTML = '<span style="font-size:20px">' + r.emoji + '</span><span style="font-size:9px;font-weight:600;color:rgba(255,255,255,0.45);text-align:center;white-space:nowrap">' + r.label + '</span>'
            rb.onmouseenter = () => { rb.style.borderColor = config.theme.primaryColor; rb.style.background = config.theme.primaryColor + '18' }
            rb.onmouseleave = () => { rb.style.borderColor = 'rgba(255,255,255,0.1)'; rb.style.background = 'rgba(255,255,255,0.05)' }
            rb.onclick = async () => {
              ratingRow.querySelectorAll('button').forEach((b: any) => { b.disabled = true; b.style.borderColor = 'rgba(255,255,255,0.1)'; b.style.background = 'rgba(255,255,255,0.05)' })
              rb.style.borderColor = config.theme.primaryColor
              rb.style.background  = config.theme.primaryColor + '20'
              state.current.rating      = r.score
              state.current.ratingLabel = r.label
              addMsg('user', r.emoji + ' ' + r.label)
              await showLikertFollowUp(config.experienceFollowUp, r.score, stepQ3)
            }
            ratingRow.appendChild(rb)
          })
          inputRef.current.appendChild(ratingRow)
          scrollBottom()
        }

        // NPS step (or skip)
        if (!npsEnabled) {
          await doExperienceRating()
          return
        }

        clearInput()
        await showTyping(1000)
        const npsPrompt = config.npsPrompt || 'How likely are you to recommend us to a friend or someone you know?'
        addMsg('bot', npsPrompt)
        await showTyping(300)

        if (!inputRef.current) return
        const stars = [
          { stars: '⭐',         label: '1 - No',         score: 1 },
          { stars: '⭐⭐',       label: '2 - Unlikely',   score: 2 },
          { stars: '⭐⭐⭐',     label: '3 - Maybe',      score: 3 },
          { stars: '⭐⭐⭐⭐',   label: '4 - Likely',     score: 4 },
          { stars: '⭐⭐⭐⭐⭐', label: '5 - Definitely!', score: 5 },
        ]
        const npsRow = document.createElement('div')
        npsRow.className = 'flex gap-1 mt-1.5'
        stars.forEach(s => {
          const sb = document.createElement('button')
          sb.className = 'flex flex-col items-center gap-1 rounded-xl px-1 py-2 flex-1 min-w-0 transition-all'
          sb.style.cssText = 'background:rgba(255,255,255,0.05);border:2px solid rgba(255,255,255,0.1);cursor:pointer;font-family:inherit;'
          sb.innerHTML = '<span style="font-size:13px">' + s.stars + '</span><span style="font-size:8px;font-weight:600;color:rgba(255,255,255,0.4);text-align:center">' + s.label + '</span>'
          sb.onmouseenter = () => { sb.style.borderColor = config.theme.primaryColor; sb.style.background = config.theme.primaryColor + '18' }
          sb.onmouseleave = () => { sb.style.borderColor = 'rgba(255,255,255,0.1)'; sb.style.background = 'rgba(255,255,255,0.05)' }
          sb.onclick = async () => {
            npsRow.querySelectorAll('button').forEach((b: any) => b.disabled = true)
            sb.style.borderColor = config.theme.primaryColor
            sb.style.background  = config.theme.primaryColor + '20'
            state.current.npsScore = s.score
            state.current.npsLabel = s.label
            state.current.sentiment = s.score >= 5 ? 'promoter' : s.score >= 4 ? 'passive' : 'detractor'
            addMsg('user', s.stars + ' ' + s.label)
            await showLikertFollowUp(config.npsFollowUp, s.score, doExperienceRating)
          }
          npsRow.appendChild(sb)
        })
        inputRef.current.appendChild(npsRow)
        scrollBottom()
      }
      row.appendChild(btn)
    })

    inputRef.current.appendChild(row)
    scrollBottom()
  }, [addMsg, clearInput, config, inputRef, progressFlow, scrollBottom, showLikertFollowUpInput, showTextInput, showTyping, state])

  return { renderInput }
}

