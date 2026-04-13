import TownHallChat from './TownHallChat'

interface Props { params: { sessionId: string } }
export const dynamic = 'force-dynamic'

export default function TownHallParticipantPage({ params }: Props) {
  return <TownHallChat sessionId={params.sessionId} />
}
