// app/layout.tsx
// Root layout — Next.js Metadata API drives <head>. Includes PWA hooks so
// the site is installable on iOS via Safari "Add to Home Screen": the
// manifest (app/manifest.ts) describes the install; the apple-touch-icon
// + apple-mobile-web-app-* meta tags below tell iOS to render the home-
// screen launch as a full-screen app rather than a Safari tab.

import type { Metadata, Viewport } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import SessionGuard from '@/components/SessionGuard'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title:       'Sentimetrx',
  description: 'Conversational survey intelligence',
  manifest:    '/manifest.webmanifest',
  // appleWebApp tells iOS Safari to treat the installed home-screen icon as
  // a standalone app (no Safari chrome). title controls the label under the
  // icon; statusBarStyle is the iOS status bar treatment when the app runs.
  appleWebApp: {
    capable:        true,
    title:          'Sentimetrx',
    statusBarStyle: 'default',
  },
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.svg',
    // iOS reads apple-touch-icon from a PNG; manifest.ts supplies the rest.
    apple: [
      { url: '/icons/icon-180.png', sizes: '180x180', type: 'image/png' },
    ],
  },
}

// Separate Viewport export per Next.js 14 metadata API — viewport-fit=cover
// lets the PWA paint under the iOS notch / dynamic island; theme color tints
// the iOS Safari address bar + Android status bar.
export const viewport: Viewport = {
  width:         'device-width',
  initialScale:  1,
  viewportFit:   'cover',
  themeColor:    '#e8622a',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en">
      <body className={inter.className}>
        {/* Dev-only database-target banner (scripts/dev.sh). PRODUCTION mode
            gets a loud red strip so nobody mutates client data by habit;
            test mode gets a slim green chip. Never renders in real builds
            (NODE_ENV guard) — prod deploys have no NEXT_PUBLIC_DB_TARGET. */}
        {process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_DB_TARGET === 'prod' && (
          <div style={{ position: 'fixed', top: 0, left: 0, right: 0, zIndex: 99999, background: '#DC2626', color: 'white', textAlign: 'center', fontSize: 12, fontWeight: 800, letterSpacing: '0.08em', padding: '3px 0', textTransform: 'uppercase' }}>
            ⚠ Production database — read-only habits apply
          </div>
        )}
        {process.env.NODE_ENV === 'development' && process.env.NEXT_PUBLIC_DB_TARGET === 'test' && (
          <div style={{ position: 'fixed', bottom: 8, left: 8, zIndex: 99999, background: '#059669', color: 'white', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', padding: '2px 8px', borderRadius: 6, opacity: 0.85, pointerEvents: 'none' }}>
            TEST DB
          </div>
        )}
        <SessionGuard>{children}</SessionGuard>
        {/* No global footer here. Adding one broke pages that lock the
            layout to height: 100vh (the analyze tabs do this so the
            module's two top bars stay fixed and the inner content
            scrolls within itself). With a body-level footer, the body
            became taller than the viewport, so the OUTER scroll moved
            the whole page — including the supposedly-fixed bars.
            Datanautix attribution lives in TopNav for authenticated
            pages, on the login footer, and is added explicitly to the
            public share surfaces. */}
      </body>
    </html>
  )
}
