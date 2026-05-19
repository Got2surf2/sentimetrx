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
