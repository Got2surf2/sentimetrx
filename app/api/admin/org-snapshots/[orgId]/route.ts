// app/api/admin/org-snapshots/[orgId]/route.ts
// GET — list snapshots for one org from S3
// POST — trigger an on-demand snapshot for this org (operator-initiated)
//
// Admin-org gated.

import { NextRequest, NextResponse } from 'next/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import { dumpOrgSnapshot } from '@/lib/orgSnapshot'
import { uploadOrgSnapshot, listOrgSnapshots } from '@/lib/backupS3'
import { createServiceRoleClient } from '@/lib/supabase/server'
import { serverError } from '@/lib/apiError'

export const dynamic = 'force-dynamic'
export const maxDuration = 120

interface Params { params: Promise<{ orgId: string }> }

export async function GET(_req: NextRequest, props: Params) {
  const params = await props.params;
  const denied = await requireAdmin()
  if (denied) return denied
  try {
    const items = await listOrgSnapshots(params.orgId, 100)
    return NextResponse.json({ snapshots: items })
  } catch (e: any) {
    return serverError(e, 'admin.orgSnapshots.list', { orgId: params.orgId })
  }
}

export async function POST(_req: NextRequest, props: Params) {
  const params = await props.params;
  const denied = await requireAdmin()
  if (denied) return denied

  // Verify the org exists before doing the work.
  const service = createServiceRoleClient()
  const { data: org } = await service.from('organizations').select('id, name').eq('id', params.orgId).single()
  if (!org) return NextResponse.json({ error: 'Org not found' }, { status: 404 })

  try {
    const snap = await dumpOrgSnapshot(params.orgId)
    const result = await uploadOrgSnapshot(params.orgId, snap)
    return NextResponse.json({
      ok: true,
      org_name: (org as any).name,
      key: result.key,
      size_bytes: result.size_bytes,
      row_counts: snap.meta.table_row_counts,
      truncated: snap.meta.truncated_tables,
    })
  } catch (e: any) {
    return serverError(e, 'admin.orgSnapshots.create', { orgId: params.orgId })
  }
}
