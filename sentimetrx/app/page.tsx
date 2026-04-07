import { redirect } from 'next/navigation'

export default function Home({ searchParams }: { searchParams: { code?: string } }) {
  // If Supabase redirects here with a PKCE code (password reset, magic link),
  // forward to the auth callback handler so the code gets exchanged for a session
  if (searchParams.code) {
    redirect(`/auth/callback?code=${searchParams.code}`)
  }

  redirect('/dashboard')
}
