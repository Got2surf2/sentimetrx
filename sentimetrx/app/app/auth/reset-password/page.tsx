'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function ResetPasswordPage() {
  const [password,  setPassword]  = useState('')
  const [password2, setPassword2] = useState('')
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [done,      setDone]      = useState(false)
  const router  = useRouter()
  const supabase = createClient()

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password !== password2) { setError('Passwords do not match'); return }
    if (password.length < 8)    { setError('Password must be at least 8 characters'); return }
    setLoading(true)
    setError(null)

    const { error } = await supabase.auth.updateUser({ password })
    if (error) {
      setError(error.message)
      setLoading(false)
    } else {
      setDone(true)
      setTimeout(() => router.push('/dashboard'), 2000)
    }
  }

  const inputClass = `
    w-full px-4 py-3 rounded-xl text-sm text-white placeholder-slate-500
    bg-slate-800 border border-slate-700 outline-none
    focus:border-cyan-500 transition-colors
  `

  return (
    <main className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">🔑</div>
          <h1 className="text-2xl font-bold text-white">Set your password</h1>
          <p className="text-slate-400 text-sm mt-1">Choose a password for your account</p>
        </div>

        {done ? (
          <div className="text-center p-6 rounded-xl bg-green-500/10 border border-green-500/20">
            <div className="text-2xl mb-2">✓</div>
            <p className="text-green-400 font-medium">Password set!</p>
            <p className="text-slate-400 text-sm mt-1">Taking you to the dashboard…</p>
          </div>
        ) : (
          <form onSubmit={handleReset} className="flex flex-col gap-3">
            <input
              type="password"
              placeholder="New password (min 8 characters)"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              className={inputClass}
            />
            <input
              type="password"
              placeholder="Confirm new password"
              value={password2}
              onChange={e => setPassword2(e.target.value)}
              required
              className={inputClass}
            />
            {error && <p className="text-red-400 text-xs px-1">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-semibold text-sm transition-all mt-1"
            >
              {loading ? 'Setting password…' : 'Set password'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}
