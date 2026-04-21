'use client'

// app/test-spinner/page.tsx
// Quick test page to verify LottieLoader spinner animation works.
// Visit /test-spinner to check.

import { useState } from 'react'
import LottieLoader from '@/components/ui/LottieLoader'

export default function TestSpinnerPage() {
  const [showOverlay, setShowOverlay] = useState(false)

  return (
    <div style={{ padding: 40, fontFamily: 'system-ui, sans-serif', background: '#f7f7f8', minHeight: '100vh' }}>
      <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 8 }}>Spinner Test</h1>
      <p style={{ fontSize: 13, color: '#6b7280', marginBottom: 32 }}>Verify the LottieLoader animation is working.</p>

      {/* Inline spinners at different sizes */}
      <div style={{ display: 'flex', gap: 32, alignItems: 'center', flexWrap: 'wrap', marginBottom: 40 }}>
        {[48, 80, 96, 120].map(size => (
          <div key={size} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <LottieLoader size={size} message={size + 'px'} />
          </div>
        ))}
      </div>

      {/* White card background (like ExportModal body) */}
      <div style={{ background: '#ffffff', borderRadius: 12, padding: 40, display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 16, border: '1px solid #e5e7eb', marginBottom: 32 }}>
        <p style={{ fontSize: 12, color: '#9ca3af', margin: 0 }}>On white (like modal body):</p>
        <LottieLoader size={80} message="Loading fields…" />
      </div>

      {/* Full-screen overlay test */}
      <div style={{ display: 'block' }}>
        <button
          onClick={() => setShowOverlay(true)}
          style={{ padding: '10px 20px', background: '#e8622a', color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: 'pointer' }}>
          Test generating overlay (like PPTX export)
        </button>
      </div>

      {showOverlay && (
        <div
          onClick={() => setShowOverlay(false)}
          style={{ position: 'fixed', inset: 0, zIndex: 3000, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div
            onClick={e => e.stopPropagation()}
            style={{ background: '#ffffff', borderRadius: 16, padding: '48px 56px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, boxShadow: '0 24px 64px rgba(0,0,0,.25)', minWidth: 280 }}>
            <LottieLoader size={96} message="Building your PowerPoint…" />
            <p style={{ fontSize: 12, color: '#9ca3af', margin: '8px 0 0', textAlign: 'center' }}>
              Click outside to close
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
