// app/layout.tsx
// Root layout — update metadata.icons to point at the SVG favicon

import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import SessionGuard from '@/components/SessionGuard'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title:       'Sentimetrx',
  description: 'Conversational survey intelligence',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
    ],
    shortcut: '/favicon.svg',
    apple:    '/favicon.svg',
  },
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
