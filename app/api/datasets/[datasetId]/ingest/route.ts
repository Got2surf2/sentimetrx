// app/api/datasets/[datasetId]/ingest/route.ts
// Server-side dataset ingest control (2026-09-02).
//   POST — kick off (body: { path, filename, format, includedCols,
//          fieldAliases, expectedRows }) or continue (empty body) the ingest.
//          The heavy work runs via waitUntil, so this answers 202 immediately
//          and processing survives the browser tab closing.
//   GET  — the ingest state for the upload page's poller.
// See lib/datasetIngest.ts for the worker + state machine.

import { NextResponse } from 'next/server'
import { waitUntil } from '@vercel/functions'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { getCallerOrgContext } from '@/lib/auth/orgAccess'
import { serverError } from '@/lib/apiError'
import { runIngest, readIngestState, HEARTBEAT_STALE_MS, type IngestFormat } from '@/lib/datasetIngest'
import { logError } from '@/lib/log'

export const dynamic = 'force-dynamic'
// The worker deadline is 250s (lib/datasetIngest) — leave headroom for the
// finalize/compute step so `paused` is written before the platform kills us.
export const maxDuration = 300

interface Params { params: Promise<{ datasetId: string }> }

const FORMATS: IngestFormat[] = ['csv', 'tsv', 'json', 'surveymonkey']

async function gate(datasetId: string) {
  const supabase = await createClient()
  const { userId, orgId, isAdmin } = await getCallerOrgContext(supabase)
  if (!userId || !orgId) return { error: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  const service = createServiceRoleClient()
  const { data: ds } = await service.from('datasets').select('org_id').eq('id', datasetId).maybeSingle()
  if (!ds) return { error: NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 }) }
  if (!isAdmin && ds.org_id !== orgId) return { error: NextResponse.json({ error: "This resource isn't available to your account." }, { status: 404 }) }
  return { userId, orgId, isAdmin, dsOrgId: ds.org_id as string, service }
}

export async function GET(_req: Request, props: Params) {
  const params = await props.params
  const g = await gate(params.datasetId)
  if ('error' in g) return g.error
  const st = await readIngestState(g.service, params.datasetId)
  if (!st) return NextResponse.json({ error: 'No ingest for this dataset' }, { status: 404 })
  // Only the fields the poller needs — includedCols/aliases stay server-side.
  return NextResponse.json({
    status: st.status, rowsDone: st.rowsDone, rowsTotal: st.rowsTotal,
    error: st.error || null, heartbeatAt: st.heartbeatAt,
  })
}

export async function POST(req: Request, props: Params) {
  const params = await props.params
  const g = await gate(params.datasetId)
  if ('error' in g) return g.error
  const { service, userId } = g

  const body = await req.json().catch(() => ({}))
  const existing = await readIngestState(service, params.datasetId)

  if (typeof body.path === 'string' && body.path) {
    // ── Kickoff ──────────────────────────────────────────────────────────
    if (existing && existing.status === 'running') {
      return NextResponse.json({ error: 'Ingest already running' }, { status: 409 })
    }
    // The path was minted by /api/datasets/upload-url under the DATASET's org
    // prefix — refuse anything else so one org can't ingest another's file.
    if (!body.path.startsWith(`${g.dsOrgId}/`)) {
      return NextResponse.json({ error: 'Invalid upload path' }, { status: 400 })
    }
    const format: IngestFormat = FORMATS.includes(body.format) ? body.format : 'csv'
    const includedCols = Array.isArray(body.includedCols) ? body.includedCols.filter((c: unknown) => typeof c === 'string') : []
    const fieldAliases = body.fieldAliases && typeof body.fieldAliases === 'object' ? body.fieldAliases as Record<string, string> : {}
    const { error } = await service.rpc('merge_dataset_analytics', {
      p_dataset_id: params.datasetId,
      p_patch: {
        ingest: {
          status: 'running', rowsDone: 0,
          rowsTotal: Number(body.expectedRows) || 0,
          path: body.path,
          filename: typeof body.filename === 'string' ? body.filename.slice(0, 200) : 'upload',
          format, includedCols, fieldAliases,
          startedAt: new Date().toISOString(), heartbeatAt: new Date().toISOString(),
        },
      },
    })
    if (error) return serverError(error, 'datasets.ingest.start', { orgId: g.orgId })
  } else {
    // ── Continue ─────────────────────────────────────────────────────────
    if (!existing) return NextResponse.json({ error: 'No ingest to continue' }, { status: 404 })
    if (existing.status === 'done') return NextResponse.json({ status: 'done' })
    const heartbeatAge = Date.now() - Date.parse(existing.heartbeatAt || 0 as unknown as string)
    if (existing.status === 'running' && heartbeatAge < HEARTBEAT_STALE_MS) {
      // A live worker owns it — resuming now would double-write.
      return NextResponse.json({ status: 'running', alreadyRunning: true }, { status: 202 })
    }
    // paused, errored (retry), or running-with-dead-worker → take over below.
  }

  waitUntil(
    runIngest(service, params.datasetId, userId).catch((e) => {
      void logError('datasets.ingest.background', e, { datasetId: params.datasetId })
    }),
  )
  return NextResponse.json({ started: true }, { status: 202 })
}
