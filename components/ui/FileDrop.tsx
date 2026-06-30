'use client'

// Shared file picker — drag-and-drop OR click-to-browse — so every upload surface
// behaves the same. Matches the dataset uploader's UX (dashed dropzone, orange
// drag highlight, "Browse files"). Hand it an `accept` string + an `onFile`
// callback; it owns the drag state and the hidden input. Single file by default;
// pass `multiple` to receive an array via `onFiles`.

import { useCallback, useRef, useState, type ReactNode } from 'react'

export default function FileDrop({
  accept,
  onFile,
  onFiles,
  multiple = false,
  title = 'Drag and drop your file here',
  hint,
  icon = '📂',
  disabled = false,
  compact = false,
  children,
}: {
  accept?: string
  onFile?: (file: File) => void
  onFiles?: (files: File[]) => void
  multiple?: boolean
  title?: string
  hint?: string
  icon?: string
  disabled?: boolean
  compact?: boolean
  children?: ReactNode
}) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const emit = useCallback((list: FileList | null) => {
    if (!list || list.length === 0) return
    const files = Array.from(list)
    if (multiple) onFiles?.(files)
    else onFile?.(files[0])
  }, [multiple, onFile, onFiles])

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false)
    if (disabled) return
    emit(e.dataTransfer.files)
  }, [disabled, emit])

  return (
    <div
      onDragOver={e => { e.preventDefault(); if (!disabled) setDragging(true) }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      onClick={() => { if (!disabled) inputRef.current?.click() }}
      role="button"
      aria-disabled={disabled}
      className={'border-2 border-dashed rounded-2xl text-center transition-all '
        + (compact ? 'p-6 ' : 'p-12 ')
        + (disabled ? 'opacity-50 cursor-not-allowed border-gray-200 ' : 'cursor-pointer ')
        + (dragging ? 'border-orange-400 bg-orange-50' : 'border-gray-300 hover:border-gray-400 bg-white')}>
      {children ?? (
        <>
          <div className={compact ? 'text-3xl mb-2' : 'text-4xl mb-3'}>{icon}</div>
          <p className="text-gray-600 font-semibold mb-1">{title}</p>
          {hint && <p className="text-gray-400 text-sm mb-4">{hint}</p>}
          <span className="px-5 py-2.5 rounded-xl text-sm font-semibold text-white inline-block" style={{ background: '#E85A1A' }}>Browse files</span>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        disabled={disabled}
        onChange={e => { emit(e.target.files); e.target.value = '' }}
      />
    </div>
  )
}
