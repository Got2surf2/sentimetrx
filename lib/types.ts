// ============================================================
// SENTIMETRX -- Shared Types
// ============================================================

import type { StudyType } from './surveyBlueprints'
import type { Industry } from './industryDefaults'

export type ClientPlan = 'trial' | 'active' | 'suspended'
// ── Module feature flags ─────────────────────────────────────────────────────
// All false by default. Datanautix admin enables at org level; org admin at user level.
export interface ModuleFeatures {
  surveys?:       boolean   // Sarina conversational surveys
  analyze?:       boolean   // Ana text analytics (uploads)
  googleReviews?: boolean   // Google Reviews downloader
  reddit?:        boolean   // Reddit downloader
  substack?:      boolean   // Substack downloader
  townhall?:      boolean   // Town Hall live discussions
  campaigns?:     boolean   // Email campaigns
  bots?:          boolean   // Branded chatbots
}

export const MODULE_LABELS: Record<keyof ModuleFeatures, string> = {
  surveys:       'Surveys',
  analyze:       'Analytics',
  googleReviews: 'Google Reviews',
  reddit:        'Reddit',
  substack:      'Substack',
  townhall:      'SignalIQ',
  campaigns:     'Campaigns',
  bots:          'Agents',
}

export const MODULE_KEYS = Object.keys(MODULE_LABELS) as (keyof ModuleFeatures)[]

export interface OrgFeatures extends ModuleFeatures {
  primaryIndustries?: Industry[]
  defaultEmailProvider?: EmailProviderType
  aiProvider?: {
    provider: 'anthropic' | 'openai' | 'azure-openai'
    azureEndpoint?: string
    azureApiVersion?: string
  }
}

// User-level features — subset of org features. Stored in users.features JSONB.
export type UserFeatures = ModuleFeatures
// -- Likert / rating scale ------------------------------------

export interface RatingOption {
  score:  number
  emoji:  string
  label:  string
}

// Adaptive open-end follow-up attached to any Likert question
export interface LikertFollowUp {
  enabled:      boolean
  mode:         'shared' | 'per-response'  // shared = one prompt for all; per-response = unique per score
  exportLabel?: string                      // label for the verbatim in analytics/CSV exports
  // shared mode
  sharedPrompt: string
  shareClarify: boolean
  shareAI:      boolean
  // per-response mode -- keyed by score value (1-5 etc.)
  perResponse:  Record<string, {
    prompt:    string
    clarify:   boolean
    useAI:     boolean
  }>
}

// -- Custom survey questions -----------------------------------

export type QuestionType =
  | 'open'
  | 'radio'
  | 'checkbox'
  | 'dropdown'
  | 'likert'
  | 'date'
  | 'rating'   // numeric scale with fixed min/max (e.g. 1-5, 1-7, 0-10)
  | 'numeric'  // free numeric entry (age, spend, count)
  | 'hidden'   // hidden field populated via URL params (not shown to respondent)
  | 'email'    // email address with validation
  | 'phone'    // phone number (international support)
  | 'zip_code' // US ZIP code (5 or 5+4 format)
  | 'us_state' // US state dropdown (abbreviation)
  | 'message'  // bot message only — no response expected, auto-advances

export interface LikertScaleOption {
  score:  number
  emoji?: string
  label:  string
}

// Keyword-based follow-on trigger for open-ended questions (from Question Bank)
export interface KeywordTrigger {
  priority:   number
  keywords:   string[]
  follow_on:  string
}

export interface SurveyQuestion {
  id:           string         // uuid, generated at creation
  type:         QuestionType
  prompt:       string
  exportLabel?: string
  required?:    boolean
  // open-ended specific
  clarify?:     boolean          // enable keyword-based clarifiers
  useAI?:       boolean          // enable AI-based clarifiers
  keywordTriggers?:  KeywordTrigger[]   // keyword follow-on clusters (from Question Bank)
  defaultFollowOn?:  string             // default follow-on when no keywords match
  triggerType?:      string             // trigger category (e.g. 'dissatisfaction_probe')
  // close-ended specific (radio, checkbox, dropdown)
  options?:     string[]
  // likert specific
  likertScale?: LikertScaleOption[]
  followUp?:    LikertFollowUp
  // date specific
  dateFormat?:  'date' | 'datetime'   // default 'date'
  dateMin?:     string                // ISO date string e.g. '2020-01-01'
  dateMax?:     string                // ISO date string e.g. '2030-12-31'
  // rating scale specific (numeric scale with fixed min/max)
  ratingMin?:   number                // default 1
  ratingMax?:   number                // default 5
  // numeric input -- no extra fields needed; stores raw number as string
  // hidden field -- URL param key that maps to this field
  paramKey?:    string                // URL parameter name (e.g. 'recipient_id', 'source')
  // flow placement
  conversationPosition?: boolean      // if true, show after Q4 in conversation phase, not custom-Q phase
  // enabled/disabled
  enabled?: boolean                   // if false, question is skipped in survey; default true
  // skip logic — branch to another question based on answer
  skipLogic?: SkipRule[]
}

// Skip logic rule — evaluated after the question is answered
export interface SkipRule {
  condition: 'equals' | 'not_equals' | 'any_of' | 'none_of' | 'greater_than' | 'less_than'
  value:     string | string[]        // answer value(s) to match
  skipTo:    string                   // question ID to jump to, or '_end' to end survey
}

// -- Psychographics -------------------------------------------

export interface PsychoQuestion {
  key:          string
  q:            string
  opts:         string[]
  exportLabel?: string
}

// -- Theme ----------------------------------------------------

export interface StudyTheme {
  primaryColor:      string
  headerGradient:    string
  backgroundColor:   string
  accentColor:       string
  botAvatarGradient: string
}

export interface StudyClarifiers {
  [keyword: string]: string
  default: string
}

// -- Rating question type -------------------------------------
// Controls default prompt, emoji scale, follow-up text and dashboard label
// for the experience_rating opening item.
export type RatingType =
  | 'experience'   // overall experience (default)
  | 'familiarity'  // brand / product familiarity
  | 'satisfaction' // CSAT
  | 'value'        // value for money / time
  | 'quality'      // product / service quality
  | 'ease'         // effort / ease (CES)
  | 'intent'       // return / repurchase intent
  | 'perception'   // brand impression / awareness

// -- Opening flow ---------------------------------------------

export interface OpeningFlowItem {
  id:           string
  type:         'experience_rating' | 'nps' | 'open_end'
  // open_end only:
  prompt?:      string
  exportLabel?: string
  clarify?:     boolean
  useAI?:       boolean
}

// -- Study config ---------------------------------------------

export interface StudyConfig {
  greeting:           string

  // Header text (shown in the survey widget header bar)
  headerSubtitle?:    string           // default: study name — text below bot name in header
  headerStatus?:      string           // default: 'Ready for your feedback' — status line with green dot

  // Ready prompt (shown after greeting, before survey begins)
  readyPrompt?:       string           // default 'Are you ready to share your feedback?'
  readyYes?:          string           // default "Yes, let's go! 👍"
  readyNo?:           string           // default 'Not right now'

