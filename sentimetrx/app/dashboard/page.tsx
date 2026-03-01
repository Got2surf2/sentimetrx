import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export default async function DashboardPage() {
  const supabase = createClient()
  const { data: { user } } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  const { data: studies } = await supabase
    .from('studies')
    .select('id, guid, name, bot_name, bot_emoji, status, created_at')
    .order('created_at', { ascending: false })

  const base = process.env.NEXT_PUBLIC_BASE_URL || 'https://sentimetrx.ai'

  return (
    <main className="min-h-screen bg-slate-950 text-white p-8">
      <div className="max-w-4xl mx-auto">

        {/* Header */}
        <div className="flex items-center justify-between mb-10">
          <div>
            <h1 className="text-3xl font-bold text-white">Sentimetrx</h1>
            <p className="text-slate-400 text-sm mt-1">Phase 1 — Studies Dashboard</p>
          </div>
          <div className="text-right">
            <p className="text-slate-400 text-xs">{user.email}</p>
            <form action="/api/auth/signout" method="POST">
              <button className="text-xs text-slate-500 hover:text-white mt-1 transition-colors">
                Sign out
              </button>
            </form>
          </div>
        </div>

        {/* Studies */}
        <div className="bg-slate-900 rounded-2xl border border-slate-800 overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
            <h2 className="font-semibold text-white">Active Studies</h2>
            <span className="text-xs text-slate-500">{studies?.length ?? 0} studies</span>
          </div>

          {!studies || studies.length === 0 ? (
            <div className="px-6 py-12 text-center text-slate-500 text-sm">
              No studies yet. Create one in Supabase using the seed SQL, or wait for Phase 2.
            </div>
          ) : (
            <div className="divide-y divide-slate-800">
              {studies.map(s => (
                <div key={s.id} className="px-6 py-4 flex items-center gap-4">
                  <span className="text-2xl flex-shrink-0">{s.bot_emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-white text-sm truncate">{s.name}</div>
                    <div className="text-slate-500 text-xs mt-0.5">{s.bot_name} · {s.guid}</div>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                      s.status === 'active'  ? 'bg-green-500/15 text-green-400' :
                      s.status === 'draft'   ? 'bg-slate-700 text-slate-400' :
                      s.status === 'paused'  ? 'bg-yellow-500/15 text-yellow-400' :
                                               'bg-red-500/15 text-red-400'
                    }`}>{s.status}</span>
                    {s.status === 'active' && (
                      <a
                        href={`${base}/s/${s.guid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-cyan-400 hover:text-cyan-300 transition-colors font-medium"
                      >
                        Open survey →
                      </a>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Phase 2 callout */}
        <div className="mt-6 p-5 rounded-xl border border-dashed border-slate-700 text-center">
          <p className="text-slate-500 text-sm">
            Phase 2 will add the point-and-click study creator, response dashboard, and client management.
          </p>
        </div>

      </div>
    </main>
  )
}
