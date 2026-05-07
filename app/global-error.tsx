'use client'

// app/global-error.tsx
// Friendly fallback when a top-level uncaught error breaks the page.
// Sentry captures the error automatically; the user sees a calm
// "we've logged it" page with a Try Again button.

import * as Sentry from '@sentry/nextjs'
import { useEffect } from 'react'

const HERMES = '#E8632A'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error)
  }, [error])

  return (
    <html>
      <body style={{ margin: 0, fontFamily: 'system-ui, sans-serif', background: '#f9fafb', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ maxWidth: 480, textAlign: 'center', padding: 32 }}>
          <div style={{ fontSize: 48, marginBottom: 12 }}>⚠️</div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#111827', marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ fontSize: 14, color: '#6b7280', marginBottom: 24, lineHeight: 1.5 }}>
            We&apos;ve logged this on our end. Try again — if it keeps happening, please email <a href="mailto:support@datanautix.com" style={{ color: HERMES }}>support@datanautix.com</a>.
          </p>
          <button onClick={reset}
            style={{ padding: '10px 24px', background: HERMES, color: 'white', border: 'none', borderRadius: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
            Try again
          </button>
          {error.digest && (
            <p style={{ fontSize: 11, color: '#9ca3af', marginTop: 24 }}>
              Reference: <code>{error.digest}</code>
            </p>
          )}
        </div>
      </body>
    </html>
  )
}
