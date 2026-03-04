'use client'

import Link from 'next/link'

interface Props {
  logoUrl?:     string
  orgName?:     string
  isAdmin?:     boolean
  userEmail?:   string
  fullName?:    string
  crumbs?:      any   // accepted but ignored — breadcrumbs live in SubHeader
  currentPage?: 'dashboard' | 'team' | 'admin' | 'responses' | 'analytics' | 'edit' | 'deploy' | 'new'
}

const HERMES = '#E8632A'

export default function TopNav({ logoUrl, orgName, isAdmin, userEmail, fullName, currentPage }: Props) {

  const navLink = (page: string, href: string, label: string) => {
    const active = currentPage === page
    return (
      <Link href={href}
        className={'text-sm font-medium transition-all whitespace-nowrap px-3 py-1.5 rounded-full ' +
          (active ? 'bg-white/25 text-white' : 'text-orange-100 hover:bg-white/15 hover:text-white')}>
        {label}
      </Link>
    )
  }

  const displayName = fullName
    ? `${fullName}${userEmail ? ` (${userEmail})` : ''}`
    : userEmail || ''

  return (
    <nav className="px-5 flex items-center justify-between h-14 sticky top-0 z-50 shadow-md"
      style={{ background: HERMES }}>

      {/* Left: logo + org name + user */}
      <div className="flex items-center gap-3 min-w-0">
        <Link href="/dashboard" className="flex items-center gap-2.5 flex-shrink-0">
          {logoUrl ? (
            <img src={logoUrl} alt={orgName || 'Logo'} className="h-8 w-auto object-contain max-w-[120px] rounded" />
          ) : (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
                <span className="text-white font-black text-sm leading-none">S</span>
              </div>
              <span className="font-bold text-white text-sm tracking-tight whitespace-nowrap">sentimetrx.ai</span>
            </div>
          )}
        </Link>
        {orgName && (
          <>
            <span className="text-orange-200/60 text-sm hidden sm:block">|</span>
            <span className="text-orange-100 text-sm font-medium truncate max-w-[120px] hidden sm:block">{orgName}</span>
          </>
        )}
        {displayName && (
          <>
            <span className="text-orange-200/40 text-sm hidden lg:block">·</span>
            <span className="text-orange-200 text-xs truncate max-w-[180px] hidden lg:block">{displayName}</span>
          </>
        )}
      </div>

      {/* Right: nav links */}
      <div className="flex items-center gap-0.5 flex-shrink-0">
        {navLink('dashboard', '/dashboard', 'Dashboard')}
        {navLink('team', '/settings/team', 'Team')}
        {isAdmin && (
          <Link href="/admin"
            className={'text-sm font-medium whitespace-nowrap px-3 py-1.5 rounded-full transition-all ' +
              (currentPage === 'admin' ? 'bg-white/25 text-white' : 'text-orange-100 hover:bg-white/15 hover:text-white')}>
            Admin
          </Link>
        )}
        <div className="w-px h-5 bg-white/20 mx-2" />
        <form action="/api/auth/signout" method="POST">
          <button className="text-sm text-orange-100 hover:text-white hover:bg-white/15 transition-all px-3 py-1.5 rounded-full whitespace-nowrap">
            Sign out
          </button>
        </form>
      </div>
    </nav>
  )
}
