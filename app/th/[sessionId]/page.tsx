import { createServiceRoleClient } from '@/lib/supabase/server'
import TownHallChat from './TownHallChat'

interface Props { params: { sessionId: string } }
export const dynamic = 'force-dynamic'

export default async function TownHallParticipantPage({ params }: Props) {
  const supabase = createServiceRoleClient()

  const { data: session } = await supabase
    .from('townhall_sessions')
    .select('id, name, status, config')
    .eq('id', params.sessionId)
    .single()

  if (!session) {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb' }}>
        <p style={{ color: '#9ca3af', fontSize: 14 }}>Session not found.</p>
      </div>
    )
  }

  if (session.status === 'setup') {
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', padding: 20 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>{'\uD83C\uDFE4'}</div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#374151', marginBottom: 4 }}>{session.name}</h2>
          <p style={{ color: '#9ca3af', fontSize: 14 }}>This session hasn't started yet. Please wait for the facilitator to begin.</p>
        </div>
      </div>
    )
  }

  if (session.status === 'ended') {
    const config = session.config as any
    return (
      <div style={{ minHeight: '100dvh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f9fafb', padding: 20 }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>{'\u2705'}</div>
          <h2 style={{ fontSize: 18, fontWeight: 700, color: '#374151', marginBottom: 4 }}>{session.name}</h2>
          <p style={{ color: '#9ca3af', fontSize: 14 }}>{config?.session_end?.closing_message || 'This session has ended. Thank you!'}</p>
        </div>
      </div>
    )
  }

  return <TownHallChat session={session} />
}
