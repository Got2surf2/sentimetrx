// components/ui/DatanautixAttribution.tsx
// Small reusable parent-company attribution shown on every entry surface
// (TopNav, login, public share pages, authenticated footer). Two visual
// variants:
//   - "compact" — single inline line, fits inside a 48px nav. No background.
//   - "footer"  — centered tagline, slightly bolder; for full-width footers.
// Swap the text "Datanautix" for an SVG when an asset lands in public/.

interface Props {
  variant?: 'compact' | 'footer'
  className?: string
}

const HOME = 'https://www.datanautix.com'

export default function DatanautixAttribution({ variant = 'footer', className = '' }: Props) {
  if (variant === 'compact') {
    return (
      <a
        href={HOME}
        target="_blank"
        rel="noopener noreferrer"
        className={'text-[10px] font-medium hover:underline whitespace-nowrap ' + className}
        style={{ color: 'rgba(255,255,255,.55)' }}
        title="Sentimetrx is a Datanautix product"
      >
        by <span style={{ color: 'rgba(255,255,255,.85)' }}>Datanautix</span>
      </a>
    )
  }
  return (
    <p className={'text-center text-[11px] ' + className} style={{ color: '#9ca3af' }}>
      Sentimetrx is a{' '}
      <a
        href={HOME}
        target="_blank"
        rel="noopener noreferrer"
        className="font-semibold hover:underline"
        style={{ color: '#374151' }}
      >
        Datanautix
      </a>{' '}
      product.
    </p>
  )
}
