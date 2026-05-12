// app/api/questions/library/route.ts
// GET — return the JSON question banks (psychographic, structured, open-ended)
// plus the caller's org's custom questions. Any authed user — required by
// the survey/agent creator wizard.
//
// Split out of /api/admin/questions GET so non-admin users can read the
// library without traversing an /api/admin/* path. The admin path now hosts
// only the POST handler (super-admin-only custom-question creation).

import { NextRequest, NextResponse } from 'next/server'
import { createClient, getAuthUser } from '@/lib/supabase/server'
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

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const user = await getAuthUser(supabase)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const typeFilter = url.searchParams.get('type')
  const industryFilter = url.searchParams.get('industry')

  const result: { psychographic: any[]; structured: any[]; openEnded: any[]; customDemo: any[]; customPsycho: any[] } =
    { psychographic: [], structured: [], openEnded: [], customDemo: [], customPsycho: [] }

  if (!typeFilter || typeFilter === 'psychographic') {
    for (const ind of psychographicData.psychographic_profiling) {
      const industryKey = mapIndustryLabel(ind.industry)
      if (industryFilter && industryKey !== industryFilter && industryKey !== 'universal') continue
      for (const q of ind.questions) {
        result.psychographic.push({ industry: industryKey, industryLabel: ind.industry, prompt: q.prompt, responses: q.responses })
      }
    }
  }

  if (!typeFilter || typeFilter === 'structured') {
    for (const ind of industryQuestionsData.industries) {
      if (industryFilter && ind.industry !== industryFilter) continue
      for (const q of ind.questions) {
        result.structured.push({ industry: ind.industry, industryLabel: INDUSTRY_LABELS[ind.industry as Industry] || ind.industry, ...q })
      }
    }
  }

  if (!typeFilter || typeFilter === 'open_ended') {
    for (const ind of (openEndedData as any).industries) {
      const industryKey = mapIndustryLabel(ind.industry)
      if (industryFilter && industryKey !== industryFilter) continue
      for (const oe of ind.open_ends) {
        result.openEnded.push({ industry: industryKey, industryLabel: ind.industry, prompt: oe.prompt, triggerType: oe.trigger_type, keywordTriggers: oe.keyword_triggers, defaultFollowOn: oe.default_follow_on })
      }
    }
  }

  // Caller's own org's custom questions (stored in organizations.features).
  const { data: userData } = await supabase
    .from('users').select('org_id').eq('id', user.id).single()
  const orgId = userData?.org_id as string | null
  if (orgId) {
    const { data: orgData } = await supabase
      .from('organizations').select('features').eq('id', orgId).single()
    const features = (orgData?.features as any) || {}
    const customQ = features.custom_questions || { demo: [], psycho: [] }
    result.customDemo = customQ.demo || []
    result.customPsycho = customQ.psycho || []
  }

  return NextResponse.json(result)
}
