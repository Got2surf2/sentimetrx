'use client'

import { useEffect, useMemo, useState } from 'react'
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

// ── Pill row config ─────────────────────────────────────────────────────
// Each pill represents one check. The runtime fills in `triggered` + `tip`.
// `kind` selects the colored chrome when triggered (no big visual semantic
// difference today — kept so we can color slurs darker than profanity etc.
// in the future without changing call sites).
type PillKind = 'red' | 'amber' | 'blue' | 'violet' | 'emerald' | 'rose' | 'slate'

interface CheckPill {
  id: string
  label: string
  group: 'Skip patterns' | 'Moderation' | 'Output' | 'Sentiment'
  triggered: boolean
  tip: string
  kind: PillKind
}

function buildPills(r: TestResult | null): CheckPill[] {
  const pills: CheckPill[] = []
  // Skip patterns (the narrow pre-filter set from lib/guardrails)
  const SKIP_DEFS: { id: string; label: string; kind: PillKind; idleTip: string }[] = [
    { id: 'profanity', label: 'profanity', kind: 'red',    idleTip: 'Pre-filter: \\b(fuck|shit|cunt|bitch|asshole|bastard)\\b' },
    { id: 'violence',  label: 'violence',  kind: 'red',    idleTip: 'Pre-filter: \\b(kill|murder|rape|bomb|attack|shoot)\\b' },
    { id: 'sexual',    label: 'sexual',    kind: 'rose',   idleTip: 'Pre-filter: \\b(nude|naked|sex|porn|dick|cock|pussy|tits)\\b' },
    { id: 'slurs',     label: 'slurs',     kind: 'red',    idleTip: 'Pre-filter: common slur variants (n*g, sp*c, ch*nk, k*ke, f*g)' },
    { id: 'urls',      label: 'urls',      kind: 'amber',  idleTip: 'Pre-filter: https?://… (catches full-URL spam)' },
  ]
  for (const def of SKIP_DEFS) {
    const hit = r?.skipHits.find(h => h.name === def.id)
    pills.push({ id: 'skip:' + def.id, label: def.label, group: 'Skip patterns', kind: def.kind, triggered: !!hit, tip: hit ? 'Matched: ' + hit.pattern : def.idleTip })
  }

  // Moderation outcomes
  const guard = r?.guard
  const sev = guard?.severity as string | undefined
  const cat = guard?.category as string | undefined
  pills.push({ id: 'mod:rude',     label: 'rude',      group: 'Moderation', kind: 'amber',  triggered: sev === 'rude',     tip: sev === 'rude' ? 'lib/contentGuard rated this rude' + (cat ? ' (' + cat + ')' : '') : 'lib/contentGuard severity = "rude"' })
  pills.push({ id: 'mod:moderate', label: 'moderate',  group: 'Moderation', kind: 'amber',  triggered: sev === 'moderate', tip: sev === 'moderate' ? 'lib/contentGuard rated this moderate' + (cat ? ' (' + cat + ')' : '') : 'lib/contentGuard severity = "moderate"' })
  pills.push({ id: 'mod:severe',   label: 'severe',    group: 'Moderation', kind: 'red',    triggered: sev === 'severe',   tip: sev === 'severe' ? 'lib/contentGuard rated this severe' + (cat ? ' (' + cat + ')' : '') : 'lib/contentGuard severity = "severe"' })
  pills.push({ id: 'mod:nudge',    label: 'nudge',     group: 'Moderation', kind: 'amber',  triggered: !!guard?.nudge,     tip: guard?.nudge ? 'Bot would gently call out the rudeness' : 'Triggered when severity = "rude" — bot nudges instead of blocking' })
  pills.push({ id: 'mod:shutdown', label: 'shutdown',  group: 'Moderation', kind: 'red',    triggered: !!guard?.shutdown,  tip: guard?.shutdown ? 'Strike count exceeded — participant would be cut off' : 'Triggered after repeated severe violations from the same participant' })
  pills.push({ id: 'mod:bleeped',  label: 'bleeped',   group: 'Moderation', kind: 'amber',  triggered: !!r?.bleepedDifferent, tip: r?.bleepedDifferent ? 'Bleeped: ' + r.bleeped : 'Lights up if the bleep filter would mask part of the message' })

  // Output / cleanup
  pills.push({ id: 'out:refusal',  label: 'refusal',     group: 'Output', kind: 'violet', triggered: !!r?.refusal,             tip: r?.refusal ? 'Looks like a model refusal — would be substituted with the fallback' : 'Catches "I appreciate… I can\'t roleplay…", "even in a simulated…" etc.' })
  pills.push({ id: 'out:cleaned',  label: 'cleanup',     group: 'Output', kind: 'blue',   triggered: !!r?.cleanedDifferent,    tip: r?.cleanedDifferent ? 'After cleanup: ' + r.cleaned : 'cleanAiOutput strips leaked reasoning / decision markers / preamble' })
  pills.push({ id: 'out:notclean', label: 'output-clean', group: 'Output', kind: 'amber', triggered: !!r && !r.outputClean,    tip: r?.outputClean === false ? 'Failed isOutputClean — too short/long or matched a skip pattern' : 'Lights up if the output fails the basic clean check (length / skip patterns)' })

  // Sentiment polarity (always exactly one if a test has run)
  const sl = r?.sentiment.label
  const sScore = r ? r.sentiment.score.toFixed(2) : ''
  pills.push({ id: 'sent:positive', label: 'positive', group: 'Sentiment', kind: 'emerald', triggered: sl === 'positive', tip: sl === 'positive' ? 'Score ' + sScore + ' (positive)' : 'Sentiment polarity from lib/contentGuard.scoreSentimentFull' })
  pills.push({ id: 'sent:neutral',  label: 'neutral',  group: 'Sentiment', kind: 'slate',   triggered: sl === 'neutral',  tip: sl === 'neutral'  ? 'Score ' + sScore + ' (neutral)'  : 'Sentiment polarity from lib/contentGuard.scoreSentimentFull' })
  pills.push({ id: 'sent:negative', label: 'negative', group: 'Sentiment', kind: 'rose',    triggered: sl === 'negative', tip: sl === 'negative' ? 'Score ' + sScore + ' (negative)' : 'Sentiment polarity from lib/contentGuard.scoreSentimentFull' })

  return pills
}

