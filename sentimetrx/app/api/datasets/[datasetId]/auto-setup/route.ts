// app/api/datasets/[datasetId]/auto-setup/route.ts
// POST — auto-build schema from linked study config.
// Called by AnalyzeButton on first import. Builds field schema from study questions,
// applies question text as aliases, maps field types from study question types.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient } from '@/lib/supabase/server'
import { buildStudySchema } from '@/lib/datasetUtils'

export const dynamic = 'force-dynamic'

interface Params { params: { datasetId: string } }

export async function POST(_req: Request, { params }: Params) {
  var supabase = createClient()
  var { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  var service = createServiceRoleClient()

  // Load dataset + linked study
  var { data: dataset } = await service
    .from('datasets').select('*, studies(id, name, config)').eq('id', params.datasetId).single()

  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  if (dataset.source !== 'study' || !dataset.study_id) {
    return NextResponse.json({ error: 'Not a study-linked dataset' }, { status: 400 })
  }

  var study = (dataset as any).studies
  if (!study || !study.config) {
    return NextResponse.json({ error: 'Study config not found', needsReview: true }, { status: 200 })
  }

  // Build schema from study config
  var schema = buildStudySchema(study.config)

  // Apply question text as field labels (aliases)
  if (study.config.questions) {
    study.config.questions.forEach(function(q: any) {
      var col = q.exportLabel || q.prompt || q.id
      var field = schema.fields.find(function(f: any) { return f.field === col || f.field.includes(col) })
      if (field && q.prompt) {
        field.label = q.prompt.length > 60 ? q.prompt.slice(0, 57) + '...' : q.prompt
      }
    })
  }

  // Apply standard aliases for built-in fields
  schema.fields.forEach(function(f: any) {
    if (f.field === 'nps_score' && !f.label) f.label = 'NPS Score'
    if (f.field === 'experience_score' && !f.label) f.label = 'Experience Rating'
    if (f.field === 'sentiment' && !f.label) f.label = 'Sentiment'
    if (f.field === 'duration_sec' && !f.label) f.label = 'Duration (seconds)'
    if (f.field === 'submitted_at' && !f.label) f.label = 'Submitted'
    if (f.field === 'q3_response' && !f.label) f.label = 'Open Response 1'
    if (f.field === 'q4_response' && !f.label) f.label = 'Open Response 2'
  })

  // Update dataset name to study name
  await service.from('datasets').update({ name: study.name + ' \u2014 Analytics' }).eq('id', params.datasetId)

  // Save schema to dataset_state
  var { error: stateErr } = await service
    .from('dataset_state')
    .update({
      schema_config: schema,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    })
    .eq('dataset_id', params.datasetId)

  if (stateErr) return NextResponse.json({ error: stateErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, needsReview: false, fieldCount: schema.fields.length })
}
