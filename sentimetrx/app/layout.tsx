import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Sentimetrx',
  description: 'Conversational survey intelligence',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,   // prevents iOS zoom on input focus
  userScalable: false,
  viewportFit: 'cover', // allows content behind iPhone notch/home bar
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
