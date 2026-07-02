'use client'

import { useState, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'

// Brand palette — matches email-wordmark.svg and the rich Supabase email
// templates so users move between sign-in, magic link, and password reset
// without a visual gear-shift.
const HERMES = '#E8632A'
const HERMES_DEEP = '#c84e1d'
const TEAL = '#0F7173'

type Mode = 'login' | 'forgot' | 'magic'

function LoginFormInner() {
  const [mode,     setMode]     = useState<Mode>('login')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [sent,     setSent]     = useState(false)
  const [magicSent, setMagicSent] = useState(false)

  const router       = useRouter()
  const searchParams = useSearchParams()
  const urlError     = searchParams.get('error')
  const supabase     = createClient()

  const inputClass = 'w-full px-4 py-3 rounded-xl text-sm text-gray-800 placeholder-gray-400 bg-white border border-gray-300 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-all'

  const primaryBtn: React.CSSProperties = {
    background: HERMES,
    color: 'white',
  }

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      // Best-effort login logging — don't block redirect on failure
      fetch('/api/auth/log-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: 'password' }),
      }).catch(() => {})
      router.push('/analyze')
      router.refresh()
    }
  }

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      // ?next= tells /auth/callback where to send the user after the PKCE
      // code exchange. Without it, Supabase's verify endpoint strips the
      // 'type=recovery' marker so the callback can't distinguish recovery
      // from a normal sign-in and would dump them on /dashboard.
      redirectTo: `${window.location.origin}/auth/callback?next=/auth/reset-password`,
    })
    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
  }

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    // Routed through /api/auth/magic-link rather than calling
    // supabase.auth.signInWithOtp directly: the server-side wrapper
    // swallows the 422 "Signups not allowed for otp" that Supabase
    // returns for unknown emails, so the network response is uniform
    // regardless of whether the email is known. Signups still go
    // through invites — this endpoint only sends links to existing users.
    try {
      await fetch('/api/auth/magic-link', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email,
          redirectTo: `${window.location.origin}/auth/confirm`,
        }),
      })
    } catch {
      /* uniform UX — show the success card either way */
    }
    setLoading(false)
    setMagicSent(true)
  }

  const sentCard = (icon: string, title: string, body: React.ReactNode) => (
    <div
      className="text-center p-6 rounded-xl border"
      style={{ background: '#fff7f0', borderColor: '#fcd5c0' }}
    >
      <div className="text-3xl mb-3">{icon}</div>
      <p className="font-semibold mb-1" style={{ color: '#1f2937' }}>{title}</p>
      <p className="text-sm leading-relaxed" style={{ color: '#6b7280' }}>{body}</p>
      <button
        onClick={() => { setMode('login'); setSent(false); setMagicSent(false); setError(null) }}
        className="mt-5 text-xs transition-colors"
        style={{ color: TEAL }}
      >
        Back to sign in
      </button>
    </div>
  )

  if (mode === 'magic' && magicSent) {
    return sentCard('✉️', 'Check your email', (
      <>We sent a sign-in link to <span style={{ color: '#1f2937', fontWeight: 600 }}>{email}</span>. Click it to log in. The link is single-use and expires shortly.</>
    ))
  }

  if (mode === 'magic') {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-center leading-relaxed" style={{ color: '#6b7280' }}>
          Enter your email and we’ll send you a one-time sign-in link. No password needed.
        </p>
        <form onSubmit={(e) => { void handleMagicLink(e) }} className="flex flex-col gap-3">
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className={inputClass}
          />
          {error && <p className="text-xs px-1" style={{ color: '#dc2626' }}>{error}</p>}
          <button
            type="submit"
            disabled={loading}
            style={loading ? { background: '#d1d5db', color: '#6b7280' } : primaryBtn}
            className="w-full py-3 rounded-xl font-semibold text-sm transition-all"
          >
            {loading ? 'Sending...' : 'Email me a sign-in link'}
          </button>
        </form>
        <button
          onClick={() => { setMode('login'); setError(null) }}
          className="text-xs text-center transition-colors"
          style={{ color: TEAL }}
        >
          Back to password sign-in
        </button>
      </div>
    )
  }

  if (mode === 'forgot' && sent) {
    return sentCard('📬', 'Check your email', (
      <>We sent a reset link to <span style={{ color: '#1f2937', fontWeight: 600 }}>{email}</span>. Click it to set a new password.</>
    ))
  }

  if (mode === 'forgot') {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-center leading-relaxed" style={{ color: '#6b7280' }}>
          Enter your email and we’ll send you a link to reset your password.
        </p>
        <form onSubmit={(e) => { void handleForgot(e) }} className="flex flex-col gap-3">
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className={inputClass}
          />
          {error && <p className="text-xs px-1" style={{ color: '#dc2626' }}>{error}</p>}
          <button
            type="submit"
            disabled={loading}
            style={loading ? { background: '#d1d5db', color: '#6b7280' } : primaryBtn}
            className="w-full py-3 rounded-xl font-semibold text-sm transition-all"
          >
            {loading ? 'Sending...' : 'Send reset link'}
          </button>
        </form>
        <button
          onClick={() => { setMode('login'); setError(null) }}
          className="text-xs text-center transition-colors"
          style={{ color: TEAL }}
        >
          Back to sign in
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={(e) => { void handleLogin(e) }} className="flex flex-col gap-3">
      {urlError && (
        <div
          className="px-4 py-3 rounded-xl text-xs leading-relaxed"
          style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}
        >
          {urlError}
        </div>
      )}
      <input
        type="email"
        placeholder="Email address"
        value={email}
        onChange={e => setEmail(e.target.value)}
        required
        className={inputClass}
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        onChange={e => setPassword(e.target.value)}
        required
        className={inputClass}
      />
      {error && <p className="text-xs px-1" style={{ color: '#dc2626' }}>{error}</p>}
      <button
        type="submit"
        disabled={loading}
        style={loading ? { background: '#d1d5db', color: '#6b7280' } : primaryBtn}
        className="w-full py-3 rounded-xl font-semibold text-sm transition-all mt-1 hover:opacity-95"
        onMouseDown={e => { if (!loading) (e.currentTarget.style.background = HERMES_DEEP) }}
        onMouseUp={e => { if (!loading) (e.currentTarget.style.background = HERMES) }}
        onMouseLeave={e => { if (!loading) (e.currentTarget.style.background = HERMES) }}
      >
        {loading ? 'Signing in...' : 'Sign in'}
      </button>
      <div className="flex items-center justify-center gap-3 mt-2 text-xs">
        <button
          type="button"
          onClick={() => { setMode('magic'); setError(null) }}
          className="transition-colors hover:underline"
          style={{ color: HERMES, fontWeight: 600 }}
        >
          Email me a sign-in link
        </button>
        <span style={{ color: '#d1d5db' }}>·</span>
        <button
          type="button"
          onClick={() => { setMode('forgot'); setError(null) }}
          className="transition-colors hover:underline"
          style={{ color: '#6b7280' }}
        >
          Forgot your password?
        </button>
      </div>
    </form>
  )
}

export default function LoginForm() {
  return (
    <Suspense fallback={null}>
      <LoginFormInner />
    </Suspense>
  )
}
