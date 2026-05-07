// /clara — see comment on /nora for details. Clara now lives in the `bots`
// table; this route redirects to /b/clara which goes through the dynamic
// bot pipeline. Legacy /api/clara-chat kept alive for backward compat.

import { redirect } from 'next/navigation'

export const dynamic = 'force-static'

export default function ClaraPage() {
  redirect('/b/clara')
}
