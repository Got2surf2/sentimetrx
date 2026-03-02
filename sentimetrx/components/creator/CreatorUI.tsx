'use client'

// Shared UI components used across all creator steps
// Keeps each step file clean and consistent

interface InputProps {
  value:       string
  onChange:    (v: string) => void
  placeholder?: string
  hint?:        string
  className?:   string
  multiline?:   boolean
  rows?:        number
}

export function Input({ value, onChange, placeholder, hint, className = '', multiline, rows = 3 }: InputProps) {
  const base = `w-full px-4 py-3 rounded-xl text-sm text-white placeholder-slate-500 bg-slate-800 border border-slate-700 outline-none focus:border-cyan-500 transition-colors resize-none ${className}`

  return (
    <div className="flex flex-col gap-1">
      {multiline ? (
        <textarea
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className={base}
        />
      ) : (
        <input
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={base}
        />
      )}
      {hint && <p className="text-slate-500 text-xs px-1">{hint}</p>}
    </div>
  )
}

export function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-slate-300 text-sm font-medium">{children}</label>
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-slate-500 text-xs px-1">{hint}</p>}
    </div>
  )
}

export function Section({ title, children, description }: { title: string; children: React.ReactNode; description?: string }) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="text-white font-semibold text-base">{title}</h3>
        {description && <p className="text-slate-400 text-sm mt-0.5">{description}</p>}
      </div>
      {children}
    </div>
  )
}

interface NavButtonsProps {
  onBack?:       () => void
  onNext?:       () => void
  nextLabel?:    string
  nextDisabled?: boolean
  saving?:       boolean
  extraButtons?: React.ReactNode
}

export function NavButtons({ onBack, onNext, nextLabel = 'Next', nextDisabled, saving, extraButtons }: NavButtonsProps) {
  return (
    <div className="flex items-center justify-between pt-4 border-t border-slate-800 mt-4">
      <div>
        {onBack && (
          <button
            onClick={onBack}
            className="px-4 py-2.5 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 text-sm font-medium transition-all"
          >
            Back
          </button>
        )}
      </div>
      <div className="flex gap-2">
        {extraButtons}
        {onNext && (
          <button
            onClick={onNext}
            disabled={nextDisabled || saving}
            className="px-5 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:bg-slate-700 disabled:text-slate-500 text-slate-900 font-semibold text-sm transition-all"
          >
            {saving ? 'Saving...' : nextLabel}
          </button>
        )}
      </div>
    </div>
  )
}

export function Divider() {
  return <div className="border-t border-slate-800" />
}
