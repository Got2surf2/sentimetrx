'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'

interface Props { params: { token: string } }

export default function InvitePage({ params }: Props) {
  const [invite,   setInvite]   = useState<any>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [name,     setName]     = useState('')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [saving,   setSaving]   = useState(false)
  const [done,     setDone]     = useState(false)
  const router = useRouter()

  useEffect(() => {
    fetch(`/api/invite?token=${params.token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) {
          setError(data.error)
        } else {
          setInvite(data)
          if (data.email) setEmail(data.email)
        }
        setLoading(false)
      })
      .catch(() => { setError('Failed to validate invite link.'); setLoading(false) })
  }, [params.token])

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setSaving(true)
    setError(null)
    const res = await fetch('/api/invite/register', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: params.token, email, password, full_name: name }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Registration failed')
      setSaving(false)
    } else {
      setDone(true)
      setTimeout(() => router.push('/login'), 3000)
    }
  }

  const inputClass = 'w-full px-4 py-3 rounded-xl text-sm text-white placeholder-slate-500 bg-slate-800 border border-slate-700 outline-none focus:border-cyan-500 transition-colors'

  return (
    <main className="min-h-screen bg-slate-950 flex items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">💓</div>
          <h1 className="text-2xl font-bold text-white">Sentimetrx</h1>
          <p className="text-slate-400 text-sm mt-1">Create your account</p>
        </div>

        {loading && (
          <div className="text-center text-slate-500 text-sm">Validating invite...</div>
        )}

        {error && !loading && (
          <div className="text-center p-6 rounded-xl bg-red-500/10 border border-red-500/20">
            <div className="text-2xl mb-3">⚠️</div>
            <p className="text-red-400 font-medium mb-1">Invalid invite</p>
            <p className="text-slate-400 text-sm">{error}</p>
          </div>
        )}

        {done && (
          <div className="text-center p-6 rounded-xl bg-green-500/10 border border-green-500/20">
            <div className="text-2xl mb-3">✓</div>
            <p className="text-green-400 font-medium mb-1">Account created!</p>
            <p className="text-slate-400 text-sm">Taking you to the login page...</p>
          </div>
        )}

        {invite && !done && (
          <>
            <div className="mb-6 px-4 py-3 rounded-xl bg-cyan-500/10 border border-cyan-500/20 text-center">
              <p className="text-cyan-400 text-sm font-medium">
                You have been invited to join {invite.clients?.name || 'Sentimetrx'}
              </p>
            </div>
            <form onSubmit={handleRegister} className="flex flex-col gap-3">
              <input
                type="text"
                placeholder="Your full name"
                value={name}
                onChange={e => setName(e.target.value)}
                className={inputClass}
              />
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
                placeholder="Password (min 8 characters)"
                value={password}
                onChange={e => setPassword(e.target.value)}
                required
                className={inputClass}
              />
              {error && <p className="text-red-400 text-xs px-1">{error}</p>}
              <button
                type="submit"
                disabled={saving}
                className="w-full py-3 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-semibold text-sm transition-all mt-1"
              >
                {saving ? 'Creating account...' : 'Create account'}
              </button>
            </form>
          </>
        )}
      </div>
    </main>
  )
}
