// lib/userEvents.ts
//
// Generic user-event recorder for stickiness analysis. Call from API
// routes after the user-facing work has completed. Always best-effort:
// failures are swallowed so a logging hiccup never breaks the user flow.
//
// Adding new events:
//   1. Add the name to the UserEventName union below.
//   2. Pick a category for grouping in the admin dashboard.
//   3. Call recordUserEvent(...) from the relevant API route.
//   4. Optionally pass metadata { … } for per-event details (dataset_id,
//      export_format, etc.) so the admin view can drill down later.

import { createServiceRoleClient } from './supabase/server'
import type { NextRequest } from 'next/server'

// Keep the name union narrow so typos surface at compile time. Add to
// the union when instrumenting a new event.
export type UserEventName =
  | 'login'                  // successful sign-in (mirror of user_logins)
  | 'dataset_created'        // any source — upload, study, reviews, etc.
  | 'dataset_synced'         // sync completed with > 0 new rows
  | 'theme_mined'            // AI mining produced themes
  | 'theme_library_applied'  // industry theme library applied
  | 'theme_model_saved'      // user saved theme edits
  | 'export_started'         // any export route hit
  | 'share_created'          // share token minted
  | 'agent_created'          // new agent / bot
  | 'agent_chat_started'     // public agent chat session opened
  | 'townhall_created'       // pulseiq session created
  | 'campaign_created'       // email campaign created
  | 'campaign_sent'          // campaign sent
  | 'ai_toggled'             // user opt-in/out (also logged in ai_consent_audit)
  | 'ask_ana'                // ask-ana query
  | 'entities_discovered'    // entity discovery run on a dataset's scope

export type UserEventCategory =
  | 'auth' | 'data' | 'analyze' | 'export' | 'share' | 'agent' | 'campaign' | 'admin'

const CATEGORY: Record<UserEventName, UserEventCategory> = {
  login:                  'auth',
  dataset_created:        'data',
  dataset_synced:         'data',
  theme_mined:            'analyze',
  theme_library_applied:  'analyze',
  theme_model_saved:      'analyze',
  export_started:         'export',
  share_created:          'share',
  agent_created:          'agent',
  agent_chat_started:     'agent',
  townhall_created:       'agent',
  campaign_created:       'campaign',
  campaign_sent:          'campaign',
  ai_toggled:             'auth',
  ask_ana:                'analyze',
  entities_discovered:    'analyze',
}

interface RecordEventOpts {
  userId:    string
  orgId?:    string | null
  event:     UserEventName
  metadata?: Record<string, unknown>
  ip?:       string | null
  userAgent?: string | null
}

export async function recordUserEvent(opts: RecordEventOpts): Promise<void> {
  try {
    const service = createServiceRoleClient()
    await service.from('user_events').insert({
      user_id:        opts.userId,
      org_id:         opts.orgId || null,
      event_name:     opts.event,
      event_category: CATEGORY[opts.event],
      metadata:       opts.metadata || {},
      ip:             opts.ip || null,
      user_agent:     opts.userAgent || null,
    })
  } catch (e) {
    // Best-effort: log + swallow. A failed analytics write should
    // never bubble up and break the user-facing operation.
    console.warn('[userEvents] insert failed', (e as Error)?.message || e)
  }
}

/** Convenience helper: extract ip + ua from a NextRequest. */
export function eventContextFromRequest(req: NextRequest): { ip: string | null; userAgent: string | null } {
  const ip =
    req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    req.headers.get('x-real-ip') ||
    null
  const userAgent = req.headers.get('user-agent') || null
  return { ip, userAgent }
}
