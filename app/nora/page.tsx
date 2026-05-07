// /nora used to be a hardcoded page that wired up <ChatBot> with an inline
// config and a dedicated /api/nora-chat endpoint. Nora now lives as a row
// in the `bots` table, so /nora redirects to the dynamic /b/nora route
// which goes through the standard bot pipeline (intent detection,
// deflection, KB injection, content_safety from bot.config, etc.).
//
// The legacy /api/nora-chat route is kept alive for backward compatibility
// with anything embedding the old endpoint directly.

import { redirect } from 'next/navigation'

export const dynamic = 'force-static'

export default function NoraPage() {
  redirect('/b/nora')
}
