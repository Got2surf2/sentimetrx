// app/analyze/page.tsx
// Server component -- analyze gate + datasets list

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import TopNav from '@/components/nav/TopNav'
import AnalyzeClient from './AnalyzeClient'

export const dynamic = 'force-dynamic'

export default async function AnalyzePage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('full_name, org_id, organizations(id, name, is_admin_org, logo_url, features)')
    .eq('id', user.id)
    .single()

  const rawOrg  = userData?.organizations
  const orgData = Array.isArray(rawOrg) ? rawOrg[0] : rawOrg as any

  if (!orgData?.features?.analyze) redirect('/dashboard')

  const orgId = userData?.org_id

  const { data: rawDatasets, error: dsErr } = await supabase
    .from('datasets')
    .select('id, name, description, source, study_id, ana_library, visibility, status, row_count, last_synced_at, created_at, updated_at, created_by, studies(name), dataset_state(theme_model)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false })

  if (dsErr) console.error('[AnalyzePage] datasets query error:', dsErr.message)

  // Fetch creator names separately (the FK join to auth.users is unreliable)
  var creatorIds = Array.from(new Set((rawDatasets || []).map(function(d: any) { return d.created_by }).filter(Boolean)))
  var creatorMap: Record<string, string> = {}
  if (creatorIds.length > 0) {
    var { data: creators } = await supabase
      .from('users')
      .select('id, full_name, email')
      .in('id', creatorIds)
    ;(creators || []).forEach(function(c: any) { creatorMap[c.id] = c.full_name || c.email || 'Unknown' })
  }

  const datasets = (rawDatasets || []).map(function(d: any) {
    const studyName = d.studies?.name ?? null
    const creatorName = creatorMap[d.created_by] || null
    const stateArr = d.dataset_state
    const state = Array.isArray(stateArr) ? stateArr[0] : stateArr
    const tm = state?.theme_model || null
    const themeCount = tm?.themes?.length || 0
    const themeSource = tm?.themeSource || null
    const themeLibName = tm?.themeLibName || null
    const { studies: _s, dataset_state: _ds, ...rest } = d
    return { ...rest, study_name: studyName, creator_name: creatorName, org_name: orgData?.name || null, theme_count: themeCount, theme_source: themeSource, theme_lib_name: themeLibName }
  })

  return (
    <div className="min-h-screen bg-gray-50">
      <TopNav
        logoUrl={orgData?.logo_url    || ''}
        orgName={orgData?.name        || ''}
        isAdmin={!!orgData?.is_admin_org}
        userEmail={user.email         || ''}
        fullName={userData?.full_name  || ''}
        analyzeEnabled={true}
        currentPage="analyze"
      />
      <main className="pt-20 px-4 pb-12 max-w-6xl mx-auto">
        <AnalyzeClient initialDatasets={datasets} />
      </main>
    </div>
  )
}
