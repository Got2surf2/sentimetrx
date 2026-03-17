'use client'

import { useState } from 'react'
import Link from 'next/link'

interface Props {
  logoUrl?:        string
  orgName?:        string
  isAdmin?:        boolean
  userEmail?:      string
  fullName?:       string
  crumbs?:         any
  analyzeEnabled?: boolean   // NEW -- true if org has features.analyze
  currentPage?:    'dashboard' | 'team' | 'admin' | 'responses' | 'analytics' | 'edit' | 'deploy' | 'new' | 'analyze'
}

const HERMES = '#E8632A'

function CogMenu({ currentPage }: { currentPage?: string }) {
  var [open, setOpen] = useState(false)
  var isActive = currentPage === 'team' || currentPage === 'admin'
  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={function() { setOpen(function(v) { return !v }) }}
        className={'text-sm font-medium transition-all whitespace-nowrap px-2.5 py-1.5 rounded-full ' +
          (isActive ? 'bg-white/25 text-white' : 'text-orange-100 hover:bg-white/15 hover:text-white')}
        title="Settings"
        style={{ fontSize: 16, lineHeight: 1 }}>
        {'\u2699'}
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 90 }} onClick={function() { setOpen(false) }} />
          <div style={{ position: 'absolute', right: 0, top: '100%', marginTop: 6, background: 'white', borderRadius: 10, boxShadow: '0 8px 24px rgba(0,0,0,.15)', zIndex: 100, minWidth: 180, padding: '4px 0', overflow: 'hidden' }}>
            <Link href="/settings/team" onClick={function() { setOpen(false) }}
              style={{ display: 'block', padding: '10px 16px', fontSize: 13, fontWeight: currentPage === 'team' ? 700 : 500, color: currentPage === 'team' ? HERMES : '#374151', textDecoration: 'none', transition: 'background .1s' }}
              onMouseEnter={function(e) { (e.target as HTMLElement).style.background = '#f9fafb' }}
              onMouseLeave={function(e) { (e.target as HTMLElement).style.background = 'transparent' }}>
              {'\uD83D\uDC65'} Team Management
            </Link>
            <Link href="/admin" onClick={function() { setOpen(false) }}
              style={{ display: 'block', padding: '10px 16px', fontSize: 13, fontWeight: currentPage === 'admin' ? 700 : 500, color: currentPage === 'admin' ? HERMES : '#374151', textDecoration: 'none', transition: 'background .1s' }}
              onMouseEnter={function(e) { (e.target as HTMLElement).style.background = '#f9fafb' }}
              onMouseLeave={function(e) { (e.target as HTMLElement).style.background = 'transparent' }}>
              {'\uD83D\uDD27'} Admin Panel
            </Link>
          </div>
        </>
      )}
    </div>
  )
}

export default function TopNav({ logoUrl, orgName, isAdmin, userEmail, fullName, analyzeEnabled, currentPage }: Props) {

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
    ? (fullName + (userEmail ? ' (' + userEmail + ')' : ''))
    : userEmail || ''

  return (
    <nav className="px-5 flex items-center justify-between h-14 fixed top-0 left-0 right-0 z-50 shadow-md"
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
        {navLink('dashboard', '/dashboard', 'Studies')}
        {analyzeEnabled && navLink('analyze', '/analyze', 'Analyze')}
        {isAdmin && <CogMenu currentPage={currentPage} />}
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
