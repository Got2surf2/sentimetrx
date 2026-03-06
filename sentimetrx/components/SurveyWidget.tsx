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
    const el = chatRef.current
    if (!el) return
    // Only auto-scroll if user is already near the bottom (within 120px)
    // so manual upward scrolling is never interrupted
    const nearBottom = () => el.scrollHeight - el.scrollTop - el.clientHeight < 120
    setTimeout(() => { if (nearBottom()) el.scrollTop = el.scrollHeight }, 60)
    setTimeout(() => { if (nearBottom()) el.scrollTop = el.scrollHeight }, 300)
  }, [chatRef])

  const { renderInput } = useSurveyEngine({ study, chatRef, inputRef, scrollBottom })

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

  if (status === 'checking') {
    return (
      <div className="w-full h-full flex items-center justify-center">
        <div className="flex gap-1.5">
          {[0, 150, 300].map(d => (
            <span key={d} className="typing-dot" style={{ animationDelay: `${d}ms` }} />
          ))}
        </div>
      </div>
    )
  }

  if (status === 'closed' || status === 'draft') {
    return (
      <div className="w-full h-full flex flex-col" style={{ background: theme.backgroundColor }}>
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0"
          style={{ background: theme.headerGradient }}>
          <div className="w-10 h-10 rounded-full flex items-center justify-center text-xl flex-shrink-0"
            style={{ background: 'rgba(255,255,255,0.15)' }}>
            {study.bot_emoji}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-white text-base leading-tight truncate">{study.bot_name}</div>
            <div className="text-white/60 text-xs mt-0.5 uppercase tracking-wide truncate">{study.name}</div>
          </div>
        </div>
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
        <div className="text-center pb-6" style={{ paddingBottom: 'max(1.5rem, env(safe-area-inset-bottom))' }}>
          <p className="text-white/20 text-xs">Powered by <span className="text-white/40 font-medium">sentimetrx.ai</span></p>
        </div>
      </div>
    )
  }

  // Active — full screen on mobile, card on desktop
  return (
    <div
      className="w-full h-full flex flex-col sm:h-auto sm:max-w-sm sm:mx-auto sm:rounded-2xl sm:shadow-2xl sm:my-4"
      style={{
        background: theme.backgroundColor,
        border: `1px solid ${theme.primaryColor}28`,
      }}
    >
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0 sm:px-5 sm:py-4"
        style={{ background: theme.headerGradient }}>
        <div className="w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center text-xl flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.15)' }}>
          {study.bot_emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white text-base leading-tight truncate">{study.bot_name}</div>
          <div className="text-white/60 text-xs mt-0.5 uppercase tracking-wide truncate">{study.name}</div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="live-dot" />
            <span className="text-white/50 text-xs">Ready for your feedback</span>
          </div>
        </div>
      </div>

      {/* Chat — fills remaining vertical space */}
      <div ref={chatRef}
        className="survey-chat flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-2"
      />

      {/* Input — pinned to bottom, respects iPhone home bar */}
      <div ref={inputRef}
        className="px-3 pt-2 flex-shrink-0"
        style={{
          background: `${theme.backgroundColor}f0`,
          borderTop: `1px solid ${theme.primaryColor}18`,
          paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))',
        }}
      />
    </div>
  )
}
