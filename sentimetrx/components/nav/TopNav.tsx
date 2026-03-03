'use client'

import Link from 'next/link'

interface Crumb { label: string; href?: string }

interface Props {
  logoUrl?:   string
  orgName?:   string
  isAdmin?:   boolean
  userEmail?: string
  crumbs?:    Crumb[]
}

const HERMES = '#E8632A'

export default function TopNav({ logoUrl, orgName, isAdmin, userEmail, crumbs }: Props) {
  return (
    <nav className="border-b border-slate-800 px-6 py-3 flex items-center justify-between bg-slate-950 sticky top-0 z-50">
      <div className="flex items-center gap-3 min-w-0 overflow-hidden">
        <Link href="/dashboard" className="flex items-center gap-2 flex-shrink-0">
          {logoUrl ? (
            <img src={logoUrl} alt={orgName || 'Logo'} className="h-8 w-auto object-contain max-w-[140px]" />
          ) : (
            <span className="font-bold text-sm whitespace-nowrap" style={{ color: HERMES }}>
              sentimetrx.ai
            </span>
          )}
        </Link>
        {crumbs && crumbs.length > 0 && (
          <div className="flex items-center gap-1.5 min-w-0 overflow-hidden">
            {crumbs.map((c, i) => (
              <div key={i} className="flex items-center gap-1.5 min-w-0">
                <span className="text-slate-600 text-sm flex-shrink-0">/</span>
                {c.href ? (
                  <Link href={c.href} className="text-sm text-slate-400 hover:text-white transition-colors truncate max-w-[140px]">
                    {c.label}
                  </Link>
                ) : (
                  <span className="text-sm text-white font-medium truncate max-w-[180px]">{c.label}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 flex-shrink-0 ml-4">
        <Link href="/dashboard" className="text-xs text-slate-500 hover:text-white transition-colors hidden sm:block">Dashboard</Link>
        <Link href="/settings/team" className="text-xs text-slate-500 hover:text-white transition-colors hidden sm:block">Team</Link>
        {isAdmin && (
          <Link href="/admin" className="text-xs font-medium transition-colors" style={{ color: HERMES }}>Admin</Link>
        )}
        {userEmail && (
          <span className="text-slate-600 text-xs hidden md:block truncate max-w-[160px]">{userEmail}</span>
        )}
        <form action="/api/auth/signout" method="POST">
          <button className="text-xs text-slate-500 hover:text-white transition-colors px-2.5 py-1.5 rounded-lg hover:bg-slate-800">
            Sign out
          </button>
        </form>
      </div>
    </nav>
  )
}
