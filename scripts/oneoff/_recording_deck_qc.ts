/* eslint-disable */
// Read-only QC harness for the Recordings PowerPoint export.
//
// Renders the deck for an existing recording WITHOUT mutating prod:
//   1. fetch the recording + its stored transcript (service-role reads only)
//   2. run the NEW analyze pass (sentiment + synthesis) in-memory — results are
//      cached to /tmp so deck/layout iteration is free after the first run
//   3. build the Datanautix deck via lib/pptx/recordingDeck and write the .pptx
//      to ~/Downloads
//
// Nothing is written back to the database. Costs ~$1 of AI on the first run
// (Opus extraction + Sonnet curate + synthesis); $0 on cached re-runs.
//
// Run: node_modules/.bin/tsx scripts/_recording_deck_qc.ts
//   force a fresh analyze:  FRESH=1 node_modules/.bin/tsx scripts/_recording_deck_qc.ts

import { readFileSync, writeFileSync, existsSync } from 'fs'
import path from 'path'
import os from 'os'
const env = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const l of env.split('\n')) { const m = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g,'').replace(/\\n$/,'') }

import { createClient } from '@supabase/supabase-js'
import { analyzeRecording } from '../../lib/recordings/analyze'
import { buildRecordingDeck } from '../../lib/pptx/recordingDeck'
import type { RecordingExtractionRow } from '../../lib/recordings/types'

const RECORDING_ID = process.env.RECORDING_ID || '27aace41-15e1-4a3e-8cd1-44e1014ce458' // NOWOCATS Meeting 2
const CACHE = path.join(os.tmpdir(), `recdeck-${RECORDING_ID}.json`)

async function main() {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)

  const { data: rec, error: rErr } = await s.from('recordings')
    .select('id, org_id, name, meeting_date, location, session_type, setup_inputs')
    .eq('id', RECORDING_ID).single()
  if (rErr || !rec) throw new Error('recording not found: ' + (rErr?.message ?? ''))
  console.log(`Recording: ${rec.name} (${rec.session_type})`)

  let analysis: { extractions: any[]; analysis_summary: any }
  if (!process.env.FRESH && existsSync(CACHE)) {
    console.log('Using cached analysis (' + CACHE + '). FRESH=1 to re-run.')
    analysis = JSON.parse(readFileSync(CACHE, 'utf-8'))
  } else {
    const { data: tx, error: txErr } = await s.from('recording_transcripts')
      .select('segments').eq('recording_id', RECORDING_ID).maybeSingle()
    if (txErr || !tx) throw new Error('transcript not found')
    const segments = (tx.segments ?? []) as any[]
    console.log(`Analyzing ${segments.length} transcript segments (Opus + Sonnet x2)…`)
    const res = await analyzeRecording({
      recording_id: rec.id,
      org_id: rec.org_id,
      session_type: rec.session_type,
      setup_inputs: rec.setup_inputs,
      transcript: segments,
    })
    analysis = { extractions: res.extractions, analysis_summary: res.analysis_summary }
    writeFileSync(CACHE, JSON.stringify(analysis, null, 2))
    console.log(`Analyzed: ${res.extractions.length} units, summary=${res.analysis_summary ? 'yes' : 'null'}, cost≈$${(res.total_cost_cents / 100).toFixed(2)}`)
  }

  const buf = await buildRecordingDeck({
    name: rec.name,
    meeting_date: rec.meeting_date,
    location: rec.location,
    analysis_summary: analysis.analysis_summary,
    extractions: analysis.extractions as unknown as RecordingExtractionRow[],
  })

  const safe = (rec.name || 'recording').replace(/[^a-z0-9]/gi, '-').toLowerCase()
  const out = path.join(os.homedir(), 'Downloads', `${safe}-qa-report.pptx`)
  writeFileSync(out, buf)
  console.log('Wrote ' + out + ' (' + (buf.length / 1024).toFixed(0) + ' KB)')
}

main().catch(e => { console.error(e); process.exit(1) })
