// app/api/bots/fetch-url/route.ts
// POST — fetch a URL and extract text content for bot training
// Strips HTML, returns plain text. Used during bot creation.

import type { NextRequest} from 'next/server';
import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { safeFetch, SafeFetchError } from '@/lib/safeFetch'
import { serverError } from '@/lib/apiError'
import { htmlToPlainText } from '@/lib/htmlStrip'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(req: NextRequest) {
  // Auth check
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { url } = body
  if (!url || typeof url !== 'string') {
    return NextResponse.json({ error: 'URL is required' }, { status: 400 })
  }

  try {
    const res = await safeFetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Datanautix Bot Trainer/1.0)',
        'Accept': 'text/html,application/xhtml+xml,text/plain',
      },
      signal: AbortSignal.timeout(15000),
    })

    if (!res.ok) {
      return NextResponse.json({ error: 'Failed to fetch: ' + res.status }, { status: 502 })
    }

    const html = await res.text()

    // Strip HTML tags and extract text
    var text = htmlToPlainText(html)   // fixed-point strip, &amp; decoded last (lib/htmlStrip)

    // Truncate to ~50K chars to stay within reasonable system prompt sizes
    if (text.length > 50000) text = text.slice(0, 50000) + '\n\n[Truncated — content exceeds 50,000 characters]'

    return NextResponse.json({ text, length: text.length, url })
  } catch (err: unknown) {
    if (err instanceof SafeFetchError) {
      return NextResponse.json({ error: err.message }, { status: err.status })
    }
    return serverError(err, 'bots.fetchUrl')
  }
}
