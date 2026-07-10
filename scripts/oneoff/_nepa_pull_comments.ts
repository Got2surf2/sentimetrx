/* eslint-disable */
// Pull the full public comment corpus for the LIVE Blue Mountains Forest Plan
// Revision comment period (CARA project 301397) into a clean structured JSON.
// Each CARA comment is a small single-page PDF with a self-describing header
// (Data Submitted / First name / Last name / Organization / Title / Comments),
// so we enumerate letter ids from the reading-room listing pages, download each
// PDF, pdftotext it, and parse the fields.
//
// Public records, no login. Polite: rate-limited, clear UA, retry-once.
//
// Run: node --import tsx scripts/oneoff/_nepa_pull_comments.ts <out.json> [maxLetters]

import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdtempSync, writeFileSync as wf } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const PROJECT = '301397'
const BASE = 'https://cara.fs2c.usda.gov/Public'
const UA = 'Mozilla/5.0 (Datanautix NEPA comment-analysis; public-records research)'
const DELAY_MS = 160
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function getText(url: string, tries = 2): Promise<string> {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { headers: { 'User-Agent': UA } })
      if (res.ok) return await res.text()
    } catch {}
    await sleep(400)
  }
  return ''
}

async function getPdfText(letterid: string, dir: string): Promise<string> {
  for (let i = 0; i < 2; i++) {
    try {
      const res = await fetch(`${BASE}/DownloadCommentFile?letterid=${letterid}&project=${PROJECT}`, { headers: { 'User-Agent': UA } })
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer())
        const f = join(dir, `${letterid}.pdf`)
        wf(f, buf)
        try { return execFileSync('pdftotext', ['-q', f, '-'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }) } catch { return '' }
      }
    } catch {}
    await sleep(400)
  }
  return ''
}

interface Comment {
  letterid: string
  date: string | null
  first: string | null
  last: string | null
  organization: string | null
  title: string | null
  comment: string
  format: 'webform' | 'attachment'
}

function parse(letterid: string, text: string): Comment {
  const grab = (label: string) => {
    // [ \t]* (not \s*) so an empty field doesn't swallow the next line's label.
    const m = text.match(new RegExp('^' + label + ':[ \\t]*(.*)$', 'm'))
    return m ? m[1].trim() || null : null
  }
  const ci = text.indexOf('Comments:')
  if (ci >= 0) {
    return {
      letterid,
      date: (text.match(/Data Submitted[^:]*:\s*(.+)/) || [])[1]?.trim() || null,
      first: grab('First name'),
      last: grab('Last name'),
      organization: grab('Organization'),
      title: grab('Title'),
      comment: text.slice(ci + 'Comments:'.length).trim().replace(/\s+\n/g, '\n').trim(),
      format: 'webform',
    }
  }
  // Uploaded attachment (org letter, different layout) — keep the full text.
  return { letterid, date: null, first: null, last: null, organization: null, title: null, comment: text.trim(), format: 'attachment' }
}

async function main() {
  const out = process.argv[2]
  const cap = process.argv[3] ? parseInt(process.argv[3], 10) : Infinity
  if (!out) { console.error('Usage: … _nepa_pull_comments.ts <out.json> [maxLetters]'); process.exit(1) }

  // 1) Enumerate letter ids from the paginated reading room.
  const ids: string[] = []
  let total = Infinity
  for (let page = 1; ids.length < total && ids.length < cap; page++) {
    const html = await getText(`${BASE}/ReadingRoom?project=${PROJECT}&List-size=25&List-page=${page}`)
    if (!html) break
    if (total === Infinity) { const t = html.match(/of\s+([0-9,]+)/); if (t) total = parseInt(t[1].replace(/,/g, ''), 10) }
    const pageIds = [...html.matchAll(/DownloadCommentFile\?letterid=(\d+)/g)].map(m => m[1])
    const fresh = pageIds.filter(id => !ids.includes(id))
    if (!fresh.length) break
    ids.push(...fresh)
    if (page % 5 === 0) console.log(`  …enumerated ${ids.length}/${total === Infinity ? '?' : total}`)
    await sleep(DELAY_MS)
  }
  const targetIds = ids.slice(0, cap)
  console.log(`[ids] ${targetIds.length} letters to pull (reported total ${total})`)

  // 2) Download + parse each.
  const dir = mkdtempSync(join(tmpdir(), 'nepa-'))
  const comments: Comment[] = []
  let ok = 0, empty = 0
  for (let i = 0; i < targetIds.length; i++) {
    const id = targetIds[i]
    const txt = await getPdfText(id, dir)
    if (txt) { comments.push(parse(id, txt)); ok++ } else { empty++ }
    if ((i + 1) % 50 === 0) console.log(`  …pulled ${i + 1}/${targetIds.length}  (ok ${ok}, empty ${empty})`)
    await sleep(DELAY_MS)
  }

  writeFileSync(out, JSON.stringify({ project: PROJECT, pulled_count: comments.length, reported_total: total, comments }, null, 2))
  const withOrg = comments.filter(c => c.organization).length
  const attach = comments.filter(c => c.format === 'attachment').length
  console.log(`\n✔ wrote ${comments.length} comments → ${out}`)
  console.log(`   webform ${comments.length - attach} · attachments ${attach} · with-organization ${withOrg} · empty/failed ${empty}`)
}

main().catch(e => { console.error(e); process.exit(1) })
