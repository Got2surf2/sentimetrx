// /bot — see comment on /nora for details. The Datanautix Assistant now
// lives in the `bots` table at slug=datanautix-assistant; this route
// redirects to /b/datanautix-assistant which goes through the dynamic bot
// pipeline. Legacy /api/bot-chat kept alive for backward compat.

import { redirect } from 'next/navigation'

export const dynamic = 'force-static'

export default function BotPage() {
  redirect('/b/datanautix-assistant')
}
