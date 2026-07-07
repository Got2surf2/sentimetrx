'use client'

import { useMemo, useState } from 'react'
import TopNav from '@/components/nav/TopNav'
import { SARINA_TESTS, type SarinaTest, type Category } from './tests'
import type { ModuleFeatures } from '@/lib/types'

interface Props {
  botId: string
  logoUrl?: string
  orgName?: string
  userEmail: string
  fullName?: string
  features?: ModuleFeatures
}

type Status = 'pending' | 'running' | 'pass' | 'partial' | 'fail' | 'error'

interface CheckResult { label: string; matched: boolean }

interface TestRun {
  id: string
  status: Status
  reply: string // final assistant reply (the one that gets graded)
  transcript: { role: 'user' | 'assistant'; content: string }[]
  mustIncludeResults: CheckResult[]
  mustNotIncludeResults: CheckResult[]
  ragDebug: string[]
  intentDebug: string[]
  error?: string
  elapsedMs: number
}

function emptyRun(id: string): TestRun {
  return {
    id,
    status: 'pending',
    reply: '',
    transcript: [],
    mustIncludeResults: [],
    mustNotIncludeResults: [],
    ragDebug: [],
    intentDebug: [],
    elapsedMs: 0,
  }
}

function gradeReply(test: SarinaTest, reply: string): Pick<TestRun, 'status' | 'mustIncludeResults' | 'mustNotIncludeResults'> {
  const mustIncludeResults: CheckResult[] = test.mustInclude.map(c => ({
    label: c.label,
    matched: new RegExp(c.pattern, c.flags).test(reply),
  }))
  const mustNotIncludeResults: CheckResult[] = test.mustNotInclude.map(c => ({
    label: c.label,
    matched: new RegExp(c.pattern, c.flags).test(reply),
  }))
  const failureHit = mustNotIncludeResults.some(r => r.matched)
  const totalMust = mustIncludeResults.length
  const passMust = mustIncludeResults.filter(r => r.matched).length

  let status: Status
  if (failureHit) status = 'fail'
  else if (totalMust === 0) status = 'pass'
  else if (passMust === totalMust) status = 'pass'
  else if (passMust === 0) status = 'fail'
  else status = 'partial'

  return { status, mustIncludeResults, mustNotIncludeResults }
}

async function runOneTest(botId: string, test: SarinaTest): Promise<TestRun> {
  const sessionId = (typeof crypto !== 'undefined' && 'randomUUID' in crypto) ? crypto.randomUUID() : 'sess_' + Math.random().toString(36).slice(2)
  const transcript: { role: 'user' | 'assistant'; content: string }[] = []
  const ragDebug: string[] = []
  const intentDebug: string[] = []
  const started = Date.now()

  try {
    for (let i = 0; i < test.turns.length; i++) {
      const messages = [...transcript, { role: 'user' as const, content: test.turns[i] }]
      const res = await fetch('/api/bots/' + botId + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, session_id: sessionId, debug: true }),
      })
      const data = await res.json()
      if (!res.ok) {
        return { ...emptyRun(test.id), status: 'error', error: data?.error || ('HTTP ' + res.status), elapsedMs: Date.now() - started }
      }
      const reply = String(data?.reply || '')
      transcript.push({ role: 'user', content: test.turns[i] })
      transcript.push({ role: 'assistant', content: reply })
      const debugLines: string[] = Array.isArray(data?._debug) ? data._debug : []
      for (const line of debugLines) {
        if (/^RAG[:\s]/.test(line)) ragDebug.push('[turn ' + (i + 1) + '] ' + line)
        if (/^Intents?[:\s]/.test(line)) intentDebug.push('[turn ' + (i + 1) + '] ' + line)
      }
    }

    const finalReply = transcript.length > 0 ? transcript[transcript.length - 1].content : ''
    const graded = gradeReply(test, finalReply)
    return {
      id: test.id,
      status: graded.status,
      reply: finalReply,
      transcript,
      mustIncludeResults: graded.mustIncludeResults,
      mustNotIncludeResults: graded.mustNotIncludeResults,
      ragDebug,
      intentDebug,
      elapsedMs: Date.now() - started,
    }
  } catch (e: unknown) {
    return { ...emptyRun(test.id), status: 'error', error: e instanceof Error ? e.message : String(e), elapsedMs: Date.now() - started }
  }
}

