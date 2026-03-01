import { redirect } from 'next/navigation'

// The root URL redirects to the admin dashboard.
// In Phase 2 this will be the study creator.
// For Phase 1 it just shows a holding page.
export default function Home() {
  redirect('/dashboard')
}
