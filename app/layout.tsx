// app/layout.tsx
// Root layout — update metadata.icons to point at the SVG favicon

import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import SessionGuard from '@/components/SessionGuard'
import DatanautixAttribution from '@/components/ui/DatanautixAttribution'

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
        {/* Global parent-company footer — appears on every page, including
            public share surfaces. Small and unobtrusive so it doesn't
            compete with page chrome. Login + share pages already include
            their own in-card attribution; the slight redundancy is
            intentional so the parent relationship is visible from every
            entry point. */}
        <footer className="py-2 text-center" style={{ background: '#fafafa', borderTop: '1px solid #f3f4f6' }}>
          <DatanautixAttribution variant="footer" />
        </footer>
      </body>
    </html>
  )
}
