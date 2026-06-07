'use client'

// app/recordings/new/RecordingWizardClient.tsx
//
// Setup-before-media (§ 5.2). Thin wrapper around the shared Town Hall setup
// editor (components/recordings/RecordingSetupForm) in create mode. The form
// creates the recording in 'awaiting_media' (no files) and hands off to the
// status page, where AddRecordingClient attaches the media later.

import RecordingSetupForm, {
  type AgentOption,
  type MemberOption,
} from '@/components/recordings/RecordingSetupForm'

export type { AgentOption, MemberOption }

export default function RecordingWizardClient({
  agents = [], members = [],
}: {
  agents?: AgentOption[]
  members?: MemberOption[]
}) {
  return <RecordingSetupForm mode="create" agents={agents} members={members} />
}
