import { redirect } from 'next/navigation'

export default async function CampaignEditRedirect(props: { params: Promise<{ id: string }> }) {
  const params = await props.params;
  redirect('/campaigns/' + params.id)
}
