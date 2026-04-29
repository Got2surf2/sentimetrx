// app/b/[slug]/layout.tsx
// Bot public page layout — viewport meta for mobile keyboard handling

import type { Metadata, Viewport } from 'next'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  interactiveWidget: 'resizes-content',
}

export const metadata: Metadata = {
  title: 'Chat',
}

export default function BotLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
