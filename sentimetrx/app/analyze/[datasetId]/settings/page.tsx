import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import SettingsClient from './SettingsClient'

export const dynamic = 'force-dynamic'

interface Props {
  params:      { datasetId: string }
  searchParams: { new?: string }
}

export default async function SettingsPage({ params, searchParams }: Props) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: dataset } = await supabase
    .from('datasets')
    .select('id, name, description, visibility, status, row_count, created_by')
    .eq('id', params.datasetId)
    .single()

  if (!dataset) redirect('/analyze')

  const { data: state } = await supabase
    .from('dataset_state')
    .select('*')
    .eq('dataset_id', params.datasetId)
    .single()

  return (
    <SettingsClient
      dataset={dataset}
      state={state}
      datasetId={params.datasetId}
      isOwner={dataset.created_by === user.id}
      isNewDataset={searchParams.new === '1'}
    />
  )
}
