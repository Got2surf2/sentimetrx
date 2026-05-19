'use client'

import { useState } from 'react'
import Link from 'next/link'
import TopNav from '@/components/nav/TopNav'

interface OrgRow { id: string; name: string; slug: string; plan: string; is_admin_org: boolean }

interface Props {
  orgs: OrgRow[]
  logoUrl?: string
  orgName?: string
  userEmail: string
  fullName?: string
  features?: import('@/lib/types').ModuleFeatures
}

export default function BackupsClient({ orgs, logoUrl, orgName, userEmail, fullName, features }: Props) {
  const [running, setRunning] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, { ok: boolean; msg: string }>>({})

  async function snapshotNow(orgId: string) {
    setRunning(orgId)
    try {
      const res = await fetch('/api/admin/org-snapshots/' + orgId, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) {
        setResults(prev => ({ ...prev, [orgId]: { ok: false, msg: data?.error || ('HTTP ' + res.status) } }))
      } else {
        const size = data.size_bytes ? Math.round(data.size_bytes / 1024) + ' KB' : 'unknown size'
        const truncated = data.truncated?.length > 0 ? ' (' + data.truncated.length + ' tables truncated)' : ''
        setResults(prev => ({ ...prev, [orgId]: { ok: true, msg: 'Snapshot uploaded: ' + size + truncated } }))
      }
    } catch (e: any) {
      setResults(prev => ({ ...prev, [orgId]: { ok: false, msg: e?.message || 'Network error' } }))
    } finally {
      setRunning(null)
    }
  }

  return (
    <div className='min-h-screen bg-gray-50'>
      <TopNav logoUrl={logoUrl} orgName={orgName} isAdmin={true} userEmail={userEmail} fullName={fullName} currentPage='admin' features={features} />

      <div className='max-w-5xl mx-auto px-4 py-8'>
        <div className='mb-6'>
          <div className='text-xs text-gray-500 mb-1'><Link href='/admin' className='hover:underline'>Admin</Link> / Backups</div>
          <h1 className='text-2xl font-semibold text-gray-900'>Per-tenant backups</h1>
          <p className='text-sm text-gray-600 mt-1'>
            Nightly at 04:00 UTC, every org's tenant-scoped data is snapshotted to S3.
            Click <strong>Snapshot now</strong> to run an on-demand backup, or <strong>Browse</strong> to list and restore prior snapshots.
          </p>
          <div className='mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-3'>
            Restore is destructive even in <em>merge</em> mode (it overwrites rows by id). Use sparingly and verify the snapshot's <code>taken_at</code> before clicking.
          </div>
        </div>

        <div className='bg-white border border-gray-200 rounded-lg divide-y divide-gray-200'>
          {orgs.map(org => {
            const r = results[org.id]
            const isRunning = running === org.id
            return (
              <div key={org.id} className='p-4 flex items-center gap-3 flex-wrap'>
                <div className='flex-1 min-w-0'>
                  <div className='font-medium text-gray-900 text-sm'>
                    {org.name} {org.is_admin_org && <span className='ml-1 text-xs text-emerald-700 font-normal'>(admin)</span>}
                  </div>
                  <div className='text-xs text-gray-500 font-mono'>{org.id}</div>
                  {r && (
                    <div className={'mt-1 text-xs ' + (r.ok ? 'text-emerald-700' : 'text-red-700')}>
                      {r.msg}
                    </div>
                  )}
                </div>
                <div className='flex gap-2'>
                  <Link
                    href={'/admin/backups/' + org.id}
                    className='px-3 py-1.5 rounded-lg border border-gray-300 text-sm text-gray-700 hover:bg-gray-50'
                  >Browse snapshots</Link>
                  <button
                    onClick={() => snapshotNow(org.id)}
                    disabled={isRunning}
                    className='px-3 py-1.5 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed'
                  >{isRunning ? 'Working…' : 'Snapshot now'}</button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
