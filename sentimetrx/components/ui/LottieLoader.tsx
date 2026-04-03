'use client'

// components/ui/LottieLoader.tsx
// Orange spinning loader — uses a global CSS class (.lottie-spinner) defined in globals.css.

interface Props {
  size?:      number
  message?:   string
  className?: string
}

export default function LottieLoader({ size = 120, message, className }: Props) {
  const spinnerSize = Math.round(size * 0.38)

  return (
    <div className={className || ''} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 8 }}>
      <div style={{ width: size, height: size, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div
          className="lottie-spinner"
          style={{ width: spinnerSize, height: spinnerSize }}
        />
      </div>
      {message && (
        <div style={{ fontSize: 13, color: '#6b7280', fontWeight: 500, textAlign: 'center' }}>{message}</div>
      )}
    </div>
  )
}
