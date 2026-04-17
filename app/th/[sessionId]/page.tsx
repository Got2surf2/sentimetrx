import TownHallChat from './TownHallChat'

interface Props { params: { sessionId: string } }
export const dynamic = 'force-dynamic'

export default function TownHallParticipantPage({ params }: Props) {
  return (
    <main style={{ height: '100dvh', overflow: 'hidden' }}>
      <TownHallChat sessionId={params.sessionId} />
    </main>
  )
}
