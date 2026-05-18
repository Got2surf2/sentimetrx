/* eslint-disable */
import { readFileSync } from 'fs'
import path from 'path'

const envText = readFileSync(path.join(process.cwd(), '.env.local'), 'utf-8')
for (const line of envText.split('\n')) {
  const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/)
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

import { createClient } from '@supabase/supabase-js'

const BOT_ID = '5c468b90-13fc-46a2-8855-312dc0a1e428'

async function main() {
  const service = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )

  const { data, error } = await service
    .from('bot_knowledge_chunks')
    .select('title, content, metadata')
    .eq('bot_id', BOT_ID)
  if (error) throw error

  const needles = [
    'next meeting', 'next community', 'meeting #2', 'meeting 2', 'series #2', 'pm-2', 'pm2',
    'second meeting', 'spring 2026', 'summer 2026', 'fall 2026', 'winter 2026', 'march 2026',
    'april 2026', 'may 2026', 'june 2026', 'july 2026', 'august 2026', 'september 2026',
    'october 2026', 'november 2026', 'december 2026', 'january 2027',
  ]

  for (const row of data ?? []) {
    const text = `${row.title}\n${row.content}`.toLowerCase()
    for (const n of needles) {
      if (text.includes(n)) {
        const idx = text.indexOf(n)
        const start = Math.max(0, idx - 60)
        const end = Math.min(text.length, idx + 160)
        console.log(`---`)
        console.log(`SOURCE: ${(row.metadata as any)?.source}`)
        console.log(`TITLE: ${row.title}`)
        console.log(`MATCH "${n}": ...${text.slice(start, end)}...`)
        break
      }
    }
  }
}

main().catch(e => { console.error(e); process.exit(1) })
