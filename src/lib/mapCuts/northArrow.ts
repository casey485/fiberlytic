/** Draws a simple north-arrow compass rose on an offscreen canvas and returns
 *  a PNG data URL for pdf.addImage. Always points "up" — there is no
 *  georeference/bearing data for a freshly uploaded, uncalibrated PDF page,
 *  and true orientation detection would require computer-vision work that is
 *  explicitly out of scope. Size is fixed; callers scale it down via
 *  addImage's width/height args. */
export function buildNorthArrowDataUrl(size = 160): string {
  const canvas = document.createElement('canvas')
  canvas.width = size
  canvas.height = size
  const ctx = canvas.getContext('2d')!
  const cx = size / 2
  const cy = size / 2
  const r = size * 0.42

  ctx.clearRect(0, 0, size, size)

  // Outer circle
  ctx.strokeStyle = '#1e293b'
  ctx.lineWidth = size * 0.03
  ctx.beginPath()
  ctx.arc(cx, cy, r, 0, Math.PI * 2)
  ctx.stroke()

  // Arrow: dark half points up (north), light half points down
  const tipY = cy - r * 0.82
  const tailY = cy + r * 0.55
  const halfW = r * 0.28

  ctx.fillStyle = '#1e293b'
  ctx.beginPath()
  ctx.moveTo(cx, tipY)
  ctx.lineTo(cx + halfW, tailY)
  ctx.lineTo(cx, cy)
  ctx.closePath()
  ctx.fill()

  ctx.fillStyle = '#94a3b8'
  ctx.beginPath()
  ctx.moveTo(cx, tipY)
  ctx.lineTo(cx - halfW, tailY)
  ctx.lineTo(cx, cy)
  ctx.closePath()
  ctx.fill()

  // "N" label
  ctx.fillStyle = '#1e293b'
  ctx.font = `bold ${Math.round(size * 0.22)}px sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('N', cx, cy - r * 1.18)

  return canvas.toDataURL('image/png')
}
