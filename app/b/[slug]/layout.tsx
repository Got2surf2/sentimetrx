// app/b/[slug]/layout.tsx
// Bot public page layout

import type { Metadata } from 'next'

export const metadata: Metadata = {
  title: 'Chat',
}

export default function BotLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
