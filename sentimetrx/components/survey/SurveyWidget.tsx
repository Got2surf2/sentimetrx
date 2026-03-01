'use client'

import { useEffect, useRef, useCallback } from 'react'
import { useSurveyEngine } from './useSurveyEngine'
import type { Study } from '@/lib/types'

interface Props { study: Study }

export default function SurveyWidget({ study }: Props) {
  const chatRef    = useRef<HTMLDivElement>(null)
  const inputRef   = useRef<HTMLDivElement>(null)
  const startedRef = useRef(false)

  const scrollBottom = useCallback(() => {
    setTimeout(() => {
      if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight
    }, 60)
  }, [])

  const { renderInput } = useSurveyEngine({
    study,
    chatRef,
    inputRef,
    scrollBottom,
  })

  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true
      renderInput('start')
    }
  }, [renderInput])

  const theme = study.config.theme

  return (
    <div
      className="w-full max-w-sm rounded-2xl overflow-hidden flex flex-col shadow-2xl"
      style={{
        height: 'min(700px, calc(100vh - 32px))',
        background: theme.backgroundColor,
        border: `1px solid ${theme.primaryColor}28`,
        boxShadow: `0 50px 100px rgba(0,0,0,0.7), 0 0 0 1px ${theme.primaryColor}20`,
      }}
    >
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 py-4 flex-shrink-0"
        style={{ background: theme.headerGradient }}
      >
        <div
          className="w-11 h-11 rounded-full flex items-center justify-center text-xl flex-shrink-0"
          style={{ background: 'rgba(255,255,255,0.15)' }}
        >
          {study.bot_emoji}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-white text-lg leading-tight">
            {study.bot_name}
          </div>
          <div className="text-white/60 text-xs mt-0.5 uppercase tracking-wide">
            {study.name}
          </div>
          <div className="flex items-center gap-1.5 mt-1">
            <span className="live-dot" />
            <span className="text-white/50 text-xs">Ready for your feedback</span>
          </div>
        </div>
      </div>

      {/* Chat area */}
      <div
        ref={chatRef}
        className="survey-chat flex-1 overflow-y-auto px-3.5 py-4 flex flex-col gap-2.5"
      />

      {/* Input area */}
      <div
        ref={inputRef}
        className="px-3 pb-3.5 pt-2.5 flex-shrink-0"
        style={{ background: `${theme.backgroundColor}ee`, borderTop: `1px solid ${theme.primaryColor}14` }}
      />
    </div>
  )
}
