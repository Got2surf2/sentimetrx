'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import TopNav from '@/components/nav/TopNav'
import SubHeader from '@/components/nav/SubHeader'
import type { EmailProviderType } from '@/lib/types'

const HERMES = '#E8632A'

interface Props {
  logoUrl?: string; analyzeEnabled?: boolean; campaignsEnabled?: boolean; features?: Record<string, boolean>
  user: { email: string; fullName?: string; clientName?: string; isAdmin?: boolean }
  study: { id: string; name: string; status: string; guid: string; slug?: string }
  hiddenFields: string[]
  studyUrl: string
}

export default function NewCampaignClient({ user, study, hiddenFields, studyUrl, logoUrl = '', analyzeEnabled, campaignsEnabled, features }: Props) {
  const router = useRouter()
  const [name, setName] = useState(
    /campaign$/i.test(study.name.trim()) ? study.name.trim() : study.name.trim() + ' Campaign'
  )
  const [targetResponses, setTargetResponses] = useState<string>('')
  const [emailProvider, setEmailProvider] = useState<EmailProviderType>('resend')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!name.trim()) { setError('Campaign name is required'); return }
    setSaving(true)
    setError(null)

    try {
      const res = await fetch('/api/campaigns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          study_id: study.id,
          study_url: studyUrl,
          hidden_fields: hiddenFields,
          target_responses: targetResponses ? parseInt(targetResponses) : null,
          email_provider: emailProvider,
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        setError(data.error || 'Failed to create campaign')
        return
      }

      const data = await res.json()

      // Create default email templates
      const templates = [
        {
          sequence: 0, send_to: 'all', send_delay_hours: 0,
          subject: "We'd love your feedback, {{first_name}}",
          body_html: defaultInitialEmail(),
        },
        {
          sequence: 1, send_to: 'non_responders', send_delay_hours: 72,
          subject: 'Quick reminder: your feedback matters, {{first_name}}',
          body_html: defaultReminderEmail(1),
        },
        {
          sequence: 2, send_to: 'non_responders', send_delay_hours: 168,
          subject: 'Last chance to share your thoughts, {{first_name}}',
          body_html: defaultReminderEmail(2),
        },
      ]

      for (const tmpl of templates) {
        await fetch('/api/campaigns/' + data.id + '/emails', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tmpl),
        })
      }

      router.push('/campaigns/' + data.id)
    } catch {
      setError('Network error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      <div className="fixed top-0 left-0 right-0 z-50">
        <TopNav logoUrl={logoUrl} orgName={user.clientName} isAdmin={user.isAdmin}
          userEmail={user.email} fullName={user.fullName} currentPage="campaigns"
          analyzeEnabled={analyzeEnabled} campaignsEnabled={campaignsEnabled} features={features} />
      </div>
      <SubHeader crumbs={[
        { label: 'Studies', href: '/dashboard' },
        { label: study.name, href: '/studies/' + study.id + '/edit' },
        { label: 'New Campaign' },
      ]} isAdmin={user.isAdmin} showFilters={false} />

      <main className="max-w-2xl mx-auto px-6 py-8 pt-28 w-full">
        <h1 className="text-xl font-bold text-gray-800 mb-6">Create Campaign</h1>

        <div className="bg-white rounded-2xl border border-gray-200 p-6 space-y-5">
          {/* Study info */}
          <div className="bg-gray-50 rounded-xl p-4 border border-gray-100">
            <p className="text-xs font-semibold text-gray-500 mb-1">LINKED STUDY</p>
            <p className="text-sm font-medium text-gray-800">{study.name}</p>
            <p className="text-xs text-gray-400 mt-1 break-all">{studyUrl}</p>
            {hiddenFields.length > 0 && (
              <p className="text-xs text-gray-500 mt-2">Hidden fields: {hiddenFields.join(', ')}</p>
            )}
          </div>

          {/* Campaign name */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Campaign Name *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-4 py-2.5 outline-none focus:border-orange-400 transition-colors"
              placeholder="e.g. Q1 Customer Feedback" />
          </div>

          {/* Target responses */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Target Responses (optional)</label>
            <input type="number" min={1} value={targetResponses} onChange={e => setTargetResponses(e.target.value)}
              className="w-full text-sm border border-gray-200 rounded-lg px-4 py-2.5 outline-none focus:border-orange-400 transition-colors"
              placeholder="e.g. 500" />
            <p className="text-xs text-gray-400 mt-1">Set a goal to track progress on the dashboard</p>
          </div>

          {/* Email provider */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1">Email Provider</label>
            <select value={emailProvider} onChange={e => setEmailProvider(e.target.value as EmailProviderType)}
              className="w-full text-sm border border-gray-200 rounded-lg px-4 py-2.5 outline-none focus:border-orange-400 transition-colors">
              <option value="resend">Resend</option>
              <option value="sendgrid">SendGrid</option>
              <option value="ses">AWS SES</option>
              <option value="smtp">Custom SMTP</option>
            </select>
          </div>

          {/* Suggested follow-up plan */}
          <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
            <p className="text-xs font-semibold text-blue-700 mb-2">SUGGESTED EMAIL PLAN</p>
            <div className="space-y-2 text-xs text-blue-800">
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-200 text-blue-700 flex items-center justify-center text-xs font-bold flex-shrink-0">1</span>
                <span>Initial invitation — sent immediately</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-200 text-blue-700 flex items-center justify-center text-xs font-bold flex-shrink-0">2</span>
                <span>First reminder — 3 days later, to non-responders</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 h-5 rounded-full bg-blue-200 text-blue-700 flex items-center justify-center text-xs font-bold flex-shrink-0">3</span>
                <span>Final reminder — 7 days later, to non-responders</span>
              </div>
            </div>
            <p className="text-xs text-blue-600 mt-2">These templates will be created automatically. You can edit them after creation.</p>
          </div>

          {error && (
            <div className="px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm">{error}</div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-2">
            <button onClick={() => router.back()}
              className="px-5 py-2.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm font-medium transition-all">
              Cancel
            </button>
            <button onClick={handleCreate} disabled={saving}
              className="px-5 py-2.5 rounded-lg text-white text-sm font-semibold shadow-sm hover:opacity-90 transition-all disabled:opacity-50"
              style={{ background: HERMES }}>
              {saving ? 'Creating...' : 'Create Campaign'}
            </button>
          </div>
        </div>
      </main>
    </div>
  )
}

function defaultInitialEmail() {
  return `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
  <div style="background:linear-gradient(135deg,#E8632A,#c44d1a);padding:24px;border-radius:12px 12px 0 0">
    <h1 style="color:white;margin:0;font-size:20px">{{campaign_name}}</h1>
  </div>
  <div style="background:#f9f9f9;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb">
    <p>Hi {{first_name}},</p>
    <p>We value your input and would love to hear your thoughts. This brief survey takes just a few minutes.</p>
    <p style="margin:24px 0">
      <a href="{{survey_link}}" style="display:inline-block;background:#E8632A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Take the Survey</a>
    </p>
    <p style="color:#6b7280;font-size:14px">Thank you for your time!</p>
  </div>
</div>`
}

function defaultReminderEmail(num: number) {
  const title = num === 1 ? 'Reminder' : 'Final Reminder'
  const message = num === 1
    ? "We noticed you haven't had a chance to complete our survey yet. Your feedback is important to us."
    : "This is a final reminder about our survey. We're closing it soon and would really appreciate hearing from you."
  return `<div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
  <div style="background:linear-gradient(135deg,#E8632A,#c44d1a);padding:24px;border-radius:12px 12px 0 0">
    <h1 style="color:white;margin:0;font-size:20px">${title}: {{campaign_name}}</h1>
  </div>
  <div style="background:#f9f9f9;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb">
    <p>Hi {{first_name}},</p>
    <p>${message}</p>
    <p style="margin:24px 0">
      <a href="{{survey_link}}" style="display:inline-block;background:#E8632A;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600">Take the Survey</a>
    </p>
    <p style="color:#6b7280;font-size:14px">Thank you!</p>
  </div>
</div>`
}
