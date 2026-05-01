'use client'

import { useState, useRef, useCallback } from 'react'

// ── Response data pools ─────────────────────────────────────────────────

const POSITIVE = [
  "Really impressed with the quality of service. The team went above and beyond.",
  "Everything was smooth from start to finish. Would definitely come back.",
  "Love the attention to detail. You can tell people here really care.",
  "Had a fantastic experience — the staff was incredibly helpful and friendly.",
  "One of the best experiences I've had. Keep doing what you're doing!",
  "Very professional and welcoming. Made me feel valued as a customer.",
  "The whole process was seamless. I appreciated how organized everything was.",
  "Great atmosphere and wonderful people. Exceeded my expectations.",
  "I was blown away by how responsive the team was to my needs.",
  "Top-notch service. I've already recommended you to friends.",
  "Your team made a complicated situation feel easy. Thank you!",
  "I'm genuinely impressed. This is exactly how customer service should be.",
  "Such a pleasant surprise. Everything about my visit was outstanding.",
  "The quality keeps getting better. Really happy I chose you.",
  "Couldn't be happier with how everything turned out. Well done.",
]

const NEUTRAL = [
  "It was fine overall. Nothing spectacular but nothing bad either.",
  "Decent experience. A few things could be improved but generally okay.",
  "Pretty standard service. Met my expectations but didn't exceed them.",
  "The basics were handled well. Some areas could use a bit more polish.",
  "Not bad. I've had better experiences elsewhere but also much worse.",
  "Average experience. The main thing got done which is what matters.",
  "It was okay. Some staff were great, others seemed disengaged.",
  "Satisfactory but room for improvement in a few areas.",
  "Middle of the road. Nothing to write home about but no complaints.",
  "Got what I needed done. Wouldn't say it was memorable though.",
]

const NEGATIVE = [
  "Pretty disappointed with the experience. Felt rushed and overlooked.",
  "The wait times were unacceptable. I almost left before being seen.",
  "Communication was really poor. Nobody seemed to know what was going on.",
  "I expected much better based on what I'd heard. Let down.",
  "Several things went wrong and nobody seemed to care about fixing them.",
  "Frustrating experience. Had to repeat myself multiple times.",
  "The service didn't match the price at all. Felt overcharged.",
  "Things were disorganized and chaotic. Needs serious improvement.",
  "I left feeling worse than when I arrived. Very disappointing.",
  "Not up to standard. I've been coming for years and quality has dropped.",
]

const SUGGESTIONS = [
  "Would be nice to have an online booking system so I don't have to call.",
  "Maybe add more options for evening availability? Hard to fit into work schedules.",
  "A loyalty program or repeat customer discount would go a long way.",
  "The parking situation needs work. It's really stressful finding a spot.",
  "More transparency about pricing upfront would help set expectations.",
  "Consider adding a feedback kiosk on-site so people can share thoughts in real time.",
  "The website could use an update — it's hard to find basic information.",
  "It'd be great to get text message reminders instead of just email.",
  "Better signage inside would help first-time visitors navigate.",
  "A mobile app would be really convenient for managing appointments.",
]

const DEMO: Record<string, string[]> = {
  age: ['18-24','25-34','35-44','45-54','55-64','65+'],
  gender: ['male','female','nonbinary','prefer_not'],
  zip: ['10001','90210','60601','33101','98101','02101','30301','78701','85001','55401'],
  income: ['under_25k','25k_50k','50k_75k','75k_100k','100k_150k','150k_plus','prefer_not'],
  education: ['high_school','some_college','associates','bachelors','masters','doctoral','prefer_not'],
  ethnicity: ['white','black','hispanic','asian','multi','other','prefer_not'],
  employment: ['full_time','part_time','self_employed','student','retired','unemployed'],
  marital: ['single','married','domestic','divorced','widowed'],
  household: ['1','2','3','4','5_plus'],
}

// ── Helpers ─────────────────────────────────────────────────────────────

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function weightedScore(weights: number[]): number {
  const total = weights.reduce((a, b) => a + b, 0)
  let r = Math.random() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return i + 1
  }
  return weights.length
}

function getWeights(mix: string): number[] {
  switch (mix) {
    case 'positive': return [2, 5, 10, 40, 43]
    case 'negative': return [30, 30, 20, 12, 8]
    case 'uniform':  return [20, 20, 20, 20, 20]
    default:         return [5, 10, 20, 35, 30]
  }
}

