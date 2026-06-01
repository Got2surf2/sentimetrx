// app/api/datasets/[datasetId]/auto-setup/route.ts
// POST — auto-build schema from linked study config.
// Called by AnalyzeButton on first import. Builds field schema from study questions,
// applies question text as aliases, maps field types from study question types.

import { NextResponse } from 'next/server'
import { createClient, createServiceRoleClient, getAuthUser } from '@/lib/supabase/server'
import { buildStudySchema } from '@/lib/datasetUtils'
import { type Industry } from '@/lib/industryDefaults'
import { INDUSTRY_THEMES } from '@/lib/industryThemes'

export const dynamic = 'force-dynamic'

interface Params { params: Promise<{ datasetId: string }> }

export async function POST(_req: Request, props: Params) {
  const params = await props.params;
  const supabase = await createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const service = createServiceRoleClient()

  // Cross-org gate: service-role bypasses RLS, so confirm the caller's org
  // owns this dataset before letting them overwrite schema_config + name.
  // Admin-org members can act cross-org (Phase E parity).
  const { data: userData } = await supabase
    .from('users').select('org_id, organizations(is_admin_org)').eq('id', user.id).single()
  const orgRel = (userData as any)?.organizations
  const isAdmin = Array.isArray(orgRel) ? orgRel[0]?.is_admin_org === true : orgRel?.is_admin_org === true
  const userOrgId = (userData as any)?.org_id as string | null

  // Load dataset + linked study
  const { data: dataset } = await service
    .from('datasets').select('*, studies(id, name, config)').eq('id', params.datasetId).single()

  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  if (!isAdmin && (dataset as any).org_id !== userOrgId) {
    return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })
  }
  if (dataset.source !== 'study' || !dataset.study_id) {
    return NextResponse.json({ error: 'Not a study-linked dataset' }, { status: 400 })
  }

  const study = (dataset as any).studies
  if (!study || !study.config) {
    return NextResponse.json({ error: 'Study config not found', needsReview: true }, { status: 400 })
  }

  // Build schema from study config
  const schema = buildStudySchema(study.config)

  // Ensure all fields have prompt populated (for PPTX subtitles)
  if (study.config.questions) {
    study.config.questions.forEach(function(q: any) {
      const col = q.exportLabel || q.prompt || q.id
      const field = schema.fields.find(function(f: any) { return f.field === col || f.field.includes(col) })
      if (field && !field.prompt) field.prompt = q.prompt
    })
  }
  if (study.config.psychographicBank) {
    study.config.psychographicBank.forEach(function(pq: any) {
      const sanitized = (pq.key || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
      const field = schema.fields.find(function(f: any) { return f.field === 'psycho_' + sanitized })
      if (field && !field.prompt) field.prompt = pq.q
    })
  }
  if (study.config.demoFields) {
    study.config.demoFields.forEach(function(df: any) {
      if (!df.enabled) return
      const sanitized = (df.key || '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
      const field = schema.fields.find(function(f: any) { return f.field === 'demo_' + sanitized })
      if (field && !field.prompt) field.prompt = df.label
    })
  }

  // Apply question text as field labels (aliases)
  if (study.config.questions) {
    study.config.questions.forEach(function(q: any) {
      const col = q.exportLabel || q.prompt || q.id
      const field = schema.fields.find(function(f: any) { return f.field === col || f.field.includes(col) })
      if (field) {
        // analyticsLabel takes priority; fall back to truncated prompt
        if (q.analyticsLabel) {
          field.label = q.analyticsLabel
        } else if (q.prompt) {
          field.label = q.prompt.length > 60 ? q.prompt.slice(0, 57) + '...' : q.prompt
        }
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
    if (f.field === 'nps_followup' && !f.label) f.label = 'NPS Follow-up'
    if (f.field === 'experience_followup' && !f.label) f.label = 'Experience Follow-up'
    if (f.field === 'q3_response' && !f.label) f.label = 'Open Response 1'
    if (f.field === 'q4_response' && !f.label) f.label = 'Open Response 2'
  })

  // Extract industry — INDUSTRY_THEMES keys match Industry keys directly
  const industry = study.config.industry as Industry | undefined
  const anaLibrary = industry && industry !== 'other' ? industry : null

  // Update dataset name and ana_library
  const datasetUpdate: Record<string, unknown> = { name: study.name + ' \u2014 Analytics' }
  if (anaLibrary) datasetUpdate.ana_library = anaLibrary
  await service.from('datasets').update(datasetUpdate).eq('id', params.datasetId)

  // Build theme model from industry themes if available
  const themeUpdate: Record<string, unknown> = {
    schema_config: schema,
    updated_at: new Date().toISOString(),
    updated_by: user.id,
  }
  if (anaLibrary && INDUSTRY_THEMES[anaLibrary]) {
    const industryThemes = INDUSTRY_THEMES[anaLibrary]
    // Map IndustryTheme → AnaTheme format
    const SENTIMENT_COLORS: Record<string, string> = {
      positive: '#16a34a', negative: '#dc2626', neutral: '#6b7280', mixed: '#d97706'
    }
    const anaThemes = industryThemes.map(function(t) {
      return {
        id: t.id,
        name: t.name,
        keywords: t.keywords,
        color: SENTIMENT_COLORS[t.sentiment] || '#6b7280',
        description: t.description,
        sentiment: t.sentiment,
        count: 0,
        percentage: 0,
        relatedThemes: [],
      }
    })
    themeUpdate.theme_model = {
      themes: anaThemes,
      industry: anaLibrary,
      aiGenerated: false,
      version: 1,
      fieldName: schema.primaryTextField || 'q3_response',
      themeLibName: anaLibrary,
      themeSource: 'industry',
    }
  }

  // Save schema + theme model to dataset_state
  const { error: stateErr } = await service
    .from('dataset_state')
    .update(themeUpdate)
    .eq('dataset_id', params.datasetId)

  if (stateErr) return NextResponse.json({ error: stateErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, needsReview: false, fieldCount: schema.fields.length })
}