  // NPS (shown first)
  npsEnabled?:        boolean          // default true
  npsPrompt?:         string           // default 'How likely are you to recommend us...'
  npsLabel?:          string           // default 'NPS' -- dashboard card + CSV header
  npsFollowUp?:       LikertFollowUp   // adaptive open-end after NPS

  // Experience rating (shown after NPS Q1)
  experienceEnabled?: boolean          // default true
  ratingType?:        RatingType       // controls default prompt/scale/follow-ups; default 'experience'
  experienceRatingLabel?: string       // alias shown in analytics + CSV header (default: 'Experience Rating')
  ratingPrompt:       string
  ratingScale:        RatingOption[]
  experienceFollowUp?: LikertFollowUp  // adaptive open-end after experience rating
  ratingVariableId?:    string           // 'nps' | 'experience'
  ratingVariableLabel?: string           // display label for the primary variable

  // Sentiment-adapted open-ended Q1 (after NPS, before experience rating)
  promoterQ1?:        string  // legacy -- kept for existing studies
  passiveQ1?:         string
  detractorQ1?:       string
  q1ExportLabel?:     string  // legacy

  // Legacy open-ended Q3/Q4 (still supported, shown before custom questions)
  q3:                 string
  q3Required?:        boolean
  q3ExportLabel?:     string
  q3Clarify?:         boolean   // enable clarifier follow-up for Q3
  q3Enabled?:         boolean   // default true — set false to skip Q3 entirely
  q4:                 string
  q4Required?:        boolean
  q4ExportLabel?:     string
  q4Clarify?:         boolean   // enable clarifier follow-up for Q4
  q4Enabled?:         boolean   // default true — set false to skip Q4 entirely

  // Opening flow (drag-ordered): absent = legacy npsEnabled/experienceEnabled cascade
  openingFlow?:       OpeningFlowItem[]

  // Custom questions (drag-ordered)
  questions?:         SurveyQuestion[]

  // Clarifiers (used by legacy Q1/Q3/Q4 and open custom questions)
  clarifiers:         StudyClarifiers
  useAIClarify?:      boolean
  maxClarifierCount?: number           // max times a clarifier fires per session (default 5; 0 = unlimited)

  // Response control
  allowMultipleResponses?: boolean   // default true — multiple responses allowed; set false to limit to one per device

  // Psychographics
  psychographicBank:  PsychoQuestion[]
  psychoCount?:       number           // how many to randomly show per session (default 3)
  customQCount?:      number           // how many custom questions to show per session (default: all)
  industry?:          string           // industry key -- stored in config so it persists via JSONB
  otherIndustry?:     string           // free-text when industry === 'other'

  // Study type and blueprint metadata
  studyType?:         StudyType        // e.g. 'satisfaction_experience', 'awareness_perception'
  templateLabel?:     string           // attribution string: "Sentimetrx [Type] Template v1.0"

  theme:              StudyTheme

  // Branding
  brandingLabel?:     string           // default 'DATANAUTIX'; max 15 chars; empty string = no branding
  showBranding?:      boolean          // default true — show "by <label>" on survey hero

  // Input mode
  confirmBeforeRecord?: boolean        // default false (auto-record on tap); true = require confirm button for radio/likert/rating

  // Closing message — shown after all questions are complete
  closingMessage?:  string   // bot's thank-you message (default: "Thank you so much -- {bot_name} really appreciates...")
  closingCard?:     string   // card subtitle text (default: "Your responses have been saved. Thank you for your time.")

  // Question redirect — when respondent asks a question or goes off-topic, AI generates contextual redirect
  questionRedirect?: {
    enabled:  boolean
    message:  string   // custom instruction/tone for the AI deflection (e.g. "Redirect them warmly")
    linkText: string   // e.g. "our website" — leave empty to omit link
    linkUrl:  string   // e.g. "https://example.com/faq" — leave empty to omit link
  }

  // Section transition messages (shown between survey sections)
  sectionTransitions?: {
    customQuestions?:  { enabled: boolean; text: string }
    psychographics?:   { enabled: boolean; text: string }
    demographics?:     { enabled: boolean; text: string }
    contact?:          { enabled: boolean; text: string }
  }

  // Accessibility
  surveyFontSize?:    number           // base font size in px for survey widget (default 18)

  // Typing animation duration multiplier (0.5 = default, 0.25 = minimal, 1.0 = deliberate, 2.0 = slow)
  typingSpeed?:       number           // default 0.5

  // Testing mode — exposes AI thinking/reasoning inline with bot messages
  testing?:           boolean          // default false
  // Content safety — flag responses containing profanity, slurs, threats etc.
  // Flagged responses still saved (never blocked) — analyst can filter in/out in Ana.
  contentSafety?:     boolean          // default false
  // Debug mode: activated via ?debug=GUID in URL (study GUID is the password)

  // Multi-language support
  languages?:         string[]         // enabled language codes, e.g. ['en', 'es', 'fr']
  translations?:      Record<string, StudyTranslation> // keyed by language code
  autoTranslateResponses?: boolean     // default false — auto-translate non-English responses back to English on submission

  // Demographics
  demoFields?:        DemoField[]      // configurable demographic questions (default: age, gender, zip)

  // Contact info
  contactFields?:     ContactField[]   // configurable contact/address fields
  contactTransition?: { enabled: boolean; text: string }

  // Section ordering — controls the order of post-conversation sections
  // Default: ['customQuestions', 'psychographics', 'demographics', 'contact']
  sectionOrder?:      SectionKey[]
}

// -- Multi-language support ------------------------------------

export var SUPPORTED_LANGUAGES: { code: string; name: string; nativeName: string; confirmLabel: string }[] = [
  { code: 'en', name: 'English',    nativeName: 'English',    confirmLabel: 'Confirm' },
  { code: 'es', name: 'Spanish',    nativeName: 'Español',    confirmLabel: 'Confirmar' },
  { code: 'fr', name: 'French',     nativeName: 'Français',   confirmLabel: 'Confirmer' },
  { code: 'de', name: 'German',     nativeName: 'Deutsch',    confirmLabel: 'Bestätigen' },
  { code: 'pt', name: 'Portuguese', nativeName: 'Português',  confirmLabel: 'Confirmar' },
  { code: 'it', name: 'Italian',    nativeName: 'Italiano',   confirmLabel: 'Conferma' },
  { code: 'zh', name: 'Chinese',    nativeName: '中文',       confirmLabel: '确认' },
  { code: 'ja', name: 'Japanese',   nativeName: '日本語',     confirmLabel: '確認' },
  { code: 'ko', name: 'Korean',     nativeName: '한국어',     confirmLabel: '확인' },
  { code: 'ar', name: 'Arabic',     nativeName: 'العربية',    confirmLabel: 'تأكيد' },
  { code: 'hi', name: 'Hindi',      nativeName: 'हिन्दी',     confirmLabel: 'पुष्टि करें' },
  { code: 'vi', name: 'Vietnamese', nativeName: 'Tiếng Việt', confirmLabel: 'Xác nhận' },
  { code: 'tl', name: 'Filipino',   nativeName: 'Filipino',   confirmLabel: 'Kumpirmahin' },
  { code: 'ru', name: 'Russian',    nativeName: 'Русский',    confirmLabel: 'Подтвердить' },
  { code: 'pl', name: 'Polish',     nativeName: 'Polski',     confirmLabel: 'Potwierdź' },
]

