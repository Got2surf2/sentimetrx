'use client'

import type { StepProps } from '@/lib/studyDraft'
import { Input, Section, Field, NavButtons } from './CreatorUI'

interface Props extends StepProps { onNext: () => void; onBack: () => void }

export default function StepClosing({ draft, updateConfig, onNext, onBack }: Props) {
  const c = draft.config

  return (
    <div className="flex flex-col gap-6">
      <Section title="Closing message" description="The thank-you message the bot sends after the respondent completes all questions.">
        <Field label="Bot message">
          <Input
            value={c.closingMessage || `Thank you so much -- ${draft.bot_name || 'the bot'} really appreciates you taking a moment to share. Your feedback makes a genuine difference. 💛`}
            onChange={v => updateConfig({ closingMessage: v })}
            multiline rows={3}
          />
        </Field>
      </Section>

      <Section title="Completion card" description="A styled card shown after the closing message to confirm the survey is complete.">
        <Field label="Card subtitle (shown below &quot;All done!&quot;)">
          <Input
            value={c.closingCard || 'Your responses have been saved. Thank you for your time.'}
            onChange={v => updateConfig({ closingCard: v })}
            multiline rows={2}
          />
        </Field>
      </Section>

      <NavButtons onBack={onBack} onNext={onNext} nextLabel="Next: Review" />
    </div>
  )
}
