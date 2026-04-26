// app/api/bots/[id]/conversations/export/route.ts
// GET — export all conversations as CSV

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

interface Params { params: { id: string } }

export async function GET(req: NextRequest, { params }: Params) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { data: bot } = await supabase.from('bots').select('id, name').eq('id', params.id).single()
  if (!bot) return NextResponse.json({ error: 'Bot not found' }, { status: 404 })

  const { data: turns } = await supabase
    .from('bot_conversation_turns')
    .select('session_id, turn_number, role, content, language, created_at')
    .eq('bot_id', params.id)
    .order('session_id')
    .order('turn_number', { ascending: true })
    .limit(5000)

  if (!turns || turns.length === 0) {
    return NextResponse.json({ error: 'No conversations to export' }, { status: 404 })
  }

  // Build CSV
  const escape = (s: string) => '"' + (s || '').replace(/"/g, '""').replace(/\n/g, ' ') + '"'
  const header = 'Session ID,Turn,Role,Content,Language,Timestamp'
  const rows = turns.map(t =>
    [escape(t.session_id), t.turn_number, t.role, escape(t.content), t.language, t.created_at].join(',')
  )
  const csv = header + '\n' + rows.join('\n')

  const fileName = bot.name.replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_') + '_Conversations.csv'

  // Write to ~/Downloads
  const path = require('path')
  const fs = require('fs')
  const downloadPath = path.join(require('os').homedir(), 'Downloads', fileName)
  fs.writeFileSync(downloadPath, csv)

  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv',
      'Content-Disposition': 'attachment; filename="' + fileName + '"',
    },
  })
}
