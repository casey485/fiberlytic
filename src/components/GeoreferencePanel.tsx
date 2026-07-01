/**
 * GeoreferencePanel — upload a PDF plan and anchor it onto the Field Map.
 * Renders as a non-blocking side panel (like MarkupPanel/FeaturePanel) so the
 * live Leaflet map stays clickable underneath while calibrating: the user
 * clicks a point on the rendered PDF page, then clicks the matching spot on
 * the map, repeating for 3+ control points before the transform can be solved.
 */
import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import { X, Upload, Check, Trash2, AlertCircle, ScanSearch, MapPinCheck, XCircle } from 'lucide-react'
import { useData } from '../store/DataContext'
import { renderPdf } from '../features/printkmz/pdf'
import { runOcrWithBoxes, type OcrProgress } from '../features/printkmz/ocr'
import { saveBlob, loadBlob } from '../lib/fileStore'
import { computeTransform, projectPoint } from '../lib/georeference'
import type { ControlPoint } from '../lib/georeference'
import { detectOcrCandidates, type OcrCandidate } from '../lib/ocrWorkObjectDetect'
import { WORK_OBJECT_TYPE_MAP } from '../lib/workObjectTypes'

interface Props {
  projectId: string
  map: L.Map | null
  onClose: () => void
  onSaved: (overlayId: string) => void
  /** When set, skips the "Choose PDF" step and auto-renders this already-stored ProjectFile's PDF instead. */
  preloadFile?: { id: string; name: string } | null
}

interface DetectCandidate extends OcrCandidate {
  lat: number
  lng: number
}