// Built-in UI string translations — used as fallback when stored translation lacks the ui field
// These are universal survey chrome strings that don't depend on study content
export var BUILTIN_UI_TRANSLATIONS: Record<string, Record<string, string>> = {
  es: {
    readyPrompt: '¿Estás listo/a para compartir tu opinión?',
    readyYes: '¡Sí, vamos! 👍', readyNo: 'Ahora no',
    thankYouAck: 'No hay problema -- ¡gracias por tu tiempo! 😊',
    skip: 'Omitir', done: 'Listo', confirm: 'Confirmar', allDone: '¡Todo listo!',
    selectOption: 'Selecciona una opción...', sharePlaceholder: 'Comparte tus ideas...',
    selectAtLeastOne: 'Selecciona al menos una', clarifyPlaceholder: 'Puedes agregar un poco más...',
    'rating_Very poor': 'Muy malo', 'rating_Poor': 'Malo', 'rating_Okay': 'Regular', 'rating_Good': 'Bueno', 'rating_Excellent': 'Excelente',
    clarifierDefault: '¿Podrías contarme un poco más sobre eso?',
    'rating_Very unsatisfied': 'Muy insatisfecho', 'rating_Unsatisfied': 'Insatisfecho', 'rating_Neutral': 'Neutral', 'rating_Satisfied': 'Satisfecho', 'rating_Very satisfied': 'Muy satisfecho',
    'rating_Strongly disagree': 'Muy en desacuerdo', 'rating_Disagree': 'En desacuerdo', 'rating_Agree': 'De acuerdo', 'rating_Strongly agree': 'Muy de acuerdo',
    'nps_1 - No': '1 - No', 'nps_2 - Unlikely': '2 - Improbable', 'nps_3 - Maybe': '3 - Quizás', 'nps_4 - Likely': '4 - Probable', 'nps_5 - Definitely!': '5 - ¡Seguro!',
    transition_psychographics: 'Solo unas breves preguntas para completar -- nos ayuda a entender la variedad de personas que comparten su opinión.',
    transition_demographics: 'Ya casi terminamos -- un par de preguntas opcionales sobre ti. Totalmente voluntario.',
    transition_customQuestions: 'Ahora algunas preguntas más específicas.',
    transition_contact: 'Si deseas que te contactemos, comparte tus datos a continuación. Completamente opcional.',
    submitFeedback: 'Enviar mi opinión', continue: 'Continuar', optional: 'opcional',
    demo_age: 'Rango de edad', demo_gender: 'Género', demo_zip: 'Código postal',
    'demo_opt_male': 'Masculino', 'demo_opt_female': 'Femenino', 'demo_opt_nonbinary': 'No binario',
    'demo_opt_other': 'Prefiero describirme', 'demo_opt_prefer_not': 'Prefiero no decir',
    closingMessageDefault: '¡Muchas gracias por tomarte un momento para compartir tu opinión! Tu feedback realmente marca la diferencia. 💛',
    closingCardDefault: 'Tus respuestas han sido guardadas. ¡Gracias por tu tiempo!',
    ackDecline1: 'No hay problema -- gracias por ser honesto/a.',
    ackDecline2: 'Está bien -- gracias por hacérmelo saber.',
    ackDecline3: 'No te preocupes -- gracias por tu tiempo.',
    ackDecline4: 'Entendido -- sigamos adelante.',
    ackShort: 'Entendido -- gracias por compartir.',
    ackPositive: '¡Qué bueno escuchar eso -- gracias por compartir!',
    ackNegative: 'Agradecemos mucho que compartas eso -- nos ayuda a mejorar.',
    ackDefault1: 'Entendido -- eso es realmente útil.',
    ackDefault2: 'Gracias -- esa es una opinión muy valiosa.',
    ackDefault3: 'Agradecemos que compartas eso -- marca la diferencia.',
  },
  fr: {
    readyPrompt: 'Êtes-vous prêt(e) à partager votre avis ?',
    readyYes: 'Oui, allons-y ! 👍', readyNo: 'Pas maintenant',
    thankYouAck: 'Pas de souci -- merci pour votre temps ! 😊',
    skip: 'Passer', done: 'Terminé', confirm: 'Confirmer', allDone: 'Terminé !',
    selectOption: 'Sélectionnez une option...', sharePlaceholder: 'Partagez vos idées...',
    selectAtLeastOne: 'Sélectionnez au moins une option', clarifyPlaceholder: 'N\'hésitez pas à en dire plus...',
    'rating_Very poor': 'Très mauvais', 'rating_Poor': 'Mauvais', 'rating_Okay': 'Correct', 'rating_Good': 'Bon', 'rating_Excellent': 'Excellent',
    clarifierDefault: 'Pourriez-vous m\'en dire un peu plus à ce sujet ?',
    transition_psychographics: 'Encore quelques petites questions pour compléter -- cela nous aide à comprendre la diversité des personnes qui partagent leur avis.',
    transition_demographics: 'Presque terminé -- quelques questions optionnelles sur vous. C\'est entièrement facultatif.',
    submitFeedback: 'Envoyer mon avis', continue: 'Continuer', optional: 'facultatif',
    demo_age: 'Tranche d\'âge', demo_gender: 'Genre', demo_zip: 'Code postal',
    'demo_opt_male': 'Homme', 'demo_opt_female': 'Femme', 'demo_opt_nonbinary': 'Non-binaire',
    'demo_opt_other': 'Je préfère me décrire', 'demo_opt_prefer_not': 'Je préfère ne pas dire',
    closingMessageDefault: 'Merci beaucoup d\'avoir pris le temps de partager votre avis ! Votre feedback fait vraiment la différence. 💛',
    closingCardDefault: 'Vos réponses ont été enregistrées. Merci pour votre temps !',
    ackShort: 'Compris -- merci pour ce partage.',
    ackPositive: 'Ravi(e) de l\'entendre -- merci de partager !',
    ackNegative: 'Merci beaucoup de partager cela -- ça nous aide à comprendre ce qui doit changer.',
    ackDefault1: 'Compris -- c\'est vraiment utile.',
    ackDefault2: 'Merci -- c\'est un retour très précieux.',
    ackDefault3: 'Merci de partager cela -- ça fait la différence.',
  },
  de: {
    readyPrompt: 'Sind Sie bereit, Ihr Feedback zu teilen?',
    readyYes: 'Ja, los geht\'s! 👍', readyNo: 'Jetzt nicht',
    thankYouAck: 'Kein Problem -- danke für Ihre Zeit! 😊',
    skip: 'Überspringen', done: 'Fertig', confirm: 'Bestätigen', allDone: 'Geschafft!',
    selectOption: 'Option auswählen...', sharePlaceholder: 'Teilen Sie Ihre Gedanken...',
    selectAtLeastOne: 'Mindestens eine auswählen', clarifyPlaceholder: 'Gerne noch etwas mehr...',
    'rating_Very poor': 'Sehr schlecht', 'rating_Poor': 'Schlecht', 'rating_Okay': 'Okay', 'rating_Good': 'Gut', 'rating_Excellent': 'Ausgezeichnet',
    clarifierDefault: 'Könnten Sie mir etwas mehr darüber erzählen?',
    transition_psychographics: 'Nur noch ein paar kurze Fragen zum Abschluss -- das hilft uns, die Vielfalt der Teilnehmer besser zu verstehen.',
    transition_demographics: 'Fast geschafft -- ein paar optionale Fragen über Sie. Völlig freiwillig.',
    submitFeedback: 'Feedback absenden', continue: 'Weiter', optional: 'freiwillig',
    demo_age: 'Altersgruppe', demo_gender: 'Geschlecht', demo_zip: 'Postleitzahl',
    'demo_opt_male': 'Männlich', 'demo_opt_female': 'Weiblich', 'demo_opt_nonbinary': 'Nicht-binär',
    'demo_opt_other': 'Selbst beschreiben', 'demo_opt_prefer_not': 'Möchte ich nicht sagen',
    closingMessageDefault: 'Vielen Dank, dass Sie sich einen Moment Zeit genommen haben! Ihr Feedback macht wirklich einen Unterschied. 💛',
    closingCardDefault: 'Ihre Antworten wurden gespeichert. Vielen Dank für Ihre Zeit!',
    ackShort: 'Verstanden -- danke fürs Teilen.',
    ackPositive: 'Das freut uns zu hören -- danke fürs Teilen!',
    ackNegative: 'Vielen Dank, dass Sie das teilen -- es hilft uns zu verstehen, was sich ändern muss.',
    ackDefault1: 'Verstanden -- das ist wirklich hilfreich.',
    ackDefault2: 'Danke -- das ist sehr wertvolles Feedback.',
    ackDefault3: 'Danke fürs Teilen -- das macht einen Unterschied.',
  },
  pt: {
    readyPrompt: 'Você está pronto(a) para compartilhar sua opinião?',
    readyYes: 'Sim, vamos lá! 👍', readyNo: 'Agora não',
    thankYouAck: 'Sem problema -- obrigado(a) pelo seu tempo! 😊',
    skip: 'Pular', done: 'Concluído', confirm: 'Confirmar', allDone: 'Tudo pronto!',
    selectOption: 'Selecione uma opção...', sharePlaceholder: 'Compartilhe suas ideias...',
    selectAtLeastOne: 'Selecione pelo menos uma', clarifyPlaceholder: 'Fique à vontade para adicionar mais...',
    ackShort: 'Entendido -- obrigado(a) por compartilhar.',
    ackDefault1: 'Entendido -- isso é muito útil.',
    clarifierDefault: 'Poderia me contar um pouco mais sobre isso?',
    transition_psychographics: 'Só mais algumas perguntas rápidas para complementar -- nos ajuda a entender a variedade de pessoas compartilhando opiniões.',
    transition_demographics: 'Quase terminando -- algumas perguntas opcionais sobre você. Totalmente voluntário.',
    submitFeedback: 'Enviar meu feedback', continue: 'Continuar', optional: 'opcional',
    demo_age: 'Faixa etária', demo_gender: 'Gênero', demo_zip: 'CEP',
    closingMessageDefault: 'Muito obrigado(a) por dedicar um momento para compartilhar! Seu feedback faz toda a diferença. 💛',
    closingCardDefault: 'Suas respostas foram salvas. Obrigado(a) pelo seu tempo!',
  },
  it: {
    readyPrompt: 'Sei pronto/a a condividere il tuo feedback?',
    readyYes: 'Sì, andiamo! 👍', readyNo: 'Non ora',
    thankYouAck: 'Nessun problema -- grazie per il tuo tempo! 😊',
    skip: 'Salta', done: 'Fatto', confirm: 'Conferma', allDone: 'Tutto fatto!',
    selectOption: 'Seleziona un\'opzione...', sharePlaceholder: 'Condividi i tuoi pensieri...',
    selectAtLeastOne: 'Seleziona almeno una', clarifyPlaceholder: 'Sentiti libero/a di aggiungere altro...',
    ackShort: 'Capito -- grazie per aver condiviso.',
    ackDefault1: 'Capito -- è davvero utile.',
    clarifierDefault: 'Potresti dirmi un po\' di più al riguardo?',
    transition_psychographics: 'Solo qualche breve domanda per completare -- ci aiuta a capire la varietà di persone che condividono il loro feedback.',
    transition_demographics: 'Quasi finito -- un paio di domande facoltative su di te. Completamente opzionale.',
    submitFeedback: 'Invia il mio feedback', continue: 'Continua', optional: 'facoltativo',
    demo_age: 'Fascia d\'età', demo_gender: 'Genere', demo_zip: 'CAP',
    closingMessageDefault: 'Grazie mille per aver dedicato un momento a condividere! Il tuo feedback fa davvero la differenza. 💛',
    closingCardDefault: 'Le tue risposte sono state salvate. Grazie per il tuo tempo!',
  },
  zh: {
    readyPrompt: '您准备好分享您的反馈了吗？',
    readyYes: '是的，开始吧！👍', readyNo: '现在不了',
    thankYouAck: '没关系——感谢您的时间！😊',
    skip: '跳过', done: '完成', confirm: '确认', allDone: '全部完成！',
    selectOption: '请选择...', sharePlaceholder: '分享您的想法...',
    selectAtLeastOne: '至少选择一个', clarifyPlaceholder: '可以再补充一些...',
    ackShort: '收到——感谢分享。',
    ackDefault1: '收到——这非常有帮助。',
    clarifierDefault: '能再多说一些吗？',
    transition_psychographics: '再回答几个简短的问题——这有助于我们了解分享反馈的人群多样性。',
    transition_demographics: '快完成了——几个关于您的可选问题。完全自愿。',
    submitFeedback: '提交我的反馈', continue: '继续', optional: '可选',
    demo_age: '年龄段', demo_gender: '性别', demo_zip: '邮编',
    closingMessageDefault: '非常感谢您抽出时间分享！您的反馈真的很重要。💛',
    closingCardDefault: '您的回答已保存。感谢您的时间！',
  },
  ja: {
    readyPrompt: 'フィードバックを共有する準備はできましたか？',
    readyYes: 'はい、始めましょう！👍', readyNo: '今はやめておきます',
    thankYouAck: '大丈夫です——お時間ありがとうございます！😊',
    skip: 'スキップ', done: '完了', confirm: '確認', allDone: '完了しました！',
    selectOption: 'オプションを選択...', sharePlaceholder: 'ご意見をお聞かせください...',
    selectAtLeastOne: '少なくとも1つ選択してください', clarifyPlaceholder: 'もう少し詳しく...',
    ackShort: '承知しました——共有いただきありがとうございます。',
    ackDefault1: '承知しました——とても参考になります。',
    clarifierDefault: 'もう少し詳しく教えていただけますか？',
    transition_psychographics: 'あと少しだけ質問があります——フィードバックを共有してくださる方々の多様性を理解するのに役立ちます。',
    transition_demographics: 'もう少しで終わりです——あなたについての任意の質問です。完全に自由です。',
    submitFeedback: 'フィードバックを送信', continue: '続ける', optional: '任意',
    demo_age: '年齢層', demo_gender: '性別', demo_zip: '郵便番号',
    closingMessageDefault: 'フィードバックを共有していただきありがとうございます！皆様のご意見が本当に大きな違いを生みます。💛',
    closingCardDefault: 'ご回答は保存されました。お時間いただきありがとうございました！',
  },
  ko: {
    readyPrompt: '피드백을 공유할 준비가 되셨나요?',
    readyYes: '네, 시작합시다! 👍', readyNo: '지금은 아니요',
    thankYouAck: '괜찮습니다 -- 시간 내주셔서 감사합니다! 😊',
    skip: '건너뛰기', done: '완료', confirm: '확인', allDone: '모두 완료!',
    selectOption: '옵션을 선택하세요...', sharePlaceholder: '의견을 공유해 주세요...',
    selectAtLeastOne: '하나 이상 선택해 주세요', clarifyPlaceholder: '좀 더 말씀해 주세요...',
    ackShort: '알겠습니다 -- 공유해 주셔서 감사합니다.',
    ackDefault1: '알겠습니다 -- 정말 도움이 됩니다.',
    clarifierDefault: '그것에 대해 좀 더 말씀해 주시겠어요?',
    transition_psychographics: '몇 가지 간단한 질문만 더 하겠습니다 -- 피드백을 공유하는 분들의 다양성을 이해하는 데 도움이 됩니다.',
    transition_demographics: '거의 다 끝났습니다 -- 선택 사항인 몇 가지 질문입니다. 완전히 자유입니다.',
    submitFeedback: '피드백 제출', continue: '계속', optional: '선택',
    demo_age: '연령대', demo_gender: '성별', demo_zip: '우편번호',
    closingMessageDefault: '의견을 공유해 주셔서 정말 감사합니다! 여러분의 피드백이 큰 차이를 만듭니다. 💛',
    closingCardDefault: '응답이 저장되었습니다. 시간 내주셔서 감사합니다!',
  },
  ar: {
    readyPrompt: 'هل أنت مستعد لمشاركة رأيك؟',
    readyYes: 'نعم، لنبدأ! 👍', readyNo: 'ليس الآن',
    thankYouAck: 'لا مشكلة -- شكراً لوقتك! 😊',
    skip: 'تخطي', done: 'تم', confirm: 'تأكيد', allDone: 'انتهينا!',
    selectOption: 'اختر خياراً...', sharePlaceholder: 'شارك أفكارك...',
    ackShort: 'فهمت -- شكراً للمشاركة.',
    ackDefault1: 'فهمت -- هذا مفيد حقاً.',
    clarifierDefault: 'هل يمكنك إخباري بالمزيد عن ذلك؟',
    transition_psychographics: 'بضعة أسئلة سريعة فقط لإكمال الصورة -- تساعدنا في فهم تنوع الأشخاص الذين يشاركون آراءهم.',
    transition_demographics: 'شارفنا على الانتهاء -- بعض الأسئلة الاختيارية عنك. اختياري تماماً.',
    submitFeedback: 'إرسال ملاحظاتي', continue: 'متابعة', optional: 'اختياري',
    demo_age: 'الفئة العمرية', demo_gender: 'الجنس', demo_zip: 'الرمز البريدي',
    closingMessageDefault: 'شكراً جزيلاً لتخصيص وقتك لمشاركة رأيك! ملاحظاتك تحدث فرقاً حقيقياً. 💛',
    closingCardDefault: 'تم حفظ إجاباتك. شكراً لوقتك!',
  },
  hi: {
    readyPrompt: 'क्या आप अपनी प्रतिक्रिया साझा करने के लिए तैयार हैं?',
    readyYes: 'हाँ, चलिए! 👍', readyNo: 'अभी नहीं',
    thankYouAck: 'कोई बात नहीं -- आपके समय के लिए धन्यवाद! 😊',
    skip: 'छोड़ें', done: 'पूर्ण', confirm: 'पुष्टि करें', allDone: 'सब हो गया!',
    selectOption: 'एक विकल्प चुनें...', sharePlaceholder: 'अपने विचार साझा करें...',
    ackShort: 'समझ गए -- साझा करने के लिए धन्यवाद।',
    ackDefault1: 'समझ गए -- यह वाकई उपयोगी है।',
    clarifierDefault: 'क्या आप इसके बारे में थोड़ा और बता सकते हैं?',
    transition_psychographics: 'बस कुछ और छोटे सवाल -- इससे हमें समझने में मदद मिलती है कि किस तरह के लोग अपनी राय साझा कर रहे हैं।',
    transition_demographics: 'लगभग हो गया -- आपके बारे में कुछ वैकल्पिक सवाल। पूरी तरह से आपकी मर्ज़ी।',
    submitFeedback: 'मेरी प्रतिक्रिया सबमिट करें', continue: 'जारी रखें', optional: 'वैकल्पिक',
    demo_age: 'आयु वर्ग', demo_gender: 'लिंग', demo_zip: 'पिन कोड',
    closingMessageDefault: 'अपनी राय साझा करने के लिए बहुत-बहुत धन्यवाद! आपकी प्रतिक्रिया सच में फर्क डालती है। 💛',
    closingCardDefault: 'आपके उत्तर सहेज लिए गए हैं। आपके समय के लिए धन्यवाद!',
  },
  vi: {
    readyPrompt: 'Bạn đã sẵn sàng chia sẻ ý kiến chưa?',
    readyYes: 'Có, bắt đầu thôi! 👍', readyNo: 'Không phải bây giờ',
    thankYouAck: 'Không sao -- cảm ơn bạn đã dành thời gian! 😊',
    skip: 'Bỏ qua', done: 'Xong', confirm: 'Xác nhận', allDone: 'Hoàn tất!',
    selectOption: 'Chọn một tùy chọn...', sharePlaceholder: 'Chia sẻ suy nghĩ của bạn...',
    ackShort: 'Đã nhận -- cảm ơn bạn đã chia sẻ.',
    ackDefault1: 'Đã nhận -- điều này thực sự hữu ích.',
    clarifierDefault: 'Bạn có thể cho tôi biết thêm về điều đó không?',
    transition_psychographics: 'Chỉ thêm vài câu hỏi ngắn nữa -- giúp chúng tôi hiểu sự đa dạng của những người chia sẻ ý kiến.',
    transition_demographics: 'Sắp xong rồi -- vài câu hỏi tùy chọn về bạn. Hoàn toàn tự nguyện.',
    submitFeedback: 'Gửi ý kiến của tôi', continue: 'Tiếp tục', optional: 'tùy chọn',
    demo_age: 'Độ tuổi', demo_gender: 'Giới tính', demo_zip: 'Mã bưu chính',
    closingMessageDefault: 'Cảm ơn bạn rất nhiều vì đã dành thời gian chia sẻ! Ý kiến của bạn thực sự tạo nên sự khác biệt. 💛',
    closingCardDefault: 'Câu trả lời của bạn đã được lưu. Cảm ơn bạn!',
  },
  tl: {
    readyPrompt: 'Handa ka na bang ibahagi ang iyong feedback?',
    readyYes: 'Oo, tara na! 👍', readyNo: 'Hindi muna ngayon',
    thankYouAck: 'Okay lang -- salamat sa iyong oras! 😊',
    skip: 'Laktawan', done: 'Tapos', confirm: 'Kumpirmahin', allDone: 'Tapos na lahat!',
    selectOption: 'Pumili ng opsyon...', sharePlaceholder: 'Ibahagi ang iyong mga saloobin...',
    ackShort: 'Nakuha -- salamat sa pagbabahagi.',
    ackDefault1: 'Nakuha -- talagang nakakatulong iyan.',
    clarifierDefault: 'Maaari mo bang sabihin pa sa akin ang tungkol doon?',
    transition_psychographics: 'Ilan pang maikling tanong para makumpleto -- nakakatulong ito para maintindihan namin ang iba\'t ibang uri ng taong nagbabahagi ng kanilang opinyon.',
    transition_demographics: 'Malapit na -- ilang opsyonal na tanong tungkol sa iyo. Ganap na boluntaryo.',
    submitFeedback: 'Isumite ang aking feedback', continue: 'Magpatuloy', optional: 'opsyonal',
    demo_age: 'Saklaw ng edad', demo_gender: 'Kasarian', demo_zip: 'Zip code',
    closingMessageDefault: 'Maraming salamat sa pagbabahagi ng iyong opinyon! Ang iyong feedback ay tunay na nakakatulong. 💛',
    closingCardDefault: 'Nai-save na ang iyong mga sagot. Salamat sa iyong oras!',
  },
  ru: {
    readyPrompt: 'Вы готовы поделиться своим мнением?',
    readyYes: 'Да, начнём! 👍', readyNo: 'Не сейчас',
    thankYouAck: 'Ничего страшного -- спасибо за ваше время! 😊',
    skip: 'Пропустить', done: 'Готово', confirm: 'Подтвердить', allDone: 'Всё готово!',
    selectOption: 'Выберите вариант...', sharePlaceholder: 'Поделитесь своими мыслями...',
    ackShort: 'Понял -- спасибо, что поделились.',
    ackDefault1: 'Понял -- это действительно полезно.',
    clarifierDefault: 'Не могли бы вы рассказать об этом чуть подробнее?',
    transition_psychographics: 'Ещё несколько коротких вопросов для полноты картины -- это помогает нам понять разнообразие людей, делящихся мнением.',
    transition_demographics: 'Почти готово -- пара необязательных вопросов о вас. Полностью добровольно.',
    submitFeedback: 'Отправить отзыв', continue: 'Продолжить', optional: 'необязательно',
    demo_age: 'Возрастная группа', demo_gender: 'Пол', demo_zip: 'Почтовый индекс',
    closingMessageDefault: 'Большое спасибо за то, что уделили время и поделились мнением! Ваш отзыв действительно важен. 💛',
    closingCardDefault: 'Ваши ответы сохранены. Спасибо за ваше время!',
  },
  pl: {
    readyPrompt: 'Czy jesteś gotowy/a podzielić się swoją opinią?',
    readyYes: 'Tak, zaczynajmy! 👍', readyNo: 'Nie teraz',
    thankYouAck: 'Nie ma problemu -- dziękujemy za Twój czas! 😊',
    skip: 'Pomiń', done: 'Gotowe', confirm: 'Potwierdź', allDone: 'Wszystko gotowe!',
    selectOption: 'Wybierz opcję...', sharePlaceholder: 'Podziel się swoimi przemyśleniami...',
    ackShort: 'Rozumiem -- dziękuję za podzielenie się.',
    ackDefault1: 'Rozumiem -- to naprawdę pomocne.',
    clarifierDefault: 'Czy mógłbyś/mogłabyś powiedzieć mi trochę więcej na ten temat?',
    transition_psychographics: 'Jeszcze kilka krótkich pytań na zakończenie -- pomaga nam to zrozumieć różnorodność osób dzielących się opinią.',
    transition_demographics: 'Prawie koniec -- kilka opcjonalnych pytań o Tobie. Całkowicie dobrowolne.',
    submitFeedback: 'Wyślij moją opinię', continue: 'Kontynuuj', optional: 'opcjonalne',
    demo_age: 'Przedział wiekowy', demo_gender: 'Płeć', demo_zip: 'Kod pocztowy',
    closingMessageDefault: 'Dziękujemy bardzo za poświęcenie chwili na podzielenie się opinią! Twój feedback naprawdę robi różnicę. 💛',
    closingCardDefault: 'Twoje odpowiedzi zostały zapisane. Dziękujemy za Twój czas!',
  },
}

