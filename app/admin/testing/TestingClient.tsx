'use client'

import { useState, useCallback, useRef } from 'react'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'

// ── Shared types ────────────────────────────────────────────────────────

interface AIResult { input: string; label?: string; output: string | null; type: 'deflect' | 'clarify'; ms: number }
interface SimLog { text: string; type: 'ok' | 'err' | 'info' | 'dim' }
interface StudyQuestion { id: string; label: string; prompt: string }

interface Props {
  logoUrl?: string; orgName?: string; fullName?: string; userEmail: string
  analyzeEnabled?: boolean; campaignsEnabled?: boolean; features?: Record<string, boolean>
}

// ── Test data ───────────────────────────────────────────────────────────

const DEFLECT_EXAMPLES = [
  { label: 'Direct question', text: 'What are your hours on Saturday?' },
  { label: 'Help request', text: 'Can someone call me about my account?' },
  { label: 'Off-topic', text: 'I need to update my address on file.' },
  { label: 'Pricing question', text: 'How much does the premium plan cost?' },
  { label: 'Who are you', text: 'Wait, who are you? Are you a real person?' },
  { label: 'Rhetorical question', text: 'Why can\'t they just fix the parking situation?' },
  { label: 'Passionate complaint', text: 'They ask ALL THE TIME. Never stop asking.' },
  { label: 'Short positive', text: 'Great service.' },
  { label: 'Suggestion', text: 'You should really offer evening appointments.' },
  { label: 'Story/rant', text: 'Last time I came in the receptionist was so rude I almost walked out.' },
  { label: 'Emotional', text: 'Honestly it made my whole week. I was having such a hard time.' },
  { label: 'Vague negative', text: 'Meh. Could be better.' },
]

const CLARIFY_EXAMPLES = [
  { label: 'Vague positive', text: 'It was good.' },
  { label: 'One word', text: 'Fine.' },
  { label: 'Short negative', text: 'Not great.' },
  { label: 'Medium detail', text: 'The staff was friendly but the wait was too long.' },
  { label: 'Detailed (should SKIP)', text: 'The check-in process was slow, the waiting room was uncomfortable, and my appointment started 30 minutes late. But the actual consultation was thorough and helpful.' },
  { label: 'Off-topic', text: 'I like pizza.' },
  { label: 'Decline', text: 'No comment.' },
]

const POSITIVE = [
  "Really impressed with the quality of service. The team went above and beyond.",
  "Everything was smooth from start to finish. Would definitely come back.",
  "Love the attention to detail. You can tell people here really care.",
  "Had a fantastic experience — the staff was incredibly helpful and friendly.",
  "Very professional and welcoming. Made me feel valued as a customer.",
  "The whole process was seamless. I appreciated how organized everything was.",
  "I was blown away by how responsive the team was to my needs.",
  "Top-notch service. I've already recommended you to friends.",
  "Such a pleasant surprise. Everything about my visit was outstanding.",
  "Couldn't be happier with how everything turned out. Well done.",
]
const NEUTRAL = [
  "It was fine overall. Nothing spectacular but nothing bad either.",
  "Decent experience. A few things could be improved but generally okay.",
  "Pretty standard service. Met my expectations but didn't exceed them.",
  "Not bad. I've had better experiences elsewhere but also much worse.",
  "Average experience. The main thing got done which is what matters.",
  "Satisfactory but room for improvement in a few areas.",
  "Got what I needed done. Wouldn't say it was memorable though.",
]
const NEGATIVE = [
  "Pretty disappointed with the experience. Felt rushed and overlooked.",
  "The wait times were unacceptable. I almost left before being seen.",
  "Communication was really poor. Nobody seemed to know what was going on.",
  "Several things went wrong and nobody seemed to care about fixing them.",
  "Frustrating experience. Had to repeat myself multiple times.",
  "I left feeling worse than when I arrived. Very disappointing.",
]
const SUGGESTIONS = [
  "Would be nice to have an online booking system so I don't have to call.",
  "A loyalty program or repeat customer discount would go a long way.",
  "More transparency about pricing upfront would help set expectations.",
  "The website could use an update — it's hard to find basic information.",
  "It'd be great to get text message reminders instead of just email.",
  "Better signage inside would help first-time visitors navigate.",
  "A mobile app would be really convenient for managing appointments.",
]
const DEMO_POOLS: Record<string, string[]> = {
  age: ['18-24','25-34','35-44','45-54','55-64','65+'],
  gender: ['male','female','nonbinary','prefer_not'],
  zip: ['10001','90210','60601','33101','98101','02101','30301','78701'],
  income: ['under_25k','25k_50k','50k_75k','75k_100k','100k_150k','150k_plus'],
  education: ['high_school','some_college','bachelors','masters','doctoral'],
  ethnicity: ['white','black','hispanic','asian','multi','other','prefer_not'],
  employment: ['full_time','part_time','self_employed','student','retired'],
  marital: ['single','married','domestic','divorced','widowed'],
  household: ['1','2','3','4','5_plus'],
}

// ── Helpers ─────────────────────────────────────────────────────────────

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms))
function weightedScore(weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  for (let i = 0; i < weights.length; i++) { r -= weights[i]; if (r <= 0) return i + 1 }
  return weights.length
}
function feedback(score: number, max: number) { const p = score / max; return p >= 0.7 ? pick(POSITIVE) : p >= 0.4 ? pick(NEUTRAL) : pick(NEGATIVE) }
function sentiment(score: number, max: number) { const p = score / max; return p >= 0.7 ? 'positive' : p >= 0.4 ? 'neutral' : 'negative' }

