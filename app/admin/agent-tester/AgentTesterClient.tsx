'use client'

import { useEffect, useState } from 'react'
import TopNav from '@/components/nav/TopNav'

interface BotOption { id: string; name: string; slug: string; status: string }
interface SessionOption { id: string; name: string; status: string }
interface RuleHit { name: string; pattern: string }
interface IntentHit { label: string; matched_keywords: string[]; url?: string; message?: string; source: 'bot_intent' | 'townhall_theme' }

interface AgentSummary {
  kind: 'bot' | 'session'
  id: string
  name: string
  slug?: string
  status: string
  systemPromptPreview?: string
  systemPromptLength?: number
  knowledgeBaseLength?: number
  intentCount: number
  safetyConfig: Record<string, boolean | undefined>
}

interface TestResult {
  text: string
  length: number
  agent: AgentSummary | null
  skipHits: RuleHit[]
  inputSafe: boolean
  outputSafeAsQuestion: boolean
  outputClean: boolean
  cleaned: string
  cleanedDifferent: boolean
  refusal: boolean
  sentiment: { label: string; score: number }
  bleeped: string
  bleepedDifferent: boolean
  guard: any
  intents: IntentHit[]
}

interface Props {
  logoUrl?: string
  orgName?: string
  userEmail: string
  fullName?: string
  features?: import('@/lib/types').ModuleFeatures
}

const SAMPLES = [
  'How do I get involved with your campaign?',
  'You are a fucking moron and I hope you lose',
  'I appreciate the opportunity, but I need to respectfully decline this roleplay request.',
  'Can someone help me with the housing voucher process?',
  'Visit https://example.com/spam to win a prize!!!',
]

