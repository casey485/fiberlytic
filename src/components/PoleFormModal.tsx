import { useState, useEffect } from 'react'
import { X, Check, Camera, Trash2 } from 'lucide-react'
import { useData } from '../store/DataContext'
import { saveBlob, loadBlob } from '../lib/fileStore'
import type { AerialPole } from '../types'

const LASH_COLOR = '#a7dce8'

interface Props {
  pole: AerialPole
  /** Set when editing a saved run; undefined when editing an in-progress run. */
  runId?: string
  onSave: (updated: AerialPole) => void
  onClose: () => void
}

export function PoleFormModal({ pole, runId, onSave, onClose }: Props) {
  const { data, addMarkupPhoto, deleteMarkupPhoto } = useData()

  const [tickMark,  setTickMark]  = useState(pole.tickMark  ?? '')
  const [notes,     setNotes]     = useState(pole.notes     ?? '')
  const [crewName,  setCrewName]  = useState(pole.crewName  ?? '')
  const [dateTime,  setDateTime]  = useState(pole.dateTime  ?? '')
  const [completed, setCompleted] = useState(pole.completed)

  // Photos are keyed by markupId = `alf:<runId>:<poleNumber>` — only for saved runs
  const photoMarkupId = runId ? `alf:${runId}:${pole.poleNumber}` : null
  const photos = photoMarkupId
    ? (data.markupPhotos ?? []).filter((p) => p.markupId === photoMarkupId)
    : []

  const [photoUrls, setPhotoUrls] = useState<Record<string, string>>({})

  useEffect(() => {
    if (photos.length === 0) return
    let cancelled = false
    async function load() {
      const result: Record<string, string> = {}
      for (const ph of photos) {
        const url = await loadBlob(`mkp-${ph.id}`)
        if (url) result[ph.id] = url
      }
      if (!cancelled) setPhotoUrls(result)
    }
    void load()
    return () => { cancelled = true }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photos.length, photoMarkupId])

  async function handlePhotoUpload(e: React.ChangeEvent<HTMLInputElement>) {
    if (!photoMarkupId) return
    const files = Array.from(e.target.files ?? [])
    for (const file of files) {
      await new Promise<void>((resolve) => {
        const reader = new FileReader()
        reader.onload = async (ev) => {
          const dataUrl = ev.target?.result as string
          const id = addMarkupPhoto({
            markupId: photoMarkupId,
            caption: null,
            takenAt: new Date().toISOString(),
            uploadedBy: crewName.trim() || null,
            lat: pole.lat,
            lng: pole.lng,
          })
          await saveBlob(`mkp-${id}`, dataUrl)
          setPhotoUrls((m) => ({ ...m, [id]: dataUrl }))
          resolve()
        }
        reader.readAsDataURL(file)
      })
    }
    e.target.value = ''
  }

  function handleSave() {
    onSave({
      ...pole,
      tickMark:  tickMark.trim()  || null,
      notes:     notes.trim()     || null,
      crewName:  crewName.trim()  || null,
      dateTime:  dateTime         || null,
      completed,
    })
  }

  return (
    <div
      className="fixed inset-0 z-[2000] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-80 max-h-[90vh] overflow-y-auto bg-[#0d0d0d] border border-[#2a2a2a] rounded-xl shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-[#0d0d0d] flex items-center gap-2 px-4 py-3 border-b border-[#1e1e1e] z-10">
          <span
            className="h-6 w-6 rounded-full border-2 flex items-center justify-center text-[11px] font-bold shrink-0"
            style={{ borderColor: LASH_COLOR, color: LASH_COLOR }}
          >
            {pole.poleNumber}
          </span>
          <span className="text-[13px] font-semibold text-slate-100 flex-1">Pole {pole.poleNumber}</span>
          <button
            onClick={() => setCompleted((v) => !v)}
            className={`flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold border transition shrink-0 ${
              completed
                ? 'bg-emerald-900/60 text-emerald-400 border-emerald-700'
                : 'bg-white/5 text-slate-500 border-white/10'
            }`}
          >
            <Check size={10} />
            {completed ? 'Done' : 'Pending'}
          </button>
          <button
            onClick={onClose}
            className="ml-1 rounded p-1 text-slate-600 hover:text-slate-200 hover:bg-white/5 transition shrink-0"
          >
            <X size={14} />
          </button>
        </div>

        {/* GPS (read-only) */}
        <div className="px-4 py-2 border-b border-[#161616] bg-[#0a0a0a]">
          <span className="text-[9px] uppercase tracking-wider text-slate-700">GPS</span>
          <p className="text-[10px] text-slate-500 font-mono mt-0.5">
            {pole.lat.toFixed(6)}, {pole.lng.toFixed(6)}
          </p>
        </div>

        {/* Form */}
        <div className="px-4 py-3 space-y-3">
          <div>
            <label className="text-[9px] uppercase tracking-wider text-slate-600 block mb-1">Tick Mark</label>
            <input
              type="text"
              value={tickMark}
              onChange={(e) => setTickMark(e.target.value)}
              placeholder="e.g. 42.3 ft"
              className="w-full rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] px-3 py-1.5 text-[12px] text-slate-200 placeholder-slate-600 outline-none focus:border-[#a7dce8]/50 transition"
            />
          </div>
          <div>
            <label className="text-[9px] uppercase tracking-wider text-slate-600 block mb-1">Crew Name</label>
            <input
              type="text"
              value={crewName}
              onChange={(e) => setCrewName(e.target.value)}
              placeholder="Crew or tech name"
              className="w-full rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] px-3 py-1.5 text-[12px] text-slate-200 placeholder-slate-600 outline-none focus:border-[#a7dce8]/50 transition"
            />
          </div>
          <div>
            <label className="text-[9px] uppercase tracking-wider text-slate-600 block mb-1">Date / Time</label>
            <input
              type="datetime-local"
              value={dateTime}
              onChange={(e) => setDateTime(e.target.value)}
              className="w-full rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] px-3 py-1.5 text-[12px] text-slate-200 outline-none focus:border-[#a7dce8]/50 transition"
            />
          </div>
          <div>
            <label className="text-[9px] uppercase tracking-wider text-slate-600 block mb-1">Notes</label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Any notes about this pole…"
              className="w-full rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] px-3 py-1.5 text-[12px] text-slate-200 placeholder-slate-600 outline-none focus:border-[#a7dce8]/50 transition resize-none"
            />
          </div>

          {/* Photos — only for saved runs */}
          {runId && (
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[9px] uppercase tracking-wider text-slate-600">Photos</label>
                <label className="cursor-pointer flex items-center gap-1 text-[10px] hover:text-white transition" style={{ color: LASH_COLOR }}>
                  <Camera size={11} /> Add photo
                  <input type="file" accept="image/*" multiple capture="environment" className="hidden" onChange={handlePhotoUpload} />
                </label>
              </div>
              {photos.length === 0 ? (
                <p className="text-[10px] text-slate-700 italic">No photos yet</p>
              ) : (
                <div className="grid grid-cols-3 gap-1">
                  {photos.map((ph) => (
                    <div key={ph.id} className="relative group aspect-square">
                      {photoUrls[ph.id] ? (
                        <img src={photoUrls[ph.id]} alt="" className="w-full h-full object-cover rounded" />
                      ) : (
                        <div className="w-full h-full rounded bg-[#1e1e1e] animate-pulse" />
                      )}
                      <button
                        onClick={() => deleteMarkupPhoto(ph.id)}
                        className="absolute top-0.5 right-0.5 rounded p-0.5 bg-black/80 text-red-400 opacity-0 group-hover:opacity-100 transition"
                      >
                        <Trash2 size={9} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="flex gap-2 px-4 pb-4 pt-1">
          <button
            onClick={onClose}
            className="flex-1 rounded-lg border border-[#2a2a2a] py-2 text-[12px] text-slate-500 hover:text-slate-200 hover:bg-white/5 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 rounded-lg py-2 text-[12px] font-semibold transition"
            style={{ background: `${LASH_COLOR}18`, color: LASH_COLOR, border: `1px solid ${LASH_COLOR}40` }}
          >
            Save Pole
          </button>
        </div>
      </div>
    </div>
  )
}
