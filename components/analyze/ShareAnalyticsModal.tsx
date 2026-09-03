'use client'

// components/analyze/ShareAnalyticsModal.tsx
// Thin wrapper around unified ShareModal — passes analytics metadata (filters, includeThemes)

import ShareModal from '@/components/ui/ShareModal'
import DataStoryLinks from '@/components/analyze/DataStoryLinks'
import { useFilters } from '@/components/analyze/FilterContext'
import { serializeFilters } from '@/lib/filterUtils'

interface Props {
  datasetId: string
  datasetName: string
  onClose: () => void
}

export default function ShareAnalyticsModal({ datasetId, datasetName, onClose }: Props) {
  var { filters: activeFilters } = useFilters()
  var hasFilters = Object.keys(activeFilters).length > 0
  var serialized = hasFilters ? serializeFilters(activeFilters) : {}

  return (
    <ShareModal
      type="analytics"
      targetId={datasetId}
      title={datasetName}
      onClose={onClose}
      metadata={{
        dataset_id: datasetId,
        filters: serialized,
        label: datasetName,
        includeThemes: true,
      }}
      extra={<DataStoryLinks datasetId={datasetId} />}
    />
  )
}
