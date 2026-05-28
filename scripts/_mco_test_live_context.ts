/* eslint-disable */
// Direct test of buildMcoLiveContext — bypasses Next.js so we can confirm
// the lib actually returns matches for the user's exact query.

import { readFileSync } from 'fs'
import path from 'path'
const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\\n$/, '')
}

async function main() {
  const { buildMcoLiveContext } = await import('@/lib/mcoLiveContext')
  const block = await buildMcoLiveContext(
    '920c571b-5a09-4d3a-a20e-904a417d20b3',
    'what gate does my delta flight to lga leave from',
    '',
  )
  console.log('=== LIVE BLOCK ===')
  console.log(block || '(empty — no live intent detected, or no matches)')
}
main().catch(e => { console.error(e); process.exit(1) })
