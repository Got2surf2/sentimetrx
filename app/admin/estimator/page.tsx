'use client'

// app/admin/estimator/page.tsx
// Project cost estimator for bidding — input product mix + volume → AI cost estimate.
// RATES are imported from lib/usageLog.ts so this page and /admin/usage stay in sync.

import { useState } from 'react'
import { RATES, TIER_DEFAULT_MODEL } from '@/lib/usageRates'

var HERMES = '#E8632A'

// Supabase Storage / S3 standard pricing per GB-month.
var STORAGE_RATE_PER_GB = 0.023

// ── AI call profiles: avg tokens per call type ────────────────────────
// `tier` resolves to a model via TIER_DEFAULT_MODEL → RATES.
var PROFILES: Record<string, { input: number; output: number; tier: 'fast' | 'standard' | 'advanced'; label: string }> = {
  // PulseIQ (Town Hall)
  th_chat:        { input: 800,  output: 150,  tier: 'fast',     label: 'TH chat response' },
  th_deflect:     { input: 400,  output: 80,   tier: 'fast',     label: 'TH deflection check' },
  th_compress:    { input: 600,  output: 100,  tier: 'fast',     label: 'TH context compression' },
  th_translate:   { input: 300,  output: 200,  tier: 'fast',     label: 'TH translation' },
  th_theme:       { input: 1500, output: 300,  tier: 'fast',     label: 'TH theme detection' },
  // Agents
  bot_chat:       { input: 1200, output: 300,  tier: 'fast',     label: 'Agent chat response' },
  bot_deflect:    { input: 400,  output: 80,   tier: 'fast',     label: 'Agent deflection' },
  bot_intent:     { input: 300,  output: 30,   tier: 'fast',     label: 'Agent intent detection' },
  bot_persona:    { input: 500,  output: 200,  tier: 'fast',     label: 'Agent persona extraction' },
  bot_demo:       { input: 500,  output: 150,  tier: 'fast',     label: 'Agent demographics' },
  bot_compress:   { input: 600,  output: 100,  tier: 'fast',     label: 'Agent context compression' },
  bot_translate:  { input: 300,  output: 200,  tier: 'fast',     label: 'Agent translation' },
  // Surveys
  survey_clarify:   { input: 600, output: 150, tier: 'fast',     label: 'Survey clarification' },
  survey_deflect:   { input: 400, output: 80,  tier: 'fast',     label: 'Survey deflection' },
  survey_translate: { input: 300, output: 200, tier: 'fast',     label: 'Survey translation' },
  // Social
  social_reply:   { input: 500,  output: 150,  tier: 'fast',     label: 'Social AI reply' },
  social_theme:   { input: 3000, output: 800,  tier: 'standard', label: 'Social theme mining' },
  // Search & Datasets
  ds_theme_mine:  { input: 3000, output: 800,  tier: 'standard', label: 'Dataset theme mining' },
  search_rerank:  { input: 2500, output: 400,  tier: 'standard', label: 'Search re-rank' },
  // Ask Ana & Insights
  ana_chat:        { input: 4000, output: 800,  tier: 'advanced', label: 'Ask Ana query' },
  ana_sample:      { input: 2000, output: 400,  tier: 'advanced', label: 'Ana sampling decision' },
  insights_deck:   { input: 5000, output: 2000, tier: 'advanced', label: 'Insights deck / report' },
  insights_export: { input: 3000, output: 1500, tier: 'advanced', label: 'HTML/PPTX export' },
}

function costForCalls(profileKey: string, count: number): number {
  var p = PROFILES[profileKey]
  if (!p || count <= 0) return 0
  var model = TIER_DEFAULT_MODEL[p.tier]
  var rates = RATES[model]
  if (!rates) return 0
  return count * ((p.input / 1_000_000) * rates.input + (p.output / 1_000_000) * rates.output)
}

interface LineItem { label: string; calls: number; cost: number }

