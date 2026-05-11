// app/api/admin/questions/route.ts
// GET  — list all questions from JSON libraries + org custom questions
// POST — admin-only: create a custom demo or psychographic question

import { NextRequest, NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
import { requireAdmin } from '@/lib/auth/requireAdmin'
import psychographicData from '@/QuestionBank/psychographic_profiling_mobile_v4-2.json'
import industryQuestionsData from '@/lib/data/industryQuestions.json'
import openEndedData from '@/QuestionBank/Question_Bank.json'
import { INDUSTRY_LABELS, type Industry } from '@/lib/industryDefaults'

export const dynamic = 'force-dynamic'

const LABEL_TO_KEY: Record<string, string> = {}
for (const [key, label] of Object.entries(INDUSTRY_LABELS)) {
  LABEL_TO_KEY[label] = key
}
LABEL_TO_KEY['Universal / Cross-Industry'] = 'universal'

function mapIndustryLabel(label: string): string {
  return LABEL_TO_KEY[label] || label.toLowerCase().replace(/[^a-z0-9]+/g, '_')
}

async function getOrgAndCustomQ(supabase: any, userId: string) {
  const { data: userData } = await supabase
    .from('users').select('org_id').eq('id', userId).single()
  const orgId = userData?.org_id
  if (!orgId) return { orgId: null, customQ: { demo: [], psycho: [] }, features: {} }
  const { data: orgData } = await supabase
    .from('organizations').select('id, features, is_admin_org').eq('id', orgId).single()
  const features = orgData?.features || {}
  const customQ = features.custom_questions || { demo: [], psycho: [] }
  return { orgId, customQ, features, isAdmin: !!orgData?.is_admin_org }
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const typeFilter = url.searchParams.get('type')
  const industryFilter = url.searchParams.get('industry')

  const result: { psychographic: any[]; structured: any[]; openEnded: any[]; customDemo: any[]; customPsycho: any[] } =
    { psychographic: [], structured: [], openEnded: [], customDemo: [], customPsycho: [] }

  // ── Psychographic (JSON library) ──
  if (!typeFilter || typeFilter === 'psychographic') {
    for (const ind of psychographicData.psychographic_profiling) {
      const industryKey = mapIndustryLabel(ind.industry)
      if (industryFilter && industryKey !== industryFilter && industryKey !== 'universal') continue
      for (const q of ind.questions) {
        result.psychographic.push({ industry: industryKey, industryLabel: ind.industry, prompt: q.prompt, responses: q.responses })
      }
    }
  }

  // ── Structured industry questions (JSON) ──
  if (!typeFilter || typeFilter === 'structured') {
    for (const ind of industryQuestionsData.industries) {
      if (industryFilter && ind.industry !== industryFilter) continue
      for (const q of ind.questions) {
        result.structured.push({ industry: ind.industry, industryLabel: INDUSTRY_LABELS[ind.industry as Industry] || ind.industry, ...q })
      }
    }
  }

  // ── Open-ended + keyword triggers (JSON) ──
  if (!typeFilter || typeFilter === 'open_ended') {
    for (const ind of (openEndedData as any).industries) {
      const industryKey = mapIndustryLabel(ind.industry)
      if (industryFilter && industryKey !== industryFilter) continue
      for (const oe of ind.open_ends) {
        result.openEnded.push({ industry: industryKey, industryLabel: ind.industry, prompt: oe.prompt, triggerType: oe.trigger_type, keywordTriggers: oe.keyword_triggers, defaultFollowOn: oe.default_follow_on })
      }
    }
  }

  // ── Custom questions from org features ──
  const { customQ } = await getOrgAndCustomQ(supabase, user.id)
  result.customDemo = customQ.demo || []
  result.customPsycho = customQ.psycho || []

  return NextResponse.json(result)
}

export async function POST(req: NextRequest) {
  const denied = await requireAdmin()
  if (denied) return denied
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { orgId, customQ, features } = await getOrgAndCustomQ(supabase, user.id)
  if (!orgId) return NextResponse.json({ error: 'No org' }, { status: 400 })

  const body = await req.json()
  const { type, data: qData } = body  // type: 'demo' | 'psycho'
  if (type !== 'demo' && type !== 'psycho') return NextResponse.json({ error: 'Invalid type' }, { status: 400 })

  const newId = crypto.randomUUID()
  const entry = { ...qData, id: newId }

  const updated = { ...customQ }
  if (type === 'demo') updated.demo = [...(customQ.demo || []), entry]
  else updated.psycho = [...(customQ.psycho || []), entry]

  const { error } = await supabase.from('organizations')
    .update({ features: { ...features, custom_questions: updated } })
    .eq('id', orgId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ id: newId, ...entry })
}
