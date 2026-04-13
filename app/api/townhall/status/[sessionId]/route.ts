import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// GET /api/townhall/status/:sessionId — public endpoint, no auth required
// Returns only the info a participant needs: name, status, config.display
export async function GET(_req: NextRequest, { params }: { params: { sessionId: string } }) {
  const supabase = createServiceRoleClient()

  const { data: session } = await supabase
    .from('townhall_sessions')
    .select('id, name, status, config')
    .eq('id', params.sessionId)
    .single()

  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const config = session.config as any

  return NextResponse.json({
    id: session.id,
    name: session.name,
    status: session.status,
    display: config?.display || {},
    closing_message: config?.session_end?.closing_message || null,
  })
}