const STATUS_STYLES: Record<Status, string> = {
  pending: 'bg-gray-100 text-gray-500 border-gray-200',
  running: 'bg-blue-100 text-blue-700 border-blue-300 animate-pulse',
  pass: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  partial: 'bg-amber-100 text-amber-800 border-amber-300',
  fail: 'bg-red-100 text-red-800 border-red-300',
  error: 'bg-gray-200 text-gray-700 border-gray-400',
}

const STATUS_LABEL: Record<Status, string> = {
  pending: 'PENDING',
  running: 'RUNNING…',
  pass: 'PASS',
  partial: 'PARTIAL',
  fail: 'FAIL',
  error: 'ERROR',
}

const CATEGORY_ORDER: Category[] = ['Parsing/Flow', 'KB Facts', 'Nuance', 'Guardrail', 'Feedback']

export default function SarinaRegressionClient({ botId, logoUrl, orgName, userEmail, fullName, features }: Props) {
  const [runs, setRuns] = useState<Record<string, TestRun>>(() => {
    const m: Record<string, TestRun> = {}
    for (const t of SARINA_TESTS) m[t.id] = emptyRun(t.id)
    return m
  })
  const [running, setRunning] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [categoryFilter, setCategoryFilter] = useState<Category | 'All'>('All')

  const counts = useMemo(() => {
    const c = { total: SARINA_TESTS.length, pass: 0, partial: 0, fail: 0, error: 0, pending: 0 }
    for (const t of SARINA_TESTS) {
      const r = runs[t.id]
      if (r.status === 'pass') c.pass++
      else if (r.status === 'partial') c.partial++
      else if (r.status === 'fail') c.fail++
      else if (r.status === 'error') c.error++
      else c.pending++
    }
    return c
  }, [runs])

  async function runAll() {
    if (running) return
    setRunning(true)
    const fresh: Record<string, TestRun> = {}
    for (const t of SARINA_TESTS) fresh[t.id] = emptyRun(t.id)
    setRuns(fresh)

    for (const test of SARINA_TESTS) {
      setRuns(prev => ({ ...prev, [test.id]: { ...prev[test.id], status: 'running' } }))
      const result = await runOneTest(botId, test)
      setRuns(prev => ({ ...prev, [test.id]: result }))
      // Light gap to stay under the 30/min rate limit (one test = up to ~2-3 turns)
      await new Promise(r => setTimeout(r, 600))
    }
    setRunning(false)
  }

  async function runOne(test: SarinaTest) {
    if (running) return
    setRuns(prev => ({ ...prev, [test.id]: { ...emptyRun(test.id), status: 'running' } }))
    const result = await runOneTest(botId, test)
    setRuns(prev => ({ ...prev, [test.id]: result }))
  }

  function copyMarkdownReport() {
    const lines: string[] = []
    lines.push('# Sarina regression — ' + new Date().toISOString())
    lines.push('')
    lines.push('**Total** ' + counts.total + ' &nbsp; **Pass** ' + counts.pass + ' &nbsp; **Partial** ' + counts.partial + ' &nbsp; **Fail** ' + counts.fail + ' &nbsp; **Error** ' + counts.error)
    lines.push('')
    lines.push('| ID | Category | Status | Description | Reply (truncated) |')
    lines.push('|---|---|---|---|---|')
    for (const t of SARINA_TESTS) {
      const r = runs[t.id]
      const reply = r.reply.replace(/\n+/g, ' ').slice(0, 220)
      lines.push('| ' + t.id + ' | ' + t.category + ' | ' + STATUS_LABEL[r.status] + ' | ' + t.description + ' | ' + reply + ' |')
    }
    navigator.clipboard.writeText(lines.join('\n')).catch(() => {})
  }

  const visibleTests = useMemo(
    () => categoryFilter === 'All' ? SARINA_TESTS : SARINA_TESTS.filter(t => t.category === categoryFilter),
    [categoryFilter],
  )

  return (
    <div className='min-h-screen bg-gray-50'>
      <TopNav logoUrl={logoUrl} orgName={orgName} isAdmin={true} userEmail={userEmail} fullName={fullName} currentPage='admin' features={features} />

      <div className='max-w-6xl mx-auto px-4 py-8'>
        <div className='mb-6'>
          <div className='flex items-center justify-between flex-wrap gap-2'>
            <div>
              <h1 className='text-2xl font-semibold text-gray-900'>Sarina regression</h1>
              <p className='text-sm text-gray-600 mt-1'>22 scenarios from Arjun's NOWOCATS handoff. Each scenario opens its own session so context can't bleed.</p>
            </div>
            <div className='flex gap-2'>
              <button
                onClick={() => { void runAll() }}
                disabled={running}
                className='px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed'
              >
                {running ? 'Running…' : 'Run all 22 tests'}
              </button>
              <button
                onClick={copyMarkdownReport}
                disabled={running}
                className='px-4 py-2 rounded-lg border border-gray-300 text-gray-700 hover:bg-white disabled:opacity-50'
                title='Copy a markdown summary of the latest run to your clipboard'
              >
                Copy report
              </button>
            </div>
          </div>

          <div className='mt-4 flex flex-wrap gap-2 items-center'>
            <span className={'px-3 py-1 rounded-full text-sm font-medium border ' + STATUS_STYLES.pass}>Pass {counts.pass}</span>
            <span className={'px-3 py-1 rounded-full text-sm font-medium border ' + STATUS_STYLES.partial}>Partial {counts.partial}</span>
            <span className={'px-3 py-1 rounded-full text-sm font-medium border ' + STATUS_STYLES.fail}>Fail {counts.fail}</span>
            {counts.error > 0 && <span className={'px-3 py-1 rounded-full text-sm font-medium border ' + STATUS_STYLES.error}>Error {counts.error}</span>}
            <span className={'px-3 py-1 rounded-full text-sm font-medium border ' + STATUS_STYLES.pending}>Pending {counts.pending}</span>

            <div className='ml-auto flex gap-1'>
              <button
                onClick={() => setCategoryFilter('All')}
                className={'px-2 py-1 rounded-md text-xs border ' + (categoryFilter === 'All' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300')}
              >All</button>
              {CATEGORY_ORDER.map(cat => (
                <button
                  key={cat}
                  onClick={() => setCategoryFilter(cat)}
                  className={'px-2 py-1 rounded-md text-xs border ' + (categoryFilter === cat ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-300')}
                >{cat}</button>
              ))}
            </div>
          </div>
        </div>

        <div className='bg-white border border-gray-200 rounded-lg divide-y divide-gray-200'>
          {visibleTests.map(test => {
            const run = runs[test.id]
            const isOpen = !!expanded[test.id]
            return (
              <div key={test.id} className='p-4'>
                <div className='flex items-start gap-3'>
                  <div className='font-mono text-xs font-semibold text-gray-500 w-8 pt-0.5'>{test.id}</div>
                  <div className='flex-1 min-w-0'>
                    <div className='flex items-center gap-2 flex-wrap'>
                      <span className='text-xs text-gray-500'>{test.category}</span>
                      <span className={'px-2 py-0.5 rounded-full text-xs font-semibold border ' + STATUS_STYLES[run.status]}>
                        {STATUS_LABEL[run.status]}
                      </span>
                      {run.elapsedMs > 0 && <span className='text-xs text-gray-400'>{(run.elapsedMs / 1000).toFixed(1)}s</span>}
                    </div>
                    <div className='text-sm text-gray-900 mt-1 font-medium'>{test.description}</div>
                    <div className='text-xs text-gray-500 mt-0.5 italic'>Expected: {test.expectedFromDoc}</div>
                    {run.reply && (
                      <div className='mt-2 text-sm text-gray-700 bg-gray-50 rounded p-2 border border-gray-200'>
                        <span className='text-xs text-gray-500 font-semibold mr-1'>Reply:</span>
                        {run.reply}
                      </div>
                    )}
                    {run.error && (
                      <div className='mt-2 text-sm text-red-700 bg-red-50 rounded p-2 border border-red-200'>
                        Error: {run.error}
                      </div>
                    )}

                    {isOpen && run.status !== 'pending' && (
                      <div className='mt-3 space-y-3 text-xs'>
                        {run.transcript.length > test.turns.length && (
                          <div>
                            <div className='font-semibold text-gray-700 mb-1'>Transcript ({test.turns.length} turn{test.turns.length > 1 ? 's' : ''}):</div>
                            <div className='space-y-1 bg-gray-50 rounded p-2 border border-gray-200'>
                              {run.transcript.map((m, idx) => (
                                <div key={idx}>
                                  <span className='font-mono text-gray-500'>{m.role === 'user' ? 'U' : 'A'}:</span> <span className={m.role === 'user' ? 'text-gray-900' : 'text-gray-700'}>{m.content}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        {run.mustIncludeResults.length > 0 && (
                          <div>
                            <div className='font-semibold text-gray-700 mb-1'>Must include:</div>
                            <ul className='space-y-0.5'>
                              {run.mustIncludeResults.map((c, idx) => (
                                <li key={idx} className={c.matched ? 'text-emerald-700' : 'text-red-700'}>
                                  {c.matched ? '✓' : '✗'} {c.label}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {run.mustNotIncludeResults.length > 0 && (
                          <div>
                            <div className='font-semibold text-gray-700 mb-1'>Must NOT include:</div>
                            <ul className='space-y-0.5'>
                              {run.mustNotIncludeResults.map((c, idx) => (
                                <li key={idx} className={c.matched ? 'text-red-700' : 'text-emerald-700'}>
                                  {c.matched ? '✗ triggered' : '✓ absent'} — {c.label}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        {(run.ragDebug.length > 0 || run.intentDebug.length > 0) && (
                          <div>
                            <div className='font-semibold text-gray-700 mb-1'>Debug:</div>
                            <ul className='space-y-0.5 font-mono text-gray-600'>
                              {run.ragDebug.map((l, idx) => <li key={'r' + idx}>{l}</li>)}
                              {run.intentDebug.map((l, idx) => <li key={'i' + idx}>{l}</li>)}
                            </ul>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className='flex flex-col gap-1 items-end'>
                    <button
                      onClick={() => { void runOne(test) }}
                      disabled={running}
                      className='px-2 py-1 rounded text-xs border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50'
                    >Re-run</button>
                    {run.status !== 'pending' && (
                      <button
                        onClick={() => setExpanded(prev => ({ ...prev, [test.id]: !prev[test.id] }))}
                        className='px-2 py-1 rounded text-xs text-blue-700 hover:underline'
                      >{isOpen ? 'Hide' : 'Details'}</button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        <div className='mt-6 text-xs text-gray-500'>
          <p>
            Each test opens a fresh session against the live Sarina bot (id <span className='font-mono'>{botId.slice(0, 8)}…</span>).
            One full run is ~30 chat calls and costs roughly $1–$3 in model usage. The "Run all" button respects bot-chat's 30/min rate limit by spacing requests.
          </p>
        </div>
      </div>
    </div>
  )
}