// Extract questions from study config for the dropdown
function extractQuestions(config: any): StudyQuestion[] {
  const questions: StudyQuestion[] = []

  // NPS
  if (config.npsEnabled !== false) {
    questions.push({ id: 'nps', label: 'NPS', prompt: config.npsPrompt || 'How likely are you to recommend us?' })
  }

  // Experience rating
  if (config.experienceEnabled !== false) {
    questions.push({ id: 'experience', label: 'Experience Rating', prompt: config.ratingPrompt || 'How would you rate your experience?' })
  }

  // Opening flow open-ends
  if (config.openingFlow) {
    for (const item of config.openingFlow) {
      if (item.type === 'open_end' && item.prompt) {
        questions.push({ id: 'opening_' + item.id, label: item.exportLabel || 'Opening Q', prompt: item.prompt })
      }
    }
  }

  // Legacy Q1 (sentiment-adapted)
  if (config.promoterQ1) {
    questions.push({ id: 'q1_promoter', label: 'Q1 (Promoter)', prompt: config.promoterQ1 })
  }
  if (config.passiveQ1) {
    questions.push({ id: 'q1_passive', label: 'Q1 (Passive)', prompt: config.passiveQ1 })
  }
  if (config.detractorQ1) {
    questions.push({ id: 'q1_detractor', label: 'Q1 (Detractor)', prompt: config.detractorQ1 })
  }

  // Q3 / Q4
  if (config.q3 && config.q3Enabled !== false) {
    questions.push({ id: 'q3', label: config.q3ExportLabel || 'Q3', prompt: config.q3 })
  }
  if (config.q4 && config.q4Enabled !== false) {
    questions.push({ id: 'q4', label: config.q4ExportLabel || 'Q4', prompt: config.q4 })
  }

  // Custom questions (open-ended only — clarify/deflect don't apply to close-ended)
  if (config.questions) {
    for (const q of config.questions) {
      if (q.enabled !== false && q.type === 'open' && q.prompt) {
        questions.push({ id: 'custom_' + q.id, label: q.exportLabel || q.prompt.slice(0, 40), prompt: q.prompt })
      }
    }
  }

  return questions
}

const HERMES = '#E8632A'

// ── Component ───────────────────────────────────────────────────────────

