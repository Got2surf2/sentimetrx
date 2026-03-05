import { NextRequest, NextResponse } from 'next/server'
import { createServiceRoleClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const noCache = { 'Cache-Control': 'no-store, no-cache, must-revalidate' }

export async function GET(
  _req: NextRequest,
  { params }: { params: { guid: string } }
) {
  const { guid } = params

  const supabase = createServiceRoleClient()

  // Query with full debug — see exactly what comes back
  const { data, error, status, statusText } = await supabase
    .from('studies')
    .select('id, guid, status')
    .eq('guid', guid)

  // Return everything raw so we can see what's happening
  return NextResponse.json({
    guid_received: guid,
    supabase_status: status,
    supabase_statusText: statusText,
    error: error?.message || null,
    rows_returned: data?.length ?? 0,
    data: data,
    env_url: process.env.NEXT_PUBLIC_SUPABASE_URL?.slice(0, 30),
  }, { headers: noCache })
}
