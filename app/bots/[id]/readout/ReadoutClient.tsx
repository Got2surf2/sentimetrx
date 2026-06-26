'use client'

// app/bots/[id]/readout/ReadoutClient.tsx
// Interactive Agent Conversation Readout. Fetches the readout object from
// /api/bots/[id]/readout and renders it via the SHARED pure renderer
// (renderAgentReadoutFragment) — the same markup the PDF and share bake use, so
// the three surfaces can't drift. Toolbar: Refresh (recompute), Download PDF,
// Export PPTX.

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import type { AgentReadout } from '@/lib/agentReadout'
import { renderAgentReadoutFragment } from '@/lib/agentReadoutHtml'
import LottieLoader from '@/components/ui/LottieLoader'

const MUTE = '#6b7280'
const TEAL = '#0F7173'

// File-safe stem from the report title (e.g. "Sarina — Conversation Readout"
// → "Sarina_Conversation_Readout").
function fileStem(title: string): string {
  return (title || 'Agent_Readout').replace(/[^\w]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'Agent_Readout'
}

const btn: React.CSSProperties = {
  fontSize: 13, fontWeight: 600, padding: '8px 14px', borderRadius: 9,
  border: '1px solid #e5e7eb', background: 'white', color: '#374151', cursor: 'pointer',
}

export default function ReadoutClient() {
  const params = useParams()
  const router = useRouter()
  const botId = params.id as string
  const [readout, setReadout] = useState<AgentReadout | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshing, setRefreshing] = useState(false)
  const [pdfState, setPdfState] = useState<'idle' | 'working'>('idle')
  const [pptxState, setPptxState] = useState<'idle' | 'working'>('idle')

  async function load(force = false) {
    if (force) setRefreshing(true); else setLoading(true)
    setError('')
    try {
      const r = await fetch('/api/bots/' + botId + '/readout' + (force ? '?force=1' : ''))
      if (!r.ok) { const d = await r.json().catch(() => ({})); setError(d.error || 'Failed to load readout'); return }
      const d = await r.json()
      setReadout(d.readout)
    } catch { setError('Failed to load readout') }
    finally { setLoading(false); setRefreshing(false) }
  }
  useEffect(() => { load() }, [botId]) // eslint-disable-line react-hooks/exhaustive-deps

  async function download(kind: 'pdf' | 'pptx') {
    const set = kind === 'pdf' ? setPdfState : setPptxState
    set('working')
    try {
      const r = await fetch('/api/bots/' + botId + '/readout/' + kind, { method: 'POST' })
      if (!r.ok) { const d = await r.json().catch(() => ({})); alert(d.error || 'Export failed'); return }
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = fileStem(readout?.title || '') + '.' + kind; a.click()
      URL.revokeObjectURL(url)
    } catch { alert('Export failed') }
    finally { set('idle') }
  }

  if (loading) {
    return <div style={{ maxWidth: 860, margin: '0 auto', padding: '64px 24px', textAlign: 'center' }}>
      <LottieLoader message="Building the conversation readout…" />
    </div>
  }
  if (error || !readout) {
    return <div style={{ maxWidth: 860, margin: '0 auto', padding: '48px 24px' }}>
      <button onClick={() => router.push('/bots')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: MUTE, marginBottom: 16 }}>&larr; Agents</button>
      <div style={{ background: 'white', border: '1px solid #e5e7eb', borderRadius: 14, padding: 24, textAlign: 'center', color: MUTE }}>{error || 'No data'}</div>
    </div>
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto', padding: '24px 24px 56px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 18, flexWrap: 'wrap' }}>
        <button onClick={() => router.push('/bots')} style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 14, color: MUTE }}>&larr; Agents</button>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={() => load(true)} disabled={refreshing} style={{ ...btn, opacity: refreshing ? 0.6 : 1 }}>{refreshing ? 'Refreshing…' : 'Refresh'}</button>
          <button onClick={() => download('pdf')} disabled={pdfState === 'working'} style={{ ...btn, opacity: pdfState === 'working' ? 0.6 : 1 }}>{pdfState === 'working' ? 'Preparing…' : 'Download PDF'}</button>
          <button onClick={() => download('pptx')} disabled={pptxState === 'working'} style={{ ...btn, color: 'white', background: TEAL, borderColor: TEAL, opacity: pptxState === 'working' ? 0.6 : 1 }}>{pptxState === 'working' ? 'Building…' : 'Export PPTX'}</button>
        </div>
      </div>
      <div dangerouslySetInnerHTML={{ __html: renderAgentReadoutFragment(readout) }} />
    </div>
  )
}
