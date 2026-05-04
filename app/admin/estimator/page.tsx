'use client'

// app/admin/estimator/page.tsx
// Project cost estimator for bidding — input product mix + volume → AI cost estimate

import { useState } from 'react'

var HERMES = '#E8632A'

// ── Cost rates per million tokens (May 2025) ──────────────────────────
var RATES = {
  haiku:  { input: 0.80, output: 4.00, label: 'Haiku 4.5 (fast tier)' },
  sonnet: { input: 3.00, output: 15.00, label: 'Sonnet 4.6 (standard tier)' },
}

// ── AI call profiles: avg tokens per call type ────────────────────────
var PROFILES: Record<string, { input: number; output: number; tier: 'haiku' | 'sonnet'; label: string }> = {
  th_chat:        { input: 800,  output: 150, tier: 'haiku',  label: 'TH chat response' },
  th_deflect:     { input: 400,  output: 80,  tier: 'haiku',  label: 'TH deflection check' },
  th_compress:    { input: 600,  output: 100, tier: 'haiku',  label: 'TH context compression' },
  th_translate:   { input: 300,  output: 200, tier: 'haiku',  label: 'TH translation' },
  th_theme:       { input: 1500, output: 300, tier: 'haiku',  label: 'TH theme detection' },
  bot_chat:       { input: 1200, output: 300, tier: 'haiku',  label: 'Agent chat response' },
  bot_deflect:    { input: 400,  output: 80,  tier: 'haiku',  label: 'Agent deflection' },
  bot_intent:     { input: 300,  output: 30,  tier: 'haiku',  label: 'Agent intent detection' },
  bot_persona:    { input: 500,  output: 200, tier: 'haiku',  label: 'Agent persona extraction' },
  bot_demo:       { input: 500,  output: 150, tier: 'haiku',  label: 'Agent demographics' },
  bot_compress:   { input: 600,  output: 100, tier: 'haiku',  label: 'Agent context compression' },
  survey_clarify: { input: 600,  output: 150, tier: 'haiku',  label: 'Survey clarification' },
  survey_deflect: { input: 400,  output: 80,  tier: 'haiku',  label: 'Survey deflection' },
  social_reply:   { input: 500,  output: 150, tier: 'haiku',  label: 'Social AI reply' },
  ana_chat:       { input: 4000, output: 800, tier: 'sonnet', label: 'Ask Ana query' },
  ana_sample:     { input: 2000, output: 400, tier: 'sonnet', label: 'Ana sampling decision' },
}

function costForCalls(profileKey: string, count: number): number {
  var p = PROFILES[profileKey]
  if (!p || count <= 0) return 0
  var r = RATES[p.tier]
  return count * ((p.input / 1_000_000) * r.input + (p.output / 1_000_000) * r.output)
}

interface LineItem { label: string; calls: number; cost: number }