// Translated content for a single language
export interface StudyTranslation {
  greeting:        string
  q3?:             string
  q4?:             string
  promoterQ1?:     string
  passiveQ1?:      string
  detractorQ1?:    string
  ratingPrompt?:   string
  npsPrompt?:      string
  closingMessage?: string
  closingCard?:    string
  readyPrompt?:    string
  readyYes?:       string
  readyNo?:        string
  contactTransition?: string
  questions?:      Record<string, { prompt: string; options?: string[]; likertLabels?: string[] }>  // keyed by question ID
  psychographics?: Record<string, { q: string; opts: string[] }>          // keyed by psycho key
  // Adaptive follow-up prompts
  followUps?:      Record<string, { sharedPrompt?: string; perResponse?: Record<string, string> }>
  // Opening flow open-end prompts (keyed by item ID)
  openingFlow?:    Record<string, string>
  // Demographic field labels & option labels
  demoLabels?:     Record<string, string>       // keyed by field key → translated label
  demoOptions?:    Record<string, string[]>      // keyed by field key → translated option display labels
  // Contact field labels
  contactLabels?:  Record<string, string>        // keyed by field key → translated label
  // UI chrome strings
  ui?: {
    readyPrompt?:    string   // "Are you ready to share your feedback?"
    readyYes?:       string   // "Yes, let's go! 👍"
    readyNo?:        string   // "Not right now"
    thankYouAck?:    string   // "No problem at all -- thanks for your time! 😊"
    skip?:           string   // "Skip"
    done?:           string   // "Done"
    confirm?:        string   // "Confirm"
    allDone?:        string   // "All done!"
    selectOption?:   string   // "Select an option..."
    sharePlaceholder?: string // "Share your thoughts..."
    ratingLabels?:   Record<string, string>  // keyed by English label → translated label
    npsLabels?:      Record<string, string>  // keyed by English label → translated label
    transitions?:    Record<string, string>  // keyed by section key → translated transition text
  }
}