export default function TestingClient({ logoUrl = '', orgName = '', fullName = '', userEmail, analyzeEnabled, campaignsEnabled, features }: Props) {
  const [tab, setTab] = useState<'ai' | 'load' | 'leakage'>('load')

  // Shared
  const [studyGuid, setStudyGuid] = useState('')
  const [studyConfig, setStudyConfig] = useState<any>(null)
  const [studyName, setStudyName] = useState('')
  const [studyOrgName, setStudyOrgName] = useState('')
  const [loadingStudy, setLoadingStudy] = useState(false)
  const [studyQuestions, setStudyQuestions] = useState<StudyQuestion[]>([])

  // AI tester
  const [aiResults, setAiResults] = useState<AIResult[]>([])
  const [aiInput, setAiInput] = useState('')
  const [aiQuestion, setAiQuestion] = useState('How would you describe your overall experience?')
  const [aiQuestionSource, setAiQuestionSource] = useState('custom') // 'custom' or question id
  const [aiRunning, setAiRunning] = useState(false)
  const [aiBatch, setAiBatch] = useState(false)

  // Leakage tester
  interface LeakResult { input: string; question: string; output: string; leaked: boolean; pattern: string; ms: number }
  const [leakResults, setLeakResults] = useState<LeakResult[]>([])
  const [leakRunning, setLeakRunning] = useState(false)
  const [leakReps, setLeakReps] = useState(5)
  const [leakProgress, setLeakProgress] = useState({ done: 0, total: 0, leaked: 0 })
  const leakStop = useRef(false)
  const [customComments, setCustomComments] = useState('')
  const [useCustom, setUseCustom] = useState(false)

  // Load tester
  const [simCount, setSimCount] = useState(10)
  const [simMix, setSimMix] = useState('realistic')
  const [simRunning, setSimRunning] = useState(false)
  const [simLogs, setSimLogs] = useState<SimLog[]>([])
  const [simProgress, setSimProgress] = useState({ done: 0, total: 0, ok: 0, fail: 0 })
  const simStop = useRef(false)
  const logEnd = useRef<HTMLDivElement>(null)

  const simLog = useCallback((text: string, type: SimLog['type'] = 'ok') => {
    setSimLogs(prev => [...prev, { text, type }])
    setTimeout(() => logEnd.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [])

  // ── Load study ──────────────────────────────────────────────────────

  const loadStudy = useCallback(async () => {
    if (!studyGuid.trim()) return
    setLoadingStudy(true)
    try {
      const res = await fetch(`/api/study/${studyGuid.trim()}`)
      if (!res.ok) throw new Error('Study not found (' + res.status + ')')
      const data = await res.json()
      setStudyConfig(data.config)
      setStudyName(data.bot_name)
      setStudyOrgName(data.org_name || data.name || '')
      const qs = extractQuestions(data.config)
      setStudyQuestions(qs)
      // Auto-select first question if available
      if (qs.length > 0) {
        setAiQuestionSource(qs[0].id)
        setAiQuestion(qs[0].prompt)
      }
    } catch (err) {
      alert((err as Error).message)
    }
    setLoadingStudy(false)
  }, [studyGuid])

  // Handle question dropdown change
  const handleQuestionChange = (value: string) => {
    setAiQuestionSource(value)
    if (value === 'custom') {
      setAiQuestion('')
    } else {
      const q = studyQuestions.find(q => q.id === value)
      if (q) setAiQuestion(q.prompt)
    }
  }

  // ── AI: deflect ─────────────────────────────────────────────────────

  const testDeflect = useCallback(async (text: string): Promise<AIResult> => {
    const qr = studyConfig?.questionRedirect || {}
    const start = Date.now()
    const res = await fetch('/api/deflect', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studyName: studyOrgName || studyName || 'Test Org', orgName: studyOrgName || '', questionAsked: aiQuestion, answer: text, linkText: qr.linkText || '', linkUrl: qr.linkUrl || '', customMessage: qr.message || '' }),
    })
    const data = await res.json()
    return { input: text, output: data.deflection ? data.deflection.replace(/<[^>]+>/g, '') : null, type: 'deflect', ms: Date.now() - start }
  }, [studyConfig, studyName, aiQuestion])

  // ── AI: clarify ─────────────────────────────────────────────────────

  const testClarify = useCallback(async (text: string): Promise<AIResult> => {
    const start = Date.now()
    const res = await fetch('/api/clarify', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studyName: studyOrgName || studyName || 'Test Org', studyPurpose: studyConfig?.greeting || 'Collecting feedback', questionAsked: aiQuestion, questionKey: 'q3', answer: text, sentiment: 'neutral', experienceScore: 3, npsScore: 3, priorQA: [], industry: studyConfig?.industry || '' }),
    })
    const data = await res.json()
    return { input: text, output: data.question || null, type: 'clarify', ms: Date.now() - start }
  }, [studyConfig, studyName, aiQuestion])

  const runAI = useCallback(async (text: string, type: 'deflect' | 'clarify') => {
    if (!text.trim()) return
    setAiRunning(true)
    try {
      const r = type === 'deflect' ? await testDeflect(text) : await testClarify(text)
      setAiResults(prev => [r, ...prev])
    } catch (err) {
      setAiResults(prev => [{ input: text, output: 'ERROR: ' + (err as Error).message, type, ms: 0 }, ...prev])
    }
    setAiRunning(false)
  }, [testDeflect, testClarify])

  const runAIBatch = useCallback(async (type: 'deflect' | 'clarify') => {
    setAiBatch(true)
    const examples = type === 'deflect' ? DEFLECT_EXAMPLES : CLARIFY_EXAMPLES
    for (const ex of examples) {
      try {
        const r = type === 'deflect' ? await testDeflect(ex.text) : await testClarify(ex.text)
        setAiResults(prev => [{ ...r, label: ex.label }, ...prev])
      } catch (err) {
        setAiResults(prev => [{ input: ex.text, label: ex.label, output: 'ERROR: ' + (err as Error).message, type, ms: 0 }, ...prev])
      }
      await sleep(800)
    }
    setAiBatch(false)
  }, [testDeflect, testClarify])

  // ── Leakage detection ────────────────────────────────────────────────

  const LEAKAGE_PATTERNS: { pattern: RegExp; label: string }[] = [
    { pattern: /^(Got it|Sure|Okay|I see|Understood|Right|Interesting)\b/i, label: 'Preamble: "Got it/Sure/Okay..."' },
    { pattern: /here'?s?\s+(my|a|the)\s+(follow[- ]?up|question)/i, label: 'Reasoning: "Here\'s my follow-up"' },
    { pattern: /\b(the respondent|they('ve| have| are| indicated| mentioned| seem))/i, label: 'Analysis: "The respondent..."' },
    { pattern: /\b(let me|I'll|I will|I want to|I should)\b/i, label: 'Self-talk: "Let me/I\'ll..."' },
    { pattern: /\b(based on|given that|since they|considering|it (seems|appears|sounds))\b/i, label: 'Reasoning: "Based on/Given that..."' },
    { pattern: /\b(my follow-up|my question|my response)\b/i, label: 'Self-reference: "my follow-up"' },
    { pattern: /\b(analysis|classify|categorize|determine|assess)\b/i, label: 'Meta-language: analysis/classify' },
    { pattern: /^["'][^]*["']\s*$/, label: 'Wrapped in quotes' },
    { pattern: /---/, label: 'Contains separator "---"' },
    { pattern: /.{150,}/, label: 'Suspiciously long (>150 chars)' },
  ]

  function detectLeakage(text: string): { leaked: boolean; pattern: string } {
    for (const { pattern, label } of LEAKAGE_PATTERNS) {
      if (pattern.test(text)) return { leaked: true, pattern: label }
    }
    return { leaked: false, pattern: '' }
  }

  const SAMPLE_RESPONSES = [
    'It was good.', 'Fine.', 'Not great.', 'Pretty bad actually.',
    'Love it!', 'Meh.', 'Could be better.', 'No comment.',
    'The staff was friendly but the wait was too long.',
    'I had a great experience overall.',
    'Nothing special to report.',
    'I was really disappointed with the service.',
    'Everything went smoothly.',
    'Needs improvement.',
    'Best experience ever!',
    'Terrible. Would not recommend.',
    'Average I suppose.',
    "I don't know what to say.",
    'The food was cold when it arrived.',
    'Very professional and helpful staff.',
  ]

  const runLeakageTest = useCallback(async () => {
    if (!studyConfig || studyQuestions.length === 0) { alert('Load a study with questions first'); return }

    // Build test corpus: custom comments if provided, otherwise defaults
    const customLines = customComments.split('\n').map(l => l.trim()).filter(Boolean)
    const testResponses = useCustom && customLines.length > 0 ? customLines : SAMPLE_RESPONSES

    leakStop.current = false
    setLeakRunning(true)
    setLeakResults([])
    const total = testResponses.length * leakReps
    setLeakProgress({ done: 0, total, leaked: 0 })

    let done = 0, leaked = 0

    for (const sampleAnswer of testResponses) {
      if (leakStop.current) break
      for (let rep = 0; rep < leakReps; rep++) {
        if (leakStop.current) break
        // Pick a random question for variety
        const q = studyQuestions[Math.floor(Math.random() * studyQuestions.length)]
        const start = Date.now()
        try {
          const res = await fetch('/api/clarify', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              studyName: studyOrgName || studyName || 'Test Org',
              studyPurpose: studyConfig?.greeting || 'Collecting feedback',
              questionAsked: q.prompt,
              questionKey: 'q3',
              answer: sampleAnswer,
              sentiment: 'neutral',
              experienceScore: 3,
              npsScore: 3,
              priorQA: [],
              industry: studyConfig?.industry || '',
            }),
          })
          const data = await res.json()
          const output = data.question || '(SKIP)'
          const ms = Date.now() - start

          const detection = output !== '(SKIP)' ? detectLeakage(output) : { leaked: false, pattern: '' }
          if (detection.leaked) leaked++
          setLeakResults(prev => [{
            input: sampleAnswer, question: q.prompt, output, leaked: detection.leaked, pattern: detection.pattern, ms,
          }, ...prev])
        } catch (err) {
          setLeakResults(prev => [{
            input: sampleAnswer, question: q.prompt, output: 'ERROR: ' + (err as Error).message, leaked: false, pattern: '', ms: Date.now() - start,
          }, ...prev])
        }

        done++
        setLeakProgress({ done, total, leaked })
        await sleep(300) // rate limit friendly
      }
    }

    setLeakRunning(false)
  }, [studyConfig, studyQuestions, studyOrgName, studyName, leakReps, customComments, useCustom])

  // ── Load tester (simulator) ─────────────────────────────────────────

  const runSim = useCallback(async () => {
    if (!studyConfig || !studyGuid.trim()) { alert('Load a study first'); return }
    simStop.current = false
    setSimRunning(true)
    setSimLogs([])
    setSimProgress({ done: 0, total: simCount, ok: 0, fail: 0 })

    const weights = simMix === 'positive' ? [2,5,10,40,43] : simMix === 'negative' ? [30,30,20,12,8] : simMix === 'uniform' ? [20,20,20,20,20] : [5,10,20,35,30]
    const config = studyConfig
    const scale = config.ratingScale || [{ score: 1, label: 'Poor' },{ score: 2, label: 'Fair' },{ score: 3, label: 'Average' },{ score: 4, label: 'Good' },{ score: 5, label: 'Excellent' }]
    const maxScore = Math.max(...scale.map((r: any) => r.score))

    simLog(`Generating ${simCount} responses for "${studyName}"...`, 'info')
    let ok = 0, fail = 0

    for (let i = 0; i < simCount; i++) {
      if (simStop.current) { simLog('Stopped.', 'info'); break }

      const sid = 'sim_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
      const nps = weightedScore(weights), exp = weightedScore(weights)
      const npsOpt = scale.find((r: any) => r.score === nps) || { label: 'Score ' + nps }
      const expOpt = scale.find((r: any) => r.score === exp) || { label: 'Score ' + exp }
      const payload: Record<string, any> = { agent: 'Simulator', timestamp: new Date().toISOString() }

      // Partial 1: NPS
      if (config.npsEnabled !== false) payload.npsRecommend = { score: nps, label: npsOpt.label }
      try { await fetch('/api/respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ study_guid: studyGuid.trim(), payload: { ...payload }, duration_sec: 15 + Math.floor(Math.random() * 20), session_id: sid, status: 'incomplete' }) }) } catch {}
      await sleep(80)

      // Partial 2: Experience + Q1
      if (config.experienceEnabled !== false) payload.experienceRating = { score: exp, label: expOpt.label, sentiment: sentiment(exp, maxScore) }
      if (Math.random() < 0.7) { if (!payload.openEnded) payload.openEnded = {}; payload.openEnded.q1 = feedback(nps, maxScore) }
      try { await fetch('/api/respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ study_guid: studyGuid.trim(), payload: { ...payload, openEnded: { ...payload.openEnded } }, duration_sec: 45 + Math.floor(Math.random() * 30), session_id: sid, status: 'incomplete' }) }) } catch {}
      await sleep(80)

      // Partial 3: Q3/Q4 + custom
      if (!payload.openEnded) payload.openEnded = {}
      if (config.q3Enabled !== false) payload.openEnded.q3 = feedback(exp, maxScore)
      if (config.q4Enabled !== false) payload.openEnded.q4 = pick(SUGGESTIONS)
      if (config.questions?.length) {
        const ca: Record<string, any> = {}
        config.questions.filter((q: any) => q.enabled !== false && q.type !== 'hidden').forEach((q: any) => {
          if (q.type === 'open') ca[q.id] = pick([...POSITIVE, ...NEUTRAL, ...SUGGESTIONS])
          else if ((q.type === 'radio' || q.type === 'dropdown') && q.options?.length) ca[q.id] = pick(q.options)
          else if (q.type === 'checkbox' && q.options?.length) { const n = Math.floor(Math.random() * Math.min(3, q.options.length)) + 1; ca[q.id] = [...q.options].sort(() => Math.random() - 0.5).slice(0, n) }
          else if (q.type === 'likert' || q.type === 'rating') ca[q.id] = String(weightedScore(weights))
          else if (q.type === 'numeric') ca[q.id] = String(Math.floor(Math.random() * 100) + 1)
        })
        if (Object.keys(ca).length) payload.customAnswers = ca
      }
      try { await fetch('/api/respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ study_guid: studyGuid.trim(), payload: { ...payload }, duration_sec: 90 + Math.floor(Math.random() * 60), session_id: sid, status: 'incomplete' }) }) } catch {}
      await sleep(80)

      // Psychographics + demographics + opening flow
      if (config.psychographicBank?.length) { const ps: Record<string, string> = {}; const pool = [...config.psychographicBank]; const n = config.psychoCount || 3; for (let j = 0; j < n && pool.length; j++) { const idx = Math.floor(Math.random() * pool.length); const q = pool.splice(idx, 1)[0]; ps[q.key] = q.opts?.length ? pick(q.opts) : pick(['Strongly agree','Agree','Neutral','Disagree']) }; payload.psychographics = ps }
      if (config.demographicFields) { const dm: Record<string, string> = {}; config.demographicFields.filter((d: any) => d.enabled).forEach((f: any) => { if (f.options?.length) dm[f.key] = (pick(f.options) as string[])[0]; else if (DEMO_POOLS[f.key]) dm[f.key] = pick(DEMO_POOLS[f.key]) }); if (Object.keys(dm).length) payload.demographics = dm }
      if (config.openingFlow) { const opens = config.openingFlow.filter((f: any) => f.type === 'open_end'); if (opens.length) { const oa: Record<string, string> = {}; opens.forEach((item: any) => { oa[item.id] = feedback(exp, maxScore) }); payload.openingAnswers = oa } }

      // Final submit
      const duration = Math.floor(Math.random() * 510) + 90
      try {
        const res = await fetch('/api/respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ study_guid: studyGuid.trim(), payload, duration_sec: duration, session_id: sid, status: 'complete' }) })
        const data = await res.json()
        if (res.ok) { ok++; simLog(`${i+1}/${simCount}  exp:${exp} nps:${nps}  ${duration}s  id:${data.response_id}`) }
        else { fail++; simLog(`${i+1}/${simCount}  FAILED ${res.status}: ${JSON.stringify(data)}`, 'err') }
      } catch (err) { fail++; simLog(`${i+1}/${simCount}  NETWORK ERROR: ${(err as Error).message}`, 'err') }

      setSimProgress({ done: i + 1, total: simCount, ok, fail })
      if (!simStop.current && i < simCount - 1) await sleep(2500)
    }

    simLog(`Done! ${ok} saved, ${fail} failed.`, 'info')
    setSimRunning(false)
  }, [studyConfig, studyGuid, studyName, simCount, simMix, simLog])

  // ── Render ────────────────────────────────────────────────────────────

  const pct = simProgress.total > 0 ? Math.round((simProgress.done / simProgress.total) * 100) : 0

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="fixed top-0 left-0 right-0 z-50">
        <TopNav
          logoUrl={logoUrl}
          orgName={orgName}
          isAdmin={true}
          userEmail={userEmail}
          fullName={fullName}
          currentPage="test-spinner"
          analyzeEnabled={analyzeEnabled}
          campaignsEnabled={campaignsEnabled}
          features={features}
        />
      </div>
      <SubHeader crumbs={[{ label: 'Admin', href: '/admin' }, { label: 'Testing Tools' }]} />

      <main className="max-w-3xl mx-auto px-6 py-8 pt-28 w-full">
        <h1 className="text-xl font-bold text-gray-800">Testing Tools</h1>
        <p className="text-sm text-gray-500 mb-4">Load test responses and test AI features across any study</p>

        {/* Study loader (shared) */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-4">
          <label className="block text-xs font-semibold text-gray-500 mb-1">Study GUID</label>
          <div className="flex gap-2">
            <input
              type="text" value={studyGuid} onChange={e => setStudyGuid(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') loadStudy() }}
              placeholder="Paste study GUID..."
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:outline-none"
            />
            <button onClick={loadStudy} disabled={loadingStudy || !studyGuid.trim()}
              className="px-4 py-2 text-white rounded-lg text-sm font-medium hover:opacity-90 disabled:opacity-40"
              style={{ background: HERMES }}>
              {loadingStudy ? 'Loading...' : 'Load'}
            </button>
          </div>
          {studyName && (
            <div className="mt-2 text-sm bg-orange-50 border border-orange-100 rounded-lg px-3 py-2" style={{ color: HERMES }}>
              <strong>{studyName}</strong>
              {studyConfig?.questionRedirect?.enabled && (
                <span className="text-gray-500"> — deflection {studyConfig.questionRedirect.message ? `"${studyConfig.questionRedirect.message}"` : 'AI-generated'}{studyConfig.questionRedirect.linkUrl ? ' + link' : ''}</span>
              )}
              {studyQuestions.length > 0 && (
                <span className="text-gray-400"> — {studyQuestions.length} questions found</span>
              )}
            </div>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 bg-white border border-gray-200 rounded-xl p-1 shadow-sm">
          <button onClick={() => setTab('load')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'load' ? 'text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            style={tab === 'load' ? { background: HERMES } : {}}>
            Load Tester
          </button>
          <button onClick={() => setTab('ai')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'ai' ? 'text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            style={tab === 'ai' ? { background: HERMES } : {}}>
            AI Tester
          </button>
          <button onClick={() => setTab('leakage')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${tab === 'leakage' ? 'text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            style={tab === 'leakage' ? { background: HERMES } : {}}>
            Leakage Test
          </button>
        </div>

        {/* ── Load Tester tab ──────────────────────────────────────── */}
        {tab === 'load' && (
          <>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-4">
              <p className="text-sm text-gray-500 mb-4">Generate realistic responses with partial saves and final submit — just like a real user.</p>
              <div className="flex gap-3 mb-4">
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Count</label>
                  <input type="number" value={simCount} onChange={e => setSimCount(parseInt(e.target.value) || 10)} min={1} max={500} disabled={simRunning}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:outline-none" />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Sentiment mix</label>
                  <select value={simMix} onChange={e => setSimMix(e.target.value)} disabled={simRunning}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:outline-none bg-white">
                    <option value="realistic">Realistic (skew positive)</option>
                    <option value="uniform">Uniform spread</option>
                    <option value="positive">Mostly positive</option>
                    <option value="negative">Mostly negative</option>
                  </select>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={runSim} disabled={simRunning || !studyConfig}
                  className="px-5 py-2.5 text-white rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                  style={{ background: HERMES }}>
                  {simRunning ? 'Generating...' : `Generate ${simCount} responses`}
                </button>
                {simRunning && (
                  <button onClick={() => { simStop.current = true }}
                    className="px-5 py-2.5 bg-red-100 text-red-600 rounded-lg text-sm font-semibold hover:bg-red-200 transition-all">
                    Stop
                  </button>
                )}
                {!studyConfig && <span className="text-xs text-gray-400">Load a study first</span>}
              </div>

              {simProgress.total > 0 && (
                <div className="mt-4">
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-300" style={{ width: pct + '%', background: HERMES }} />
                  </div>
                  <div className="text-xs text-gray-500 mt-1 text-right">
                    {simProgress.done} / {simProgress.total} ({simProgress.ok} saved{simProgress.fail > 0 ? `, ${simProgress.fail} failed` : ''})
                  </div>
                </div>
              )}
            </div>

            {simLogs.length > 0 && (
              <div className="bg-gray-900 rounded-xl p-4 max-h-[400px] overflow-y-auto font-mono text-xs leading-relaxed">
                {simLogs.map((l, i) => (
                  <div key={i} className={l.type === 'err' ? 'text-red-400' : l.type === 'info' ? 'text-sky-400' : l.type === 'dim' ? 'text-gray-600' : 'text-green-400'}>{l.text}</div>
                ))}
                <div ref={logEnd} />
              </div>
            )}
          </>
        )}

        {/* ── AI Tester tab ────────────────────────────────────────── */}
        {tab === 'ai' && (
          <>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-4">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Bot question being answered (context for AI)</label>
              {studyQuestions.length > 0 ? (
                <div className="flex flex-col gap-2">
                  <select value={aiQuestionSource} onChange={e => handleQuestionChange(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:outline-none bg-white">
                    {studyQuestions.map(q => (
                      <option key={q.id} value={q.id}>{q.label}: {q.prompt.length > 60 ? q.prompt.slice(0, 60) + '...' : q.prompt}</option>
                    ))}
                    <option value="custom">Custom question...</option>
                  </select>
                  {aiQuestionSource === 'custom' && (
                    <input type="text" value={aiQuestion} onChange={e => setAiQuestion(e.target.value)}
                      placeholder="Type a custom question..."
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:outline-none" />
                  )}
                  {aiQuestionSource !== 'custom' && (
                    <div className="text-xs text-gray-400 bg-gray-50 rounded-lg px-3 py-2">{aiQuestion}</div>
                  )}
                </div>
              ) : (
                <input type="text" value={aiQuestion} onChange={e => setAiQuestion(e.target.value)}
                  placeholder="Load a study to populate questions, or type one manually"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:outline-none" />
              )}
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-4">
              <label className="block text-xs font-semibold text-gray-500 mb-2">Test a respondent reply</label>
              <div className="flex gap-2 mb-3">
                <input type="text" value={aiInput} onChange={e => setAiInput(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && aiInput.trim()) runAI(aiInput.trim(), 'deflect') }}
                  placeholder="Type what a respondent might say..."
                  className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:outline-none" disabled={aiRunning} />
                <button onClick={() => runAI(aiInput.trim(), 'deflect')} disabled={aiRunning || !aiInput.trim()}
                  className="px-4 py-2 bg-orange-500 text-white rounded-lg text-sm font-medium hover:bg-orange-600 disabled:opacity-40">Deflect</button>
                <button onClick={() => runAI(aiInput.trim(), 'clarify')} disabled={aiRunning || !aiInput.trim()}
                  className="px-4 py-2 bg-blue-500 text-white rounded-lg text-sm font-medium hover:bg-blue-600 disabled:opacity-40">Clarify</button>
              </div>
              <div className="flex gap-2 flex-wrap">
                <button onClick={() => runAIBatch('deflect')} disabled={aiBatch}
                  className="px-3 py-1.5 bg-orange-100 text-orange-700 rounded-lg text-xs font-medium hover:bg-orange-200 disabled:opacity-40">
                  {aiBatch ? 'Running...' : `Run all deflect tests (${DEFLECT_EXAMPLES.length})`}
                </button>
                <button onClick={() => runAIBatch('clarify')} disabled={aiBatch}
                  className="px-3 py-1.5 bg-blue-100 text-blue-700 rounded-lg text-xs font-medium hover:bg-blue-200 disabled:opacity-40">
                  {aiBatch ? 'Running...' : `Run all clarify tests (${CLARIFY_EXAMPLES.length})`}
                </button>
                {aiResults.length > 0 && (
                  <button onClick={() => setAiResults([])}
                    className="px-3 py-1.5 bg-gray-100 text-gray-600 rounded-lg text-xs font-medium hover:bg-gray-200 ml-auto">Clear</button>
                )}
              </div>
            </div>

            {aiResults.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 text-xs font-semibold text-gray-500">Results ({aiResults.length})</div>
                <div className="divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
                  {aiResults.map((r, i) => (
                    <div key={i} className="px-5 py-3">
                      <div className="flex items-start gap-3">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded uppercase flex-shrink-0 mt-0.5 ${
                          r.type === 'deflect' ? r.output ? 'bg-orange-100 text-orange-600' : 'bg-green-100 text-green-600'
                            : r.output ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {r.type === 'deflect' ? (r.output ? 'DEFLECTED' : 'PASSED') : (r.output ? 'FOLLOW-UP' : 'SKIPPED')}
                        </span>
                        <div className="flex-1 min-w-0">
                          {r.label && <div className="text-[10px] text-gray-400 font-medium mb-0.5">{r.label}</div>}
                          <div className="text-sm text-gray-700">&ldquo;{r.input}&rdquo;</div>
                          {r.output && <div className={`text-sm mt-1 ${r.output.startsWith('ERROR') ? 'text-red-500' : 'text-gray-500 italic'}`}>&rarr; {r.output}</div>}
                        </div>
                        <span className="text-[10px] text-gray-400 flex-shrink-0">{r.ms}ms</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ── Leakage Test tab ─────────────────────────────────────── */}
        {tab === 'leakage' && (
          <>
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 mb-4">
              <h3 className="font-semibold text-sm text-gray-800 mb-1">AI Thought Leakage Tester</h3>
              <p className="text-sm text-gray-500 mb-4">
                Fires the clarifier API many times with sample responses and checks if the AI leaks
                internal reasoning (e.g. &quot;Got it&quot;, &quot;The respondent...&quot;, &quot;Here&apos;s my follow-up&quot;).
                Tests both the prompt quality and the server-side stripping.
              </p>

              {/* Source toggle */}
              <div className="flex items-center gap-3 mb-3">
                <button onClick={() => setUseCustom(false)} disabled={leakRunning}
                  className={'text-xs px-3 py-1.5 rounded-lg font-medium border transition-all ' +
                    (!useCustom ? 'text-white border-transparent' : 'text-gray-500 border-gray-200 hover:border-orange-300')}
                  style={!useCustom ? { background: HERMES } : {}}>
                  Default samples ({SAMPLE_RESPONSES.length})
                </button>
                <button onClick={() => setUseCustom(true)} disabled={leakRunning}
                  className={'text-xs px-3 py-1.5 rounded-lg font-medium border transition-all ' +
                    (useCustom ? 'text-white border-transparent' : 'text-gray-500 border-gray-200 hover:border-orange-300')}
                  style={useCustom ? { background: HERMES } : {}}>
                  Paste custom comments
                </button>
              </div>

              {/* Custom comments textarea */}
              {useCustom && (
                <div className="mb-3">
                  <label className="block text-xs font-semibold text-gray-500 mb-1">
                    Paste comments (one per line)
                  </label>
                  <textarea
                    value={customComments}
                    onChange={e => setCustomComments(e.target.value)}
                    disabled={leakRunning}
                    rows={6}
                    placeholder={"The service was excellent\nI had a terrible experience\nNothing special to report\nThe staff was very helpful but slow"}
                    className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-orange-400 resize-y font-mono disabled:opacity-50"
                  />
                  <p className="text-[10px] text-gray-400 mt-1">
                    {customComments.split('\n').filter(l => l.trim()).length} comments entered
                  </p>
                </div>
              )}

              <div className="flex gap-3 mb-4 items-end">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Reps per response</label>
                  <select value={leakReps} onChange={e => setLeakReps(parseInt(e.target.value))} disabled={leakRunning}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:outline-none bg-white">
                    <option value={3}>3x (quick)</option>
                    <option value={5}>5x (standard)</option>
                    <option value={10}>10x (thorough)</option>
                    <option value={20}>20x (comprehensive)</option>
                  </select>
                </div>
                <div className="text-xs text-gray-400">
                  {(useCustom ? customComments.split('\n').filter(l => l.trim()).length : SAMPLE_RESPONSES.length)} responses &times; {leakReps} reps = {(useCustom ? customComments.split('\n').filter(l => l.trim()).length : SAMPLE_RESPONSES.length) * leakReps} API calls
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button onClick={runLeakageTest} disabled={leakRunning || !studyConfig || studyQuestions.length === 0}
                  className="px-5 py-2.5 text-white rounded-lg text-sm font-semibold hover:opacity-90 disabled:opacity-40 transition-all"
                  style={{ background: HERMES }}>
                  {leakRunning ? 'Testing...' : 'Run Leakage Test'}
                </button>
                {leakRunning && (
                  <button onClick={() => { leakStop.current = true }}
                    className="px-5 py-2.5 bg-red-100 text-red-600 rounded-lg text-sm font-semibold hover:bg-red-200 transition-all">
                    Stop
                  </button>
                )}
                {!studyConfig && <span className="text-xs text-gray-400">Load a study first</span>}
                {studyConfig && studyQuestions.length === 0 && <span className="text-xs text-gray-400">Study has no questions to test</span>}
              </div>

              {/* Progress */}
              {leakProgress.total > 0 && (
                <div className="mt-4">
                  <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all duration-300"
                      style={{ width: Math.round(leakProgress.done / leakProgress.total * 100) + '%', background: leakProgress.leaked > 0 ? '#dc2626' : '#16a34a' }} />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-xs text-gray-500">
                      {leakProgress.done} / {leakProgress.total} tested
                    </span>
                    <span className={'text-xs font-semibold ' + (leakProgress.leaked > 0 ? 'text-red-600' : 'text-green-600')}>
                      {leakProgress.leaked} leaked ({leakProgress.done > 0 ? Math.round(leakProgress.leaked / leakProgress.done * 100) : 0}%)
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Summary */}
            {leakResults.length > 0 && !leakRunning && (
              <div className={'rounded-xl shadow-sm border p-4 mb-4 ' + (leakProgress.leaked > 0 ? 'bg-red-50 border-red-200' : 'bg-green-50 border-green-200')}>
                <div className={'text-sm font-bold ' + (leakProgress.leaked > 0 ? 'text-red-700' : 'text-green-700')}>
                  {leakProgress.leaked > 0
                    ? `${leakProgress.leaked} leakage(s) detected in ${leakProgress.done} tests (${Math.round(leakProgress.leaked / leakProgress.done * 100)}% leak rate)`
                    : `All ${leakProgress.done} tests passed — no leakage detected`}
                </div>
                {leakProgress.leaked > 0 && (
                  <p className="text-xs text-red-600 mt-1">Review leaked responses below. The server-side stripping may need additional patterns.</p>
                )}
              </div>
            )}

            {/* Leaked results — full thread */}
            {leakResults.filter(r => r.leaked).length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-red-200 overflow-hidden mb-4">
                <div className="px-5 py-3 border-b border-red-100 text-xs font-semibold text-red-600">
                  Leaked Responses ({leakResults.filter(r => r.leaked).length})
                </div>
                <div className="divide-y divide-red-50 max-h-[500px] overflow-y-auto">
                  {leakResults.filter(r => r.leaked).map((r, i) => (
                    <div key={i} className="px-4 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-red-100 text-red-600">LEAKED — {r.pattern}</span>
                        <span className="text-[10px] text-gray-400">{r.ms}ms</span>
                      </div>
                      {/* Conversation thread */}
                      <div className="space-y-1.5 ml-2 border-l-2 border-red-200 pl-3">
                        <div>
                          <div className="text-[10px] font-semibold text-gray-400 mb-0.5">BOT ASKED:</div>
                          <div className="text-xs text-gray-600 bg-gray-50 rounded px-2 py-1">{r.question}</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold text-blue-400 mb-0.5">RESPONDENT SAID:</div>
                          <div className="text-xs text-gray-700 bg-blue-50 rounded px-2 py-1">&ldquo;{r.input}&rdquo;</div>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold text-red-500 mb-0.5">CLARIFIER RESPONDED:</div>
                          <div className="text-sm text-red-700 font-medium bg-red-50 rounded px-2 py-1.5 border border-red-200">{r.output}</div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* All results — full thread view */}
            {leakResults.length > 0 && (
              <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 border-b border-gray-100 text-xs font-semibold text-gray-500">
                  All Results ({leakResults.length})
                </div>
                <div className="divide-y divide-gray-100 max-h-[600px] overflow-y-auto">
                  {leakResults.map((r, i) => (
                    <div key={i} className="px-4 py-3">
                      <div className="flex items-center justify-between mb-2">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${r.leaked ? 'bg-red-100 text-red-600' : r.output === '(SKIP)' ? 'bg-gray-100 text-gray-500' : 'bg-green-100 text-green-600'}`}>
                          {r.leaked ? 'FAIL' : r.output === '(SKIP)' ? 'SKIP' : 'PASS'}
                        </span>
                        <span className="text-[10px] text-gray-400">{r.ms}ms</span>
                      </div>
                      <div className="space-y-1 ml-2 border-l-2 pl-3" style={{ borderColor: r.leaked ? '#fca5a5' : r.output === '(SKIP)' ? '#e5e7eb' : '#bbf7d0' }}>
                        <div className="flex gap-2 items-start">
                          <span className="text-[9px] font-bold text-gray-400 w-10 flex-shrink-0 pt-0.5">BOT</span>
                          <span className="text-xs text-gray-500">{r.question.length > 80 ? r.question.slice(0, 80) + '...' : r.question}</span>
                        </div>
                        <div className="flex gap-2 items-start">
                          <span className="text-[9px] font-bold text-blue-400 w-10 flex-shrink-0 pt-0.5">USER</span>
                          <span className="text-xs text-gray-700">&ldquo;{r.input}&rdquo;</span>
                        </div>
                        <div className="flex gap-2 items-start">
                          <span className={'text-[9px] font-bold w-10 flex-shrink-0 pt-0.5 ' + (r.leaked ? 'text-red-500' : r.output === '(SKIP)' ? 'text-gray-400' : 'text-green-500')}>AI</span>
                          <span className={'text-xs ' + (r.leaked ? 'text-red-700 font-medium' : r.output === '(SKIP)' ? 'text-gray-400 italic' : 'text-gray-600')}>{r.output}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  )
}
