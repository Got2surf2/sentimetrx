// app/api/notify/closed-study/route.ts
//
// Sends an email to the study creator when someone tries to access a closed study.
// Uses Resend (https://resend.com) — add RESEND_API_KEY to your Vercel env vars.
// If no key is set the route returns 200 silently (non-fatal).

import { NextResponse } from 'next/server'

export async function POST(req: Request) {
  try {
    const { creatorEmail, creatorName, studyName, studyId, accessedAt } = await req.json()

    const apiKey = process.env.RESEND_API_KEY
    if (!apiKey) {
      // Email not configured — log and return OK so survey page isn't affected
      console.log('[notify] RESEND_API_KEY not set — skipping email for closed study access:', studyName)
      return NextResponse.json({ ok: true, skipped: true })
    }

    const baseUrl    = process.env.NEXT_PUBLIC_BASE_URL || 'https://www.sentimetrx.ai'
    const studyUrl   = `${baseUrl}/studies/${studyId}/responses`
    const accessTime = new Date(accessedAt).toLocaleString('en-US', {
      timeZone: 'America/New_York',
      dateStyle: 'medium',
      timeStyle: 'short',
    })

    const html = `
      <div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">
        <div style="background:linear-gradient(135deg,#E8632A,#c44d1a);padding:24px;border-radius:12px 12px 0 0">
          <h1 style="color:white;margin:0;font-size:18px">🔒 Closed Survey Accessed</h1>
        </div>
        <div style="background:#f9f9f9;padding:24px;border-radius:0 0 12px 12px;border:1px solid #e5e7eb">
          <p style="margin:0 0 16px">Hi ${creatorName},</p>
          <p style="margin:0 0 16px">
            Someone tried to access your closed survey <strong>${studyName}</strong> at <strong>${accessTime} ET</strong>.
          </p>
          <p style="margin:0 0 24px;color:#6b7280;font-size:14px">
            No response was recorded — the visitor was shown a "survey closed" message.
          </p>
          <a href="${studyUrl}" style="display:inline-block;background:#E8632A;color:white;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">
            View study responses →
          </a>
          <hr style="margin:24px 0;border:none;border-top:1px solid #e5e7eb" />
          <p style="margin:0;color:#9ca3af;font-size:12px">
            You received this because you created this study on sentimetrx.ai.<br/>
            To reopen this survey, visit your dashboard.
          </p>
        </div>
      </div>
    `

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from:    'Sentimetrx <notifications@sentimetrx.ai>',
        to:      [creatorEmail],
        subject: `🔒 Your closed survey "${studyName}" was accessed`,
        html,
      }),
    })

    if (!res.ok) {
      const err = await res.text()
      console.error('[notify] Resend error:', err)
      return NextResponse.json({ ok: false, error: err }, { status: 500 })
    }

    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[notify] Unexpected error:', err)
    return NextResponse.json({ ok: false }, { status: 500 })
  }
}
