'use client'

import { useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'

export default function AuthConfirmPage() {
  const router = useRouter()
  const supabase = createClient()

  useEffect(() => {
    const hash = window.location.hash
    if (!hash) {
      router.replace('/login')
      return
    }

    const params = new URLSearchParams(hash.replace('#', ''))
    const access_token  = params.get('access_token')
    const refresh_token = params.get('refresh_token')
    const type          = params.get('type')

    if (!access_token || !refresh_token) {
      router.replace('/login?error=Invalid+reset+link.+Please+request+a+new+one.')
      return
    }

    supabase.auth.setSession({ access_token, refresh_token }).then(({ error }) => {
      if (error) {
        router.replace('/login?error=Reset+link+expired.+Please+request+a+new+one.')
      } else if (type === 'recovery') {
        router.replace('/auth/reset-password')
      } else {
        router.replace('/dashboard')
      }
    })
  }, [])

  return (
    <main className="min-h-screen bg-slate-950 flex items-center justify-center">
      <div className="text-center">
        <div className="text-3xl mb-4">⏳</div>
        <p className="text-slate-400 text-sm">Verifying your link...</p>
      </div>
    </main>
  )
}
