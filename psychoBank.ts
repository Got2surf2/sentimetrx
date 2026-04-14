// lib/psychoBank.ts
// General-purpose psychographic question bank — shared by surveys and town halls.
// Non-industry-specific questions suitable for any context.

import type { PsychoQuestion } from '@/lib/types'

export const GENERAL_PSYCHO_BANK: PsychoQuestion[] = [
  // Behaviour
  { key: 'b_frequency',   q: 'How often do you typically engage with us?',                       opts: ['This is my first time', 'A few times a year', 'Monthly', 'Weekly', 'Daily or almost daily'],       exportLabel: 'Engagement Frequency' },
  { key: 'b_channel',     q: 'What is your preferred way to interact with us?',                   opts: ['In person', 'Website', 'Mobile app', 'Phone', 'Email'],                                             exportLabel: 'Preferred Channel' },
  { key: 'b_duration',    q: 'How long have you been a customer or visitor?',                     opts: ['Less than 6 months', '6–12 months', '1–2 years', '3–5 years', 'More than 5 years'],                exportLabel: 'Customer Tenure' },
  { key: 'b_recency',     q: 'When was your last interaction with us before today?',              opts: ['Today was my first time', 'Within the last week', 'Within the last month', '1–3 months ago', 'More than 3 months ago'], exportLabel: 'Last Interaction' },
  { key: 'b_referral',    q: 'How did you first hear about us?',                                  opts: ['Friend or family recommendation', 'Social media', 'Online search', 'Advertisement', 'In person / walked by', 'Other'], exportLabel: 'Referral Source' },

  // Attitudes & Values
  { key: 'a_loyalty',     q: 'Which of the following best describes your loyalty to us?',        opts: ['I use you exclusively', 'You are my main choice but I use others', 'I use several providers equally', 'I have no strong preference'], exportLabel: 'Loyalty Level' },
  { key: 'a_trust',       q: 'What matters most to you when choosing a provider like us?',       opts: ['Price / value for money', 'Quality of service', 'Convenience / ease', 'Reputation and trust', 'Personalisation', 'Staff or people'], exportLabel: 'Decision Driver' },
  { key: 'a_priority',    q: 'What is most important to you in a great experience?',              opts: ['Speed and efficiency', 'Friendliness and warmth', 'Expertise and knowledge', 'Ease of the process', 'Going above and beyond'], exportLabel: 'Experience Priority' },
  { key: 'a_value',       q: 'How do you feel about the value you get for the price you pay?',   opts: ['Excellent value', 'Good value', 'Fair value', 'Slightly overpriced', 'Poor value'],                 exportLabel: 'Perceived Value' },
  { key: 'a_compare',     q: 'How do we compare to similar providers you have used?',            opts: ['Much better', 'Somewhat better', 'About the same', 'Somewhat worse', 'This is the only one I use'], exportLabel: 'Competitive Comparison' },

  // Media & Communication
  { key: 'm_social',      q: 'Which social media platforms do you use most?',                    opts: ['Facebook', 'Instagram', 'TikTok', 'X / Twitter', 'LinkedIn', 'YouTube', 'None'],                   exportLabel: 'Social Platforms' },
  { key: 'm_comms',       q: 'How do you prefer to receive updates and communications from us?', opts: ['Email', 'SMS / text', 'Push notification', 'Social media', 'In person', 'I prefer not to receive updates'], exportLabel: 'Comms Preference' },
  { key: 'm_content',     q: 'What type of content from us would you find most useful?',         opts: ['Offers and promotions', 'How-to guides and tips', 'Behind the scenes content', 'News and updates', 'Customer stories', 'None'], exportLabel: 'Preferred Content' },

  // Decision Making
  { key: 'd_influence',   q: 'Who else is typically involved when you decide to use us?',        opts: ['I decide alone', 'Partner or spouse', 'Family', 'Friends or colleagues', 'A manager or employer'],  exportLabel: 'Decision Influencer' },
  { key: 'd_trigger',     q: 'What triggered your decision to visit or use us today?',           opts: ['Planned in advance', 'Spontaneous decision', 'Recommended by someone', 'Saw an ad or promotion', 'Habit — I always come'], exportLabel: 'Visit Trigger' },
]