export default function EstimatorPage() {
  // ── PulseIQ (Town Hall) ──
  var [thEnabled, setThEnabled] = useState(true)
  var [thSessions, setThSessions] = useState(2)
  var [thParticipants, setThParticipants] = useState(50)
  var [thTurnsPerParticipant, setThTurnsPerParticipant] = useState(8)
  var [thTopics, setThTopics] = useState(6)
  var [thMultilingualPct, setThMultilingualPct] = useState(0)
  var [thThemeReruns, setThThemeReruns] = useState(1)

  // ── Agents ──
  var [botEnabled, setBotEnabled] = useState(true)
  var [botConversations, setBotConversations] = useState(200)
  var [botTurnsPerConvo, setBotTurnsPerConvo] = useState(6)
  var [botTurnsP95, setBotTurnsP95] = useState(15)
  var [botIntents, setBotIntents] = useState(true)
  var [botDemographics, setBotDemographics] = useState(false)
  var [botMultilingualPct, setBotMultilingualPct] = useState(0)

  // ── Surveys ──
  var [surveyEnabled, setSurveyEnabled] = useState(false)
  var [surveyResponses, setSurveyResponses] = useState(500)
  var [surveyQuestions, setSurveyQuestions] = useState(5)
  var [surveyMultilingualPct, setSurveyMultilingualPct] = useState(0)

  // ── Social ──
  var [socialEnabled, setSocialEnabled] = useState(false)
  var [socialComments, setSocialComments] = useState(1000)
  var [socialAutoReplyPct, setSocialAutoReplyPct] = useState(30)
  var [socialThemeRuns, setSocialThemeRuns] = useState(4)

  // ── Datasets / Search ──
  var [searchEnabled, setSearchEnabled] = useState(false)
  var [searchQueries, setSearchQueries] = useState(500)
  var [searchRerankPct, setSearchRerankPct] = useState(40)
  var [datasetThemeRuns, setDatasetThemeRuns] = useState(2)

  // ── Ask Ana ──
  var [anaEnabled, setAnaEnabled] = useState(true)
  var [anaQueries, setAnaQueries] = useState(50)

  // ── Insights / Exports ──
  var [insightsEnabled, setInsightsEnabled] = useState(false)
  var [insightsDecks, setInsightsDecks] = useState(2)
  var [insightsExports, setInsightsExports] = useState(5)

  // ── Storage ──
  var [storageGB, setStorageGB] = useState(5)

  // ── Pricing ──
  var [months, setMonths] = useState(1)
  var [markup, setMarkup] = useState(50)
  var [quotedPrice, setQuotedPrice] = useState(0)

  // ── Calculate ──
  var lines: LineItem[] = []

  if (thEnabled) {
    var thTotalTurns = thSessions * thParticipants * thTurnsPerParticipant
    lines.push({ label: 'TH chat responses', calls: thTotalTurns, cost: costForCalls('th_chat', thTotalTurns) })
    var thDeflect = Math.round(thTotalTurns * 0.3)
    lines.push({ label: 'TH deflection checks', calls: thDeflect, cost: costForCalls('th_deflect', thDeflect) })
    var compressTurns = Math.round(thTotalTurns * 0.1)
    lines.push({ label: 'TH context compression', calls: compressTurns, cost: costForCalls('th_compress', compressTurns) })
    if (thMultilingualPct > 0) {
      var thXlate = Math.round(thTotalTurns * thMultilingualPct / 100)
      lines.push({ label: 'TH translations', calls: thXlate, cost: costForCalls('th_translate', thXlate) })
    }
    var themeRuns = thSessions * Math.ceil(thParticipants / 10) * Math.max(1, thThemeReruns)
    lines.push({ label: 'TH theme detection', calls: themeRuns, cost: costForCalls('th_theme', themeRuns) })
  }

  if (botEnabled) {
    var botTotalTurns = botConversations * botTurnsPerConvo
    lines.push({ label: 'Agent chat responses', calls: botTotalTurns, cost: costForCalls('bot_chat', botTotalTurns) })
    var botDeflect = Math.round(botTotalTurns * 0.3)
    lines.push({ label: 'Agent deflection checks', calls: botDeflect, cost: costForCalls('bot_deflect', botDeflect) })
    if (botIntents) {
      var botIntent = Math.round(botTotalTurns * 0.2)
      lines.push({ label: 'Agent intent detection', calls: botIntent, cost: costForCalls('bot_intent', botIntent) })
    }
    var personaCalls = botConversations
    lines.push({ label: 'Agent persona extraction', calls: personaCalls, cost: costForCalls('bot_persona', personaCalls) })
    if (botDemographics) {
      lines.push({ label: 'Agent demographics', calls: personaCalls, cost: costForCalls('bot_demo', personaCalls) })
    }
    // Compression triggers more often when convos are long; weight by p95 vs mean.
    var compressShare = Math.max(0.05, Math.min(0.25, (botTurnsP95 - botTurnsPerConvo) / 40))
    var botCompressCalls = Math.round(botTotalTurns * compressShare)
    lines.push({ label: 'Agent context compression', calls: botCompressCalls, cost: costForCalls('bot_compress', botCompressCalls) })
    if (botMultilingualPct > 0) {
      var botXlate = Math.round(botTotalTurns * botMultilingualPct / 100)
      lines.push({ label: 'Agent translations', calls: botXlate, cost: costForCalls('bot_translate', botXlate) })
    }
  }

  if (surveyEnabled) {
    var surveyTotalQA = surveyResponses * surveyQuestions
    var sClarify = Math.round(surveyTotalQA * 0.5)
    lines.push({ label: 'Survey clarifications', calls: sClarify, cost: costForCalls('survey_clarify', sClarify) })
    var sDeflect = Math.round(surveyTotalQA * 0.2)
    lines.push({ label: 'Survey deflections', calls: sDeflect, cost: costForCalls('survey_deflect', sDeflect) })
    if (surveyMultilingualPct > 0) {
      var sXlate = Math.round(surveyTotalQA * surveyMultilingualPct / 100)
      lines.push({ label: 'Survey translations', calls: sXlate, cost: costForCalls('survey_translate', sXlate) })
    }
  }

  if (socialEnabled) {
    var autoReplies = Math.round(socialComments * socialAutoReplyPct / 100)
    lines.push({ label: 'Social AI replies', calls: autoReplies, cost: costForCalls('social_reply', autoReplies) })
    if (socialThemeRuns > 0) {
      lines.push({ label: 'Social theme mining', calls: socialThemeRuns, cost: costForCalls('social_theme', socialThemeRuns) })
    }
  }

  if (searchEnabled) {
    var rerankCount = Math.round(searchQueries * searchRerankPct / 100)
    lines.push({ label: 'Search re-rank', calls: rerankCount, cost: costForCalls('search_rerank', rerankCount) })
    if (datasetThemeRuns > 0) {
      lines.push({ label: 'Dataset theme mining', calls: datasetThemeRuns, cost: costForCalls('ds_theme_mine', datasetThemeRuns) })
    }
  }

  if (anaEnabled) {
    lines.push({ label: 'Ask Ana queries', calls: anaQueries, cost: costForCalls('ana_chat', anaQueries) })
    var anaSample = Math.round(anaQueries * 0.3)
    lines.push({ label: 'Ana sampling decisions', calls: anaSample, cost: costForCalls('ana_sample', anaSample) })
  }

  if (insightsEnabled) {
    if (insightsDecks > 0) {
      lines.push({ label: 'Insights decks', calls: insightsDecks, cost: costForCalls('insights_deck', insightsDecks) })
    }
    if (insightsExports > 0) {
      lines.push({ label: 'HTML/PPTX exports', calls: insightsExports, cost: costForCalls('insights_export', insightsExports) })
    }
  }

  var totalCalls = lines.reduce(function(s, l) { return s + l.calls }, 0)
  var aiCostMonthly = lines.reduce(function(s, l) { return s + l.cost }, 0)
  var storageMonthly = storageGB * STORAGE_RATE_PER_GB
  var monthlyTotal = aiCostMonthly + storageMonthly
  var totalCost = monthlyTotal * months
  var withMarkup = totalCost * (1 + markup / 100)

  // Margin / breakeven (only if user supplied a quoted price)
  var marginAbs = quotedPrice - totalCost
  var marginPct = quotedPrice > 0 ? (marginAbs / quotedPrice) * 100 : 0
  var costRatio = quotedPrice > 0 ? (totalCost / quotedPrice) * 100 : 0

  // Marginal cost: cost of one more conversation / TH participant.
  var marginalPerConvo = botEnabled
    ? costForCalls('bot_chat', botTurnsPerConvo)
      + costForCalls('bot_persona', 1)
      + costForCalls('bot_compress', Math.round(botTurnsPerConvo * 0.1))
    : 0
  var marginalPerThParticipant = thEnabled
    ? costForCalls('th_chat', thTurnsPerParticipant)
      + costForCalls('th_deflect', Math.round(thTurnsPerParticipant * 0.3))
    : 0

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 4 }}>Project Cost Estimator</h1>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>
        Estimate AI + storage costs for project bids. Rates pulled live from <code style={{ background: '#f3f4f6', padding: '1px 4px', borderRadius: 3 }}>lib/usageLog.ts</code>.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* ── PulseIQ ── */}
        <Module title="PulseIQ (Town Hall)" color="#7C3AED" enabled={thEnabled} onToggle={setThEnabled}>
          <Param label="Sessions" value={thSessions} onChange={setThSessions} />
          <Param label="Participants per session" value={thParticipants} onChange={setThParticipants} />
          <Param label="Avg turns per participant" value={thTurnsPerParticipant} onChange={setThTurnsPerParticipant} />
          <Param label="Topics per session" value={thTopics} onChange={setThTopics} />
          <Param label="Multilingual %" value={thMultilingualPct} onChange={setThMultilingualPct} />
          <Param label="Theme re-runs / session" value={thThemeReruns} onChange={setThThemeReruns} />
        </Module>

        {/* ── Agents ── */}
        <Module title="Agents" color="#0891B2" enabled={botEnabled} onToggle={setBotEnabled}>
          <Param label="Conversations / month" value={botConversations} onChange={setBotConversations} />
          <Param label="Avg turns per conversation" value={botTurnsPerConvo} onChange={setBotTurnsPerConvo} />
          <Param label="P95 turns per conversation" value={botTurnsP95} onChange={setBotTurnsP95} />
          <Param label="Multilingual %" value={botMultilingualPct} onChange={setBotMultilingualPct} />
          <Toggle label="Intent detection" checked={botIntents} onChange={setBotIntents} />
          <Toggle label="Demographic inference" checked={botDemographics} onChange={setBotDemographics} />
        </Module>

        {/* ── Surveys ── */}
        <Module title="Surveys" color="#059669" enabled={surveyEnabled} onToggle={setSurveyEnabled}>
          <Param label="Total responses" value={surveyResponses} onChange={setSurveyResponses} />
          <Param label="Questions per survey" value={surveyQuestions} onChange={setSurveyQuestions} />
          <Param label="Multilingual %" value={surveyMultilingualPct} onChange={setSurveyMultilingualPct} />
        </Module>

        {/* ── Social ── */}
        <Module title="Social Moderation" color="#E85A1A" enabled={socialEnabled} onToggle={setSocialEnabled}>
          <Param label="Comments / month" value={socialComments} onChange={setSocialComments} />
          <Param label="Auto-reply %" value={socialAutoReplyPct} onChange={setSocialAutoReplyPct} />
          <Param label="Theme mining runs / month" value={socialThemeRuns} onChange={setSocialThemeRuns} />
        </Module>

        {/* ── Datasets / Search ── */}
        <Module title="Datasets & Search" color="#9333EA" enabled={searchEnabled} onToggle={setSearchEnabled}>
          <Param label="Search queries / month" value={searchQueries} onChange={setSearchQueries} />
          <Param label="Re-rank %" value={searchRerankPct} onChange={setSearchRerankPct} />
          <Param label="Theme mining runs / month" value={datasetThemeRuns} onChange={setDatasetThemeRuns} />
        </Module>

        {/* ── Ask Ana ── */}
        <Module title="Ask Ana" color="#1A5070" enabled={anaEnabled} onToggle={setAnaEnabled}>
          <Param label="Queries / month" value={anaQueries} onChange={setAnaQueries} />
        </Module>

        {/* ── Insights / Exports ── */}
        <Module title="Insights & Exports" color="#B45309" enabled={insightsEnabled} onToggle={setInsightsEnabled}>
          <Param label="Decks / month" value={insightsDecks} onChange={setInsightsDecks} />
          <Param label="HTML/PPTX exports / month" value={insightsExports} onChange={setInsightsExports} />
        </Module>

        {/* ── Storage + Pricing ── */}
        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Storage & Pricing</div>
          <Param label="Storage (GB)" value={storageGB} onChange={setStorageGB} />
          <Param label="Duration (months)" value={months} onChange={setMonths} />
          <Param label="Markup %" value={markup} onChange={setMarkup} />
          <Param label="Quoted price (total $)" value={quotedPrice} onChange={setQuotedPrice} />
        </div>
      </div>

      {/* ── Results ── */}
      <div style={{ marginTop: 24, background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, padding: 20 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Cost Breakdown</h3>
        <table style={{ width: '100%', fontSize: 12, borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ color: '#9ca3af', fontSize: 10, textTransform: 'uppercase' as const, borderBottom: '1px solid #e5e7eb' }}>
              <th style={{ textAlign: 'left', padding: '6px 0' }}>Line Item</th>
              <th style={{ textAlign: 'right' }}>AI Calls</th>
              <th style={{ textAlign: 'right' }}>Cost / mo</th>
            </tr>
          </thead>
          <tbody>
            {lines.filter(function(l) { return l.calls > 0 }).map(function(l, i) {
              return (
                <tr key={i} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '5px 0', color: '#374151' }}>{l.label}</td>
                  <td style={{ textAlign: 'right', color: '#6b7280' }}>{l.calls.toLocaleString()}</td>
                  <td style={{ textAlign: 'right', color: '#374151', fontWeight: 500 }}>${l.cost.toFixed(2)}</td>
                </tr>
              )
            })}
            {storageMonthly > 0 && (
              <tr style={{ borderBottom: '1px solid #f3f4f6' }}>
                <td style={{ padding: '5px 0', color: '#374151' }}>Storage ({storageGB} GB)</td>
                <td style={{ textAlign: 'right', color: '#6b7280' }}>—</td>
                <td style={{ textAlign: 'right', color: '#374151', fontWeight: 500 }}>${storageMonthly.toFixed(2)}</td>
              </tr>
            )}
          </tbody>
        </table>

        <div style={{ borderTop: '2px solid #e5e7eb', marginTop: 8, paddingTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <SummaryCard label="Total AI Calls" value={totalCalls.toLocaleString()} />
          <SummaryCard label={'Total Cost' + (months > 1 ? ' (' + months + ' mo)' : '')} value={'$' + totalCost.toFixed(2)} />
          <SummaryCard label={'With ' + markup + '% Markup'} value={'$' + withMarkup.toFixed(2)} accent />
        </div>

        {months > 1 && (
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <SummaryCard label="Monthly Cost" value={'$' + monthlyTotal.toFixed(2) + '/mo'} />
            <SummaryCard label="Monthly w/ Markup" value={'$' + (monthlyTotal * (1 + markup / 100)).toFixed(2) + '/mo'} />
          </div>
        )}

        {/* ── Margin / Breakeven ── */}
        {quotedPrice > 0 && (
          <div style={{ marginTop: 16, padding: 14, background: marginPct >= 50 ? '#ECFDF5' : marginPct >= 20 ? '#FFFBEB' : '#FEF2F2', border: '1px solid ' + (marginPct >= 50 ? '#A7F3D0' : marginPct >= 20 ? '#FDE68A' : '#FECACA'), borderRadius: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#374151', textTransform: 'uppercase' as const, marginBottom: 8 }}>Margin vs. Quoted Price</div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <SummaryCard label="Gross Margin $" value={'$' + marginAbs.toFixed(2)} />
              <SummaryCard label="Gross Margin %" value={marginPct.toFixed(1) + '%'} accent />
              <SummaryCard label="Cost / Quote Ratio" value={costRatio.toFixed(1) + '%'} />
            </div>
          </div>
        )}

        {/* ── Marginal cost ── */}
        {(marginalPerConvo > 0 || marginalPerThParticipant > 0) && (
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
            {marginalPerConvo > 0 && <SummaryCard label="Marginal Cost / Conversation" value={'$' + marginalPerConvo.toFixed(4)} />}
            {marginalPerThParticipant > 0 && <SummaryCard label="Marginal Cost / TH Participant" value={'$' + marginalPerThParticipant.toFixed(4)} />}
          </div>
        )}
      </div>
    </div>
  )
}

function Module({ title, color, enabled, onToggle, children }: { title: string; color: string; enabled: boolean; onToggle: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', opacity: enabled ? 1 : 0.5, transition: 'opacity 0.2s' }}>
      <div style={{ background: color, padding: '10px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'white' }}>{title}</span>
        <input type="checkbox" checked={enabled} onChange={function(e) { onToggle(e.target.checked) }} style={{ width: 16, height: 16, accentColor: 'white' }} />
      </div>
      <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {children}
      </div>
    </div>
  )
}

function Param({ label, value, onChange }: { label: string; value: number; onChange: (v: number) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
      <span style={{ fontSize: 12, color: '#374151' }}>{label}</span>
      <input type="number" value={value} onChange={function(e) { onChange(parseInt(e.target.value) || 0) }}
        style={{ width: 90, padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12, textAlign: 'right' }} />
    </label>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, cursor: 'pointer' }}>
      <span style={{ fontSize: 12, color: '#374151' }}>{label}</span>
      <input type="checkbox" checked={checked} onChange={function(e) { onChange(e.target.checked) }} style={{ width: 14, height: 14, accentColor: HERMES }} />
    </label>
  )
}

function SummaryCard({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ textAlign: 'center', padding: 12, background: accent ? '#FFF7ED' : '#f9fafb', borderRadius: 10, border: '1px solid ' + (accent ? '#fed7aa' : '#e5e7eb') }}>
      <div style={{ fontSize: 20, fontWeight: 800, color: accent ? HERMES : '#111827' }}>{value}</div>
      <div style={{ fontSize: 10, fontWeight: 600, color: '#9ca3af', textTransform: 'uppercase' as const, marginTop: 2 }}>{label}</div>
    </div>
  )
}
