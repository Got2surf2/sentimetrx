import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { resolveTownHall, projectHallAsSession } from '@/lib/townHallAdapter'

export const dynamic = 'force-dynamic'

// GET /api/townhall/status/:sessionId — public endpoint, no auth required
// Returns only the info a participant needs: name, status, config.display
//
// Tranche 2 (docs/CONVERGENCE.md § 4.2): reads pulseiq_sessions (id or slug)
// instead of legacy townhall_sessions. No in-repo consumer today (the /pi
// client polls /api/townhall/join) — kept because it's public API surface;
// deletion candidate for the final legacy-drop commit.
export async function GET(_req: NextRequest, props: { params: Promise<{ sessionId: string }> }) {
  const params = await props.params;
  const db = createServiceRoleClient()

  const hall = await resolveTownHall(db, params.sessionId)
  if (!hall) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  const session = projectHallAsSession(hall)
  // Hide sessions still in `setup` (new-substrate `draft`) from the public
  // endpoint. Otherwise anyone who guesses the URL can preview the
  // discussion guide and opening question before the moderator launches.
  if (session.status === 'setup') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  const config = session.config as { display?: Record<string, unknown>; closing_message?: string; session_end?: { closing_message?: string } }

  return NextResponse.json({
    id: session.id,
    name: session.name,
    status: session.status,
    display: config?.display || {},
    closing_message: config?.closing_message || config?.session_end?.closing_message || null,
  })
}
