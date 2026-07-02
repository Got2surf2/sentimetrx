import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

// GET /api/townhall/status/:sessionId — public endpoint, no auth required
// Returns only the info a participant needs: name, status, config.display
export async function GET(_req: NextRequest, props: { params: Promise<{ sessionId: string }> }) {
  const params = await props.params;
  const supabase = createServiceRoleClient()

  const { data: session } = await supabase
    .from('townhall_sessions')
    .select('id, name, status, config')
    .eq('id', params.sessionId)
    .single()

  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  // Hide sessions still in `setup` from the public endpoint. Otherwise
  // anyone who guesses the URL can preview the discussion guide and
  // opening question before the moderator launches.
  if (session.status === 'setup') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const config = session.config as any

  return NextResponse.json({
    id: session.id,
    name: session.name,
    status: session.status,
    display: config?.display || {},
    closing_message: config?.session_end?.closing_message || null,
  })
}
