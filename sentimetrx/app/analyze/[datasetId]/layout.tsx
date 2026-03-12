// app/analyze/[datasetId]/layout.tsx
// Shared layout for all dataset module pages -- header + tab bar

import type { ReactNode } from 'react'
import { createClient } from '@/lib/supabase/server'
import { redirect, notFound } from 'next/navigation'
import TopNav from '@/components/nav/TopNav'
import DatasetHeader from './DatasetHeader'

export const dynamic = 'force-dynamic'

interface Props {
  children:  ReactNode
  params:    { datasetId: string }
}

export default async function DatasetLayout({ children, params }: Props) {
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

  const { data: dataset } = await supabase
    .from('datasets')
    .select('id, name, source, study_id, visibility, status, row_count, last_synced_at, updated_at, studies(name)')
    .eq('id', params.datasetId)
    .eq('org_id', userData?.org_id)
    .single()

  if (!dataset) notFound()

  const studyName = (dataset as any).studies?.name ?? null

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
      <div className="pt-14">
        <DatasetHeader
          dataset={{
            id:             dataset.id,
            name:           dataset.name,
            source:         dataset.source as 'upload' | 'study',
            visibility:     dataset.visibility as 'private' | 'public',
            status:         dataset.status as 'active' | 'archived',
            row_count:      dataset.row_count,
            last_synced_at: dataset.last_synced_at,
            study_name:     studyName,
          }}
        />
        <main className="px-4 pb-12 max-w-6xl mx-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
