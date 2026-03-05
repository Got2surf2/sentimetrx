'use client'

import { useEffect, useRef, useCallback, useState } from 'react'
import { useSurveyEngine } from './useSurveyEngine'
import type { Study } from '@/lib/types'

interface Props { study: Study }

export default function SurveyWidget({ study }: Props) {
  const chatRef    = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLDivElement>(null)
  const startedRef = useRef(false)
  const [status, setStatus] = useState<'checking' | 'active' | 'closed' | 'draft'>('checking')

  const scrollBottom = useCallback(() => {
    setTimeout(() => {
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
    }, 60)
  }, [])

  const { renderInput } = useSurveyEngine({ study, chatRef, inputRef, scrollBottom })

  // ── Heartbeat ─────────────────────────────────────────────────
  useEffect(() => {
    fetch(`/api/study/${study.guid}`, { cache: 'no-store' })
      .then(res => setStatus(res.ok ? 'active' : 'closed'))
      .catch(() => setStatus('closed'))
  }, [study.guid])

  useEffect(() => {
    if (status === 'active' && !startedRef.current) {
      startedRef.current = true
      renderInput('start')
    }
  }, [status, renderInput])

  const theme = study.config.theme

  // ── Shared widget shell ───────────────────────────────────────
  // On mobile: full-screen, no rounding, no padding
  // On desktop: centered card with rounded corners and max-width
  const shellCls = [
    'flex flex-col overflow-hidden',
    // Mobile: fill entire viewport
    'w-screen h-[100dvh]',
    // Desktop: card style
    'sm:w-full sm:max-w-sm sm:rounded-2xl sm:shadow-2xl',
    'sm:h-auto',
  ].join(' ')

  const shellStyle: React.CSSProperties = {
    background: theme.backgroundColor,
    // Desktop only: fixed height and border
    ...(typeof window !== 'undefined' && window.innerWidth >= 640 ? {
      height: 'min(700px, calc(100vh - 32px))',
      border: `1px solid ${theme.primaryColor}28`,
      boxShadow: `0 50px 100px rgba(0,0,0,0.7), 0 0 0 1px ${theme.primaryColor}20`,
    } : {}),
  }

  const Header = ({ showDot = false }: { showDot?: boolean }) => (
    <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0 sm:px-5 sm:py-4"
      style={{ background: theme.headerGradient }}>
      <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center text-xl flex-shrink-0"
        style={{ background: 'rgba(255,255,255,0.15)' }}>
        {study.bot_emoji}
      </div>
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-white text-base sm:text-lg leading-tight truncate">
          {study.bot_name}
        </div>
        <div className="text-white/60 text-xs mt-0.5 uppercase tracking-wide truncate">
          {study.name}
        </div>
        {showDot && (
          <div className="flex items-center gap-1.5 mt-1">
            <span className="live-dot" />
            <span className="text-white/50 text-xs">Ready for your feedback</span>
          </div>
        )}
      </div>
    </div>
  )

  // ── Checking ──────────────────────────────────────────────────
  if (status === 'checking') {
    return (
      <div className={shellCls} style={{ ...shellStyle, alignItems: 'center', justifyContent: 'center' }}>
        <div className="flex gap-1.5">
          {[0, 150, 300].map(d => (
            <span key={d} className="typing-dot" style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
      </div>
    )
  }

  // ── Closed / draft ────────────────────────────────────────────
  if (status === 'closed' || status === 'draft') {
    return (
      <div className={shellCls} style={shellStyle}>
        <Header />
        <div className="flex-1 flex flex-col items-center justify-center px-6 text-center gap-4">
          <div className="text-5xl">{status === 'closed' ? '🔒' : '🚧'}</div>
          <div>
            <h2 className="text-white font-bold text-lg mb-2">
              {status === 'closed' ? 'This survey is now closed' : 'Not yet available'}
            </h2>
            <p className="text-white/50 text-sm leading-relaxed">
              {status === 'closed'
                ? 'Thank you for your interest. This survey is no longer accepting responses.'
                : "This survey isn't published yet. Please check back soon."}
            </p>
          </div>
        </div>
        <div className="pb-6 text-center" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
          <p className="text-white/20 text-xs">Powered by <span className="text-white/40 font-medium">sentimetrx.ai</span></p>
        </div>
      </div>
    )
  }

  // ── Active survey ─────────────────────────────────────────────
  return (
    <div className={shellCls} style={shellStyle}>
      <Header showDot />

      {/* Chat area — flex-1 lets it fill remaining space */}
      <div ref={chatRef}
        className="survey-chat flex-1 overflow-y-auto px-3.5 py-4 flex flex-col gap-2.5"
      />

      {/* Input area — safe area padding for iPhone home indicator */}
      <div ref={inputRef}
        className="px-3 pt-2.5 flex-shrink-0"
        style={{
          background: `${theme.backgroundColor}ee`,
          borderTop: `1px solid ${theme.primaryColor}14`,
          paddingBottom: 'max(0.875rem, env(safe-area-inset-bottom))',
        }}
      />
    </div>
  )
}
