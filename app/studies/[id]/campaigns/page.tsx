import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { resolveOrg } from '@/lib/resolveOrg'
import Link from 'next/link'

export const dynamic = 'force-dynamic'

export default async function StudyCampaignsPage({ params }: { params: { id: string } }) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: userData } = await supabase
    .from('users')
    .select('org_id, organizations(features)')
    .eq('id', user.id)
    .single()

  const orgData = resolveOrg(userData?.organizations) as any

  const { data: study } = await supabase
    .from('studies')
    .select('id, name, status')
    .eq('id', params.id)
    .single()

  if (!study) redirect('/dashboard')

  const { data: campaigns } = await supabase
    .from('campaigns')
    .select('id, name, status, created_at, target_responses')
    .eq('study_id', params.id)
    .order('created_at', { ascending: false })

  const HERMES = '#E8632A'

  return (
    <main className="max-w-4xl mx-auto px-6 py-8 pt-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-bold text-gray-800">Campaigns for {study.name}</h1>
          <p className="text-xs text-gray-400 mt-1">{(campaigns || []).length} campaign(s)</p>
        </div>
        <Link href={'/studies/' + params.id + '/campaigns/new'}
          className="px-4 py-2 rounded-xl text-white text-sm font-semibold shadow-sm hover:opacity-90 transition-all"
          style={{ background: HERMES }}>
          + New Campaign
        </Link>
      </div>

      {(!campaigns || campaigns.length === 0) ? (
        <div className="text-center py-16 border-2 border-dashed border-gray-200 rounded-2xl bg-white">
          <div className="text-4xl mb-3">📧</div>
          <p className="text-gray-500 text-sm mb-4">No campaigns yet for this study.</p>
          <Link href={'/studies/' + params.id + '/campaigns/new'}
            className="inline-block px-4 py-2 rounded-lg text-white text-sm font-medium"
            style={{ background: HERMES }}>
            Create your first campaign
          </Link>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map((c: any) => (
            <Link key={c.id} href={'/campaigns/' + c.id}
              className="block bg-white rounded-xl border border-gray-200 p-4 hover:shadow-md hover:border-orange-200 transition-all">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-sm text-gray-800">{c.name}</h3>
                  <span className={'text-xs px-2 py-0.5 rounded-full border font-medium mt-1 inline-block ' +
                    (c.status === 'active' ? 'bg-green-100 text-green-700 border-green-200' :
                     c.status === 'completed' ? 'bg-gray-100 text-gray-500 border-gray-200' :
                     c.status === 'paused' ? 'bg-yellow-100 text-yellow-700 border-yellow-200' :
                     'bg-gray-100 text-gray-500 border-gray-200')}>
                    {c.status}
                  </span>
                </div>
                <div className="text-xs text-gray-400">
                  {new Date(c.created_at).toLocaleDateString()}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </main>
  )
}
