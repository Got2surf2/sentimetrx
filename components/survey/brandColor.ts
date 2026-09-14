// components/survey/brandColor.ts — pure helper shared by SurveyWidget and
// useSurveyEngine. Lives in its own leaf so the hook never imports the
// component that renders it (that was a runtime import cycle).

// Pick Sarina blue or Hermes orange based on background color — whichever contrasts better
export function pickBrandColor(bgHex: string): string {
  const SARINA_BLUE = '#00b4d8'
  const HERMES_ORANGE = '#E8632A'
  const hex = (bgHex || '#1a1a2e').replace('#', '')
  const r = parseInt(hex.slice(0, 2), 16) || 0
  const g = parseInt(hex.slice(2, 4), 16) || 0
  const b = parseInt(hex.slice(4, 6), 16) || 0
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  let hue = 0
  if (max !== min) {
    const d = max - min
    if (max === r) hue = ((g - b) / d + (g < b ? 6 : 0)) * 60
    else if (max === g) hue = ((b - r) / d + 2) * 60
    else hue = ((r - g) / d + 4) * 60
  }
  const isBlueish = hue >= 160 && hue <= 260
  const isOrangeish = (hue >= 0 && hue <= 50) || hue >= 340
  if (isBlueish) return HERMES_ORANGE
  if (isOrangeish) return SARINA_BLUE
  if (lum < 0.45) return SARINA_BLUE
  return HERMES_ORANGE
}