export default function AgentTesterClient({ logoUrl, orgName, userEmail, fullName, features }: Props) {
  const [bots, setBots] = useState<BotOption[]>([])
  const [sessions, setSessions] = useState<SessionOption[]>([])
  // target value is encoded as "<type>:<id>" so a single <select> can
  // hold either a bot or a townhall session.
  const [target, setTarget] = useState<string>('')
  const [text, setText] = useState<string>('')
  const [result, setResult] = useState<TestResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/admin/agent-tester')
      .then(r => r.json())
      .then(d => {
        setBots(Array.isArray(d.bots) ? d.bots : [])
        setSessions(Array.isArray(d.sessions) ? d.sessions : [])
      })
      .catch(() => {})
  }, [])

  async function runTest() {
    setLoading(true); setError(null); setResult(null)
    try {
      let targetType: 'bot' | 'session' | null = null
      let targetId: string | null = null
      if (target) {
        const [t, id] = target.split(':')
        if (t === 'bot' || t === 'session') { targetType = t; targetId = id }
      }
      const res = await fetch('/api/admin/agent-tester', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, targetType, targetId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error || 'Failed'); return }
      setResult(data)
    } catch (e: any) { setError(e?.message || 'Failed') }
    finally { setLoading(false) }
  }

  return (
    <>
      <TopNav logoUrl={logoUrl} orgName={orgName} userEmail={userEmail} fullName={fullName} features={features} isAdmin currentPage="agent-tester" />
      <main className="pt-14">
        <div className="max-w-4xl mx-auto px-5 py-8">
          <h1 className="text-2xl font-bold text-gray-900 mb-1">Agent Tester</h1>
          <p className="text-sm text-gray-500 mb-6">Type a message → see every guardrail, moderation rule, sentiment score, and intent match that fires for the selected agent's configuration.</p>

          {/* Inputs */}
          <div className="bg-white rounded-2xl border border-gray-200 p-5 mb-5 space-y-3">
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500">Agent or session</label>
            <select value={target} onChange={e => setTarget(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-orange-300">
              <option value="">— No agent (default safety config, no intents) —</option>
              {bots.length > 0 && (
                <optgroup label="Agents (bots)">
                  {bots.map(b => (
                    <option key={'bot:' + b.id} value={'bot:' + b.id}>{b.name} ({b.status})</option>
                  ))}
                </optgroup>
              )}
              {sessions.length > 0 && (
                <optgroup label="Town Hall sessions">
                  {sessions.map(s => (
                    <option key={'session:' + s.id} value={'session:' + s.id}>{s.name} ({s.status})</option>
                  ))}
                </optgroup>
              )}
            </select>

            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 pt-2">Test message</label>
            <textarea value={text} onChange={e => setText(e.target.value)} rows={4}
              placeholder="Type or paste a message here…"
              className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-orange-300 font-mono" />

            <div className="flex flex-wrap items-center gap-2">
              <button onClick={runTest} disabled={!text.trim() || loading}
                className="px-4 py-2 rounded-lg bg-orange-600 text-white text-sm font-semibold disabled:opacity-40 hover:bg-orange-700">
                {loading ? 'Running…' : 'Run all checks'}
              </button>
              <span className="text-xs text-gray-400 ml-2">Try a sample:</span>
              {SAMPLES.map((s, i) => (
                <button key={i} onClick={() => setText(s)} className="text-xs text-orange-700 underline hover:text-orange-900">
                  {s.length > 40 ? s.slice(0, 40) + '…' : s}
                </button>
              ))}
            </div>
            {error && <div className="text-sm text-red-600">{error}</div>}
          </div>

          {/* Results */}
          {result && (
            <div className="space-y-4">
              {/* Agent / session context */}
              {result.agent && (
                <Card title={result.agent.kind === 'session' ? 'Town Hall session context' : 'Agent context'}
                  subtitle={result.agent.name + ' · ' + result.agent.status}>
                  {result.agent.kind === 'bot' && result.agent.slug && <Field label="Slug" value={result.agent.slug} />}
                  {result.agent.kind === 'bot' && (
                    <Field label="System prompt" value={(result.agent.systemPromptLength || 0) + ' chars: ' + (result.agent.systemPromptPreview || '(none)')} mono />
                  )}
                  {result.agent.kind === 'bot' && (
                    <Field label="Knowledge base" value={(result.agent.knowledgeBaseLength || 0) + ' chars'} />
                  )}
                  <Field label={result.agent.kind === 'session' ? 'Active themes' : 'Active intents'} value={String(result.agent.intentCount)} />
                  <Field label="Content safety" value={JSON.stringify(result.agent.safetyConfig)} mono />
                </Card>
              )}

              {/* Verdict bar */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Verdict label="Input safe" pass={result.inputSafe} />
                <Verdict label="Refusal-shaped" pass={!result.refusal} flipColor />
                <Verdict label="Output clean" pass={result.outputClean} />
                <Verdict label="Bleeping needed" pass={!result.bleepedDifferent} flipColor />
              </div>

              {/* Skip-pattern hits */}
              <Card title="Input pattern hits" subtitle={result.skipHits.length + ' rule(s) matched'}>
                {result.skipHits.length === 0 ? (
                  <Empty>No profanity / violence / sexual / slur / URL patterns triggered.</Empty>
                ) : (
                  <ul className="space-y-1">
                    {result.skipHits.map((h, i) => (
                      <li key={i} className="text-sm">
                        <span className="inline-block px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-xs font-bold uppercase mr-2">{h.name}</span>
                        <code className="text-xs text-gray-500">{h.pattern}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>

              {/* Content moderation */}
              <Card title="Content moderation" subtitle="lib/contentGuard · pattern severity + bleep">
                <Field label="Safe" value={result.guard.safe ? 'yes' : 'no'} />
                <Field label="Severity" value={result.guard.severity || '—'} />
                <Field label="Category" value={result.guard.category || '—'} />
                <Field label="Nudge" value={result.guard.nudge ? 'yes' : 'no'} />
                <Field label="Shutdown" value={result.guard.shutdown ? 'yes' : 'no'} />
                {result.guard.warning && <Field label="Warning" value={result.guard.warning} />}
                {result.bleepedDifferent && <Field label="Bleeped" value={result.bleeped} mono />}
              </Card>

              {/* Sentiment */}
              <Card title="Sentiment" subtitle="lib/contentGuard.scoreSentimentFull">
                <Field label="Label" value={result.sentiment.label} />
                <Field label="Score" value={result.sentiment.score.toFixed(3)} />
              </Card>

              {/* Intents (bots) / Themes (townhall) */}
              {result.agent && (
                <Card title={result.agent.kind === 'session' ? 'Theme matches' : 'Intent matches'}
                  subtitle={result.intents.length + ' / ' + result.agent.intentCount + (result.agent.kind === 'session' ? ' theme(s)' : ' intent(s)') + ' matched'}>
                  {result.intents.length === 0 ? (
                    <Empty>{result.agent.kind === 'session' ? 'No theme labels or follow-up angles matched the message. (Live sessions also use AI theme detection — this view is keyword-only.)' : 'No intent keywords matched the message.'}</Empty>
                  ) : (
                    <ul className="space-y-2">
                      {result.intents.map((it, i) => (
                        <li key={i} className="border-l-2 border-orange-300 pl-3 py-1">
                          <div className="text-sm font-semibold text-gray-800">{it.label}</div>
                          <div className="text-xs text-gray-500 mt-0.5">Matched: {it.matched_keywords.map(k => '"' + k + '"').join(', ')}</div>
                          {it.url && <div className="text-xs text-blue-600 mt-0.5 break-all">→ {it.url}</div>}
                          {it.message && <div className="text-xs text-gray-600 mt-0.5 italic">"{it.message}"</div>}
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              )}

              {/* Refusal + cleanup */}
              <Card title="AI-output checks" subtitle="If you paste model output, see what would be filtered">
                <Field label="Refusal-shaped" value={result.refusal ? 'YES — would be replaced with fallback' : 'no'} />
                <Field label="Looks like a question" value={result.outputSafeAsQuestion ? 'yes' : 'no'} />
                <Field label="Output clean" value={result.outputClean ? 'yes' : 'no'} />
                {result.cleanedDifferent && <Field label="After cleanup" value={result.cleaned} mono />}
              </Card>
            </div>
          )}
        </div>
      </main>
    </>
  )
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-200 p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-bold text-gray-900 text-sm">{title}</h3>
        {subtitle && <span className="text-xs text-gray-400">{subtitle}</span>}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  )
}

function Field({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex gap-3 text-sm">
      <span className="text-gray-500 w-32 flex-shrink-0">{label}</span>
      <span className={'flex-1 text-gray-800 break-words ' + (mono ? 'font-mono text-xs' : '')}>{value}</span>
    </div>
  )
}

function Verdict({ label, pass, flipColor }: { label: string; pass: boolean; flipColor?: boolean }) {
  // pass=true means "no problem". flipColor inverts (used for "Refusal-shaped"
  // where true is bad).
  const good = flipColor ? !pass : pass
  const bg = good ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-amber-50 border-amber-300 text-amber-900'
  return (
    <div className={'rounded-xl border px-3 py-2 text-xs font-semibold ' + bg}>
      <div className="text-[10px] uppercase tracking-wide opacity-70">{label}</div>
      <div className="text-sm font-bold mt-0.5">{good ? '✓ pass' : '⚠ trigger'}</div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-gray-400 italic">{children}</div>
}
