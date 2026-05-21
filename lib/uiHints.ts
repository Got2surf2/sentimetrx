// lib/uiHints.ts
//
// Shared type definitions for the canvas/ui_hints system used by /demo/mco.
// The agent emits zero or one hint alongside its prose response (Commit 2);
// the canvas shell consumes these to render structured cards on the right pane.
// See docs/MCO_AGENT.md § 4 for the contract.
//
// v1: four hint types — terminal_map, parking, restaurants, link_card.
// The hint payloads are intentionally narrow (only the data the renderer
// needs); per-hint data fetching (Places, parking JSON) happens at render
// time in the card components, gated by the hint's identifiers.

export type UiHint =
  | TerminalMapHint
  | ParkingHint
  | RestaurantsHint
  | LinkCardHint

export interface TerminalMapHint {
  type: 'terminal_map'
  terminal?: 'A' | 'B' | 'C'
  gate?: string
  from?: 'A' | 'B' | 'C'
  to?: 'A' | 'B' | 'C'
  via?: 'shuttle' | 'terminal_link_apm'
}

export interface ParkingHint {
  type: 'parking'
  highlight?: string[]    // garage_a, garage_b, garage_c, atlantis, …
}

export interface RestaurantsHint {
  type: 'restaurants'
  place_ids: string[]
  context?: string        // e.g. "terminal_a_airside"
}

export interface LinkCardHint {
  type: 'link_card'
  title: string
  body: string
  image_url?: string
  cta_url: string
  cta_label: string
}

// Deployment context — auto-detected by the page (URL param, geolocation,
// user agent, deployment env), demo-strip-overridable in the prototype.
export type DeploymentMode = 'home' | 'invenue' | 'kiosk'

export interface DeploymentContext {
  mode: DeploymentMode
  location?: {
    label: string                // "Terminal B (from QR scan)"
    source: 'qr' | 'geo' | 'manual'
  }
  // Future: time, audience, language preference
}
