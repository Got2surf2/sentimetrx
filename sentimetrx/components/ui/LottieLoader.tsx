'use client'

// components/ui/LottieLoader.tsx
// Lightweight Lottie animation loader using lottie-web (no React wrapper needed).
// Usage: <LottieLoader size={120} />
// The animation JSON is loaded from /loading-animation.json in the public folder.

import { useEffect, useRef } from 'react'

interface Props {
  size?:      number      // px, default 120
  message?:   string      // optional text below animation
  className?: string
}

export default function LottieLoader({ size = 120, message, className }: Props) {
  var containerRef = useRef<HTMLDivElement>(null)
  var animRef      = useRef<any>(null)

  useEffect(function() {
    if (!containerRef.current) return
    var cancelled = false

    import('lottie-web').then(function(lottie) {
      if (cancelled || !containerRef.current) return
      animRef.current = lottie.default.loadAnimation({
        container:     containerRef.current,
        renderer:      'svg',
        loop:          true,
        autoplay:      true,
        path:          '/loading-animation.json',
      })
    }).catch(function() {
      // Fallback: if lottie-web not installed, show CSS spinner
      if (containerRef.current && !cancelled) {
        containerRef.current.innerHTML = '<div style="width:' + (size * 0.4) + 'px;height:' + (size * 0.4) + 'px;border:3px solid rgba(232,98,42,0.2);border-top-color:#e8622a;border-radius:50%;animation:spin 0.8s linear infinite"></div>'
      }
    })

    return function() {
      cancelled = true
      if (animRef.current) {
        try { animRef.current.destroy() } catch (e) {}
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