export default function EstimatorPage() {
  // ── PulseIQ (Town Hall) ──
  var [thEnabled, setThEnabled] = useState(true)
  var [thSessions, setThSessions] = useState(2)
  var [thParticipants, setThParticipants] = useState(50)
  var [thTurnsPerParticipant, setThTurnsPerParticipant] = useState(8)
  var [thTopics, setThTopics] = useState(6)
  var [thBilingual, setThBilingual] = useState(false)

  // ── Agents ──
  var [botEnabled, setBotEnabled] = useState(true)
  var [botConversations, setBotConversations] = useState(200)
  var [botTurnsPerConvo, setBotTurnsPerConvo] = useState(6)
  var [botIntents, setBotIntents] = useState(true)
  var [botDemographics, setBotDemographics] = useState(false)

  // ── Surveys ──
  var [surveyEnabled, setSurveyEnabled] = useState(false)
  var [surveyResponses, setSurveyResponses] = useState(500)
  var [surveyQuestions, setSurveyQuestions] = useState(5)

  // ── Social ──
  var [socialEnabled, setSocialEnabled] = useState(false)
  var [socialComments, setSocialComments] = useState(1000)
  var [socialAutoReplyPct, setSocialAutoReplyPct] = useState(30)

  // ── Ask Ana ──
  var [anaEnabled, setAnaEnabled] = useState(true)
  var [anaQueries, setAnaQueries] = useState(50)

  // ── Duration ──
  var [months, setMonths] = useState(1)
  var [markup, setMarkup] = useState(50)

  // ── Calculate ──
  var lines: LineItem[] = []

  if (thEnabled) {
    var thTotalTurns = thSessions * thParticipants * thTurnsPerParticipant
    lines.push({ label: 'TH chat responses', calls: thTotalTurns, cost: costForCalls('th_chat', thTotalTurns) })
    lines.push({ label: 'TH deflection checks', calls: Math.round(thTotalTurns * 0.3), cost: costForCalls('th_deflect', thTotalTurns * 0.3) })
    var compressTurns = Math.round(thTotalTurns * 0.1)
    lines.push({ label: 'TH context compression', calls: compressTurns, cost: costForCalls('th_compress', compressTurns) })
    if (thBilingual) {
      lines.push({ label: 'TH translations', calls: thTotalTurns, cost: costForCalls('th_translate', thTotalTurns) })
    }
    var themeRuns = thSessions * Math.ceil(thParticipants / 10)
    lines.push({ label: 'TH theme detection', calls: themeRuns, cost: costForCalls('th_theme', themeRuns) })
  }

  if (botEnabled) {
    var botTotalTurns = botConversations * botTurnsPerConvo
    lines.push({ label: 'Agent chat responses', calls: botTotalTurns, cost: costForCalls('bot_chat', botTotalTurns) })
    lines.push({ label: 'Agent deflection checks', calls: Math.round(botTotalTurns * 0.3), cost: costForCalls('bot_deflect', botTotalTurns * 0.3) })
    if (botIntents) {
      lines.push({ label: 'Agent intent detection', calls: Math.round(botTotalTurns * 0.2), cost: costForCalls('bot_intent', botTotalTurns * 0.2) })
    }
    var personaCalls = botConversations // once per conversation (early turns)
    lines.push({ label: 'Agent persona extraction', calls: personaCalls, cost: costForCalls('bot_persona', personaCalls) })
    if (botDemographics) {
      lines.push({ label: 'Agent demographics', calls: personaCalls, cost: costForCalls('bot_demo', personaCalls) })
    }
    var botCompressCalls = Math.round(botTotalTurns * 0.08)
    lines.push({ label: 'Agent context compression', calls: botCompressCalls, cost: costForCalls('bot_compress', botCompressCalls) })
  }

  if (surveyEnabled) {
    var surveyTotalQA = surveyResponses * surveyQuestions
    lines.push({ label: 'Survey clarifications', calls: Math.round(surveyTotalQA * 0.5), cost: costForCalls('survey_clarify', surveyTotalQA * 0.5) })
    lines.push({ label: 'Survey deflections', calls: Math.round(surveyTotalQA * 0.2), cost: costForCalls('survey_deflect', surveyTotalQA * 0.2) })
  }

  if (socialEnabled) {
    var autoReplies = Math.round(socialComments * socialAutoReplyPct / 100)
    lines.push({ label: 'Social AI replies', calls: autoReplies, cost: costForCalls('social_reply', autoReplies) })
  }

  if (anaEnabled) {
    lines.push({ label: 'Ask Ana queries', calls: anaQueries, cost: costForCalls('ana_chat', anaQueries) })
    lines.push({ label: 'Ana sampling decisions', calls: Math.round(anaQueries * 0.3), cost: costForCalls('ana_sample', anaQueries * 0.3) })
  }

  var totalCalls = lines.reduce(function(s, l) { return s + l.calls }, 0)
  var totalCost = lines.reduce(function(s, l) { return s + l.cost }, 0)
  var monthlyCost = totalCost * months
  var withMarkup = monthlyCost * (1 + markup / 100)

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: '32px 24px' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 4 }}>Project Cost Estimator</h1>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 24 }}>Estimate AI costs for project bids. Adjust parameters to match scope.</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        {/* ── PulseIQ ── */}
        <Module title="PulseIQ (Town Hall)" color="#7C3AED" enabled={thEnabled} onToggle={setThEnabled}>
          <Param label="Sessions" value={thSessions} onChange={setThSessions} />
          <Param label="Participants per session" value={thParticipants} onChange={setThParticipants} />
          <Param label="Avg turns per participant" value={thTurnsPerParticipant} onChange={setThTurnsPerParticipant} />
          <Param label="Topics per session" value={thTopics} onChange={setThTopics} />
          <Toggle label="Bilingual (translation)" checked={thBilingual} onChange={setThBilingual} />
        </Module>

        {/* ── Agents ── */}
        <Module title="Agents" color="#0891B2" enabled={botEnabled} onToggle={setBotEnabled}>
          <Param label="Conversations / month" value={botConversations} onChange={setBotConversations} />
          <Param label="Avg turns per conversation" value={botTurnsPerConvo} onChange={setBotTurnsPerConvo} />
          <Toggle label="Intent detection" checked={botIntents} onChange={setBotIntents} />
          <Toggle label="Demographic inference" checked={botDemographics} onChange={setBotDemographics} />
        </Module>

        {/* ── Surveys ── */}
        <Module title="Surveys" color="#059669" enabled={surveyEnabled} onToggle={setSurveyEnabled}>
          <Param label="Total responses" value={surveyResponses} onChange={setSurveyResponses} />
          <Param label="Questions per survey" value={surveyQuestions} onChange={setSurveyQuestions} />
        </Module>

        {/* ── Social ── */}
        <Module title="Social Moderation" color="#E85A1A" enabled={socialEnabled} onToggle={setSocialEnabled}>
          <Param label="Comments / month" value={socialComments} onChange={setSocialComments} />
          <Param label="Auto-reply %" value={socialAutoReplyPct} onChange={setSocialAutoReplyPct} />
        </Module>

        {/* ── Ask Ana ── */}
        <Module title="Ask Ana" color="#1A5070" enabled={anaEnabled} onToggle={setAnaEnabled}>
          <Param label="Queries / month" value={anaQueries} onChange={setAnaQueries} />
        </Module>

        {/* ── Duration + Markup ── */}
        <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 12, padding: 16 }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#111827', marginBottom: 12 }}>Pricing</div>
          <Param label="Duration (months)" value={months} onChange={setMonths} />
          <Param label="Markup %" value={markup} onChange={setMarkup} />
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
              <th style={{ textAlign: 'right' }}>Cost</th>
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
          </tbody>
        </table>

        <div style={{ borderTop: '2px solid #e5e7eb', marginTop: 8, paddingTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
          <SummaryCard label="Total AI Calls" value={totalCalls.toLocaleString()} />
          <SummaryCard label={'AI Cost' + (months > 1 ? ' (' + months + ' mo)' : '')} value={'$' + monthlyCost.toFixed(2)} />
          <SummaryCard label={'With ' + markup + '% Markup'} value={'$' + withMarkup.toFixed(2)} accent />
        </div>

        {months > 1 && (
          <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            <SummaryCard label="Monthly AI Cost" value={'$' + totalCost.toFixed(2) + '/mo'} />
            <SummaryCard label="Monthly w/ Markup" value={'$' + (totalCost * (1 + markup / 100)).toFixed(2) + '/mo'} />
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
        style={{ width: 80, padding: '4px 8px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 12, textAlign: 'right' }} />
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
