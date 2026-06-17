'use client'

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white shadow-sm hover:bg-gray-800 print:hidden"
    >
      Print / Save PDF
    </button>
  )
}
