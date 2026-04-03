'use client'

// components/ui/LottieLoader.tsx
// Reliable orange CSS spinner — shown immediately, always visible.
// (Lottie animation has transparent/light colors that render invisible on white.)

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
        <div style={{
          width:          spinnerSize,
          height:         spinnerSize,
          border:         '3px solid rgba(232,98,42,0.18)',
          borderTopColor: '#e8622a',
          borderRadius:   '50%',
          animation:      '_lspin 0.75s linear infinite',
        }} />
      </div>
      {message && (
        <div style={{ fontSize: 13, color: '#6b7280', fontWeight: 500, textAlign: 'center' }}>{message}</div>
      )}
      <style>{`@keyframes _lspin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}
