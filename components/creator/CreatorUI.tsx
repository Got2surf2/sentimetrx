'use client'
// components/creator/CreatorUI.tsx — light theme

import { useRef } from 'react'
import LinkToolbar from './LinkToolbar'

const HERMES = '#E8632A'

interface InputProps {
  value:        string
  onChange:     (v: string) => void
  placeholder?: string
  hint?:        string
  className?:   string
  multiline?:   boolean
  rows?:        number
  enableLinks?: boolean   // show floating link toolbar on text selection
}

const inputBase = 'w-full px-4 py-3 rounded-xl text-sm text-gray-800 placeholder-gray-400 bg-white border border-gray-300 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-colors resize-none'

export function Input({ value, onChange, placeholder, hint, className = '', multiline, rows = 3, enableLinks }: InputProps) {
  const elRef = useRef<HTMLTextAreaElement & HTMLInputElement>(null)
  return (
    <div className="flex flex-col gap-1" style={{ position: 'relative' }}>
      {multiline ? (
        <textarea
          ref={elRef as React.RefObject<HTMLTextAreaElement>}
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          rows={rows}
          className={`${inputBase} ${className}`}
        />
      ) : (
        <input
          ref={elRef as React.RefObject<HTMLInputElement>}
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          className={`${inputBase} ${className}`}
        />
      )}
      {enableLinks && <LinkToolbar targetRef={elRef} value={value} onChange={onChange} />}
      {hint && <p className="text-gray-400 text-xs px-1">{hint}</p>}
      {enableLinks && <p className="text-gray-300 text-xs px-1">Select text and click Add Link to insert a URL</p>}
    </div>
  )
}

export function Label({ children }: { children: React.ReactNode }) {
  return <label className="text-gray-700 text-sm font-semibold">{children}</label>
}

export function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      {children}
      {hint && <p className="text-gray-400 text-xs px-1">{hint}</p>}
    </div>
  )
}

export function Section({ title, children, description, action }: { title: string; children?: React.ReactNode; description?: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-4 bg-white border border-gray-200 rounded-2xl p-6 shadow-sm">
      <div className="border-b border-gray-100 pb-3 flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-gray-800 font-bold text-base">{title}</h3>
          {description && <p className="text-gray-500 text-sm mt-1 leading-relaxed">{description}</p>}
        </div>
        {action && <div className="flex-shrink-0 mt-0.5">{action}</div>}
      </div>
      {children}
    </div>
  )
}

export function ExportLabelField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <Field label="CSV export column name (optional)">
      <Input
        value={value}
        onChange={onChange}
        placeholder="Short label for this column in CSV exports — e.g. Follow-up Answer"
      />
    </Field>
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
    <div className="flex items-center justify-between pt-4 border-t border-gray-200 mt-2">
      <div>
        {onBack && (
          <button onClick={onBack}
            className="px-4 py-2.5 rounded-xl text-gray-500 hover:text-gray-700 hover:bg-gray-100 text-sm font-medium transition-all">
            ← Back
          </button>
        )}
      </div>
      <div className="flex gap-2">
        {extraButtons}
        {onNext && (
          <button onClick={onNext} disabled={nextDisabled || saving}
            className="px-5 py-2.5 rounded-xl text-white font-semibold text-sm transition-all disabled:opacity-40"
            style={{ background: nextDisabled || saving ? undefined : HERMES }}
          >
            {saving ? 'Saving…' : nextLabel}
          </button>
        )}
      </div>
    </div>
  )
}

export function TransitionMessagePanel({ enabled, text, onToggle, onTextChange, defaultText }: {
  enabled: boolean
  text: string
  onToggle: (v: boolean) => void
  onTextChange: (v: string) => void
  defaultText: string
}) {
  return (
    <div className="bg-amber-50 border border-amber-200 rounded-2xl p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1">
          <h3 className="text-gray-800 font-bold text-sm">Section transition message</h3>
          <p className="text-gray-500 text-xs mt-0.5">Shown to respondents before this section begins</p>
        </div>
        <button
          type="button"
          onClick={() => onToggle(!enabled)}
          className={'relative inline-flex w-11 h-6 rounded-full transition-colors flex-shrink-0 border-2 border-transparent ' + (enabled ? 'bg-orange-500' : 'bg-gray-200')}
        >
          <span className={'inline-block w-5 h-5 bg-white rounded-full shadow-md transition-transform transform ' + (enabled ? 'translate-x-5' : 'translate-x-0')} />
        </button>
      </div>
      {enabled && (
        <textarea
          value={text || defaultText}
          onChange={e => onTextChange(e.target.value)}
          rows={2}
          className="mt-3 w-full px-4 py-2.5 rounded-xl text-sm text-gray-800 placeholder-gray-400 bg-white border border-amber-300 outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-colors resize-none"
        />
      )}
    </div>
  )
}

export function Divider() {
  return <div className="border-t border-gray-200" />
}
