'use client'

import { useState, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'

type Mode = 'login' | 'forgot'

function LoginFormInner() {
  const [mode,     setMode]     = useState<Mode>('login')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [sent,     setSent]     = useState(false)

  const router       = useRouter()
  const searchParams = useSearchParams()
  const urlError     = searchParams.get('error')
  const supabase     = createClient()

  const inputClass = 'w-full px-4 py-3 rounded-xl text-sm text-white placeholder-slate-500 bg-slate-800 border border-slate-700 outline-none focus:border-cyan-500 transition-colors'

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      router.push('/dashboard')
      router.refresh()
    }
  }

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback`,
    })
    setLoading(false)
    if (error) {
      setError(error.message)
    } else {
      setSent(true)
    }
  }

  if (mode === 'forgot' && sent) {
    return (
      <div className="text-center p-6 rounded-xl bg-cyan-500/10 border border-cyan-500/20">
        <div className="text-3xl mb-3">📬</div>
        <p className="text-white font-medium mb-1">Check your email</p>
        <p className="text-slate-400 text-sm leading-relaxed">
          We sent a reset link to <span className="text-white">{email}</span>.
          Click it to set a new password.
        </p>
        <button
          onClick={() => { setMode('login'); setSent(false); setError(null) }}
          className="mt-5 text-xs text-slate-500 hover:text-white transition-colors"
        >
          Back to login
        </button>
      </div>
    )
  }

  if (mode === 'forgot') {
    return (
      <div className="flex flex-col gap-4">
        <p className="text-slate-400 text-sm text-center leading-relaxed">
          Enter your email and we will send you a link to reset your password.
        </p>
        <form onSubmit={handleForgot} className="flex flex-col gap-3">
          <input
            type="email"
            placeholder="Email address"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            className={inputClass}
          />
          {error && <p className="text-red-400 text-xs px-1">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-semibold text-sm transition-all"
          >
            {loading ? 'Sending...' : 'Send reset link'}
          </button>
        </form>
        <button
          onClick={() => { setMode('login'); setError(null) }}
          className="text-xs text-slate-500 hover:text-white transition-colors text-center"
        >
          Back to login
        </button>
      </div>
    )
  }

  return (
    <form onSubmit={handleLogin} className="flex flex-col gap-3">
      {urlError && (
        <div className="px-4 py-3 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs leading-relaxed">
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
      {error && <p className="text-red-400 text-xs px-1">{error}</p>}
      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-semibold text-sm transition-all mt-1"
      >
        {loading ? 'Signing in...' : 'Sign in'}
      </button>
      <button
        type="button"
        onClick={() => { setMode('forgot'); setError(null) }}
        className="text-xs text-slate-500 hover:text-white transition-colors text-center mt-1"
      >
        Forgot your password?
      </button>
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
