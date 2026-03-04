'use client'

import Link from 'next/link'

interface Props {
  logoUrl?:     string
  orgName?:     string
  isAdmin?:     boolean
  userEmail?:   string
  crumbs?:      any
  currentPage?: 'dashboard' | 'team' | 'admin' | 'responses' | 'analytics' | 'edit' | 'deploy' | 'new'
}

export default function TopNav({ logoUrl, orgName, isAdmin, userEmail, currentPage }: Props) {

  const navLink = (page: string, href: string, label: string) => {
    const active = currentPage === page
    return (
      <Link
        href={href}
        className={
          'text-sm font-medium transition-all whitespace-nowrap px-3 py-1.5 rounded-md ' +
          (active
            ? 'bg-white/20 text-white'
            : 'text-orange-100 hover:bg-white/15 hover:text-white')
        }
      >
        {label}
      </Link>
    )
  }

  return (
    <nav className="px-5 flex items-center justify-between h-14 sticky top-0 z-50 shadow-md"
      style={{ background: '#E8632A' }}>

      {/* Left: logo + org name */}
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
            <span className="text-orange-200/60 text-sm">|</span>
            <span className="text-orange-100 text-sm font-medium truncate max-w-[160px]">{orgName}</span>
          </>
        )}
      </div>

      {/* Right: nav links + user */}
      <div className="flex items-center gap-1 flex-shrink-0">
        {navLink('dashboard', '/dashboard', 'Dashboard')}
        {navLink('team', '/settings/team', 'Team')}
        {isAdmin && navLink('admin', '/admin', 'Admin')}
        <div className="w-px h-5 bg-white/20 mx-1" />
        {userEmail && (
          <span className="text-orange-200 text-xs hidden lg:block truncate max-w-[150px] mr-1">{userEmail}</span>
        )}
        <form action="/api/auth/signout" method="POST">
          <button className="text-sm text-orange-100 hover:text-white hover:bg-white/15 transition-all px-3 py-1.5 rounded-md whitespace-nowrap">
            Sign out
          </button>
        </form>
      </div>
    </nav>
  )
}
