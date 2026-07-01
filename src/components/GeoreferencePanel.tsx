/**
 * GeoreferencePanel — upload a PDF plan and anchor it onto the Field Map.
 * Renders as a non-blocking side panel (like MarkupPanel/FeaturePanel) so the
 * live Leaflet map stays clickable underneath while calibrating: the user
 * clicks a point on the rendered PDF page, then clicks the matching spot on
 * the map, repeating for 3+ control points before the transform can be solved.
 */
import { useEffect, useRef, useState } from 'react'
import type L from 'leaflet'
import { X, Upload, Check, Trash2, AlertCircle } from 'lucide-react'
import { useData } from '../store/DataContext'
import { renderPdf } from '../features/printkmz/pdf'
import { saveBlob, loadBlob } from '../lib/fileStore'
import { computeTransform } from '../lib/georeference'
import type { ControlPoint } from '../lib/georeference'

interface Props {
  projectId: string
  map: L.Map | null
  onClose: () => void
  onSaved: (overlayId: string) => void
  /** When set, skips the "Choose PDF" step and auto-renders this already-stored ProjectFile's PDF instead. */
  preloadFile?: { id: string; name: string } | null
}

export function GeoreferencePanel({ projectId, map, onClose, onSaved, preloadFile }: Props) {
  const { addFieldMapOverlay } = useData()
  const [step, setStep] = useState<'upload' | 'calibrate'>('upload')
  const [rendering, setRendering] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null)
  const [points, setPoints] = useState<ControlPoint[]>([])
  const [pendingPx, setPendingPx] = useState<{ x: number; y: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Complete the pending image-side point with the next map click
  useEffect(() => {
    if (!map || !pendingPx) return
    const px = pendingPx
    function onMapClick(e: L.LeafletMouseEvent) {
      setPoints((prev) => [...prev, { px, lat: e.latlng.lat, lng: e.latlng.lng }])
      setPendingPx(null)
    }
    map.on('click', onMapClick)
    return () => { map.off('click', onMapClick) }
  }, [map, pendingPx])

  async function renderFile(file: File) {
    setRendering(true)
    setError(null)
    try {
      const rendered = await renderPdf(file)
      const img = rendered.images[0]
      if (!img) throw new Error('Could not render the PDF page')
      const dims = await new Promise<{ w: number; h: number }>((resolve, reject) => {
        const probe = new Image()
        probe.onload = () => resolve({ w: probe.naturalWidth, h: probe.naturalHeight })
        probe.onerror = () => reject(new Error('Could not read the rendered image dimensions'))
        probe.src = img
      })
      setImageUrl(img)
      setNaturalSize(dims)
      setStep('calibrate')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to render PDF')
    } finally {
      setRendering(false)
    }
  }

  // Auto-render an already-stored PDF (opened from a project's Files list) instead of prompting for upload.
  useEffect(() => {
    if (!preloadFile) return
    let cancelled = false
    setRendering(true)
    setError(null)
    loadBlob(preloadFile.id).then(async (dataUrl) => {
      if (cancelled) return
      if (!dataUrl) { setError('Could not load the stored PDF file.'); setRendering(false); return }
      const blob = await (await fetch(dataUrl)).blob()
      const file = new File([blob], preloadFile.name, { type: 'application/pdf' })
      await renderFile(file)
    })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preloadFile?.id])

  async function onFileChosen(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    await renderFile(file)
  }

  function onImageClick(e: React.MouseEvent<HTMLImageElement>) {
    if (!imgRef.current || !naturalSize) return
    const rect = imgRef.current.getBoundingClientRect()
    const x = ((e.clientX - rect.left) / rect.width) * naturalSize.w
    const y = ((e.clientY - rect.top) / rect.height) * naturalSize.h
    setPendingPx({ x, y })
  }

  function removePoint(idx: number) {
    setPoints((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleSave() {
    if (!imageUrl || !naturalSize || points.length < 3) return
    setError(null)
    try {
      computeTransform(points) // validates the points solve a transform before we persist anything
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not solve a transform from these points')
      return
    }
    setSaving(true)
    try {
      const blobKey = `geo-${crypto.randomUUID()}`
      await saveBlob(blobKey, imageUrl)
      const overlayId = addFieldMapOverlay({
        projectId,
        sourceProjectFileId: preloadFile?.id ?? null,
        imageBlobKey: blobKey,
        pageIndex: 0,
        naturalWidth: naturalSize.w,
        naturalHeight: naturalSize.h,
        controlPoints: points,
        opacity: 0.85,
        visible: true,
      })
      onSaved(overlayId)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex h-full flex-col bg-[#111111]">
      <div className="flex shrink-0 items-center justify-between border-b border-[#1e1e1e] px-3 py-2">
        <p className="text-[11px] font-bold uppercase tracking-wider text-slate-300">PDF Overlay</p>
        <button onClick={onClose} className="rounded p-1 text-slate-600 hover:text-slate-300">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3 text-[11px] text-slate-400">
        {step === 'upload' && (
          <div className="flex flex-col items-center gap-3 py-8 text-center">
            <p>Upload a scanned or vector PDF plan to anchor it onto the Field Map at real coordinates.</p>
            <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={onFileChosen} />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={rendering}
              className="flex items-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-500 disabled:opacity-50"
            >
              <Upload size={12} /> {rendering ? 'Rendering…' : 'Choose PDF'}
            </button>
            {error && (
              <p className="flex items-center gap-1 text-red-400"><AlertCircle size={12} /> {error}</p>
            )}
          </div>
        )}

        {step === 'calibrate' && imageUrl && naturalSize && (
          <div className="flex flex-col gap-3">
            <p>
              {pendingPx
                ? 'Point placed on the plan — now click the matching spot on the map.'
                : 'Click a point on the plan below, then click its matching location on the map. Place at least 3 points spread across the plan.'}
            </p>
            <div className="overflow-auto rounded border border-[#2a2a2a]" style={{ maxHeight: 260 }}>
              <img
                ref={imgRef}
                src={imageUrl}
                onClick={onImageClick}
                className="w-full cursor-crosshair select-none"
                style={{ display: 'block' }}
                alt="PDF plan to calibrate"
              />
            </div>
            <div>
              <p className="mb-1 font-semibold text-slate-300">Control points ({points.length}/3 min)</p>
              {points.length === 0 && <p className="text-slate-600">None placed yet.</p>}
              <ul className="space-y-1">
                {points.map((p, i) => (
                  <li key={i} className="flex items-center justify-between rounded bg-white/5 px-2 py-1">
                    <span>#{i + 1} · plan px ({Math.round(p.px.x)}, {Math.round(p.px.y)})</span>
                    <button onClick={() => removePoint(i)} className="text-slate-600 hover:text-red-400">
                      <Trash2 size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            {error && (
              <p className="flex items-center gap-1 text-red-400"><AlertCircle size={12} /> {error}</p>
            )}
          </div>
        )}
      </div>

      {step === 'calibrate' && (
        <div className="flex shrink-0 justify-end gap-2 border-t border-[#1e1e1e] p-2">
          <button onClick={onClose} className="rounded px-3 py-1.5 text-[11px] font-medium text-slate-500 hover:text-slate-300">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={points.length < 3 || saving}
            className="flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500 disabled:opacity-40"
          >
            <Check size={12} /> {saving ? 'Saving…' : 'Save Overlay'}
          </button>
        </div>
      )}
    </div>
  )
}
