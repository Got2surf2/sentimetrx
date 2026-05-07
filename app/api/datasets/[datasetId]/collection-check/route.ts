// app/api/datasets/[datasetId]/collection-check/route.ts
// GET — check if this dataset belongs to any collection
// Returns { collection_dataset_id, collection_name } or {}

import { NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'
export const fetchCache = 'force-no-store'

interface Params { params: { datasetId: string } }

export async function GET(_req: Request, { params }: Params) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({})

  // Find collection_members rows for this dataset
  const { data: memberships } = await supabase
    .from('collection_members')
    .select('collection_id, collections(dataset_id)')
    .eq('dataset_id', params.datasetId)
    .limit(1)

  if (!memberships || memberships.length === 0) return NextResponse.json({})

  const colDatasetId = (memberships[0].collections as any)?.dataset_id
  if (!colDatasetId) return NextResponse.json({})

  // Get collection dataset name
  const { data: colDs } = await supabase
    .from('datasets')
    .select('name')
    .eq('id', colDatasetId)
    .single()

  return NextResponse.json({
    collection_dataset_id: colDatasetId,
    collection_name: colDs?.name || 'Untitled Collection',
  })
}