// Section ordering
export type SectionKey = 'customQuestions' | 'psychographics' | 'demographics' | 'contact'

// Contact field config
export type ContactFieldType = 'email' | 'phone' | 'zip_code' | 'us_state' | 'text'

export interface ContactField {
  key:        string
  label:      string
  type:       ContactFieldType
  enabled:    boolean
  required?:  boolean
  placeholder?: string
}

// US states for dropdown
export var US_STATES: [string, string][] = [
  ['AL','Alabama'],['AK','Alaska'],['AZ','Arizona'],['AR','Arkansas'],['CA','California'],
  ['CO','Colorado'],['CT','Connecticut'],['DE','Delaware'],['FL','Florida'],['GA','Georgia'],
  ['HI','Hawaii'],['ID','Idaho'],['IL','Illinois'],['IN','Indiana'],['IA','Iowa'],
  ['KS','Kansas'],['KY','Kentucky'],['LA','Louisiana'],['ME','Maine'],['MD','Maryland'],
  ['MA','Massachusetts'],['MI','Michigan'],['MN','Minnesota'],['MS','Mississippi'],['MO','Missouri'],
  ['MT','Montana'],['NE','Nebraska'],['NV','Nevada'],['NH','New Hampshire'],['NJ','New Jersey'],
  ['NM','New Mexico'],['NY','New York'],['NC','North Carolina'],['ND','North Dakota'],['OH','Ohio'],
  ['OK','Oklahoma'],['OR','Oregon'],['PA','Pennsylvania'],['RI','Rhode Island'],['SC','South Carolina'],
  ['SD','South Dakota'],['TN','Tennessee'],['TX','Texas'],['UT','Utah'],['VT','Vermont'],
  ['VA','Virginia'],['WA','Washington'],['WV','West Virginia'],['WI','Wisconsin'],['WY','Wyoming'],
  ['DC','District of Columbia'],
]

