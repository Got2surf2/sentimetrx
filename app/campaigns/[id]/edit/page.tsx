import { redirect } from 'next/navigation'

export default function CampaignEditRedirect({ params }: { params: { id: string } }) {
  redirect('/campaigns/' + params.id)
}
