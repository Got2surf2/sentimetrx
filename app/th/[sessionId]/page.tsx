import TownHallChat from './TownHallChat'

interface Props { params: Promise<{ sessionId: string }> }
export const dynamic = 'force-dynamic'

export default async function TownHallParticipantPage(props: Props) {
  const params = await props.params;
  return (
    <main style={{ height: '100dvh', overflow: 'hidden' }}>
      <TownHallChat sessionId={params.sessionId} />
    </main>
  )
}
