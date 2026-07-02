// app/api/org/settings/route.ts
// Returns the current user's org features (including primaryIndustries)

import { createClient, getAuthUser } from '@/lib/supabase/server'
import { serverError } from '@/lib/apiError'

export async function GET(request: Request) {
  try {
    const supabase = await createClient()

    // Get current user
    const user = await getAuthUser(supabase)
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 })
    }

    // Get user's org
    const { data: users, error: userOrgError } = await supabase
      .from('users')
      .select('org_id')
      .eq('id', user.id)
      .single()

    if (userOrgError || !users?.org_id) {
      return Response.json({ error: 'User org not found' }, { status: 404 })
    }

    // Get org features
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .select('features')
      .eq('id', users.org_id)
      .single()

    if (orgError || !org) {
      return Response.json({ error: 'Org not found' }, { status: 404 })
    }

    return Response.json({ features: org.features || {} })
  } catch (error: any) {
    return serverError(error, 'org.settings.get')
  }
}
