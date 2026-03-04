'use client'

import Link from 'next/link'

interface Crumb { label: string; href?: string }

interface Props {
  logoUrl?:     string
  orgName?:     string
  isAdmin?:     boolean
  userEmail?:   string
  crumbs?:      Crumb[]
  currentPage?: 'dashboard' | 'team' | 'admin' | 'responses' | 'analytics' | 'edit' | 'deploy' | 'new'
}

const HERMES = '#E8632A'

export default function TopNav({ logoUrl, orgName, isAdmin, userEmail, crumbs, currentPage }: Props) {

  const navLink = (page: string, href: string, label: string) => {
    const active = currentPage === page
    return (
      <Link
        href={href}
        className={
          'text-xs font-medium transition-colors whitespace-nowrap px-2.5 py-1.5 rounded-md ' +
          (active ? 'bg-slate-800 text-white' : 'text-slate-400 hover:text-white hover:bg-slate-800/60')
        }
      >
        {label}
      </Link>
    )
  }

  return (
    <nav className="border-b border-slate-800 px-5 py-0 flex items-center justify-between bg-slate-950 sticky top-0 z-50 h-12">

      {/* Left: logo + breadcrumbs */}
      <div className="flex items-center gap-2 min-w-0 h-full">
        <Link href="/dashboard" className="flex items-center gap-2 flex-shrink-0 h-full py-2">
          {logoUrl ? (
            <img src={logoUrl} alt={orgName || 'Logo'} className="h-6 w-auto object-contain max-w-[100px]" />
          ) : (
            <span className="font-bold text-sm whitespace-nowrap tracking-tight" style={{ color: HERMES }}>
              sentimetrx.ai
            </span>
          )}
        </Link>

        {crumbs && crumbs.length > 0 && (
          <div className="flex items-center gap-1 min-w-0 overflow-hidden">
            {crumbs.map((c, i) => (
              <div key={i} className="flex items-center gap-1 min-w-0">
                <span className="text-slate-700 text-xs flex-shrink-0">/</span>
                {c.href
                  ? <Link href={c.href} className="text-xs text-slate-500 hover:text-white transition-colors truncate max-w-[120px]">{c.label}</Link>
                  : <span className="text-xs text-slate-300 font-medium truncate max-w-[150px]">{c.label}</span>
                }
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Right: nav links */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {navLink('dashboard', '/dashboard', 'Dashboard')}
        {navLink('team', '/settings/team', 'Team')}
        {isAdmin && (
          <Link
            href="/admin"
            className={
              'text-xs font-medium whitespace-nowrap px-2.5 py-1.5 rounded-md transition-colors ' +
              (currentPage === 'admin' ? 'bg-slate-800 text-white' : 'hover:bg-slate-800/60')
            }
            style={{ color: currentPage === 'admin' ? 'white' : HERMES }}
          >
            Admin
          </Link>
        )}
        <div className="w-px h-4 bg-slate-800 mx-2" />
        {userEmail && (
          <span className="text-slate-600 text-xs hidden lg:block truncate max-w-[130px] mr-2">{userEmail}</span>
        )}
        <form action="/api/auth/signout" method="POST">
          <button className="text-xs text-slate-500 hover:text-white transition-colors px-2.5 py-1.5 rounded-md hover:bg-slate-800/60 whitespace-nowrap">
            Sign out
          </button>
        </form>
      </div>
    </nav>
  )
}