function feedbackFor(score: number, max: number): string {
  const pct = score / max
  if (pct >= 0.7) return pick(POSITIVE)
  if (pct >= 0.4) return pick(NEUTRAL)
  return pick(NEGATIVE)
}

function sentiment(score: number, max: number): string {
  const pct = score / max
  if (pct >= 0.7) return 'positive'
  if (pct >= 0.4) return 'neutral'
  return 'negative'
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function generatePayload(config: any, weights: number[]) {
  const scale = config.ratingScale || [
    { score: 1, label: 'Poor' },
    { score: 2, label: 'Fair' },
    { score: 3, label: 'Average' },
    { score: 4, label: 'Good' },
    { score: 5, label: 'Excellent' },
  ]
  const max = Math.max(...scale.map((r: { score: number }) => r.score))

  const nps = weightedScore(weights)
  const exp = weightedScore(weights)
  const npsOpt = scale.find((r: { score: number }) => r.score === nps) || { score: nps, label: 'Score ' + nps }
  const expOpt = scale.find((r: { score: number }) => r.score === exp) || { score: exp, label: 'Score ' + exp }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const payload: Record<string, any> = {
    agent: 'Simulator',
    timestamp: new Date().toISOString(),
  }

  if (config.npsEnabled !== false) {
    payload.npsRecommend = { score: nps, label: npsOpt.label }
  }
  if (config.experienceEnabled !== false) {
    payload.experienceRating = { score: exp, label: expOpt.label, sentiment: sentiment(exp, max) }
  }

  // Open-ended
  const oe: Record<string, string> = {}
  if (config.q3Enabled !== false) oe.q3 = feedbackFor(exp, max)
  if (config.q4Enabled !== false) oe.q4 = pick(SUGGESTIONS)
  if (Math.random() < 0.7) oe.q1 = feedbackFor(nps, max)
  payload.openEnded = oe

  // Opening flow open-ends
  if (config.openingFlow) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const opens = config.openingFlow.filter((f: any) => f.type === 'open_end')
    if (opens.length) {
      const oa: Record<string, string> = {}
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      opens.forEach((item: any) => { oa[item.id] = feedbackFor(exp, max) })
      payload.openingAnswers = oa
    }
  }

  // Custom questions
  if (config.questions) {
    const ca: Record<string, string | string[]> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config.questions.filter((q: any) => q.enabled !== false && q.type !== 'hidden').forEach((q: any) => {
      if (q.type === 'open') ca[q.id] = pick([...POSITIVE, ...NEUTRAL, ...SUGGESTIONS])
      else if ((q.type === 'radio' || q.type === 'dropdown') && q.options?.length) ca[q.id] = pick(q.options)
      else if (q.type === 'checkbox' && q.options?.length) {
        const n = Math.floor(Math.random() * Math.min(3, q.options.length)) + 1
        ca[q.id] = [...q.options].sort(() => Math.random() - 0.5).slice(0, n)
      }
      else if (q.type === 'likert' || q.type === 'rating') ca[q.id] = String(weightedScore(weights))
      else if (q.type === 'numeric') ca[q.id] = String(Math.floor(Math.random() * 100) + 1)
    })
    if (Object.keys(ca).length) payload.customAnswers = ca
  }

  // Psychographics
  if (config.psychographicBank?.length) {
    const ps: Record<string, string> = {}
    const pool = [...config.psychographicBank]
    const n = config.psychoCount || 3
    for (let i = 0; i < n && pool.length; i++) {
      const idx = Math.floor(Math.random() * pool.length)
      const q = pool.splice(idx, 1)[0]
      ps[q.key] = q.opts?.length ? pick(q.opts) : pick(['Strongly agree','Agree','Neutral','Disagree'])
    }
    payload.psychographics = ps
  }

  // Demographics
  if (config.demographicFields) {
    const dm: Record<string, string> = {}
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    config.demographicFields.filter((d: any) => d.enabled).forEach((f: any) => {
      if (f.options?.length) dm[f.key] = (pick(f.options) as string[])[0]
      else if (DEMO[f.key]) dm[f.key] = pick(DEMO[f.key])
      else dm[f.key] = pick(DEMO.zip)
    })
    if (Object.keys(dm).length) payload.demographics = dm
  }

  return { payload, exp, nps, duration: Math.floor(Math.random() * 510) + 90 }
}

