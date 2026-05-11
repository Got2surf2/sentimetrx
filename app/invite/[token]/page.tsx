'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

const HERMES = '#E8632A'
const HERMES_DEEP = '#c84e1d'
const TEAL = '#0F7173'

interface Props { params: { token: string } }

interface Invite {
  id:        string
  email:     string
  role:      string
  org_id:    string
  org_name:  string | null
}

const ROLE_LABEL: Record<string, string> = {
  owner:  'Owner',
  admin:  'Admin',
  member: 'Member',
  viewer: 'Viewer',
}

export default function InvitePage({ params }: Props) {
  const [invite,   setInvite]   = useState<Invite | null>(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [name,     setName]     = useState('')
  const [password, setPassword] = useState('')
  const [saving,   setSaving]   = useState(false)
  const router   = useRouter()
  const supabase = createClient()

  useEffect(() => {
    fetch(`/api/invite?token=${params.token}`)
      .then(r => r.json())
      .then(data => {
        if (data.error) setError(data.error)
        else             setInvite(data)
        setLoading(false)
      })
      .catch(() => { setError('Failed to validate invite link.'); setLoading(false) })
  }, [params.token])

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!invite) return
    if (password.length < 8) { setError('Password must be at least 8 characters'); return }
    setSaving(true)
    setError(null)
    const res = await fetch('/api/invite/register', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: params.token, email: invite.email, password, full_name: name }),
    })
    const data = await res.json()
    if (!res.ok) {
      setError(data.error || 'Registration failed')
      setSaving(false)
      return
    }
    // Auto-login: the user just typed their password — don't make them
    // type it again on /login. signInWithPassword establishes the browser
    // session cookie; then we redirect straight into the app.
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email:    invite.email,
      password,
    })
    if (signInError) {
      // Account was created but auto-login failed — fall back to /login
      // with a friendly message rather than a hard error.
      router.push('/login?error=Account created — please sign in')
      return
    }
    router.push('/analyze')
    router.refresh()
  }

  const inputClass = 'w-full px-4 py-3 rounded-xl text-sm text-gray-800 placeholder-gray-400 bg-white border border-gray-300 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-all'
  const lockedInputClass = 'w-full px-4 py-3 rounded-xl text-sm text-gray-600 bg-gray-50 border border-gray-200 outline-none cursor-not-allowed'

  return (
    <main
      className="min-h-screen flex items-center justify-center p-6"
      style={{ background: 'linear-gradient(180deg, #fff7f0 0%, #fef5ed 60%, #f4f5f7 100%)' }}
    >
      <div className="w-full max-w-md">
        <div className="bg-white rounded-2xl shadow-xl border border-orange-100/70 px-8 py-10 sm:px-10 sm:py-12">
          <div className="flex flex-col items-center text-center mb-8">
            <svg width="64" height="64" viewBox="0 0 60 60" fill="none" role="img" aria-label="Sentimetrx">
              <circle cx="30" cy="30" r="23" stroke={HERMES} strokeWidth="4" />
              <circle cx="30" cy="30" r="11" stroke={TEAL} strokeWidth="3" />
              <circle cx="30" cy="30" r="3.5" fill={HERMES} />
            </svg>
            <h1 className="text-3xl font-bold mt-5 tracking-tight" style={{ color: '#1f2937' }}>
              Sentimetrx
            </h1>
          </div>

          {loading && (
            <div className="text-center text-sm" style={{ color: '#6b7280' }}>Validating invite…</div>
          )}

          {error && !loading && !invite && (
            <div className="text-center p-6 rounded-xl border" style={{ background: '#fef2f2', borderColor: '#fecaca' }}>
              <p className="font-semibold mb-1" style={{ color: '#b91c1c' }}>Invalid invite</p>
              <p className="text-sm" style={{ color: '#6b7280' }}>{error}</p>
            </div>
          )}

          {invite && (
            <>
              <div
                className="mb-6 px-4 py-3 rounded-xl text-center"
                style={{ background: '#fff7f0', border: '1px solid #fcd5c0' }}
              >
                <p className="text-sm" style={{ color: '#6b7280' }}>You've been invited to join</p>
                <p className="text-lg font-semibold mt-0.5" style={{ color: '#1f2937' }}>
                  {invite.org_name || 'Sentimetrx'}
                </p>
                <p className="text-xs mt-1" style={{ color: TEAL }}>
                  as {ROLE_LABEL[invite.role] || invite.role}
                </p>
              </div>

              <form onSubmit={handleRegister} className="flex flex-col gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#6b7280' }}>
                    Email <span className="font-normal text-gray-400">· locked to this invitation</span>
                  </label>
                  <input
                    type="email"
                    value={invite.email}
                    readOnly
                    className={lockedInputClass}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#6b7280' }}>Your full name</label>
                  <input
                    type="text"
                    placeholder="Jane Smith"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    className={inputClass}
                    autoFocus
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5" style={{ color: '#6b7280' }}>
                    Choose a password <span className="font-normal text-gray-400">· min 8 characters</span>
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                    className={inputClass}
                  />
                </div>
                {error && <p className="text-xs px-1" style={{ color: '#dc2626' }}>{error}</p>}
                <button
                  type="submit"
                  disabled={saving}
                  style={saving ? { background: '#d1d5db', color: '#6b7280' } : { background: HERMES, color: 'white' }}
                  className="w-full py-3 rounded-xl font-semibold text-sm transition-all mt-2"
                  onMouseDown={e => { if (!saving) (e.currentTarget.style.background = HERMES_DEEP) }}
                  onMouseUp={e => { if (!saving) (e.currentTarget.style.background = HERMES) }}
                  onMouseLeave={e => { if (!saving) (e.currentTarget.style.background = HERMES) }}
                >
                  {saving ? 'Creating account…' : 'Accept invitation'}
                </button>
              </form>
            </>
          )}
        </div>
        <p className="text-center text-xs mt-5" style={{ color: '#9ca3af' }}>
          Trouble accepting? Email <a className="underline" style={{ color: TEAL }} href="mailto:support@datanautix.com">support@datanautix.com</a>
        </p>
      </div>
    </main>
  )
}
