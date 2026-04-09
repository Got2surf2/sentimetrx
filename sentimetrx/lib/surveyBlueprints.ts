// lib/surveyBlueprints.ts
// Survey blueprint definitions — 7 study types with opening patterns, focus areas, and bot suggestions
// Core proprietary templates (version-controlled in code, not customizable by orgs)

export type StudyType =
  | 'satisfaction_experience'
  | 'nps_loyalty'
  | 'awareness_perception'
  | 'motivation_values'
  | 'churn_risk'
  | 'engagement_participation'
  | 'journey_touchpoint'

export interface SurveyBlueprint {
  id: string
  studyType: StudyType
  label: string
  description: string
  icon: string

  // Opening pattern control
  enableExperienceRating: boolean
  enableNPS: boolean
  openEndedDefault: 0 | 1 | 2

  // Focus areas pre-selected in wizard
  recommendedFocusAreas: string[]

  // Question count targets per length
  questionCounts: {
    quick: number
    standard: number
    comprehensive: number
  }

  // Bot name/emoji suggestions (3 options for user to choose from)
  botSuggestions: Array<{ name: string; emoji: string }>

  // Attribution metadata (IP protection)
  templateLabel: string
}

// ─────────────────────────────────────────────────────────────────────────────
// Blueprint Definitions (7 study types)
// ─────────────────────────────────────────────────────────────────────────────

