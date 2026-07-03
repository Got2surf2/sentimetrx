/* eslint-disable */
// Read AskAna's current prompt fields so I know what to amend.

import { readFileSync } from 'fs'
import path from 'path'
const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}
import { createClient } from '@supabase/supabase-js'
const BOT_ID = '920c571b-5a09-4d3a-a20e-904a417d20b3'

async function main() {
  const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!)
  const { data, error } = await s.from('bots').select('id, name, personality, system_prompt, guardrails, config').eq('id', BOT_ID).maybeSingle()
  if (error) { console.error(error); process.exit(1) }
  console.log(JSON.stringify(data, null, 2))
}
main()
