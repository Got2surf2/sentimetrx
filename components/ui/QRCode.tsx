'use client'
// components/ui/QRCode.tsx
// Client-side QR code generator. Renders a data-URL <img>. Replaces the
// previous reliance on api.qrserver.com — that round-tripped to an external
// service per render (50–100ms each), required network access from every
// participant device, and was a third-party dependency on the auth flow for
// joining a session via QR.

import { useEffect, useState } from 'react'

interface Props {
  url:        string
  size?:      number
  /** Foreground (dark module) color — default '#000000'. */
  color?:     string
  /** Background (light module) color — default '#ffffff'. */
  background?: string
  margin?:    number
  className?: string
  alt?:       string
}

export default function QRCode({ url, size = 160, color = '#000000', background = '#ffffff', margin = 1, className, alt = 'QR code' }: Props) {
  const [src, setSrc] = useState<string>('')

  useEffect(function() {
    if (!url) { setSrc(''); return }
    let cancelled = false
    void import('qrcode').then(function(mod) {
      if (cancelled) return
      const lib = (mod as any).default || mod
      lib.toDataURL(url, { width: size * 2, margin, color: { dark: color, light: background } })
        .then(function(dataUrl: string) { if (!cancelled) setSrc(dataUrl) })
        .catch(function() { /* leave empty src — img will show its alt */ })
    })
    return function() { cancelled = true }
  }, [url, size, color, background, margin])

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      width={size}
      height={size}
      style={{ width: size, height: size, display: 'block' }}
    />
  )
}
