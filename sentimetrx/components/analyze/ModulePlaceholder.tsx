'use client'

import Link from 'next/link'

interface Props {
  datasetId:  string
  moduleName: string
  message:    string
  rowCount:   number
  fieldCount: number
  schemaReady: boolean
}

const HERMES = '#E8632A'

export default function ModulePlaceholder({ datasetId, moduleName, message, rowCount, fieldCount, schemaReady }: Props) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[480px] gap-8 py-16 px-8">

      {/* Ana wordmark */}
      <div className="flex flex-col items-center gap-2">
        <div className="w-16 h-16 rounded-2xl flex items-center justify-center shadow-lg"
          style={{ background: HERMES }}>
          <span className="text-white font-black text-2xl tracking-tight">A</span>
        </div>
        <span className="text-xs font-medium tracking-widest uppercase text-gray-400">
          {'Ana by Datanautix'}
        </span>
      </div>

      {/* Module name */}
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900">{moduleName}</h2>
        <p className="text-gray-500 mt-2 max-w-md text-base">{message}</p>
      </div>

      {/* Data readiness card */}
      <div className="bg-white rounded-xl border border-gray-200 p-5 w-full max-w-sm shadow-sm">
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-3">
          Data Readiness
        </p>
        <div className="flex flex-col gap-2.5">
          <DataRow label="Rows loaded" value={rowCount.toLocaleString()} ok={rowCount > 0} />
          <DataRow label="Fields configured" value={fieldCount.toString()} ok={fieldCount > 0} />
          <DataRow label="Schema confirmed" value={schemaReady ? 'Yes' : 'Pending'} ok={schemaReady} />
        </div>
      </div>

      {/* CTA */}
      {!schemaReady && (
        <Link href={'/analyze/' + datasetId + '/settings'}
          className="text-sm font-medium px-4 py-2 rounded-lg border border-orange-300 text-orange-600 hover:bg-orange-50 transition-colors">
          Configure schema in Settings
        </Link>
      )}
    </div>
  )
}

function DataRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-gray-600">{label}</span>
      <div className="flex items-center gap-1.5">
        <span className={"font-medium " + (ok ? 'text-gray-900' : 'text-amber-600')}>{value}</span>
        <span className={"w-2 h-2 rounded-full " + (ok ? 'bg-green-400' : 'bg-amber-300')} />
      </div>
    </div>
  )
}
