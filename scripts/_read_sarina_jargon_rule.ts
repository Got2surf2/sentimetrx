/* eslint-disable */
// Read-only: print the current jargon-rule paragraph from Sarina's
// system_prompt so we can confirm the actual order — plain English first
// or engineering term first. No writes.
//
// Run: node_modules/.bin/tsx scripts/_read_sarina_jargon_rule.ts

import { readFileSync } from 'fs'
import path from 'path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'

const BOT_ID = '5c468b90-13fc-46a2-8855-312dc0a1e428'
const ORG_ID = 'b72e9ee6-0466-459a-8440-988a8bd6d3c5'

async function main() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const { data, error } = await service
    .from('bots')
    .select('id, name, slug, system_prompt')
    .eq('id', BOT_ID)
    .eq('org_id', ORG_ID)
    .maybeSingle()
  if (error) { console.error(error); process.exit(1) }
  if (!data) { console.error('Sarina not found'); process.exit(1) }

  const sp: string = data.system_prompt || ''
  console.log('Sarina system_prompt length:', sp.length, 'chars')
  console.log('---')

  const lines = sp.split('\n')
  let printing = false
  let printedLines = 0
  lines.forEach((ln, i) => {
    const lower = ln.toLowerCase()
    const start =
      lower.includes('jargon') ||
      lower.includes('plain language') ||
      lower.includes('plain-language') ||
      lower.includes('plain english') ||
      lower.includes('plain-english') ||
      lower.includes('engineering term') ||
      lower.includes('acronym') ||
      lower.includes('los ')
    if (start) printing = true
    if (printing) {
      console.log((i + 1).toString().padStart(4, ' ') + '  ' + ln)
      printedLines++
      if (printedLines > 60) printing = false
    }
  })
}

main().catch(e => { console.error(e); process.exit(1) })
