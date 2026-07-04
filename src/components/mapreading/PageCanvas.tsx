import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { MapReadingPage, RouteGraph } from '../../types'
import { loadBlob } from '../../lib/fileStore'
import { MAP_READING_COLORS, MAP_READING_TYPE_LABELS } from '../../lib/mapReading/colors'

interface PageCanvasProps {
  page: MapReadingPage | null
  selectedDetectionId: string | null
  onSelectDetection: (id: string | null) => void
  /** The traced route graph to overlay, or null to hide it — a separate,
   *  togglable visual layer from the OCR detection boxes below, so tracing
   *  accuracy can be checked by eye independent of text detection. */
  routeGraph?: RouteGraph | null
}

/** Center pane — the selected page's full raster with one absolutely-
 *  positioned colored box per detection. Boxes are positioned as percentages
 *  of the image's natural size, so they track the rendered <img> at any
 *  display size without a separate pan/zoom transform to keep in sync. The
 *  route-graph overlay uses an SVG viewBox in the same natural pixel space
 *  instead, since polylines are far more convenient to plot that way. */
export function PageCanvas({ page, selectedDetectionId, onSelectDetection, routeGraph }: PageCanvasProps) {
  const [src, setSrc] = useState<string | null>(null)

  useEffect(() => {
    setSrc(null)
    if (!page) return
    loadBlob(page.imageBlobKey).then(setSrc)
  }, [page])

  if (!page) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-600">
        Select a page from the left to review it here.
      </div>
    )
  }

  const strokeW = Math.max(2, page.naturalWidth / 500)

  return (
    <div className="relative h-full overflow-auto rounded-lg border border-[#2a2a2a] bg-[#0a0a0a]">
      {!src ? (
        <div className="flex h-full items-center justify-center text-slate-500">
          <Loader2 size={22} className="animate-spin" />
        </div>
      ) : (
        <div className="relative inline-block" onClick={() => onSelectDetection(null)}>
          <img src={src} className="block max-w-none" style={{ width: 900 }} alt={page.fileName} />

          {routeGraph && (
            <svg
              viewBox={`0 0 ${page.naturalWidth} ${page.naturalHeight}`}
              className="absolute inset-0 h-full w-full"
              style={{ pointerEvents: 'none' }}
            >
              {routeGraph.segments.map((s) => (
                <polyline
                  key={s.id}
                  points={s.points.map(([x, y]) => `${x},${y}`).join(' ')}
                  fill="none"
                  stroke={s.classification ? MAP_READING_COLORS[s.classification] : '#38bdf8'}
                  strokeOpacity={0.85}
                  strokeWidth={strokeW}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              ))}
              {routeGraph.nodes.map((n) => (
                n.kind === 'endpoint' ? (
                  <circle key={n.id} cx={n.x} cy={n.y} r={strokeW * 2.2} fill="#facc15" stroke="#000" strokeWidth={strokeW * 0.4} />
                ) : (
                  <rect
                    key={n.id}
                    x={n.x - strokeW * 2} y={n.y - strokeW * 2} width={strokeW * 4} height={strokeW * 4}
                    transform={`rotate(45 ${n.x} ${n.y})`}
                    fill="#f472b6" stroke="#000" strokeWidth={strokeW * 0.4}
                  />
                )
              ))}
            </svg>
          )}

          {page.detections.map((d) => {
            const color = MAP_READING_COLORS[d.type]
            const isSelected = d.id === selectedDetectionId
            // The geometric slack-loop heuristic (symbolHeuristics.ts) has no
            // real text to highlight — it gets a small symbol marker at the
            // loop's centroid instead of a text-underline treatment.
            const isGeometryDerived = d.text === 'Slack loop (geometry)'
            const leftPct = (d.x / page.naturalWidth) * 100
            const topPct = (d.y / page.naturalHeight) * 100
            const widthPct = (d.width / page.naturalWidth) * 100
            const heightPct = (d.height / page.naturalHeight) * 100

            if (isGeometryDerived) {
              return (
                <div
                  key={d.id}
                  title={`${MAP_READING_TYPE_LABELS[d.type]}: ${d.text}`}
                  onClick={(e) => { e.stopPropagation(); onSelectDetection(d.id) }}
                  className="absolute cursor-pointer rounded-full"
                  style={{
                    left: `calc(${leftPct}% + ${widthPct / 2}% - 7px)`,
                    top: `calc(${topPct}% + ${heightPct / 2}% - 7px)`,
                    width: 14, height: 14,
                    background: color,
                    border: isSelected ? '2px solid #fff' : `2px solid ${color}`,
                    boxShadow: isSelected ? `0 0 0 3px ${color}` : `0 0 4px ${color}`,
                  }}
                />
              )
            }

            // Every other detection is a real OCR text match — highlighted as
            // colored text (a colored underline + a light color wash tightly
            // sized to the actual text box) rather than a generic bordered box.
            return (
              <div
                key={d.id}
                title={`${MAP_READING_TYPE_LABELS[d.type]}: ${d.text}`}
                onClick={(e) => { e.stopPropagation(); onSelectDetection(d.id) }}
                className="absolute cursor-pointer"
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                  width: `${widthPct}%`,
                  height: `${heightPct}%`,
                  background: isSelected ? `${color}40` : `${color}1f`,
                  borderBottom: `3px solid ${color}`,
                  boxShadow: isSelected ? `0 0 0 2px #fff, 0 0 0 4px ${color}` : undefined,
                  minWidth: 6, minHeight: 4,
                }}
              />
            )
          })}
        </div>
      )}
    </div>
  )
}
