import { useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Upload, Trash2, ImageOff, ChevronDown, ChevronRight, Map as MapIcon, X } from 'lucide-react'
import { useData } from '../store/DataContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardBody } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Button, Field, Input, Select } from '../components/ui/Form'
import { PhotoImg } from '../components/PhotoImg'
import { PhotoDetailModal } from '../components/PhotoDetailModal'
import { QaStatusFilterSelect } from '../components/QaStatusFilterSelect'
import { QaStatusBadge } from '../components/QaStatusBadge'
import { listCrewsAndSubcontractors } from '../lib/crewOrSub'
import { compressImage } from '../lib/imageCompress'
import { saveBlob } from '../lib/fileStore'
import { weekStart, weekEnd } from '../lib/analytics'
import { localDateStr } from '../lib/format'
import type { BadgeTone } from '../lib/format'
import type { PhotoCategory } from '../types'
import {
  buildPhotoLibrary, applyPhotoFilters, photoFiltersActive, EMPTY_PHOTO_FILTERS,
  PHOTO_FOLDER_LABELS, workObjectTypeLabel,
} from '../lib/photoLibrary'
import type { PhotoLibraryRow, PhotoFilterState, PhotoFolder } from '../lib/photoLibrary'
import { WORK_OBJECT_TYPES } from '../lib/workObjectTypes'

const CATEGORIES: { value: PhotoCategory; label: string; tone: BadgeTone }[] = [
  { value: 'before', label: 'Before', tone: 'slate' },
  { value: 'progress', label: 'Progress', tone: 'blue' },
  { value: 'after', label: 'After', tone: 'green' },
  { value: 'issue', label: 'Issue', tone: 'red' },
  { value: 'safety', label: 'Safety', tone: 'amber' },
]

const FOLDER_ORDER: PhotoFolder[] = ['underground', 'splicing', 'aerial', 'qaqc', 'general']
const WORK_TYPE_OPTIONS: { value: string; label: string }[] = [
  { value: 'underground', label: 'Underground' },
  { value: 'aerial', label: 'Aerial' },
  { value: 'splicing', label: 'Splicing' },
  { value: 'general', label: 'General' },
]

/** Great-circle distance in meters — used to turn a map-pin click into a
 *  small "near this spot" area filter, applied on top of the shared
 *  PhotoFilterState (this one is map-interaction state, not a persisted
 *  filter dimension, so it stays local to the page). */
function distanceMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000
  const dLat = (b[0] - a[0]) * (Math.PI / 180)
  const dLng = (b[1] - a[1]) * (Math.PI / 180)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * Math.PI / 180) * Math.cos(b[0] * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

export function Photos() {
  const { data, deletePhoto, deleteMarkupPhoto } = useData()
  const [open, setOpen] = useState(false)
  const [filters, setFilters] = useState<PhotoFilterState>(EMPTY_PHOTO_FILTERS)
  const [selected, setSelected] = useState<PhotoLibraryRow | null>(null)
  const [showMap, setShowMap] = useState(false)
  const [areaCenter, setAreaCenter] = useState<[number, number] | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

  const library = useMemo(() => buildPhotoLibrary(data), [data])
  const filteredByFields = useMemo(() => applyPhotoFilters(library, filters), [library, filters])
  const filtered = useMemo(
    () => areaCenter ? filteredByFields.filter((r) => r.lat != null && r.lng != null && distanceMeters(areaCenter, [r.lat, r.lng]) <= 500) : filteredByFields,
    [filteredByFields, areaCenter],
  )

  const setFilter = <K extends keyof PhotoFilterState>(k: K, v: PhotoFilterState[K]) => setFilters((f) => ({ ...f, [k]: v }))
  const clearFilters = () => { setFilters(EMPTY_PHOTO_FILTERS); setAreaCenter(null) }

  const setThisWeek = () => { const today = localDateStr(); setFilters((f) => ({ ...f, dateFrom: weekStart(today), dateTo: weekEnd(today) })) }
  const setThisMonth = () => {
    const now = new Date()
    const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const to = localDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0))
    setFilters((f) => ({ ...f, dateFrom: from, dateTo: to }))
  }

  const clients = data.clients ?? []
  const crewOrSubOptions = listCrewsAndSubcontractors(data)
  const activeEmployees = data.employees.filter((e) => e.active)

  const byProject = useMemo(() => {
    const map = new Map<string, { key: string; name: string; rows: PhotoLibraryRow[] }>()
    for (const r of filtered) {
      const key = r.project?.id ?? 'unknown'
      if (!map.has(key)) map.set(key, { key, name: r.project?.name ?? 'Unassigned', rows: [] })
      map.get(key)!.rows.push(r)
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
  }, [filtered])

  const toggleProject = (key: string) => setCollapsed((s) => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n })

  const removeRow = (row: PhotoLibraryRow) => {
    if (row.kind === 'photo') deletePhoto(row.id)
    else deleteMarkupPhoto(row.id)
  }

  return (
    <div>
      <PageHeader
        title="Photos"
        description="Every photo, auto-organized by project and work type — filter, click through to the map, production, or QAQC."
        action={
          <Button onClick={() => setOpen(true)}>
            <Upload size={16} /> Upload photo
          </Button>
        }
      />

      <Card className="mb-5">
        <CardBody className="flex flex-wrap items-end gap-3">
          <FilterField label="Project">
            <Select value={filters.projectId} onChange={(e) => setFilter('projectId', e.target.value)} className="w-44">
              <option value="">All projects</option>
              {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </FilterField>
          <FilterField label="Customer">
            <Select value={filters.clientId} onChange={(e) => setFilter('clientId', e.target.value)} className="w-40">
              <option value="">All customers</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </FilterField>
          <FilterField label="Crew / Sub">
            <Select value={filters.crewOrSubId} onChange={(e) => setFilter('crewOrSubId', e.target.value)} className="w-40">
              <option value="">All crews</option>
              {crewOrSubOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </FilterField>
          <FilterField label="Employee">
            <Select value={filters.employeeId} onChange={(e) => setFilter('employeeId', e.target.value)} className="w-40">
              <option value="">All employees</option>
              {activeEmployees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </Select>
          </FilterField>
          <FilterField label="From">
            <Input type="date" value={filters.dateFrom} onChange={(e) => setFilter('dateFrom', e.target.value)} className="w-36" />
          </FilterField>
          <FilterField label="To">
            <Input type="date" value={filters.dateTo} onChange={(e) => setFilter('dateTo', e.target.value)} className="w-36" />
          </FilterField>
          <div className="flex gap-1.5">
            <button onClick={setThisWeek} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50">This Week</button>
            <button onClick={setThisMonth} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50">This Month</button>
          </div>
          <FilterField label="Work Type">
            <Select value={filters.workType} onChange={(e) => setFilter('workType', e.target.value)} className="w-36">
              <option value="">All work types</option>
              {WORK_TYPE_OPTIONS.map((w) => <option key={w.value} value={w.value}>{w.label}</option>)}
            </Select>
          </FilterField>
          <FilterField label="QA/QC Status">
            <QaStatusFilterSelect
              value={filters.qaStatus || 'all'}
              onChange={(v) => setFilter('qaStatus', v === 'all' ? '' : v)}
              className="w-44"
            />
          </FilterField>
          <FilterField label="Production Item">
            <Select value={filters.workObjectType} onChange={(e) => setFilter('workObjectType', e.target.value as PhotoFilterState['workObjectType'])} className="w-44">
              <option value="">All production items</option>
              {WORK_OBJECT_TYPES.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
            </Select>
          </FilterField>
          <label className="flex items-center gap-1.5 pb-2 text-xs font-medium text-slate-600">
            <input type="checkbox" checked={filters.hasGps} onChange={(e) => setFilter('hasGps', e.target.checked)} className="h-3.5 w-3.5 rounded border-slate-300" />
            Has GPS
          </label>
          <button
            onClick={() => setShowMap((s) => !s)}
            className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium ${showMap ? 'border-brand-300 bg-brand-50 text-brand-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'}`}
          >
            <MapIcon size={13} /> GPS Area
          </button>
          {(photoFiltersActive(filters) || areaCenter) && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-600">
              <X size={13} /> Clear filters
            </button>
          )}
        </CardBody>
      </Card>

      {showMap && (
        <PhotoAreaMap
          rows={filteredByFields.filter((r) => r.lat != null && r.lng != null)}
          areaCenter={areaCenter}
          onPick={setAreaCenter}
        />
      )}

      {byProject.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-12 text-center text-slate-400">
          <ImageOff size={32} />
          <p>No photos match these filters.</p>
        </Card>
      ) : (
        byProject.map(({ key, name, rows }) => {
          const isCollapsed = collapsed.has(key)
          return (
            <div key={key} className="mb-6">
              <button
                onClick={() => toggleProject(key)}
                className="mb-3 flex w-full items-center gap-1.5 text-left text-sm font-semibold text-slate-800"
              >
                {isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                {name}
                <span className="font-normal text-slate-400">({rows.length})</span>
              </button>
              {!isCollapsed && FOLDER_ORDER.map((folder) => {
                const folderRows = rows.filter((r) => r.folder === folder)
                if (folderRows.length === 0) return null
                return (
                  <div key={folder} className="mb-4">
                    <p className="mb-2 border-y border-slate-100 bg-slate-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                      {PHOTO_FOLDER_LABELS[folder]} ({folderRows.length})
                    </p>
                    <div className="grid grid-cols-1 gap-4 px-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {folderRows.map((row) => (
                        <PhotoCard key={row.id} row={row} onClick={() => setSelected(row)} onDelete={() => removeRow(row)} />
                      ))}
                    </div>
                  </div>
                )
              })}
            </div>
          )
        })
      )}

      <UploadModal open={open} onClose={() => setOpen(false)} />
      <PhotoDetailModal row={selected} onClose={() => setSelected(null)} />
    </div>
  )
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 block text-[11px] font-medium text-slate-500">{label}</span>
      {children}
    </div>
  )
}

function PhotoCard({ row, onClick, onDelete }: { row: PhotoLibraryRow; onClick: () => void; onDelete: () => void }) {
  const catMeta = row.kind === 'photo' ? CATEGORIES.find((c) => c.value === (row.raw as { category: PhotoCategory }).category) : null
  return (
    <Card className="group overflow-hidden">
      <div
        onClick={onClick}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick() } }}
        role="button"
        tabIndex={0}
        className="cursor-pointer"
      >
        <div className="relative aspect-[4/3] w-full bg-slate-100">
          <PhotoImg url={row.url} alt={row.caption ?? ''} className="h-full w-full object-cover" loading="lazy" />
          <div className="absolute left-2 top-2 flex flex-wrap gap-1">
            {catMeta && <Badge tone={catMeta.tone}>{catMeta.label}</Badge>}
            {row.qaStatus && <QaStatusBadge status={row.qaStatus} />}
          </div>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="absolute right-2 top-2 rounded-md bg-white/90 p-1.5 text-slate-500 opacity-0 transition hover:text-rose-600 group-hover:opacity-100"
            aria-label="Delete photo"
          >
            <Trash2 size={15} />
          </button>
        </div>
        <div className="p-3">
          <p className="truncate text-sm font-medium text-slate-800">{row.caption || 'Untitled'}</p>
          <p className="mt-0.5 truncate text-xs text-slate-400">{row.crewOrSubName}{row.workObjectType ? ` · ${workObjectTypeLabel(row.workObjectType)}` : ''}</p>
          <p className="mt-1 text-xs text-slate-400">{row.capturedAt ? new Date(row.capturedAt).toLocaleDateString() : '—'}</p>
        </div>
      </div>
    </Card>
  )
}

/** Small overview map of every filtered photo with GPS — clicking a pin sets
 *  a ~500m "near this spot" area filter (photoLibrary.ts's shared filters
 *  cover project/crew/date/etc.; this map-driven radius filter is
 *  interaction-only state that lives on the page, not in that shared shape). */
function PhotoAreaMap({ rows, areaCenter, onPick }: { rows: PhotoLibraryRow[]; areaCenter: [number, number] | null; onPick: (c: [number, number]) => void }) {
  const elRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)

  useEffect(() => {
    if (!elRef.current || mapRef.current) return
    const map = L.map(elRef.current, { zoomControl: true }).setView([39.5, -98.35], 4)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '&copy; OpenStreetMap' }).addTo(map)
    mapRef.current = map
    layerRef.current = L.layerGroup().addTo(map)
    return () => { map.remove(); mapRef.current = null }
  }, [])

  useEffect(() => {
    const map = mapRef.current
    const layer = layerRef.current
    if (!map || !layer) return
    layer.clearLayers()
    const pts: [number, number][] = []
    for (const r of rows) {
      if (r.lat == null || r.lng == null) continue
      pts.push([r.lat, r.lng])
      const marker = L.circleMarker([r.lat, r.lng], {
        radius: 6, color: '#0284c7', fillColor: '#0284c7', fillOpacity: 0.8, weight: 1.5,
      })
      marker.on('click', () => onPick([r.lat!, r.lng!]))
      marker.addTo(layer)
    }
    if (areaCenter) {
      L.circleMarker(areaCenter, { radius: 10, color: '#f59e0b', fillColor: 'transparent', weight: 2 }).addTo(layer)
    }
    if (pts.length > 0) map.fitBounds(pts, { padding: [30, 30], maxZoom: 15 })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, areaCenter])

  return (
    <Card className="mb-5 overflow-hidden">
      <div ref={elRef} className="h-64 w-full" />
      {rows.length === 0 && <p className="px-4 py-2 text-xs text-slate-400">No photos with GPS match the current filters.</p>}
    </Card>
  )
}

function UploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, addPhoto } = useData()
  const fileRef = useRef<HTMLInputElement>(null)
  const today = localDateStr()
  const [form, setForm] = useState({
    projectId: data.projects[0]?.id ?? '',
    caption: '',
    category: 'progress' as PhotoCategory,
    date: today,
    uploadedBy: 'Office',
    preview: '',
    blobKey: '',
  })
  const [compressing, setCompressing] = useState(false)
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const onFile = async (file: File | undefined) => {
    if (!file) return
    setCompressing(true)
    try {
      const compressed = await compressImage(file)
      const key = 'pb-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
      setForm((f) => ({ ...f, preview: compressed, blobKey: key }))
    } finally {
      setCompressing(false)
    }
  }

  const submit = async () => {
    if (!form.projectId || !form.preview || !form.blobKey) return
    await saveBlob(form.blobKey, form.preview)
    // Opportunistic GPS capture — best-effort, never blocks the save. Denied/
    // unavailable geolocation just leaves lat/lng null, same as before.
    const coords = await new Promise<{ lat: number; lng: number } | null>((resolve) => {
      if (!navigator.geolocation) { resolve(null); return }
      navigator.geolocation.getCurrentPosition(
        (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        () => resolve(null),
        { timeout: 5000 },
      )
    })
    addPhoto({
      projectId: form.projectId,
      caption: form.caption || 'Untitled photo',
      category: form.category,
      date: form.date,
      uploadedBy: form.uploadedBy,
      url: 'idb:' + form.blobKey,
      capturedAt: `${form.date}T${new Date().toTimeString().slice(0, 8)}`,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
    })
    onClose()
    setForm((f) => ({ ...f, caption: '', preview: '', blobKey: '' }))
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upload photo"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!form.preview || compressing}>{compressing ? 'Processing…' : 'Save photo'}</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Image file">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={(e) => onFile(e.target.files?.[0])}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
          />
        </Field>
        {form.preview && (
          <img src={form.preview} alt="preview" className="max-h-48 w-full rounded-lg object-cover" />
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Caption">
              <Input value={form.caption} onChange={(e) => set('caption', e.target.value)} placeholder="Describe the photo" />
            </Field>
          </div>
          <Field label="Project">
            <Select value={form.projectId} onChange={(e) => set('projectId', e.target.value)}>
              {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Category">
            <Select value={form.category} onChange={(e) => set('category', e.target.value)}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label="Date">
            <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="Uploaded by">
            <Input value={form.uploadedBy} onChange={(e) => set('uploadedBy', e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