// Default contact fields bank
export var CONTACT_BANK: ContactField[] = [
  { key: 'name',      label: 'Full Name',       type: 'text',     enabled: false, placeholder: 'Jane Smith' },
  { key: 'email',     label: 'Email Address',    type: 'email',    enabled: false, placeholder: 'you@example.com' },
  { key: 'phone',     label: 'Phone Number',     type: 'phone',    enabled: false, placeholder: '+1 (555) 123-4567' },
  { key: 'address1',  label: 'Street Address',   type: 'text',     enabled: false, placeholder: '123 Main St' },
  { key: 'address2',  label: 'Apt / Suite',      type: 'text',     enabled: false, placeholder: 'Apt 4B' },
  { key: 'city',      label: 'City',             type: 'text',     enabled: false, placeholder: 'City' },
  { key: 'state',     label: 'State',            type: 'us_state', enabled: false },
  { key: 'zip_code',  label: 'ZIP Code',         type: 'zip_code', enabled: false, placeholder: '12345' },
]

// Contact field validation
export function validateContactField(type: ContactFieldType, value: string): string | null {
  if (!value.trim()) return null  // empty is OK (optional unless required)
  switch (type) {
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? null : 'Please enter a valid email address'
    case 'phone':
      // Strip formatting, require at least 7 digits
      const digits = value.replace(/\D/g, '')
      return digits.length >= 7 ? null : 'Please enter a valid phone number'
    case 'zip_code':
      return /^\d{5}(-\d{4})?$/.test(value.trim()) ? null : 'Please enter a valid ZIP code (e.g. 12345)'
    case 'us_state':
      return US_STATES.some(([abbr]) => abbr === value) ? null : 'Please select a state'
    default:
      return null
  }
}

