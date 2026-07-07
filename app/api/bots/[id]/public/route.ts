// GET /api/bots/[id]/public
//
// Public, unauthenticated, CORS-open — returns ONLY the agent's safe display
// config (name, avatar letter, subtitle, greeting, suggested questions,
// placeholder) so external embeds (e.g. the datanautix.com chat widget) can
// render the agent's identity at runtime instead of hardcoding it.
//
// Mirrors the wildcard CORS posture of /api/bots/[id]/chat. NEVER exposes the
// system prompt, knowledge base, guardrails, or any other private config —
// only the handful of fields the public chat UI already shows.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Cache-Control': 'public, max-age=60',
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: cors })
}

interface Params { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, props: Params) {
  const params = await props.params

  const service = createServiceRoleClient()
  const { data, error } = await service
    .from('agents')
    .select('name, status, config')
    .eq('id', params.id)
    .single()

  if (error || !data || data.status !== 'active') {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: cors })
  }

  const cfg = (data.config || {}) as Record<string, unknown>
  const name = cfg.name || data.name || 'Assistant'

  return NextResponse.json(
    {
      name,
      subtitle: cfg.subtitle || '',
      avatarLetter: cfg.avatarLetter || String(name).charAt(0).toUpperCase(),
      greeting: cfg.initialMessage || '',
      suggestions: Array.isArray(cfg.suggestions) ? cfg.suggestions.slice(0, 6) : [],
      placeholder: cfg.placeholder || '',
    },
    { headers: cors }
  )
}
