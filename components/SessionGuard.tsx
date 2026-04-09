'use client'
// components/SessionGuard.tsx
// Wraps the app to enforce a 4-hour inactivity timeout.
// Tracks mouse, keyboard, scroll, click. Shows modal on expiry.
// Must be placed inside a SupabaseProvider.

import { useState, useEffect, useRef } from 'react'

var TIMEOUT_MS = 4 * 60 * 60 * 1000 // 4 hours
var CHECK_INTERVAL_MS = 60 * 1000    // check every 60 seconds
var STORAGE_KEY = 'stx_last_activity'

export default function SessionGuard({ children }: { children: React.ReactNode }) {
  var [expired, setExpired] = useState(false)
  var timerRef = useRef<NodeJS.Timeout | null>(null)

  function recordActivity() {
    try { sessionStorage.setItem(STORAGE_KEY, String(Date.now())) } catch {}
  }

  function checkExpiry() {
    try {
      var last = parseInt(sessionStorage.getItem(STORAGE_KEY) || '0')
      if (last > 0 && Date.now() - last > TIMEOUT_MS) {
        setExpired(true)
      }
    } catch {}
  }

  useEffect(function() {
    // Initial activity mark
    recordActivity()

    // Track user activity
    var events = ['mousedown', 'keydown', 'scroll', 'touchstart', 'mousemove']
    var throttled = false
    function handler() {
      if (throttled) return
      throttled = true
      recordActivity()
      setTimeout(function() { throttled = false }, 10000) // throttle to once per 10s
    }
    events.forEach(function(e) { window.addEventListener(e, handler, { passive: true }) })

    // Periodic check
    timerRef.current = setInterval(checkExpiry, CHECK_INTERVAL_MS)

    return function() {
      events.forEach(function(e) { window.removeEventListener(e, handler) })
      if (timerRef.current) clearInterval(timerRef.current)
    }
  }, [])

  function handleSignOut() {
    try { sessionStorage.removeItem(STORAGE_KEY) } catch {}
    // POST to sign out endpoint
    var form = document.createElement('form')
    form.method = 'POST'
    form.action = '/api/auth/signout'
    document.body.appendChild(form)
    form.submit()
  }

  if (expired) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ background: 'white', borderRadius: 16, padding: '32px 28px', maxWidth: 400, textAlign: 'center', boxShadow: '0 24px 64px rgba(0,0,0,.25)' }}>
          <div style={{ fontSize: 36, marginBottom: 12 }}>{'\u23F0'}</div>
          <h2 style={{ fontSize: 18, fontWeight: 800, color: '#111827', marginBottom: 8 }}>Session Expired</h2>
          <p style={{ fontSize: 13, color: '#6b7280', lineHeight: 1.6, marginBottom: 24 }}>
            Your session has expired due to 4 hours of inactivity. Please sign in again to continue.
          </p>
          <button onClick={handleSignOut}
            style={{ padding: '10px 28px', fontSize: 14, fontWeight: 700, background: '#e8622a', color: 'white', border: 'none', borderRadius: 9, cursor: 'pointer' }}>
            Sign In
          </button>
        </div>
      </div>
    )
  }

  return <>{children}</>
}