// Demographics field config
export interface DemoField {
  key:       string
  label:     string
  type:      'select' | 'text'
  options?:  [string, string][]      // [value, displayLabel] pairs for select fields
  enabled:   boolean
}

// Default demographics bank — all available demographic fields
export var DEMO_BANK: DemoField[] = [
  { key: 'age',        label: 'Age Range',        type: 'select', enabled: true,  options: [['18-24','18-24'],['25-34','25-34'],['35-44','35-44'],['45-54','45-54'],['55-64','55-64'],['65+','65 or over']] },
  { key: 'gender',     label: 'Gender',           type: 'select', enabled: true,  options: [['male','Male'],['female','Female'],['nonbinary','Non-binary'],['other','Prefer to self-describe'],['prefer_not','Prefer not to say']] },
  { key: 'zip',        label: 'ZIP / Postal Code', type: 'text',  enabled: true  },
  { key: 'income',     label: 'Household Income', type: 'select', enabled: false, options: [['under_25k','Under $25,000'],['25k_50k','$25,000–$49,999'],['50k_75k','$50,000–$74,999'],['75k_100k','$75,000–$99,999'],['100k_150k','$100,000–$149,999'],['150k_plus','$150,000 or more'],['prefer_not','Prefer not to say']] },
  { key: 'education',  label: 'Education Level',  type: 'select', enabled: false, options: [['high_school','High school or less'],['some_college','Some college'],['associates','Associate degree'],['bachelors','Bachelor\'s degree'],['masters','Master\'s degree'],['doctoral','Doctoral or professional'],['prefer_not','Prefer not to say']] },
  { key: 'ethnicity',  label: 'Ethnicity',        type: 'select', enabled: false, options: [['white','White'],['black','Black or African American'],['hispanic','Hispanic or Latino'],['asian','Asian'],['native','Native American or Alaska Native'],['pacific','Native Hawaiian or Pacific Islander'],['multi','Two or more races'],['other','Other'],['prefer_not','Prefer not to say']] },
  { key: 'employment', label: 'Employment Status', type: 'select', enabled: false, options: [['full_time','Full-time'],['part_time','Part-time'],['self_employed','Self-employed'],['student','Student'],['retired','Retired'],['unemployed','Not employed'],['prefer_not','Prefer not to say']] },
  { key: 'marital',    label: 'Marital Status',   type: 'select', enabled: false, options: [['single','Single'],['married','Married'],['domestic','Domestic partnership'],['divorced','Divorced'],['widowed','Widowed'],['prefer_not','Prefer not to say']] },
  { key: 'household',  label: 'Household Size',   type: 'select', enabled: false, options: [['1','1 person'],['2','2 people'],['3','3 people'],['4','4 people'],['5_plus','5 or more']] },
  { key: 'state',      label: 'State / Region',   type: 'text',   enabled: false },
]

// -- Study row ------------------------------------------------

export interface Study {
  id:          string
  guid:        string
  slug?:       string           // custom URL slug — e.g. 'acme-feedback-2026'
  name:        string
  bot_name:    string
  bot_emoji:   string
  status:      'draft' | 'active' | 'closed'
  visibility:  'public' | 'private'
  config:      StudyConfig
  created_by:  string
  org_id:      string
  client_id:   string
  created_at:  string
}

// -- Survey payload (saved to DB) -----------------------------

export type Sentiment = 'positive' | 'neutral' | 'negative'

export interface SurveyPayload {
  agent:            string
  timestamp:        string
  language?:        string                  // language code the survey was conducted in (e.g. 'hi', 'es')
  npsRecommend:     { score: number; label: string }
  experienceRating: { score: number; label: string; sentiment: Sentiment }
  openEnded:        { q1: string; q2: string; q3: string; q4: string }
  openEndedOriginal?: { q1: string; q2: string; q3: string; q4: string }  // original non-English responses before translation
  customAnswers?:   Record<string, string | string[]>   // keyed by SurveyQuestion.id
  customAnswersOriginal?: Record<string, string | string[]>  // original non-English before translation
  psychographics:    Record<string, string>
  demographics:      Record<string, string>
  contactInfo?:      Record<string, string>
  conversationLog?:  Array<{ who: 'bot' | 'user'; text: string; ai?: boolean }>
}

export interface SubmitResponseBody {
  study_guid:      string
  payload:         Partial<SurveyPayload>
  duration_sec:    number
  session_id?:     string
  status?:         'incomplete' | 'complete'
  recipient_guid?: string
}

// -- Campaign Manager types -----------------------------------

export type EmailProviderType = 'resend' | 'sendgrid' | 'ses' | 'smtp'
export type CampaignChannel = 'email' | 'sms' | 'both'

