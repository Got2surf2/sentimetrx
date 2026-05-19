/* eslint-disable */
// CLI: run Arjun's 22-scenario regression against live Sarina, grade each
// reply, print a markdown summary.
//
// Run: node_modules/.bin/tsx scripts/_run_sarina_regression.ts

import { SARINA_TESTS, type SarinaTest } from '../app/admin/sarina-regression/tests'

const BOT_ID = '5c468b90-13fc-46a2-8855-312dc0a1e428'
const BASE = 'https://www.sentimetrx.ai'

interface TurnResult {
  user: string
  assistant: string
}

interface TestRun {
  id: string
  status: 'pass' | 'partial' | 'fail' | 'error'
  reply: string
  transcript: TurnResult[]
  mustIncludePass: { label: string; ok: boolean }[]
  mustNotIncludePass: { label: string; triggered: boolean }[]
  ragDebug: string[]
  intentDebug: string[]
  elapsedMs: number
  error?: string
}

function gradeReply(test: SarinaTest, reply: string): Pick<TestRun, 'status' | 'mustIncludePass' | 'mustNotIncludePass'> {
  const mustIncludePass = test.mustInclude.map(c => ({ label: c.label, ok: new RegExp(c.pattern, c.flags).test(reply) }))
  const mustNotIncludePass = test.mustNotInclude.map(c => ({ label: c.label, triggered: new RegExp(c.pattern, c.flags).test(reply) }))
  const failureHit = mustNotIncludePass.some(r => r.triggered)
  const totalMust = mustIncludePass.length
  const passMust = mustIncludePass.filter(r => r.ok).length
  let status: 'pass' | 'partial' | 'fail'
  if (failureHit) status = 'fail'
  else if (totalMust === 0) status = 'pass'
  else if (passMust === totalMust) status = 'pass'
  else if (passMust === 0) status = 'fail'
  else status = 'partial'
  return { status, mustIncludePass, mustNotIncludePass }
}

async function runOne(test: SarinaTest): Promise<TestRun> {
  const sessionId = 'regression_' + Math.random().toString(36).slice(2)
  const transcript: TurnResult[] = []
  const ragDebug: string[] = []
  const intentDebug: string[] = []
  const messages: { role: 'user' | 'assistant'; content: string }[] = []
  const started = Date.now()
  try {
    for (let i = 0; i < test.turns.length; i++) {
      const userTurn = test.turns[i]
      messages.push({ role: 'user', content: userTurn })
      const res = await fetch(BASE + '/api/bots/' + BOT_ID + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, session_id: sessionId, debug: true }),
      })
      const data = await res.json()
      if (!res.ok) {
        return { id: test.id, status: 'error', reply: '', transcript, mustIncludePass: [], mustNotIncludePass: [], ragDebug, intentDebug, elapsedMs: Date.now() - started, error: data?.error || ('HTTP ' + res.status) }
      }
      const reply = String(data?.reply || '')
      messages.push({ role: 'assistant', content: reply })
      transcript.push({ user: userTurn, assistant: reply })
      const dbg: string[] = Array.isArray(data?._debug) ? data._debug : []
      for (const line of dbg) {
        if (/^RAG[:\s]/.test(line)) ragDebug.push('[t' + (i + 1) + '] ' + line)
        if (/^Intents?[:\s]/.test(line)) intentDebug.push('[t' + (i + 1) + '] ' + line)
      }
    }
    const finalReply = transcript[transcript.length - 1].assistant
    const g = gradeReply(test, finalReply)
    return {
      id: test.id,
      status: g.status,
      reply: finalReply,
      transcript,
      mustIncludePass: g.mustIncludePass,
      mustNotIncludePass: g.mustNotIncludePass,
      ragDebug,
      intentDebug,
      elapsedMs: Date.now() - started,
    }
  } catch (e: any) {
    return { id: test.id, status: 'error', reply: '', transcript, mustIncludePass: [], mustNotIncludePass: [], ragDebug, intentDebug, elapsedMs: Date.now() - started, error: e?.message || String(e) }
  }
}

const STATUS_EMOJI: Record<string, string> = { pass: '✅', partial: '🟡', fail: '❌', error: '⚠️' }

async function main() {
  console.log('Running 22 Sarina regression scenarios against ' + BASE)
  console.log('Bot id ' + BOT_ID + '\n')
  const runs: TestRun[] = []
  for (const t of SARINA_TESTS) {
    process.stdout.write('  ' + t.id.padEnd(4) + ' ' + t.description.slice(0, 60).padEnd(60) + ' … ')
    const r = await runOne(t)
    runs.push(r)
    console.log(STATUS_EMOJI[r.status] + ' ' + r.status.toUpperCase().padEnd(8) + ' (' + (r.elapsedMs / 1000).toFixed(1) + 's)')
    await new Promise(res => setTimeout(res, 800)) // stay under 30/min
  }
  const counts = { pass: 0, partial: 0, fail: 0, error: 0 }
  for (const r of runs) counts[r.status]++
  console.log('\n=== SUMMARY ===')
  console.log('Pass:    ' + counts.pass)
  console.log('Partial: ' + counts.partial)
  console.log('Fail:    ' + counts.fail)
  console.log('Error:   ' + counts.error)
  console.log('Total:   ' + runs.length)

  console.log('\n=== DETAIL ===')
  for (const r of runs) {
    const t = SARINA_TESTS.find(t => t.id === r.id)!
    console.log('\n' + STATUS_EMOJI[r.status] + ' ' + r.id + ' — ' + t.description)
    console.log('   Expected: ' + t.expectedFromDoc)
    if (r.error) {
      console.log('   ERROR: ' + r.error)
      continue
    }
    console.log('   Reply: ' + r.reply.slice(0, 300).replace(/\n/g, ' '))
    for (const m of r.mustIncludePass) console.log('     ' + (m.ok ? '✓' : '✗') + ' ' + m.label)
    for (const m of r.mustNotIncludePass) console.log('     ' + (m.triggered ? '✗ triggered: ' : '✓ absent: ') + m.label)
    if (r.ragDebug.length > 0) console.log('   RAG: ' + r.ragDebug.slice(0, 2).join(' | '))
    if (r.intentDebug.length > 0) console.log('   Intents: ' + r.intentDebug.slice(0, 2).join(' | '))
  }

  process.exit(counts.fail + counts.error > 0 ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
