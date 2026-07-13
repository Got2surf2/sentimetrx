// types/plotly.d.ts
// Minimal shim for the untyped plotly.js-dist-min bundle — only the
// methods this codebase calls (see components/analyze/{Charts,Stats}Module.tsx).
declare module 'plotly.js-dist-min' {
  interface PlotlyBundle {
    newPlot: (el: HTMLElement, data: unknown[], layout?: unknown, config?: unknown) => void
    purge: (el: HTMLElement) => void
    downloadImage: (el: HTMLElement, opts: Record<string, unknown>) => void
  }
  // CJS interop: consumers do `m.default || m`, so the namespace mirrors the default.
  export const newPlot: PlotlyBundle['newPlot']
  export const purge: PlotlyBundle['purge']
  export const downloadImage: PlotlyBundle['downloadImage']
  const Plotly: PlotlyBundle
  export default Plotly
}
