// scripts/sarina-regression-run.ts
// One-off runner: executes the 22-scenario Arjun regression set against an
// arbitrary Sarina bot id via the public /api/bots/[id]/chat endpoint.
//
// Usage:
//   tsx scripts/sarina-regression-run.ts <botId> [baseUrl]
//
// Honors the 30/min rate limit by spacing requests with a small gap.

import { SARINA_TESTS, type SarinaTest } from '../app/admin/sarina-regression/tests'

type Status = 'pass' | 'partial' | 'fail' | 'error'

interface CheckResult { label: string; matched: boolean }

interface TestRun {
  id: string
  description: string
  category: string
  status: Status
  reply: string
  transcript: { role: 'user' | 'assistant'; content: string }[]
  mustIncludeResults: CheckResult[]
  mustNotIncludeResults: CheckResult[]
  elapsedMs: number
  error?: string
}

function gradeReply(test: SarinaTest, reply: string): { status: Status; mustIncludeResults: CheckResult[]; mustNotIncludeResults: CheckResult[] } {
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

async function runOne(baseUrl: string, botId: string, test: SarinaTest): Promise<TestRun> {
  const sessionId = (globalThis.crypto?.randomUUID?.() ?? 'sess_' + Math.random().toString(36).slice(2))
  const transcript: { role: 'user' | 'assistant'; content: string }[] = []
  const started = Date.now()

  try {
    for (let i = 0; i < test.turns.length; i++) {
      const messages = [...transcript, { role: 'user' as const, content: test.turns[i] }]
      const res = await fetch(baseUrl + '/api/bots/' + botId + '/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages, session_id: sessionId, debug: true }),
      })
      const data: { error?: string; reply?: string } = await res.json().catch(() => ({}))
      if (!res.ok) {
        return {
          id: test.id, description: test.description, category: test.category,
          status: 'error', reply: '', transcript,
          mustIncludeResults: [], mustNotIncludeResults: [],
          elapsedMs: Date.now() - started,
          error: data?.error || ('HTTP ' + res.status),
        }
      }
      const reply = String(data?.reply || '')
      transcript.push({ role: 'user', content: test.turns[i] })
      transcript.push({ role: 'assistant', content: reply })
    }

    const finalReply = transcript.length > 0 ? transcript[transcript.length - 1].content : ''
    const graded = gradeReply(test, finalReply)
    return {
      id: test.id, description: test.description, category: test.category,
      status: graded.status, reply: finalReply, transcript,
      mustIncludeResults: graded.mustIncludeResults,
      mustNotIncludeResults: graded.mustNotIncludeResults,
      elapsedMs: Date.now() - started,
    }
  } catch (e: unknown) {
    return {
      id: test.id, description: test.description, category: test.category,
      status: 'error', reply: '', transcript,
      mustIncludeResults: [], mustNotIncludeResults: [],
      elapsedMs: Date.now() - started,
      error: (e instanceof Error ? e.message : '') || String(e),
    }
  }
}

async function main() {
  const botId = process.argv[2]
  const baseUrl = process.argv[3] || 'https://www.sentimetrx.ai'
  if (!botId) {
    console.error('Usage: tsx scripts/sarina-regression-run.ts <botId> [baseUrl]')
    process.exit(1)
  }

  console.log('Running ' + SARINA_TESTS.length + ' Arjun scenarios against ' + baseUrl + ' bot ' + botId)
  console.log('')

  const runs: TestRun[] = []
  for (let i = 0; i < SARINA_TESTS.length; i++) {
    const t = SARINA_TESTS[i]
    process.stdout.write('[' + (i + 1).toString().padStart(2, ' ') + '/' + SARINA_TESTS.length + '] ' + t.id + ' (' + t.category + ') ' + t.description.slice(0, 60) + ' … ')
    const r = await runOne(baseUrl, botId, t)
    runs.push(r)
    const tag = r.status === 'pass' ? 'PASS' : r.status === 'partial' ? 'PARTIAL' : r.status === 'fail' ? 'FAIL' : 'ERROR'
    console.log(tag + ' (' + (r.elapsedMs / 1000).toFixed(1) + 's)')
    await new Promise(r => setTimeout(r, 600))
  }

  console.log('')
  console.log('=== Summary ===')
  const counts = { pass: 0, partial: 0, fail: 0, error: 0 }
  for (const r of runs) counts[r.status]++
  console.log('Pass: ' + counts.pass + ' / Partial: ' + counts.partial + ' / Fail: ' + counts.fail + ' / Error: ' + counts.error + ' / Total: ' + runs.length)
  console.log('')

  const byCat: Record<string, { pass: number; partial: number; fail: number; error: number; total: number }> = {}
  for (const r of runs) {
    byCat[r.category] = byCat[r.category] || { pass: 0, partial: 0, fail: 0, error: 0, total: 0 }
    byCat[r.category][r.status]++
    byCat[r.category].total++
  }
  console.log('By category:')
  for (const cat of Object.keys(byCat)) {
    const c = byCat[cat]
    console.log('  ' + cat.padEnd(14, ' ') + '  pass ' + c.pass + ' / partial ' + c.partial + ' / fail ' + c.fail + ' / error ' + c.error + ' / total ' + c.total)
  }
  console.log('')

  console.log('=== Per-test detail ===')
  for (const r of runs) {
    const tag = r.status.toUpperCase()
    console.log('')
    console.log(r.id + '  [' + tag + ']  ' + r.category + ' — ' + r.description)
    if (r.error) console.log('  ERROR: ' + r.error)
    if (r.reply) console.log('  Reply: ' + r.reply.replace(/\s+/g, ' ').slice(0, 300))
    if (r.mustIncludeResults.length > 0) {
      console.log('  Must include:')
      for (const c of r.mustIncludeResults) console.log('    ' + (c.matched ? '✓' : '✗') + ' ' + c.label)
    }
    if (r.mustNotIncludeResults.length > 0) {
      console.log('  Must NOT include:')
      for (const c of r.mustNotIncludeResults) console.log('    ' + (c.matched ? '✗ triggered' : '✓ absent') + ' — ' + c.label)
    }
  }

  // Write a JSON dump too for any further inspection
  const fs = await import('fs/promises')
  const out = {
    botId,
    baseUrl,
    ranAt: new Date().toISOString(),
    counts,
    byCat,
    runs,
  }
  const path = '/tmp/sarina-regression-' + Date.now() + '.json'
  await fs.writeFile(path, JSON.stringify(out, null, 2))
  console.log('')
  console.log('Wrote detailed JSON to ' + path)
}

main().catch(e => { console.error(e); process.exit(1) })
