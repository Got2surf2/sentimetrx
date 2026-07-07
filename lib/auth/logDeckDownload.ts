// lib/auth/logDeckDownload.ts
// Fire-and-forget insert into deck_download_log so /admin/decks can show
// "last downloaded" per deck. Errors are swallowed — a logging failure
// must never block a download.

import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { logError } from '@/lib/log'

export async function logDeckDownload(deckName: string, variant?: string): Promise<void> {
  try {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    let userId: string | null = null
    let orgId: string | null = null
    if (user) {
      userId = user.id
      const { data, error: userRowErr } = await supabase.from('users').select('org_id').eq('id', user.id).single()
      if (userRowErr) void logError('logDeckDownload.logDeckDownload', userRowErr)
      orgId = (data as { org_id: string | null } | null)?.org_id ?? null
    }

    const service = createServiceRoleClient()
    await service.from('deck_download_log').insert({
      deck_name: deckName,
      deck_variant: variant ?? null,
      user_id: userId,
      org_id: orgId,
    })
  } catch {
    // Swallow — never fail the download because logging failed.
  }
}
