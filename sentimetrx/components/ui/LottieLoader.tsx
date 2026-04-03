'use client'

// components/ui/LottieLoader.tsx
// Lightweight Lottie animation loader using lottie-web (no React wrapper needed).
// Uses animationData (inline JSON) instead of path to avoid XHR issues.

import { useEffect, useRef } from 'react'

interface Props {
  size?:      number
  message?:   string
  className?: string
}

const SPINNER_CSS = `
  @keyframes _lottie_spin { to { transform: rotate(360deg) } }
`

function cssSpinner(container: HTMLDivElement, size: number) {
  const s = Math.round(size * 0.4)
  container.innerHTML =
    '<style>' + SPINNER_CSS + '</style>' +
    '<div style="width:' + s + 'px;height:' + s + 'px;border:3px solid rgba(232,98,42,0.2);border-top-color:#e8622a;border-radius:50%;animation:_lottie_spin 0.8s linear infinite"></div>'
}

export default function LottieLoader({ size = 120, message, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const animRef      = useRef<any>(null)

  useEffect(function() {
    const container = containerRef.current
    if (!container) return
    let cancelled = false

    Promise.all([
      import('lottie-web'),
      fetch('/loading-animation.json').then(function(r) {
        if (!r.ok) throw new Error('fetch failed')
        return r.json()
      }),
    ]).then(function([lottieModule, animationData]) {
      if (cancelled || !container) return
      animRef.current = lottieModule.default.loadAnimation({
        container,
        renderer:      'svg',
        loop:          true,
        autoplay:      true,
        animationData,
      })
    }).catch(function() {
      if (!cancelled && container) cssSpinner(container, size)
    })

    return function() {
      cancelled = true
      if (animRef.current) {
        try { animRef.current.destroy() } catch (_) {}
        animRef.current = null
      }
    }
  }, [size])

  return (
    <div className={className || ''} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <div ref={containerRef} style={{ width: size, height: size }} />
      {message && (
        <div style={{ fontSize: 13, color: '#6b7280', fontWeight: 500, textAlign: 'center' }}>{message}</div>
      )}
    </div>
  )
}
