'use client'

// QR handoff modal — opens when the QR button in the topbar is tapped.
// POSTs the current conversation snapshot to /api/mco/handoff and renders
// the returned URL as a QR code (with a 6-char fallback code for kiosks
// where camera scanning isn't easy).
//
// Lifecycle:
//   - First open with messages: shows "Working…" while POSTing
//   - Success: shows QR + short code
//   - Empty thread: shows a friendly "start chatting first" empty state
//   - Error: shows a retry CTA
//
// Closes on backdrop click, Esc, or the X button. In kiosk mode the parent
// inactivity timer (60s) will also force-close via clearConversation.

import { useEffect, useRef, useState } from 'react'
import QRCode from 'qrcode'

interface Message { role: 'user' | 'assistant'; content: string }

interface Props {
  botId: string
  sessionId: string
  messages: Message[]
  onClose: () => void
}

export default function QRHandoffModal({ botId, sessionId, messages, onClose }: Props) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'empty' | 'error'>('idle')
  const [code, setCode] = useState('')
  const [url, setUrl] = useState('')
  const [qrDataUrl, setQrDataUrl] = useState('')
  const [errorMsg, setErrorMsg] = useState('')
  const closeBtnRef = useRef<HTMLButtonElement>(null)

  // Esc + focus the close button on mount
  useEffect(() => {
    closeBtnRef.current?.focus()
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Kick off the handoff request once on open
  useEffect(() => {
    if (messages.length === 0) { setState('empty'); return }
    setState('loading')
    let aborted = false
    void (async () => {
      try {
        const res = await fetch('/api/mco/handoff', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: sessionId, bot_id: botId, messages }),
        })
        const data = await res.json()
        if (aborted) return
        if (!res.ok || !data?.code) { setState('error'); setErrorMsg(data?.error || 'unknown'); return }
        setCode(data.code)
        setUrl(data.url)
        const png = await QRCode.toDataURL(data.url, { width: 280, margin: 1, color: { dark: '#0a2540', light: '#ffffff' } })
        if (aborted) return
        setQrDataUrl(png)
        setState('ready')
      } catch (e: any) {
        if (aborted) return
        setState('error')
        setErrorMsg(String(e?.message || e))
      }
    })()
    return () => { aborted = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <div className="qr-backdrop" role="dialog" aria-modal="true" aria-labelledby="qr-title" onClick={onClose}>
      <div className="qr-panel" onClick={(e) => e.stopPropagation()}>
        <button ref={closeBtnRef} className="qr-close" onClick={onClose} aria-label="Close">×</button>

        <h2 id="qr-title" className="qr-title">Continue on your phone</h2>

        {state === 'empty' && (
          <p className="qr-empty">
            Ask Ana a question first, then tap this button to continue the conversation on your phone.
          </p>
        )}

        {state === 'loading' && (
          <p className="qr-loading">Generating your link…</p>
        )}

        {state === 'ready' && (
          <>
            {qrDataUrl ? <img src={qrDataUrl} alt="QR code" className="qr-img" /> : null}
            <p className="qr-sub">Scan with your phone camera, or enter the code at</p>
            <p className="qr-url">{url.replace(/^https?:\/\//, '')}</p>
            <div className="qr-code">{code}</div>
            <p className="qr-expires">Link expires in 15 minutes</p>
          </>
        )}

        {state === 'error' && (
          <p className="qr-error">We couldn't create the handoff link. {errorMsg ? <span>({errorMsg})</span> : null}</p>
        )}
      </div>

      <style jsx>{`
        .qr-backdrop {
          position: fixed; inset: 0; background: rgba(10, 37, 64, 0.6);
          backdrop-filter: blur(4px);
          display: flex; align-items: center; justify-content: center;
          z-index: 10000; padding: 24px;
          animation: fade 180ms ease-out;
        }
        @keyframes fade { from { opacity: 0 } to { opacity: 1 } }
        .qr-panel {
          background: #fff; border-radius: 16px;
          width: 100%; max-width: 480px;
          padding: 32px;
          box-shadow: 0 18px 60px rgba(10, 37, 64, 0.3);
          text-align: center; position: relative;
        }
        .qr-close {
          position: absolute; top: 12px; right: 12px;
          width: 36px; height: 36px; border-radius: 18px;
          background: #f3f4f6; border: none; cursor: pointer;
          font-size: 22px; line-height: 1; color: #0a2540;
        }
        .qr-close:hover { background: #e5e7eb; }
        .qr-title { font-size: 22px; color: #0a2540; margin: 0 0 16px; font-weight: 700; }
        .qr-empty, .qr-loading, .qr-error {
          font-size: 14px; color: #6b7280; line-height: 1.5; margin: 12px 0;
        }
        .qr-error { color: #b91c1c; }
        .qr-img {
          display: block; margin: 18px auto 8px;
          width: 240px; height: 240px;
          border: 1px solid #e5e7eb; border-radius: 10px;
        }
        .qr-sub { font-size: 13px; color: #6b7280; margin: 12px 0 4px; }
        .qr-url { font-size: 13px; color: #0a2540; font-weight: 600; margin: 0; }
        .qr-code {
          font-family: 'SF Mono', Menlo, monospace;
          font-size: 28px; letter-spacing: 0.18em;
          color: #0a2540; font-weight: 700;
          margin: 14px 0 6px;
          padding: 12px 16px;
          background: #fffbeb;
          border: 1px solid #f59e0b;
          border-radius: 10px;
          display: inline-block;
        }
        .qr-expires { font-size: 11px; color: #9ca3af; margin: 6px 0 0; font-style: italic; }
      `}</style>
    </div>
  )
}
