// app/demo/mco/icon.tsx
//
// Favicon for /demo/mco. Matches the AskAna bot's identity at /b/mco:
// airplane glyph on the bot's blue gradient (avatarGradient in bot.config).
// Auto-wired by Next.js's icon convention — overrides the global Sentimetrx
// favicon for this route.

import { ImageResponse } from 'next/og'

export const runtime = 'edge'
export const size = { width: 64, height: 64 }
export const contentType = 'image/png'

export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // Matches bots.config.avatarGradient for slug=mco
          background: 'linear-gradient(135deg, #1e4d8b, #2b6cb0)',
          fontSize: 42,
        }}
      >
        ✈️
      </div>
    ),
    { ...size },
  )
}