export function GeoreferencePanel({ projectId, map, onClose, onSaved, preloadFile }: Props) {
  const { addFieldMapOverlay, addMarkup } = useData()
  const [step, setStep] = useState<'upload' | 'calibrate' | 'detect'>('upload')
  const [rendering, setRendering] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [naturalSize, setNaturalSize] = useState<{ w: number; h: number } | null>(null)
  const [points, setPoints] = useState<ControlPoint[]>([])
  const [pendingPx, setPendingPx] = useState<{ x: number; y: number } | null>(null)
  const [savedOverlayId, setSavedOverlayId] = useState<string | null>(null)
  const [ocrRunning, setOcrRunning] = useState(false)
  const [ocrProgress, setOcrProgress] = useState<OcrProgress | null>(null)
  const [ocrError, setOcrError] = useState<string | null>(null)
  const [candidates, setCandidates] = useState<DetectCandidate[]>([])
  const candidateMarkersRef = useRef<Map<string, L.Marker>>(new Map())
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
      setSavedOverlayId(overlayId)
      setStep('detect')
    } finally {
      setSaving(false)
    }
  }

  function finishDetect() {
    for (const marker of candidateMarkersRef.current.values()) marker.remove()
    candidateMarkersRef.current.clear()
    if (savedOverlayId) onSaved(savedOverlayId)
  }

  async function runDetection() {
    if (!imageUrl) return
    setOcrRunning(true)
    setOcrError(null)
    try {
      const pages = await runOcrWithBoxes([imageUrl], setOcrProgress)
      const transform = computeTransform(points)
      const found = detectOcrCandidates(pages).map((c) => {
        const { lat, lng } = projectPoint(transform, c.px.x, c.px.y)
        return { ...c, lat, lng }
      })
      setCandidates(found)
    } catch (err) {
      setOcrError(err instanceof Error ? err.message : 'OCR detection failed')
    } finally {
      setOcrRunning(false)
      setOcrProgress(null)
    }
  }

  function confirmCandidate(candidate: DetectCandidate) {
    const typeDef = WORK_OBJECT_TYPE_MAP[candidate.workObjectType]
    addMarkup({
      projectId,
      tool: 'point', subtype: candidate.workObjectType, workObjectType: candidate.workObjectType,
      color: typeDef?.defaultColor ?? '#94a3b8', weight: 2, fillColor: null, fillOpacity: 0, opacity: 1,
      geometry: { center: [candidate.lat, candidate.lng] },
      label: null, fontSize: 13,
      featureType: 'point', featureName: candidate.matchedText, notes: `Detected via OCR ("${candidate.matchedText}")`,
      lengthFt: null, quantity: null, unit: typeDef?.defaultUnit,
      status: 'pending', layer: 'crew', crewId: null, createdBy: null, updatedAt: null, lockedAt: null,
    })
    dismissCandidate(candidate.id)
  }

  function dismissCandidate(id: string) {
    candidateMarkersRef.current.get(id)?.remove()
    candidateMarkersRef.current.delete(id)
    setCandidates((prev) => prev.filter((c) => c.id !== id))
  }

  // Render each pending candidate as a draggable pin on the live map; dragging updates its
  // stored lat/lng so "Confirm" places the Work Object wherever the user actually dropped it.
  useEffect(() => {
    if (!map) return
    const seen = new Set(candidates.map((c) => c.id))
    for (const [id, marker] of candidateMarkersRef.current) {
      if (!seen.has(id)) { marker.remove(); candidateMarkersRef.current.delete(id) }
    }
    for (const c of candidates) {
      if (candidateMarkersRef.current.has(c.id)) continue
      const typeDef = WORK_OBJECT_TYPE_MAP[c.workObjectType]
      const color = typeDef?.defaultColor ?? '#94a3b8'
      const marker = L.marker([c.lat, c.lng], {
        draggable: true,
        icon: L.divIcon({
          className: '',
          html: `<div style="display:flex;flex-direction:column;align-items:center">
            <div style="background:${color};color:#fff;font-size:10px;font-weight:800;padding:3px 6px;border-radius:4px;border:2px dashed rgba(255,255,255,0.8);box-shadow:0 2px 6px rgba(0,0,0,0.6);white-space:nowrap">${typeDef?.label ?? c.workObjectType}</div>
            <div style="width:2px;height:6px;background:${color}"></div>
          </div>`,
          iconAnchor: [17, 0],
          iconSize: [34, 32],
        }),
      }).addTo(map)
      marker.on('dragend', () => {
        const ll = marker.getLatLng()
        setCandidates((prev) => prev.map((p) => (p.id === c.id ? { ...p, lat: ll.lat, lng: ll.lng } : p)))
      })
      candidateMarkersRef.current.set(c.id, marker)
    }
  }, [candidates, map])

  // Clean up any remaining candidate markers if the panel unmounts mid-review.
  useEffect(() => () => {
    for (const marker of candidateMarkersRef.current.values()) marker.remove()
    candidateMarkersRef.current.clear()
  }, [])

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

        {step === 'detect' && (
          <div className="flex flex-col gap-3">
            <p>Overlay saved. Optionally scan the plan for text like "vault", "handhole", "splice", etc. — each match becomes a draggable candidate pin you can confirm or dismiss.</p>
            {!ocrRunning && candidates.length === 0 && (
              <button
                onClick={runDetection}
                className="flex items-center justify-center gap-1.5 rounded-md bg-brand-600 px-3 py-1.5 font-medium text-white hover:bg-brand-500"
              >
                <ScanSearch size={13} /> Run OCR Detection
              </button>
            )}
            {ocrRunning && (
              <p className="flex items-center gap-1.5 text-slate-300">
                <ScanSearch size={13} className="animate-pulse" />
                Scanning… {ocrProgress ? `${Math.round(ocrProgress.progress * 100)}%` : ''}
              </p>
            )}
            {ocrError && (
              <p className="flex items-center gap-1 text-red-400"><AlertCircle size={12} /> {ocrError}</p>
            )}
            {candidates.length > 0 && (
              <div>
                <p className="mb-1 font-semibold text-slate-300">{candidates.length} candidate{candidates.length === 1 ? '' : 's'} found — drag pins on the map, then confirm or dismiss each</p>
                <ul className="space-y-1">
                  {candidates.map((c) => (
                    <li key={c.id} className="flex items-center justify-between rounded bg-white/5 px-2 py-1.5">
                      <span>
                        <span className="font-medium text-slate-200">{WORK_OBJECT_TYPE_MAP[c.workObjectType]?.label ?? c.workObjectType}</span>
                        {' '}<span className="text-slate-600">— "{c.matchedText}"</span>
                      </span>
                      <span className="flex items-center gap-1 shrink-0">
                        <button onClick={() => confirmCandidate(c)} title="Confirm — create Work Object" className="text-emerald-400 hover:text-emerald-300">
                          <MapPinCheck size={14} />
                        </button>
                        <button onClick={() => dismissCandidate(c.id)} title="Dismiss" className="text-slate-600 hover:text-red-400">
                          <XCircle size={14} />
                        </button>
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
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

      {step === 'detect' && (
        <div className="flex shrink-0 justify-end gap-2 border-t border-[#1e1e1e] p-2">
          <button
            onClick={finishDetect}
            className="flex items-center gap-1.5 rounded bg-emerald-600 px-3 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500"
          >
            <Check size={12} /> Done
          </button>
        </div>
      )}
    </div>
  )
}
