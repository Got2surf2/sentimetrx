'use client'

// components/ui/SanjayModal.tsx
// Unified #sanjay verbose-mode modal — shared across survey, town hall, and agent chat.
// Detects #sanjay <password> for direct bypass, or #verbose for auth-gated access.

import { useState } from 'react'

const BYPASS_PATTERN = /^#sanjay\s+mvuli609$/i
const VERBOSE_PATTERN = /^#verbose$/i
const DEMO_PATTERN = /^#demo$/i

/** Check if input is a verbose/sanjay/demo command. Returns action or null. */
export function checkVerboseCommand(text: string): 'bypass' | 'auth' | 'demo' | null {
  if (BYPASS_PATTERN.test(text.trim())) return 'bypass'
  if (VERBOSE_PATTERN.test(text.trim())) return 'auth'
  if (DEMO_PATTERN.test(text.trim())) return 'demo'
  return null
}

interface SanjayModalProps {
  onSuccess: () => void
  onCancel: () => void
}

export default function SanjayModal({ onSuccess, onCancel }: SanjayModalProps) {
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  const [mode, setMode] = useState<'password' | 'login'>('password')
  const [email, setEmail] = useState('')
  const [loginPassword, setLoginPassword] = useState('')

  async function verifyPassword() {
    setError('')
    if (password === 'mvuli609') {
      onSuccess()
    } else {
      setError('Invalid password')
    }
  }

  async function verifyLogin() {
    setError('')
    setChecking(true)
    try {
      const res = await fetch('/api/verify-auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: loginPassword }),
      })
      const data = await res.json()
      if (data.valid) { onSuccess() }
      else { setError('Invalid credentials') }
    } catch { setError('Verification failed') }
    setChecking(false)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999 }}
      onClick={onCancel}>
      <div style={{ background: '#fff', borderRadius: 16, padding: 24, width: 320, maxWidth: '90vw' }}
        onClick={e => e.stopPropagation()}>
        <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Enable Verbose Mode</div>
        <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 16 }}>
          {mode === 'password' ? 'Enter the admin password to enable AI reasoning.' : 'Sign in with your Sentimetrx account.'}
        </div>

        {mode === 'password' ? (
          <>
            <div style={{ position: 'relative' }}>
              <input
                type={showPassword ? 'text' : 'password'}
                placeholder="Password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') verifyPassword() }}
                autoFocus
                style={{ width: '100%', padding: '8px 36px 8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, marginBottom: 8, boxSizing: 'border-box' }}
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                style={{ position: 'absolute', right: 8, top: 8, background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: '#9ca3af', padding: 0 }}>
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <button
              onClick={() => setMode('login')}
              style={{ fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 8, display: 'block' }}>
              Or sign in with account
            </button>
          </>
        ) : (
          <>
            <input type="email" placeholder="Email" value={email} onChange={e => setEmail(e.target.value)}
              autoFocus
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, marginBottom: 8, boxSizing: 'border-box' }} />
            <input type="password" placeholder="Password" value={loginPassword} onChange={e => setLoginPassword(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') verifyLogin() }}
              style={{ width: '100%', padding: '8px 12px', borderRadius: 8, border: '1px solid #d1d5db', fontSize: 14, marginBottom: 8, boxSizing: 'border-box' }} />
            <button
              onClick={() => setMode('password')}
              style={{ fontSize: 11, color: '#9ca3af', background: 'none', border: 'none', cursor: 'pointer', padding: 0, marginBottom: 8, display: 'block' }}>
              Or use admin password
            </button>
          </>
        )}

        {error && <div style={{ color: '#dc2626', fontSize: 12, marginBottom: 8 }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} style={{ padding: '8px 16px', borderRadius: 8, border: '1px solid #d1d5db', background: '#fff', fontSize: 13, cursor: 'pointer' }}>Cancel</button>
          <button
            onClick={mode === 'password' ? verifyPassword : verifyLogin}
            disabled={mode === 'password' ? (!password || checking) : (!email || !loginPassword || checking)}
            style={{ padding: '8px 16px', borderRadius: 8, border: 'none', background: '#E8632A', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer', opacity: checking ? 0.6 : 1 }}>
            {checking ? 'Verifying...' : 'Verify'}
          </button>
        </div>
      </div>
    </div>
  )
}
