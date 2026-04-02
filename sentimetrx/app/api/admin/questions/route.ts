// app/api/admin/questions/route.ts
// GET  — list all questions from JSON libraries (psychographic, structured, open-ended)
// POST — admin-only: create a custom question (future: writes to Supabase)

import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import psychographicData from '@/QuestionBank/psychographic_profiling_mobile_v4-2.json'
import industryQuestionsData from '@/lib/data/industryQuestions.json'
import openEndedData from '@/QuestionBank/Question_Bank.json'
import { INDUSTRY_LABELS, type Industry } from '@/lib/industryDefaults'

export const dynamic = 'force-dynamic'

// Map JSON industry labels to internal keys
const LABEL_TO_KEY: Record<string, string> = {}
for (const [key, label] of Object.entries(INDUSTRY_LABELS)) {
  LABEL_TO_KEY[label] = key
}
// Also map the universal entry
LABEL_TO_KEY['Universal / Cross-Industry'] = 'universal'

function mapIndustryLabel(label: string): string {
  return LABEL_TO_KEY[label] || label.toLowerCase().replace(/[^a-z0-9]+/g, '_')
}

export async function GET(req: NextRequest) {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const typeFilter = url.searchParams.get('type') // psychographic | structured | open_ended
  const industryFilter = url.searchParams.get('industry') // industry key

  const result: {
    psychographic: any[]
    structured: any[]
    openEnded: any[]
  } = { psychographic: [], structured: [], openEnded: [] }

  // ── Psychographic questions ──
  if (!typeFilter || typeFilter === 'psychographic') {
    for (const ind of psychographicData.psychographic_profiling) {
      const industryKey = mapIndustryLabel(ind.industry)
      if (industryFilter && industryKey !== industryFilter && industryKey !== 'universal') continue

      for (const q of ind.questions) {
        result.psychographic.push({
          industry: industryKey,
          industryLabel: ind.industry,
          prompt: q.prompt,
          responses: q.responses,
        })
      }
    }
  }

  // ── Structured industry questions ──
  if (!typeFilter || typeFilter === 'structured') {
    for (const ind of industryQuestionsData.industries) {
      if (industryFilter && ind.industry !== industryFilter) continue

      for (const q of ind.questions) {
        result.structured.push({
          industry: ind.industry,
          industryLabel: INDUSTRY_LABELS[ind.industry as Industry] || ind.industry,
          ...q,
        })
      }
    }
  }

  // ── Open-ended questions with keyword triggers ──
  if (!typeFilter || typeFilter === 'open_ended') {
    for (const ind of (openEndedData as any).industries) {
      const industryKey = mapIndustryLabel(ind.industry)
      if (industryFilter && industryKey !== industryFilter) continue

      for (const oe of ind.open_ends) {
        result.openEnded.push({
          industry: industryKey,
          industryLabel: ind.industry,
          prompt: oe.prompt,
          triggerType: oe.trigger_type,
          keywordTriggers: oe.keyword_triggers,
          defaultFollowOn: oe.default_follow_on,
        })
      }
    }
  }

  return NextResponse.json(result)
}