const PILL_ON: Record<PillKind, string> = {
  red:     'bg-red-100 text-red-800 border-red-300',
  amber:   'bg-amber-100 text-amber-800 border-amber-300',
  blue:    'bg-blue-100 text-blue-800 border-blue-300',
  violet:  'bg-violet-100 text-violet-800 border-violet-300',
  emerald: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  rose:    'bg-rose-100 text-rose-800 border-rose-300',
  slate:   'bg-slate-200 text-slate-800 border-slate-400',
}
const PILL_OFF = 'bg-gray-50 text-gray-400 border-gray-200'

const SAFETY_LABELS: Record<string, string> = {
  enabled: 'enabled', profanity: 'profanity', slurs: 'slurs',
  threats: 'threats', sexual: 'sexual', insults: 'insults', spam: 'spam',
}

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

  const pills = useMemo(() => buildPills(result), [result])
  const grouped = useMemo(() => {
    const out: Record<string, CheckPill[]> = {}
    for (const p of pills) (out[p.group] ||= []).push(p)
    return out
  }, [pills])

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

            {/* Triggered-checks pill row — greyed by default, lit up after a
                test runs. Hover any pill for what it does + what fired it. */}
            <div>
              <div className="text-xs font-bold uppercase tracking-wider text-gray-500 pt-2 mb-2">Checks {result ? '· hover any pill' : '· will light up after a run'}</div>
              <div className="flex flex-wrap gap-3">
                {(['Skip patterns', 'Moderation', 'Output', 'Sentiment'] as const).map(group => (
                  <div key={group} className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[10px] uppercase tracking-wider text-gray-400 mr-1">{group}</span>
                    {(grouped[group] || []).map(p => (
                      <span key={p.id} title={p.tip}
                        className={'inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-semibold transition-colors cursor-help ' + (p.triggered ? PILL_ON[p.kind] : PILL_OFF)}>
                        {p.triggered ? '● ' : '○ '}{p.label}
                      </span>
                    ))}
                  </div>
                ))}
              </div>
            </div>

            <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 pt-2">Test message</label>
            {/* Input + run button paired side-by-side. On narrow screens
                button stacks below the input. */}
            <div className="flex flex-col sm:flex-row gap-2 items-stretch">
              <textarea value={text} onChange={e => setText(e.target.value)} rows={3}
                placeholder="Type or paste a message here…"
                className="flex-1 px-3 py-2 rounded-lg border border-gray-200 text-sm focus:outline-none focus:border-orange-300 font-mono resize-y" />
              <button onClick={runTest} disabled={!text.trim() || loading}
                className="px-5 py-2 sm:py-0 rounded-lg bg-orange-600 text-white text-sm font-semibold disabled:opacity-40 hover:bg-orange-700 sm:min-w-[140px] flex-shrink-0 flex items-center justify-center">
                {loading ? 'Running…' : 'Run all checks'}
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-400">Try a sample:</span>
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
                  <div className="flex gap-3 text-sm">
                    <span className="text-gray-500 w-32 flex-shrink-0">Content safety</span>
                    <div className="flex flex-wrap gap-1.5 flex-1">
                      {Object.entries(result.agent.safetyConfig).map(([k, v]) => {
                        const on = v !== false
                        const label = SAFETY_LABELS[k] || k
                        return (
                          <span key={k}
                            className={'inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold ' + (on ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-gray-50 text-gray-400 border-gray-200 line-through')}>
                            {on ? '✓' : '×'} {label}
                          </span>
                        )
                      })}
                    </div>
                  </div>
                </Card>
              )}

              {/* Verdict bar */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <Verdict label="Input safe" pass={result.inputSafe} />
                <Verdict label="Refusal-shaped" pass={!result.refusal} flipColor />
                <Verdict label="Output clean" pass={result.outputClean} />
                <Verdict label="Bleeping needed" pass={!result.bleepedDifferent} flipColor />
              </div>

              {/* Content moderation card — pill-driven instead of a flat field list */}
              <Card title="Content moderation" subtitle="lib/contentGuard · pattern severity + bleep">
                <div className="flex flex-wrap gap-1.5 mb-2">
                  <ModPill triggered={!!result.guard.safe} label="safe" kind="emerald" tip={result.guard.safe ? 'No blocking violation — message would be allowed' : 'Blocked: ' + (result.guard.category || 'unknown') + (result.guard.severity ? ' / ' + result.guard.severity : '')} />
                  {(['rude', 'moderate', 'severe'] as const).map(s => (
                    <ModPill key={s} triggered={result.guard.severity === s} label={s} kind={s === 'severe' ? 'red' : 'amber'} tip={'severity = "' + s + '"' + (result.guard.severity === s && result.guard.category ? ' / category = "' + result.guard.category + '"' : '')} />
                  ))}
                  {result.guard.category && (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold bg-violet-50 text-violet-800 border-violet-200" title={'category = "' + result.guard.category + '"'}>
                      category: {result.guard.category}
                    </span>
                  )}
                  <ModPill triggered={!!result.guard.nudge} label="nudge" kind="amber" tip={result.guard.nudge ? 'Bot would acknowledge tone but proceed' : 'Lights up when severity = "rude"'} />
                  <ModPill triggered={!!result.guard.shutdown} label="shutdown" kind="red" tip={result.guard.shutdown ? 'Participant would be cut off — strike threshold exceeded' : 'Lights up after repeated severe violations from the same participant'} />
                  <ModPill triggered={result.bleepedDifferent} label="bleeped" kind="amber" tip={result.bleepedDifferent ? 'After bleeping: ' + result.bleeped : 'Lights up when the bleep filter would mask part of the message'} />
                </div>
                {result.guard.warning && (
                  <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                    <span className="font-semibold">Warning:</span> {result.guard.warning}
                  </div>
                )}
                {result.bleepedDifferent && (
                  <div className="text-xs font-mono bg-gray-50 border border-gray-200 rounded px-2.5 py-1.5 break-words mt-2">
                    <span className="text-gray-500 mr-1">Bleeped:</span> {result.bleeped}
                  </div>
                )}
              </Card>

              {/* Sentiment */}
              <Card title="Sentiment" subtitle="lib/contentGuard.scoreSentimentFull">
                <div className="flex items-center gap-2">
                  <span className={'inline-flex items-center px-2.5 py-1 rounded-full border text-xs font-semibold ' + (result.sentiment.label === 'positive' ? 'bg-emerald-100 text-emerald-800 border-emerald-300' : result.sentiment.label === 'negative' ? 'bg-rose-100 text-rose-800 border-rose-300' : 'bg-slate-200 text-slate-800 border-slate-400')}>
                    {result.sentiment.label}
                  </span>
                  <span className="text-xs text-gray-500 font-mono">score {result.sentiment.score.toFixed(3)}</span>
                </div>
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

function ModPill({ triggered, label, kind, tip }: { triggered: boolean; label: string; kind: 'red' | 'amber' | 'emerald'; tip: string }) {
  const ON = kind === 'red' ? 'bg-red-100 text-red-800 border-red-300'
    : kind === 'amber' ? 'bg-amber-100 text-amber-800 border-amber-300'
    : 'bg-emerald-100 text-emerald-800 border-emerald-300'
  return (
    <span title={tip} className={'inline-flex items-center px-2 py-0.5 rounded-full border text-[11px] font-semibold cursor-help ' + (triggered ? ON : 'bg-gray-50 text-gray-400 border-gray-200')}>
      {triggered ? '●' : '○'} {label}
    </span>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="text-sm text-gray-400 italic">{children}</div>
}
