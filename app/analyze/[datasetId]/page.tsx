// app/analyze/[datasetId]/page.tsx
// Redirect to /textmine by default

import { redirect } from 'next/navigation'

interface Props { params: { datasetId: string } }

export default function DatasetPage({ params }: Props) {
  redirect('/analyze/' + params.datasetId + '/textmine')
}
