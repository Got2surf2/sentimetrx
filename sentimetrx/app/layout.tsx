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
      </body>
    </html>
  )
}
