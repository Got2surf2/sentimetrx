// app/manifest.ts
// PWA manifest served at /manifest.webmanifest (Next.js 14 file convention).
// Lets the site be installed as a home-screen app on iOS / Android. Opens
// directly to /m (the mobile status surface) instead of the desktop landing
// page so home-screen taps land somewhere phone-shaped.

import type { MetadataRoute } from 'next'

export default function manifest(): MetadataRoute.Manifest {
  return {
    name:             'Sentimetrx',
    short_name:       'Sentimetrx',
    description:      'Conversational survey intelligence — status at a glance',
    start_url:        '/m',
    scope:            '/',
    display:          'standalone',
    orientation:      'portrait',
    background_color: '#ffffff',
    theme_color:      '#e8622a', // brand orange — colors the iOS Safari address bar / Android status bar
    icons: [
      { src: '/icons/icon-180.png', sizes: '180x180', type: 'image/png' },
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
