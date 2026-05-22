// app/m/[code]/page.tsx
//
// Mobile pickup page for the /demo/mco kiosk handoff. User scans the QR
// from the kiosk → lands here on their phone → the prior conversation is
// re-hydrated and they can keep talking to Ana.
//
// Lookup is server-side via service role (table has no client policies).
// If the code is missing/expired/invalid, we show a friendly fallback page.

import type { Metadata } from 'next'
import { createServiceRoleClient } from '@/lib/supabase/server'
import MobileChat from './MobileChat'

export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Continue with Ana — MCO',
  description: 'Continue your conversation with Ana on your phone.',
  robots: { index: false, follow: false },
}

interface Message { role: 'user' | 'assistant'; content: string }

interface Props { params: { code: string } }

export default async function MobileHandoffPage({ params }: Props) {
  const code = (params.code || '').toUpperCase().slice(0, 6)
  const service = createServiceRoleClient()

  const { data: row } = await service
    .from('mco_handoff_sessions')
    .select('code, bot_id, messages, expires_at')
    .eq('code', code)
    .maybeSingle()

  if (!row) return <ExpiredView reason="not_found" />
  if (new Date(row.expires_at).getTime() < Date.now()) return <ExpiredView reason="expired" />

  const messages: Message[] = Array.isArray(row.messages) ? row.messages : []

  return (
    <main style={{ minHeight: '100dvh', background: '#f3f5f8' }}>
      <MobileChat
        botId={row.bot_id as string}
        initialMessages={messages}
        code={code}
      />
    </main>
  )
}

function ExpiredView({ reason }: { reason: 'not_found' | 'expired' }) {
  const title = reason === 'expired' ? 'This handoff link has expired' : "We couldn't find that code"
  const body  = reason === 'expired'
    ? 'Handoff codes only work for 15 minutes after they were created. Tap the QR code on the kiosk again to start a new one.'
    : 'Double-check the 6-character code, or tap the QR icon on the kiosk to generate a fresh link.'
  return (
    <main style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: '#f3f5f8' }}>
      <div style={{ maxWidth: 420, background: '#fff', border: '1px solid #e5e7eb', borderRadius: 14, padding: '28px 24px', boxShadow: '0 6px 24px rgba(10, 37, 64, 0.06)' }}>
        <div style={{ fontSize: 32 }}>✈️</div>
        <h1 style={{ fontSize: 20, margin: '12px 0 8px', color: '#0a2540' }}>{title}</h1>
        <p style={{ fontSize: 14, color: '#4b5563', lineHeight: 1.5 }}>{body}</p>
      </div>
    </main>
  )
}
