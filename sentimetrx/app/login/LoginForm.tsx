'use client'

import { useState, Suspense } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter, useSearchParams } from 'next/navigation'

type Mode = 'login' | 'forgot'

// useSearchParams must be in a component wrapped by Suspense
// We split it into an inner component for exactly this reason
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

  const inputClass = `
    w-full px-4 py-3 rounded-xl text-sm text-white placeholder-slate-500
    bg-slate-800 border border-slate-700 outline-none
    focus:border-cyan-500 transition-colors
  `

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

  // ── Forgot — sent ────────────────────────────────────────
  if (mode === 'forgot' && sent) {
    return (
      <di