export type CampaignStatus = 'draft' | 'scheduled' | 'active' | 'paused' | 'completed'

export type RespondentStatus = 'pending' | 'sent' | 'opened' | 'clicked' | 'completed' | 'bounced' | 'unsubscribed'

export type SendTarget = 'all' | 'non_responders' | 'incompletes'

export interface Campaign {
  id:               string
  org_id:           string
  study_id:         string
  name:             string
  status:           CampaignStatus
  study_url:        string
  hidden_fields:    string[]
  target_responses: number | null
  email_provider:   EmailProviderType
  email_config:     Record<string, unknown>
  channel:          CampaignChannel
  sms_config:       Record<string, unknown>
  send_thank_you:   boolean
  send_incomplete:  boolean
  created_by:       string
  created_at:       string
  updated_at:       string
  // joined fields
  study_name?:      string
  study_status?:    string
}

export interface CampaignRespondent {
  id:                string
  campaign_id:       string
  email:             string
  fields:            Record<string, string>
  status:            RespondentStatus
  sent_at:           string | null
  opened_at:         string | null
  clicked_at:        string | null
  completed_at:      string | null
  response_id:       string | null
  unsubscribe_token: string
  recipient_guid:    string
  created_at:        string
}

export interface CampaignEmail {
  id:               string
  campaign_id:      string
  sequence:         number
  subject:          string
  body_html:        string
  body_text:        string | null
  send_delay_hours: number
  send_at:          string | null    // specific date/time to send (ISO string), overrides delay
  sms_body:         string | null    // SMS message template (short, with {{survey_link}})
  send_time:        string | null    // time of day to send, e.g. '09:00'
  send_timezone:    string           // e.g. 'America/New_York'
  send_to:          SendTarget
  is_thank_you:     boolean
  created_at:       string
  updated_at:       string
}

export interface CampaignSendLog {
  id:              string
  campaign_id:     string
  respondent_id:   string
  email_id:        string
  provider:        string
  provider_msg_id: string | null
  status:          string
  error_message:   string | null
  sent_at:         string | null
  created_at:      string
}

export interface CampaignStats {
  total:      number
  pending:    number
  sent:       number
  opened:     number
  clicked:    number
  completed:  number
  bounced:    number
  unsubscribed: number
}

// -- Town Hall ------------------------------------------------

export interface TownHallGuideTopic {
  id:                string
  label:             string
  description:       string
  opening_question:  string
  follow_up_angles:  string[]
  keywords:          string[]
  response_target:   number
  target_mode?:      'fixed' | 'percentage'   // fixed count vs % of expected_attendees
  target_pct?:       number                   // e.g. 30 = 30% of expected_attendees
  enabled?:          boolean   // default true — disabled topics not assigned to participants
}

export type TownHallSessionType = 'community' | 'employee' | 'customer' | 'student' | 'member' | 'other'

export interface TownHallConfig {
  bot_name:  string
  bot_emoji: string
  industry?: string   // matches Industry type from industryDefaults.ts
  session_type?: TownHallSessionType   // drives AI language: "residents" vs "team members" vs "customers" etc.
  context: {
    org_name:          string
    event_description: string
    tone:              string
    sensitive_topics:  string[]
    priority_areas:    string[]
  }
  opening_message: string    // combined welcome + opening question — shown on join
  closing_message: string    // shown when session ends or participant finishes
  // Legacy compat: opening_question, display.welcome_message, display.thank_you_message,
  // session_end.closing_message are all collapsed into opening_message + closing_message
  opening_question?: string  // deprecated — use opening_message
  languages?: string[]
  expected_attendees?: number   // estimated attendee count — used to compute % targets
  engine: {
    theme_detection_mode:             'off' | 'manual' | 'auto'
    theme_detection_interval_minutes: number   // deprecated — kept for backwards compat
    theme_detection_every_n_responses: number  // for auto mode — run detection every N new responses (default 20)
    max_turns_per_participant:        number
    default_response_target:          number
    max_active_themes:                number
    ai_timeout_ms:                    number
  }
  session_end: {
    mode:                        'manual' | 'timed' | 'inactivity'
    duration_minutes:            number | null
    inactivity_timeout_minutes:  number | null
  }
  display: {
    skip_label:        string
    done_label:        string
  }
  // Canned bot messages — facilitator writes in English, auto-translated for participants
  messages?: {
    post_session_intro?:   string   // before psycho questions (default: "Almost done — a few quick optional questions.")
    post_session_demo?:    string   // before demo form (default: "A couple of optional questions about you.")
    post_session_thanks?:  string   // after submitting (default: "Thanks for sharing!")
  }
  // When to ask demographic & psychographic questions: before or after the conversation
  questionPosition?:   'before' | 'after'   // default 'after'
  demoFields?:         DemoField[]
  psychographicBank?:  PsychoQuestion[]
  psychoCount?:        number   // how many psycho questions to randomly show (default 3)
  testing?:            boolean  // testing mode: bot messages include AI thinking/reasoning inline
  // Debug mode: activated via #debug SESSION_ID in chat or ?debug=SESSION_ID in URL
  // Content safety: profanity filtering + strike escalation
  content_safety?: {
    enabled?: boolean          // master toggle (default true)
    profanity?: boolean       // block/bleep profanity (default true)
    slurs?: boolean           // block slurs (default true)
    threats?: boolean         // block threats/violence (default true)
    sexual?: boolean          // block sexual content (default true)
    insults?: boolean         // nudge on insults (default true)
    spam?: boolean            // block URLs (default true)
  }
}

export type TownHallSessionStatus = 'setup' | 'active' | 'paused' | 'ended'
export type TownHallThemeState = 'active' | 'detected' | 'paused' | 'parked' | 'completed' | 'dismissed'
export type TownHallThemeSource = 'guide' | 'auto_detected' | 'custom'
export type TownHallTurnSource = 'guide' | 'clarifier' | 'detected_theme' | 'custom'

export interface TownHallSession {
  id:                string
  study_id:          string | null
  org_id:            string
  created_by:        string | null
  name:              string
  slug:              string | null
  status:            TownHallSessionStatus
  config:            TownHallConfig
  discussion_guide:  TownHallGuideTopic[]
  response_counter:  number
  started_at:        string | null
  ended_at:          string | null
  created_at:        string
  updated_at:        string
}

export interface TownHallTheme {
  id:               string
  session_id:       string
  label:            string
  description:      string | null
  question:         string
  follow_up_angles: string[]
  state:            TownHallThemeState
  source:           TownHallThemeSource
  response_target:  number
  response_count:   number
  mention_count:    number
  keywords:         string[]
  sentiment:        string | null
  example_quote:    string | null
  example_quotes?:  string[]
  match_count?:     number
  percentage?:      number
  top_keywords?:    { word: string; count: number }[]
  detected_at:      string | null
  approved_at:      string | null
  completed_at:     string | null
  sort_order:       number
  created_at:       string
}

export interface TownHallTurn {
  id:              string
  session_id:      string
  participant_id:  string
  turn_number:     number
  bot_message:     string
  user_message:    string | null
  user_message_en: string | null
  language:        string
  theme_id:        string | null
  source:          TownHallTurnSource
  skipped:         boolean
  created_at:      string
}
