// app/analyze/[datasetId]/page.tsx
// Redirect to /textmine by default

import { redirect } from 'next/navigation'

interface Props { params: Promise<{ datasetId: string }> }

export default async function DatasetPage(props: Props) {
  const params = await props.params;
  redirect('/analyze/' + params.datasetId + '/textmine')
}
