import { redirect } from 'next/navigation'

export default async function Home(props: { searchParams: Promise<{ code?: string }> }) {
  const searchParams = await props.searchParams;
  // If Supabase redirects here with a PKCE code (password reset, magic link),
  // forward to the auth callback handler so the code gets exchanged for a session
  if (searchParams.code) {
    redirect(`/auth/callback?code=${searchParams.code}`)
  }

  redirect('/analyze')
}
