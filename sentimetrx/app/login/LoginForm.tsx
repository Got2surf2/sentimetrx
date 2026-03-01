'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function LoginForm() {
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const router = useRouter()
  const supabase = createClient()

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

  const inputClass = `
    w-full px-4 py-3 rounded-xl text-sm text-white placeholder-slate-500
    bg-slate-800 border border-slate-700 outline-none
    focus:border-cyan-500 transition-colors
  `

  return (
    <form onSubmit={handleLogin} className="flex flex-col gap-3">
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

      {error && (
        <p className="text-red-400 text-xs px-1">{error}</p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-semibold text-sm transition-all mt-1"
      >
        {loading ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
