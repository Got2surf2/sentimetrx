// lib/pptx/styles.ts
// Deck style presets — the palette a DeckSpec renders with, selected per-export
// (ExportModal "Style" → body.style → DeckSpec.style). The chosen palette rides
// the request's pptx instance inside renderDeck, NEVER a mutable module global:
// the routes run on Vercel Fluid Compute where one warm instance serves
// concurrent requests, so a reassigned global would bleed colors between two
// simultaneous exports of different styles.
//
// Slot semantics (how slideRenderer uses each key):
//   cream    content-slide background          card   card fill
//   ink      primary text + dark cover bg      ink2   muted text / sublabels
//   orange   primary accent (left bar, rules)  orangeD dark accent / negative
//   teal     workhorse accent (badges, KPI boxes, stripes, footer wordmark)
//   tealL    cool counterpoint (quote marks, eyebrows)
//   tealD    deep secondary accent             gold   secondary pop / bar variety
//   line     hairline borders                  white  text on accent fills
//   green/red/amber  semantic chart colors     coverSub muted text on dark cover

export interface DeckPalette {
  cream: string
  card: string
  ink: string
  ink2: string
  orange: string
  orangeD: string
  teal: string
  tealL: string
  tealD: string
  gold: string
  line: string
  white: string
  green: string
  red: string
  amber: string
  coverSub: string
}

export interface DeckStyle {
  label: string
  blurb: string
  palette: DeckPalette
}

export const DECK_STYLES = {
  // The shipped look (2026-06-25 modern repalette) — byte-identical to the old
  // slideRenderer CR constant. DEFAULT: every existing caller renders unchanged.
  modern: {
    label: 'Datanautix Modern',
    blurb: 'White + deep navy with the signature Ana orange accent',
    palette: {
      cream:   'FFFFFF',
      card:    'F1F5F9',
      ink:     '0F1E33',
      ink2:    '5B6B7F',
      orange:  'E85A1A',
      orangeD: 'B84010',
      teal:    'E85A1A',  // workhorse accent — intentionally orange
      tealL:   '38BDF8',
      tealD:   '1E3A8A',
      gold:    '2563EB',
      line:    'E2E8F0',
      white:   'FFFFFF',
      green:   '059669',
      red:     'DC2626',
      amber:   'D97706',
      coverSub:'C7D2E0',
    },
  },
  // The original Datanautix brand palette (lib/pptx/shared.ts DN family).
  classic: {
    label: 'Datanautix Classic',
    blurb: 'Navy, teal and gold — the original brand palette',
    palette: {
      cream:   'F4F7F8',
      card:    'FFFFFF',
      ink:     '0D2B45',
      ink2:    '5E7380',
      orange:  'E85A1A',
      orangeD: 'B84010',
      teal:    '0F7173',
      tealL:   '4DBFC1',
      tealD:   '0A4F51',
      gold:    'E8B84B',
      line:    'D4DDE2',
      white:   'FFFFFF',
      green:   '059669',
      red:     'DC2626',
      amber:   'D97706',
      coverSub:'8FA3AE',
    },
  },
  warm: {
    label: 'Warm',
    blurb: 'Terracotta and olive on warm paper',
    palette: {
      cream:   'FBF6EF',
      card:    'F3EADD',
      ink:     '3D2C23',
      ink2:    '8A7365',
      orange:  'C2410C',
      orangeD: '9A3412',
      teal:    'C2410C',  // workhorse accent — terracotta
      tealL:   'E08A3C',
      tealD:   '6B3F23',
      gold:    '65803D',
      line:    'E5D9C9',
      white:   'FFFFFF',
      green:   '3F8F5F',
      red:     'C0392B',
      amber:   'B45309',
      coverSub:'D8C7B4',
    },
  },
  ocean: {
    label: 'Ocean',
    blurb: 'Deep blue and cyan, cool and clean',
    palette: {
      cream:   'FFFFFF',
      card:    'EFF6FF',
      ink:     '0C2340',
      ink2:    '5B7085',
      orange:  '0369A1',  // primary accent — ocean blue
      orangeD: '075985',
      teal:    '0369A1',
      tealL:   '22D3EE',
      tealD:   '1E3A8A',
      gold:    '0D9488',
      line:    'DBEAFE',
      white:   'FFFFFF',
      green:   '059669',
      red:     'DC2626',
      amber:   'D97706',
      coverSub:'B7C9DE',
    },
  },
} satisfies Record<string, DeckStyle>

export type DeckStyleId = keyof typeof DECK_STYLES

export const DEFAULT_DECK_STYLE: DeckStyleId = 'modern'

/** Resolve a style id (from a request body / DeckSpec) to a palette; unknown or
 *  missing ids fall back to the default so old callers render unchanged. */
export function getDeckPalette(style?: string | null): DeckPalette {
  return (DECK_STYLES as Record<string, DeckStyle>)[style || DEFAULT_DECK_STYLE]?.palette
    || DECK_STYLES[DEFAULT_DECK_STYLE].palette
}

/** Picker options for the export UI. */
export function deckStyleOptions(): { id: DeckStyleId; label: string; blurb: string; swatch: string[] }[] {
  return (Object.keys(DECK_STYLES) as DeckStyleId[]).map(id => {
    const s = DECK_STYLES[id]
    return { id, label: s.label, blurb: s.blurb, swatch: [s.palette.ink, s.palette.orange, s.palette.tealL, s.palette.gold] }
  })
}
