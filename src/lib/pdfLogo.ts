// ---------------------------------------------------------------------------
// Draws the FiberLytic "FL" mark directly with jsPDF vector primitives
// (rounded-square container + rect-built F/L monogram) instead of embedding
// a raster asset. The mark is built entirely from axis-aligned bars, so it
// scales to any size with no loss of fidelity — and it means PDF export
// never depends on fetching/decoding an image file.
// ---------------------------------------------------------------------------

// Rects in a 120x120 design grid: [x, y, width, height]. See public/logo.svg
// for the source-of-truth path this mirrors.
const ICON_BARS: [number, number, number, number][] = [
  [30, 26, 12, 68], // F spine
  [30, 26, 44, 12], // F top bar
  [30, 54, 32, 12], // F middle bar
  [62, 54, 12, 40], // L vertical (shares the F middle bar's end)
  [62, 82, 30, 12], // L bottom bar
]

/** pdf is jsPDF's instance type — kept loose since jsPDF is dynamically
 *  imported by callers and we don't want a hard type dependency here. */
export function drawFiberLyticLogo(
  pdf: {
    setFillColor: (r: number, g: number, b: number) => void
    setDrawColor: (r: number, g: number, b: number) => void
    roundedRect: (x: number, y: number, w: number, h: number, rx: number, ry: number, style: string) => void
    rect: (x: number, y: number, w: number, h: number, style: string) => void
  },
  x: number,
  y: number,
  size: number,
): void {
  const s = size / 120
  // White tile with a thin light-gray outline (visible on the PDF's white page)
  // + dark icon bars — matches the brand mark's white-tile/dark-icon treatment.
  pdf.setFillColor(255, 255, 255)
  pdf.setDrawColor(229, 229, 229)
  pdf.roundedRect(x, y, size, size, 24 * s, 24 * s, 'FD')
  pdf.setFillColor(10, 10, 10)
  for (const [rx, ry, rw, rh] of ICON_BARS) {
    pdf.rect(x + rx * s, y + ry * s, rw * s, rh * s, 'F')
  }
  pdf.setFillColor(0, 0, 0)
  pdf.setDrawColor(0, 0, 0)
}