// ── Component ───────────────────────────────────────────────────────────

interface LogEntry { text: string; type: 'ok' | 'err' | 'info' | 'dim' }

var HERMES = '#E8632A'

export default function SimulatorPage() {
  const [simTab, setSimTab] = useState<'survey' | 'social'>('survey')

  // Social demo state
  const [demoCandidate, setDemoCandidate] = useState('')
  const [demoContext, setDemoContext] = useState('')
  const [demoPostText, setDemoPostText] = useState('')
  const [demoCount, setDemoCount] = useState(25)
  const [demoLoading, setDemoLoading] = useState(false)
  const [demoResult, setDemoResult] = useState<any>(null)

  // Survey sim state
  const [guid, setGuid] = useState('')
  const [count, setCount] = useState(10)
  const [mix, setMix] = useState('realistic')
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [progress, setProgress] = useState({ done: 0, total: 0, ok: 0, fail: 0 })
  const [studyName, setStudyName] = useState('')
  const stopRef = useRef(false)
  const logEndRef = useRef<HTMLDivElement>(null)

  const addLog = useCallback((text: string, type: LogEntry['type'] = 'ok') => {
    setLogs(prev => [...prev, { text, type }])
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [])

  const run = useCallback(async () => {
    if (!guid.trim()) return
    stopRef.current = false
    setRunning(true)
    setLogs([])
    setProgress({ done: 0, total: count, ok: 0, fail: 0 })
    setStudyName('')

    const weights = getWeights(mix)

    // Fetch study
    addLog('Fetching study config...', 'info')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let config: any
    try {
      const res = await fetch(`/api/study/${guid.trim()}`)
      if (!res.ok) throw new Error(`Study not found (${res.status})`)
      const study = await res.json()
      config = study.config
      setStudyName(study.bot_name)
      const qs = (config.questions || []).filter((q: {enabled?: boolean; type: string}) => q.enabled !== false && q.type !== 'hidden').length
      addLog(`Found: "${study.bot_name}" — ${qs} custom Qs, ${(config.psychographicBank || []).length} psycho Qs`, 'info')
    } catch (err) {
      addLog('ERROR: ' + (err as Error).message, 'err')
      addLog('Make sure the study GUID is correct and the study is active.', 'err')
      setRunning(false)
      return
    }

    // Submit
    let ok = 0, fail = 0
    for (let i = 0; i < count; i++) {
      if (stopRef.current) { addLog('Stopped.', 'info'); break }

      const { payload, exp, nps, duration } = generatePayload(config, weights)
      const sid = 'sim_' + Math.random().toString(36).slice(2) + Date.now().toString(36)

      try {
        const res = await fetch('/api/respond', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ study_guid: guid.trim(), payload, duration_sec: duration, session_id: sid, status: 'complete' }),
        })
        const data = await res.json()
        if (res.ok) {
          ok++
          addLog(`${i+1}/${count}  exp:${exp}  nps:${nps}  ${duration}s  id:${data.response_id}`)
        } else {
          fail++
          addLog(`${i+1}/${count}  FAILED ${res.status}: ${JSON.stringify(data)}`, 'err')
        }
      } catch (err) {
        fail++
        addLog(`${i+1}/${count}  NETWORK ERROR: ${(err as Error).message}`, 'err')
      }

      setProgress({ done: i + 1, total: count, ok, fail })

      if (!stopRef.current && i < count - 1) {
        if ((i + 1) % 25 === 0) {
          addLog('Pausing for rate limit...', 'dim')
          await sleep(3000)
        } else {
          await sleep(200)
        }
      }
    }

    addLog(`Done! ${ok} saved, ${fail} failed.`, 'info')
    setRunning(false)
  }, [guid, count, mix, addLog])

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Simulators</h1>
            <p className="text-sm text-gray-500">Generate realistic test data for demos</p>
          </div>
          <a href="/admin/simulator/townhall" className="text-xs text-teal-600 hover:text-teal-800 font-medium">
            PulseIQ Simulator →
          </a>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-gray-100 p-1 rounded-xl mb-6">
          <button onClick={() => setSimTab('survey')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${simTab === 'survey' ? 'text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            style={simTab === 'survey' ? { background: HERMES } : {}}>
            Survey Responses
          </button>
          <button onClick={() => setSimTab('social')} className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${simTab === 'social' ? 'text-white shadow-sm' : 'text-gray-500 hover:text-gray-700'}`}
            style={simTab === 'social' ? { background: HERMES } : {}}>
            Social Comments
          </button>
        </div>

        {/* Social Demo Tab */}
        {simTab === 'social' && (
          <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
            <p className="text-sm text-gray-500 mb-4">Generate realistic social media comments for a candidate or organization to demo the Social Moderation dashboard.</p>
            <div className="grid grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Candidate / Organization</label>
                <input type="text" value={demoCandidate} onChange={e => setDemoCandidate(e.target.value)}
                  placeholder="e.g. Anna Eskamani for Orlando Mayor"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-700 mb-1">Comment Count</label>
                <select value={demoCount} onChange={e => setDemoCount(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm">
                  <option value={15}>15 comments</option>
                  <option value={25}>25 comments</option>
                  <option value={40}>40 comments</option>
                  <option value={50}>50 comments</option>
                </select>
              </div>
            </div>
            <div className="mb-3">
              <label className="block text-xs font-semibold text-gray-700 mb-1">Account Context <span className="font-normal text-gray-400">(what is this org/candidate about?)</span></label>
              <textarea value={demoContext} onChange={e => setDemoContext(e.target.value)}
                placeholder="e.g. Running for mayor, focuses on housing + public safety, has opponents like Buddy Dyer..."
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-vertical" />
            </div>
            <div className="mb-4">
              <label className="block text-xs font-semibold text-gray-700 mb-1">Post Text <span className="font-normal text-gray-400">(the specific post comments are responding to)</span></label>
              <textarea value={demoPostText} onChange={e => setDemoPostText(e.target.value)}
                placeholder="e.g. Excited to announce our downtown safety plan! More lighting, community policing, and mental health resources..."
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm resize-vertical" />
            </div>
            {demoLoading && (
              <div className="mb-4">
                <div className="h-2 bg-gray-200 rounded-full overflow-hidden mb-2">
                  <div className="h-full rounded-full transition-all duration-[2s] ease-out" style={{ background: HERMES, width: demoResult ? '100%' : '65%' }} />
                </div>
                <p className="text-xs text-gray-500 text-center">
                  {!demoResult ? 'Clearing old data, generating comments with AI, processing flags...' : 'Done!'}
                </p>
              </div>
            )}
            <div className="flex gap-3 mb-4">
              <button onClick={async () => {
                if (!demoCandidate.trim()) return
                setDemoLoading(true); setDemoResult(null)
                try {
                  const r = await fetch('/api/social/demo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ candidate: demoCandidate, context: demoContext, postText: demoPostText, count: demoCount }) })
                  setDemoResult(await r.json())
                } catch { setDemoResult({ error: 'Failed' }) }
                setDemoLoading(false)
              }} disabled={demoLoading || !demoCandidate.trim()}
                className="px-5 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50"
                style={{ background: HERMES }}>
                {demoLoading ? 'Generating...' : 'Generate Demo Comments'}
              </button>
              <button onClick={async () => {
                if (!confirm('Delete all demo/test comments?')) return
                setDemoLoading(true)
                const r = await fetch('/api/social/demo', { method: 'DELETE' })
                const d = await r.json()
                setDemoResult({ deleted: d.deleted })
                setDemoLoading(false)
              }} disabled={demoLoading}
                className="px-5 py-2 rounded-lg text-sm font-semibold border border-red-300 text-red-600 bg-red-50 hover:bg-red-100">
                Clear Demo Data
              </button>
            </div>
            {demoResult && (
              <div className="bg-gray-50 border border-gray-200 rounded-xl p-4">
                {demoResult.error ? (
                  <p className="text-sm text-red-600">{demoResult.error}</p>
                ) : demoResult.deleted !== undefined ? (
                  <p className="text-sm text-gray-600">Deleted {demoResult.deleted} demo comments.</p>
                ) : (
                  <>
                  <div className="grid grid-cols-4 gap-3 text-center mb-3">
                    <div><div className="text-2xl font-bold text-gray-900">{demoResult.generated}</div><div className="text-xs text-gray-500 mt-1">Generated</div></div>
                    <div><div className="text-2xl font-bold text-amber-600">{demoResult.flagged}</div><div className="text-xs text-gray-500 mt-1">Flagged</div></div>
                    <div><div className="text-2xl font-bold text-orange-600">{demoResult.autoHidden}</div><div className="text-xs text-gray-500 mt-1">Auto-Hidden</div></div>
                    <div><div className="text-2xl font-bold text-red-600">{demoResult.autoDeleted || 0}</div><div className="text-xs text-gray-500 mt-1">Auto-Deleted</div></div>
                  </div>
                  <div className="grid grid-cols-4 gap-3 text-center">
                    <div><div className="text-lg font-bold text-green-600">{demoResult.sentiment?.positive || 0}</div><div className="text-xs text-gray-500 mt-1">Positive</div></div>
                    <div><div className="text-lg font-bold text-gray-500">{demoResult.sentiment?.neutral || 0}</div><div className="text-xs text-gray-500 mt-1">Neutral</div></div>
                    <div><div className="text-lg font-bold text-red-500">{demoResult.sentiment?.negative || 0}</div><div className="text-xs text-gray-500 mt-1">Negative</div></div>
                    <div><div className="text-lg font-bold text-purple-600">{demoResult.flaggedForReview || 0}</div><div className="text-xs text-gray-500 mt-1">For Review</div></div>
                  </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {/* Survey Simulator Tab */}
        {simTab === 'survey' && (<>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
          <div className="flex gap-3 mb-4">
            <div className="flex-[2]">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Study GUID</label>
              <input
                type="text"
                value={guid}
                onChange={e => setGuid(e.target.value)}
                placeholder="Paste study GUID here..."
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-teal-600 focus:outline-none"
              />
            </div>
            <div className="w-24">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Count</label>
              <input
                type="number"
                value={count}
                onChange={e => setCount(parseInt(e.target.value) || 10)}
                min={1}
                max={500}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-teal-600 focus:outline-none"
              />
            </div>
          </div>

          <div className="flex gap-3 mb-4">
            <div className="flex-1">
              <label className="block text-xs font-semibold text-gray-500 mb-1">Sentiment Mix</label>
              <select
                value={mix}
                onChange={e => setMix(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-teal-600 focus:outline-none bg-white"
              >
                <option value="realistic">Realistic (skew positive)</option>
                <option value="uniform">Uniform (even spread)</option>
                <option value="positive">Mostly positive</option>
                <option value="negative">Mostly negative</option>
              </select>
            </div>
          </div>

          {studyName && (
            <div className="text-sm text-teal-700 bg-teal-50 rounded-lg px-3 py-2 mb-4">
              <strong>{studyName}</strong>
            </div>
          )}

          <div className="flex items-center gap-3">
            <button
              onClick={run}
              disabled={running || !guid.trim()}
              className="px-5 py-2.5 bg-teal-700 text-white rounded-lg font-semibold text-sm hover:bg-teal-800 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {running ? 'Running...' : 'Generate Responses'}
            </button>
            {running && (
              <button
                onClick={() => { stopRef.current = true }}
                className="px-5 py-2.5 bg-red-500 text-white rounded-lg font-semibold text-sm hover:bg-red-600 transition-colors"
              >
                Stop
              </button>
            )}
          </div>

          {progress.total > 0 && (
            <div className="mt-4">
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full bg-teal-600 rounded-full transition-all duration-300" style={{ width: pct + '%' }} />
              </div>
              <div className="text-xs text-gray-500 mt-1 text-right">
                {progress.done} / {progress.total} ({progress.ok} saved{progress.fail > 0 ? `, ${progress.fail} failed` : ''})
              </div>
            </div>
          )}
        </div>

        {logs.length > 0 && (
          <div className="bg-gray-900 rounded-xl p-4 max-h-[400px] overflow-y-auto font-mono text-xs leading-relaxed">
            {logs.map((l, i) => (
              <div key={i} className={
                l.type === 'err' ? 'text-red-400' :
                l.type === 'info' ? 'text-sky-400' :
                l.type === 'dim' ? 'text-gray-600' :
                'text-green-400'
              }>
                {l.text}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        )}
        </>)}
      </div>
    </div>
  )
}
