// app/api/campaigns/unsubscribe/[token]/route.ts
// GET — public unsubscribe endpoint (no auth required)

import { createServiceRoleClient } from '@/lib/supabase/server'
import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ token: string }> }

export async function GET(_req: NextRequest, props: Params) {
  const params = await props.params;
  if (params.token === 'test-preview') {
    return new NextResponse(unsubscribePage('This is a test preview — no action taken.'), {
      headers: { 'Content-Type': 'text/html' },
    })
  }

  const service = createServiceRoleClient()

  const { data } = await service
    .from('campaign_respondents')
    .select('id, email, status')
    .eq('unsubscribe_token', params.token)
    .single()

  if (!data) {
    return new NextResponse(unsubscribePage('Invalid or expired unsubscribe link.'), {
      status: 404,
      headers: { 'Content-Type': 'text/html' },
    })
  }

  if (data.status === 'unsubscribed') {
    return new NextResponse(unsubscribePage('You have already been unsubscribed.'), {
      headers: { 'Content-Type': 'text/html' },
    })
  }

  await service
    .from('campaign_respondents')
    .update({ status: 'unsubscribed' })
    .eq('id', data.id)

  return new NextResponse(unsubscribePage('You have been successfully unsubscribed. You will no longer receive emails for this campaign.'), {
    headers: { 'Content-Type': 'text/html' },
  })
}

function unsubscribePage(message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Unsubscribe</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; display: flex; justify-content: center; align-items: center; min-height: 100vh; margin: 0; background: #f9fafb; color: #374151; }
  .card { background: white; border-radius: 16px; padding: 40px; max-width: 420px; text-align: center; box-shadow: 0 4px 12px rgba(0,0,0,.08); }
  h1 { font-size: 20px; margin: 0 0 16px; color: #1f2937; }
  p { font-size: 14px; line-height: 1.6; color: #6b7280; margin: 0; }
</style>
</head>
<body><div class="card"><h1>Unsubscribe</h1><p>${message}</p></div></body>
</html>`
}
