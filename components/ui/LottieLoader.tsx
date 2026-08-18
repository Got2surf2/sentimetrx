'use client'

// components/ui/LottieLoader.tsx
// The app's only loader. Plays the morphing-particle Lottie via lottie-web.
//
// ⚠️ The animation is BUNDLED (`animationData`), never fetched by `path`.
// It used to load from /public/morphing-particle-loader.json, and that made the
// loader silently invisible exactly when it mattered most: on a first dataset
// open the page floods the origin with the paged row download plus the
// theme-counts and signal-stats scans, and over HTTP/1.1 (any dev server, and
// any HTTP/1.1 proxy in front of prod) Chrome's ~6-connection-per-origin limit
// queues the animation's own request behind them. Measured 2026-08-18: the
// request was issued and simply never came back for the whole 15s+ pending
// window, so `loadAnimation` ran against a container that stayed empty and the
// user saw a bare sentence on a blank page. A loading indicator must not depend
// on the network being free — that is precisely when it is needed.
//
// Cost is ~8.6KB of JSON in the shared client chunk, which is the right trade.

import { useEffect, useRef } from 'react'
import type { AnimationItem } from 'lottie-web'
import animationData from './morphingParticleLoader.json'

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
    var anim: AnimationItem | null = null
    // Clear any leftover SVG from a prior mount (Strict Mode double-invoke race)
    containerRef.current.innerHTML = ''
    void import('lottie-web').then(function(mod) {
      if (cancelled || !containerRef.current) return
      var lottie = mod.default || mod
      anim = lottie.loadAnimation({
        container:  containerRef.current,
        renderer:   'svg',
        loop:       true,
        autoplay:   true,
        animationData,
      })
    }).catch(function() { /* loader is decorative — never break the page */ })
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