export const STUDY_TYPE_BLUEPRINTS: Record<StudyType, SurveyBlueprint> = {
  // Rating first → experience rating, then follow-ups, then deep dive
  satisfaction_experience: {
    id: 'blueprint_satisfaction',
    studyType: 'satisfaction_experience',
    label: 'Satisfaction & Experience',
    description: 'Rate overall experience, then dig into what went well or could improve.',
    icon: '😊',
    enableExperienceRating: true,
    enableNPS: false,
    openEndedDefault: 1,
    recommendedFocusAreas: ['satisfaction', 'loyalty', 'communication'],
    questionCounts: { quick: 5, standard: 10, comprehensive: 15 },
    botSuggestions: [
      { name: 'Experience Guide', emoji: '😊' },
      { name: 'Feedback Friend', emoji: '⭐' },
      { name: 'Quality Coach', emoji: '📋' },
    ],
    templateLabel: 'Sentimetrx Satisfaction & Experience Template v1.0',
  },

  // NPS first → recommendation likelihood, then drivers
  nps_loyalty: {
    id: 'blueprint_nps',
    studyType: 'nps_loyalty',
    label: 'NPS & Loyalty',
    description: 'Measure likelihood to recommend, identify promoters vs detractors, and discover retention drivers.',
    icon: '❤️',
    enableExperienceRating: false,
    enableNPS: true,
    openEndedDefault: 1,
    recommendedFocusAreas: ['retention', 'loyalty', 'communication'],
    questionCounts: { quick: 5, standard: 10, comprehensive: 15 },
    botSuggestions: [
      { name: 'Loyalty Ally', emoji: '❤️' },
      { name: 'Retention Bot', emoji: '🔄' },
      { name: 'Growth Guide', emoji: '📈' },
    ],
    templateLabel: 'Sentimetrx NPS & Loyalty Template v1.0',
  },

  // Open first (unaided) → prompted questions → perception
  awareness_perception: {
    id: 'blueprint_awareness',
    studyType: 'awareness_perception',
    label: 'Awareness & Perception',
    description: 'Start with open-ended unaided awareness, then explore misconceptions and perception shifts.',
    icon: '🔍',
    enableExperienceRating: false,
    enableNPS: false,
    openEndedDefault: 2,
    recommendedFocusAreas: ['civic_mindset', 'motivation', 'engagement'],
    questionCounts: { quick: 5, standard: 12, comprehensive: 18 },
    botSuggestions: [
      { name: 'Insight Ally', emoji: '🔍' },
      { name: 'Awareness Bot', emoji: '💡' },
      { name: 'Perception Guide', emoji: '🧠' },
    ],
    templateLabel: 'Sentimetrx Awareness & Perception Template v1.0',
  },

  // Open first ("why?") → importance scaling → segmentation
  motivation_values: {
    id: 'blueprint_motivation',
    studyType: 'motivation_values',
    label: 'Motivation & Values',
    description: 'Understand what drives engagement, measure importance of key factors, and identify value alignment.',
    icon: '⭐',
    enableExperienceRating: false,
    enableNPS: false,
    openEndedDefault: 1,
    recommendedFocusAreas: ['motivation', 'legacy_giving', 'donor_capacity'],
    questionCounts: { quick: 5, standard: 12, comprehensive: 17 },
    botSuggestions: [
      { name: 'Impact Ally', emoji: '🎯' },
      { name: 'Values Bot', emoji: '💝' },
      { name: 'Mission Partner', emoji: '🤝' },
    ],
    templateLabel: 'Sentimetrx Motivation & Values Template v1.0',
  },

  // Rating → risk factors → growth levers
  churn_risk: {
    id: 'blueprint_churn',
    studyType: 'churn_risk',
    label: 'Churn & Risk',
    description: 'Identify what might cause someone to leave, then uncover what would drive them to increase their engagement.',
    icon: '🚨',
    enableExperienceRating: true,
    enableNPS: false,
    openEndedDefault: 1,
    recommendedFocusAreas: ['retention', 'motivation', 'communication'],
    questionCounts: { quick: 5, standard: 10, comprehensive: 15 },
    botSuggestions: [
      { name: 'Retention Coach', emoji: '🔄' },
      { name: 'Growth Guide', emoji: '📈' },
      { name: 'Risk Radar', emoji: '🚨' },
    ],
    templateLabel: 'Sentimetrx Churn & Risk Template v1.0',
  },

  // Rating → interest & capacity → barriers to deeper engagement
  engagement_participation: {
    id: 'blueprint_engagement',
    studyType: 'engagement_participation',
    label: 'Engagement & Participation',
    description: 'Gauge interest in deeper involvement (volunteering, membership, etc.) and identify participation barriers.',
    icon: '🤝',
    enableExperienceRating: true,
    enableNPS: false,
    openEndedDefault: 1,
    recommendedFocusAreas: ['engagement', 'recognition', 'loyalty'],
    questionCounts: { quick: 5, standard: 10, comprehensive: 15 },
    botSuggestions: [
      { name: 'Engagement Bot', emoji: '🤝' },
      { name: 'Participation Guide', emoji: '⚡' },
      { name: 'Connection Coach', emoji: '🌟' },
    ],
    templateLabel: 'Sentimetrx Engagement & Participation Template v1.0',
  },

  // Open first (recall) → touchpoint evaluation → moment attribution
  journey_touchpoint: {
    id: 'blueprint_journey',
    studyType: 'journey_touchpoint',
    label: 'Journey & Touchpoint',
    description: 'Start with unaided recall of their journey, then evaluate specific touchpoints and moments of truth.',
    icon: '🗺️',
    enableExperienceRating: false,
    enableNPS: false,
    openEndedDefault: 2,
    recommendedFocusAreas: ['satisfaction', 'engagement', 'communication'],
    questionCounts: { quick: 5, standard: 12, comprehensive: 18 },
    botSuggestions: [
      { name: 'Journey Guide', emoji: '🗺️' },
      { name: 'Experience Mapper', emoji: '📍' },
      { name: 'Touchpoint Bot', emoji: '🎯' },
    ],
    templateLabel: 'Sentimetrx Journey & Touchpoint Template v1.0',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Display Labels
// ─────────────────────────────────────────────────────────────────────────────

export const STUDY_TYPE_LABELS: Record<
  StudyType,
  { label: string; description: string; icon: string }
> = {
  satisfaction_experience: {
    label: 'Satisfaction & Experience',
    description: 'Understand what customers/users think about their experience and where to improve.',
    icon: '😊',
  },
  nps_loyalty: {
    label: 'NPS & Loyalty',
    description: 'Measure likelihood to recommend and identify drivers of advocacy.',
    icon: '❤️',
  },
  awareness_perception: {
    label: 'Awareness & Perception',
    description: 'Explore what people know about you and what misconceptions limit engagement.',
    icon: '🔍',
  },
  motivation_values: {
    label: 'Motivation & Values',
    description: 'Understand what drives engagement and how values align.',
    icon: '⭐',
  },
  churn_risk: {
    label: 'Churn & Risk',
    description: 'Identify risk factors and levers to increase engagement.',
    icon: '🚨',
  },
  engagement_participation: {
    label: 'Engagement & Participation',
    description: 'Uncover interest in deeper involvement and barriers to participation.',
    icon: '🤝',
  },
  journey_touchpoint: {
    label: 'Journey & Touchpoint',
    description: 'Map the customer journey and evaluate moments of truth.',
    icon: '🗺️',
  },
}

// ─────────────────────────────────────────────────────────────────────────────
// Lookup Function
// ─────────────────────────────────────────────────────────────────────────────

export function getBlueprintForStudyType(studyType: StudyType): SurveyBlueprint {
  return STUDY_TYPE_BLUEPRINTS[studyType]
}
