'use client'

import { useState, useRef, useCallback, useEffect } from 'react'
import Link from 'next/link'

// ── Response pools by sentiment ─────────────────────────────────────────

const POSITIVE: Record<string, string[]> = {
  general: [
    "I love how the community has come together on this issue. It gives me real hope.",
    "The recent improvements have been fantastic. You can really feel the positive energy.",
    "I'm impressed by how thoughtful the approach has been. It shows real leadership.",
    "Things have gotten so much better compared to a year ago. Keep it up!",
    "The team has done an outstanding job listening to everyone's concerns.",
  ],
  community: [
    "The neighborhood events have been wonderful for bringing people together.",
    "I feel safer walking around at night now. The lighting improvements really helped.",
    "The new park space is exactly what we needed. My kids love it.",
    "Community engagement has never been higher. People actually show up now.",
    "The volunteer program has been a huge success. So many people want to help.",
  ],
  service: [
    "Customer service has improved dramatically. I actually enjoy going there now.",
    "The staff is so friendly and helpful. They really know their stuff.",
    "Wait times are way down. I barely had to wait at all last time.",
    "The online tools make everything so much easier. Great investment.",
    "I appreciate how they follow up. It makes you feel valued.",
  ],
}

const NEGATIVE: Record<string, string[]> = {
  general: [
    "Nobody seems to be listening to what we've been saying for months.",
    "The situation has gotten worse and I don't see anyone addressing it.",
    "I'm frustrated by the lack of transparency. We deserve better communication.",
    "It feels like decisions are being made without considering how they affect us.",
    "I've raised this issue three times now and nothing has changed.",
  ],
  community: [
    "The traffic has become unbearable. Something needs to be done now.",
    "There's trash everywhere and nobody seems to care about keeping things clean.",
    "Noise from construction is ruining the quality of life for everyone nearby.",
    "Property values are declining and the local government isn't addressing why.",
    "Public transit options are terrible. Not everyone can drive.",
  ],
  service: [
    "I waited over an hour and nobody even acknowledged I was there.",
    "The quality has really gone downhill. It's not what it used to be.",
    "Prices keep going up but the service quality stays the same or worse.",
    "The website is confusing and the phone lines are always busy.",
    "I filed a complaint two months ago and still haven't heard back.",
  ],
}

const MIXED: Record<string, string[]> = {
  general: [
    "Some things have improved but there's still a lot of work to do.",
    "I appreciate the effort but the execution hasn't been great so far.",
    "Good intentions but the follow-through needs to be better.",
    "The plan sounds good on paper but I'm not sure about implementation.",
    "Progress has been slow but at least things are moving in the right direction.",
  ],
  community: [
    "The new development is nice but it's pushing long-time residents out.",
    "Events are great but parking is always a nightmare.",
    "Safety has improved in some areas but gotten worse in others.",
    "The schools are good but extracurricular funding has been cut.",
    "Parks are well maintained but there's nothing for teenagers to do.",
  ],
  service: [
    "The product is decent but customer support is lacking.",
    "Good value for money but the experience could be more pleasant.",
    "Online ordering works well but in-person service is hit or miss.",
    "They're responsive on social media but slow with actual resolutions.",
    "The core service is solid but the extras feel like afterthoughts.",
  ],
}

interface Session { id: string; name: string; status: string; config: any; discussion_guide: any[]; participants: number; turns: number }
interface LogEntry { text: string; type: 'ok' | 'err' | 'info' | 'dim' }

const pick = <T,>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

const FOCUS_AREAS = ['general', 'community', 'service'] as const

