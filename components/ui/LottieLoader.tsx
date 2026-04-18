'use client'

// components/ui/LottieLoader.tsx
// Plays the Lottie animation from /public/morphing-particle-loader.json using lottie-web.

import { useEffect, useRef } from 'react'

interface Props {
  size?:      number
  message?:   string
  className?: string
}

export default function LottieLoader({ size = 140, message, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(function() {
    if (!containerRef.current) return
    var cancelled = false
    var anim: any = null
    // Clear any leftover SVG from a prior mount (React 18 Strict Mode race)
    containerRef.current.innerHTML = ''
    import('lottie-web').then(function(mod) {
      if (cancelled || !containerRef.current) return
      var lottie = mod.default || mod
      anim = lottie.loadAnimation({
        container:  containerRef.current,
        renderer:   'svg',
        loop:       true,
        autoplay:   true,
        path:       '/morphing-particle-loader.json',
      })
    })
    return function() {
      cancelled = true
      if (anim) anim.destroy()
    }
  }, [])

  return (
    <div className={className || ''} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <div ref={containerRef} style={{ width: size, height: size }} />
      {message && (
        <div style={{ fontSize: 13, color: '#6b7280', fontWeight: 500, textAlign: 'center' }}>{message}</div>
      )}
    </div>
  )
}