export default function TownHallSimulatorPage() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [count, setCount] = useState(20)
  const [sentimentMix, setSentimentMix] = useState('realistic')
  const [focusArea, setFocusArea] = useState<string>('general')
  const [turnsPerParticipant, setTurnsPerParticipant] = useState(4)
  const [running, setRunning] = useState(false)
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [progress, setProgress] = useState({ done: 0, total: 0, ok: 0, fail: 0 })
  const stopRef = useRef(false)
  const logEndRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    fetch('/api/townhall/sessions')
      .then(r => r.json())
      .then(data => setSessions(Array.isArray(data) ? data : []))
      .catch(() => {})
  }, [])

  const addLog = useCallback((text: string, type: LogEntry['type'] = 'ok') => {
    setLogs(prev => [...prev, { text, type }])
    setTimeout(() => logEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 50)
  }, [])

  const pickResponse = (sentiment: 'positive' | 'negative' | 'mixed'): string => {
    const pool = sentiment === 'positive' ? POSITIVE : sentiment === 'negative' ? NEGATIVE : MIXED
    const area = pool[focusArea] || pool.general
    return pick(area)
  }

  const pickSentiment = (): 'positive' | 'negative' | 'mixed' => {
    const r = Math.random()
    switch (sentimentMix) {
      case 'positive': return r < 0.7 ? 'positive' : r < 0.9 ? 'mixed' : 'negative'
      case 'negative': return r < 0.7 ? 'negative' : r < 0.9 ? 'mixed' : 'positive'
      case 'uniform':  return r < 0.33 ? 'positive' : r < 0.66 ? 'mixed' : 'negative'
      default:         return r < 0.45 ? 'positive' : r < 0.8 ? 'mixed' : 'negative' // realistic
    }
  }

  const run = useCallback(async () => {
    if (!selectedId) return
    stopRef.current = false
    setRunning(true)
    setLogs([])

    const session = sessions.find(s => s.id === selectedId)
    if (!session) { addLog('Session not found', 'err'); setRunning(false); return }

    addLog(`Session: "${session.name}" (${session.status})`, 'info')
    addLog(`Simulating ${count} participants, ~${turnsPerParticipant} turns each, ${sentimentMix} sentiment, ${focusArea} focus`, 'info')

    // Make sure session is active
    if (session.status === 'setup') {
      addLog('Starting session...', 'info')
      try {
        await fetch('/api/townhall/sessions/' + selectedId, {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'active' }),
        })
      } catch { addLog('Failed to start session', 'err'); setRunning(false); return }
    }

    const totalTurns = count * turnsPerParticipant
    setProgress({ done: 0, total: totalTurns, ok: 0, fail: 0 })

    let ok = 0, fail = 0, turnsDone = 0

    for (let p = 0; p < count; p++) {
      if (stopRef.current) { addLog('Stopped.', 'info'); break }

      const pid = 'sim_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)
      addLog(`Participant ${p + 1}/${count} (${pid})`, 'dim')

      // Join
      let turnNumber = 0
      let themeId: string | null = null
      try {
        const jr = await fetch('/api/townhall/join/' + selectedId, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ language: 'en' }),
        })
        const jd = await jr.json()
        if (jd.error) { addLog(`  Join failed: ${jd.error}`, 'err'); fail++; continue }
        turnNumber = jd.turn_number || 1
        themeId = jd.theme_id || null
      } catch (e) { addLog(`  Join failed: ${(e as Error).message}`, 'err'); fail++; continue }

      // Chat turns
      for (let t = 0; t < turnsPerParticipant; t++) {
        if (stopRef.current) break

        const sentiment = pickSentiment()
        const message = pickResponse(sentiment)

        try {
          const cr = await fetch('/api/townhall/chat', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: selectedId, participant_id: pid,
              message, turn_number: turnNumber, theme_id: themeId,
              skipped: false, language: 'en',
            }),
          })
          const cd = await cr.json()
          if (cd.is_final) {
            addLog(`  Turn ${t + 1}: final (${sentiment})`, 'ok')
            ok++; turnsDone++
            break
          }
          turnNumber = cd.turn_number
          themeId = cd.theme_id
          ok++
          addLog(`  Turn ${t + 1}: ${sentiment} → ${cd.source || '?'}`)
        } catch (e) {
          fail++
          addLog(`  Turn ${t + 1}: ERROR ${(e as Error).message}`, 'err')
        }

        turnsDone++
        setProgress({ done: turnsDone, total: totalTurns, ok, fail })

        // Small delay to avoid overwhelming the API
        await sleep(150)
      }

      // Rate limit pause every 5 participants
      if ((p + 1) % 5 === 0 && p < count - 1 && !stopRef.current) {
        addLog('Pausing for rate limit...', 'dim')
        await sleep(2000)
      }
    }

    addLog(`Done! ${ok} turns saved, ${fail} failed across ${count} participants.`, 'info')
    setRunning(false)
  }, [selectedId, count, sentimentMix, focusArea, turnsPerParticipant, sessions, addLog])

  const pct = progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0
  const selected = sessions.find(s => s.id === selectedId)

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-bold text-gray-800">Town Hall Simulator</h1>
            <p className="text-sm text-gray-500">Generate realistic participants and conversations</p>
          </div>
          <Link href="/admin/simulator" className="text-xs text-teal-600 hover:text-teal-800 font-medium">
            Survey Simulator →
          </Link>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-4">
          {/* Session picker */}
          <div className="mb-4">
            <label className="block text-xs font-semibold text-gray-500 mb-1">Session</label>
            <select value={selectedId} onChange={e => setSelectedId(e.target.value)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:outline-none bg-white">
              <option value="">Select a Town Hall session...</option>
              {sessions.map(s => (
                <option key={s.id} value={s.id}>{s.name} ({s.status}) — {s.participants} participants, {s.turns} turns</option>
              ))}
            </select>
          </div>

          {selected && (
            <div className="text-sm text-orange-700 bg-orange-50 rounded-lg px-3 py-2 mb-4">
              <strong>{selected.name}</strong> — {selected.discussion_guide?.length || 0} topics
              {selected.status !== 'setup' && selected.status !== 'active' && (
                <span className="text-amber-600 ml-2">(session is {selected.status} — will need restart)</span>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Participants</label>
              <input type="number" value={count} onChange={e => setCount(parseInt(e.target.value) || 10)}
                min={1} max={200}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:outline-none" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Turns per Participant</label>
              <input type="number" value={turnsPerParticipant} onChange={e => setTurnsPerParticipant(parseInt(e.target.value) || 3)}
                min={1} max={20}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:outline-none" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 mb-4">
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Sentiment Mix</label>
              <select value={sentimentMix} onChange={e => setSentimentMix(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:outline-none bg-white">
                <option value="realistic">Realistic (skew positive)</option>
                <option value="uniform">Uniform (even spread)</option>
                <option value="positive">Mostly positive</option>
                <option value="negative">Mostly negative</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1">Focus Area</label>
              <select value={focusArea} onChange={e => setFocusArea(e.target.value)}
                className="w-full px-3 py-2.5 border border-gray-200 rounded-lg text-sm focus:border-orange-400 focus:outline-none bg-white">
                <option value="general">General</option>
                <option value="community">Community / Neighborhood</option>
                <option value="service">Service / Customer</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button onClick={run} disabled={running || !selectedId}
              className="px-5 py-2.5 text-white rounded-lg font-semibold text-sm hover:opacity-90 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
              style={{ background: '#E8632A' }}>
              {running ? 'Running...' : 'Simulate Participants'}
            </button>
            {running && (
              <button onClick={() => { stopRef.current = true }}
                className="px-5 py-2.5 bg-red-500 text-white rounded-lg font-semibold text-sm hover:bg-red-600 transition-colors">
                Stop
              </button>
            )}
            {selected && (
              <Link href={'/townhall/' + selectedId}
                className="px-4 py-2.5 text-sm font-medium text-orange-600 hover:text-orange-800" target="_blank">
                View Admin Panel →
              </Link>
            )}
          </div>

          {progress.total > 0 && (
            <div className="mt-4">
              <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
                <div className="h-full rounded-full transition-all duration-300" style={{ width: pct + '%', background: '#E8632A' }} />
              </div>
              <div className="text-xs text-gray-500 mt-1 text-right">
                {progress.done} / {progress.total} turns ({progress.ok} saved{progress.fail > 0 ? `, ${progress.fail} failed` : ''})
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
      </div>
    </div>
  )
}
