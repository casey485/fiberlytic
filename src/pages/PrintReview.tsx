import { useEffect, useMemo, useState } from 'react'
import { Link, useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Download, Save, Plus, Search, CheckCheck, FileText, MapPin, Spline, Undo2, Eraser, Check, Receipt } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { StatCard } from '../components/ui/StatCard'
import { Badge } from '../components/ui/Badge'
import { Button, Input, Select } from '../components/ui/Form'
import { MapView } from '../components/MapView'
import { ObjectEditorDrawer } from '../components/ObjectEditorDrawer'
import { printStore, usePrintSession } from '../features/printkmz/store'
import { isSupabaseConfigured } from '../features/printkmz/supabase'
import { exportKmz } from '../features/printkmz/kmz'
import { makeObject } from '../features/printkmz/detect'
import { legendSummary } from '../features/printkmz/legendEngine'
import { OBJECT_TYPES, objectMeta } from '../features/printkmz/types'
import type { DetectedObject, ObjectType } from '../features/printkmz/types'
import { number } from '../lib/format'

export function PrintReview() {
  const { sessionId } = useParams<{ sessionId: string }>()
  const navigate = useNavigate()
  const session = usePrintSession(sessionId)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [typeFilter, setTypeFilter] = useState<ObjectType | 'all'>('all')
  const [query, setQuery] = useState('')
  const [drawingId, setDrawingId] = useState<string | null>(null)
  const [saveState, setSaveState] = useState<{ kind: 'idle' | 'saving' | 'ok' | 'err'; msg?: string }>({ kind: 'idle' })

  const objects = useMemo(() => session?.objects ?? [], [session])

  const filtered = useMemo(() => {
    return objects.filter(
      (o) =>
        (typeFilter === 'all' || o.type === typeFilter) &&
        (!query ||
          `${o.label} ${o.roadName ?? ''} ${o.feeder ?? ''} ${o.section ?? ''}`
            .toLowerCase()
            .includes(query.toLowerCase())),
    )
  }, [objects, typeFilter, query])

  const selected = objects.find((o) => o.id === selectedId) ?? null

  // Stop drawing if the selection moves to a different object.
  useEffect(() => {
    if (drawingId && drawingId !== selectedId) setDrawingId(null)
  }, [selectedId, drawingId])

  if (!session) {
    return (
      <div>
        <Link to="/print-reader" className="mb-4 inline-flex items-center gap-1 text-sm text-brand-600">
          <ArrowLeft size={16} /> Back to Print Reader
        </Link>
        <Card className="p-10 text-center text-slate-500">Session not found.</Card>
      </div>
    )
  }

  const cover = session.extraction.cover
  const approvedCount = objects.filter((o) => o.status === 'approved').length
  const productionTotal = objects.reduce((s, o) => s + (o.productionQuantity ?? 0), 0)
  const billingTotal = objects.reduce((s, o) => s + (o.billingQuantity ?? 0), 0)

  const update = (id: string, patch: Partial<DetectedObject>) => printStore.updateObject(session.id, id, patch)

  // Keep `position` anchored to the first route vertex so point fallback + KMZ stay consistent.
  const setPath = (id: string, path: DetectedObject['path']) =>
    update(id, { path, position: path && path.length ? path[0] : objects.find((o) => o.id === id)!.position })
  const appendVertex = (id: string, pos: { lng: number; lat: number }) => {
    const obj = objects.find((o) => o.id === id)
    setPath(id, [...(obj?.path ?? []), pos])
  }
  const undoVertex = (id: string) => {
    const obj = objects.find((o) => o.id === id)
    setPath(id, (obj?.path ?? []).slice(0, -1))
  }

  const addObject = (type: ObjectType) => {
    const obj = makeObject(session.id, type, { ...session.center }, {
      feeder: cover.feeder,
      section: cover.section,
    })
    printStore.addObject(session.id, obj)
    setSelectedId(obj.id)
  }

  const approveAll = () => objects.forEach((o) => o.status === 'pending' && update(o.id, { status: 'approved' }))

  const onSave = async () => {
    setSaveState({ kind: 'saving' })
    const res = await printStore.save(session.id)
    if (res.ok) {
      setSaveState({ kind: 'ok', msg: res.offline ? 'Saved locally (Supabase not configured)' : `Saved ${res.count} objects to Supabase` })
    } else {
      setSaveState({ kind: 'err', msg: res.error })
    }
    setTimeout(() => setSaveState({ kind: 'idle' }), 4000)
  }

  return (
    <div>
      <Link to="/print-reader" className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
        <ArrowLeft size={16} /> Back to Print Reader
      </Link>

      <PageHeader
        title={cover.projectName || session.fileName}
        description={[
          [cover.city, cover.county, cover.state].filter(Boolean).join(', '),
          `${session.pageCount} page${session.pageCount === 1 ? '' : 's'}`,
          `${objects.length} objects`,
        ]
          .filter(Boolean)
          .join(' · ')}
        action={
          <>
            <Badge tone={isSupabaseConfigured ? 'green' : 'slate'}>{isSupabaseConfigured ? 'Supabase' : 'Local'}</Badge>
            <Button variant="secondary" onClick={onSave} disabled={saveState.kind === 'saving'}>
              <Save size={16} /> {saveState.kind === 'saving' ? 'Saving…' : 'Save'}
            </Button>
            <Button variant="secondary" onClick={() => navigate('/invoicing', { state: { fromSession: session.id } })}>
              <Receipt size={16} /> Create invoice
            </Button>
            <Button onClick={() => exportKmz(session)}>
              <Download size={16} /> Export KMZ
            </Button>
          </>
        }
      />

      {saveState.msg && (
        <div className={`mb-4 rounded-lg px-4 py-2 text-sm ${saveState.kind === 'err' ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>
          {saveState.msg}
        </div>
      )}

      {/* Cover info */}
      <Card className="mb-6">
        <CardHeader title="Cover sheet" subtitle="Project identity read from the first page" />
        <CardBody>
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <CoverField label="Project" value={cover.projectName} />
            <CoverField label="City" value={cover.city} />
            <CoverField label="County" value={cover.county} />
            <CoverField label="State" value={cover.state} />
            <CoverField label="Feeder" value={cover.feeder} />
            <CoverField label="Section" value={cover.section} />
          </div>
          {cover.sheetIndex.length > 0 && (
            <p className="mt-3 text-xs text-slate-400">
              Sheet index: {cover.sheetIndex.slice(0, 8).join(' · ')}
              {cover.sheetIndex.length > 8 && ` +${cover.sheetIndex.length - 8} more`}
            </p>
          )}
        </CardBody>
      </Card>

      {/* Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <StatCard label="Objects" value={String(objects.length)} />
        <StatCard label="Approved" value={`${approvedCount} / ${objects.length}`} />
        <StatCard label="Production qty" value={number(productionTotal)} />
        <StatCard label="Billing qty" value={number(billingTotal)} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-5">
        {/* Object list */}
        <Card className="lg:col-span-2">
          <CardHeader
            title="Detected objects"
            action={
              <button onClick={approveAll} className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700">
                <CheckCheck size={14} /> Approve all
              </button>
            }
          />
          <CardBody className="space-y-3">
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Search size={14} className="absolute left-2.5 top-2.5 text-slate-400" />
                <Input className="!pl-8" placeholder="Search…" value={query} onChange={(e) => setQuery(e.target.value)} />
              </div>
              <Select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as ObjectType | 'all')} className="w-40">
                <option value="all">All types</option>
                {OBJECT_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
              </Select>
            </div>

            <div className="flex flex-wrap gap-1.5">
              {OBJECT_TYPES.map((t) => (
                <button
                  key={t.type}
                  onClick={() => addObject(t.type)}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50"
                  title={`Add ${t.label}`}
                >
                  <Plus size={11} /> {t.label}
                </button>
              ))}
            </div>

            <ul className="max-h-[460px] space-y-1.5 overflow-y-auto">
              {filtered.map((o) => {
                const meta = objectMeta(o.type)
                const sub = [o.roadName, o.feeder && `FDR ${o.feeder}`, o.section && `SEC ${o.section}`, o.footage && `${o.footage} LF`]
                  .filter(Boolean)
                  .join(' · ')
                return (
                  <li key={o.id}>
                    <button
                      onClick={() => setSelectedId(o.id)}
                      className={`flex w-full items-center justify-between rounded-lg border px-3 py-2 text-left ${
                        o.id === selectedId ? 'border-brand-400 bg-brand-50/40' : 'border-slate-200 hover:bg-slate-50'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span
                          className="h-2.5 w-2.5 shrink-0"
                          style={{ background: meta.color, borderRadius: meta.linear ? '2px' : '9999px' }}
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium text-slate-800">{o.label}</span>
                          <span className="block truncate text-xs text-slate-400">{sub || meta.label}</span>
                        </span>
                      </span>
                      <Badge tone={o.status === 'approved' ? 'green' : o.status === 'rejected' ? 'red' : 'amber'}>{o.status}</Badge>
                    </button>
                  </li>
                )
              })}
              {filtered.length === 0 && <li className="py-6 text-center text-sm text-slate-400">No objects match.</li>}
            </ul>
          </CardBody>
        </Card>

        {/* Map */}
        <Card className="overflow-hidden lg:col-span-3">
          <MapToolbar
            selected={selected}
            drawingId={drawingId}
            onToggleDraw={() => setDrawingId((d) => (d === selected?.id ? null : selected?.id ?? null))}
            onUndo={() => selected && undoVertex(selected.id)}
            onClear={() => selected && setPath(selected.id, [])}
          />
          <div className="h-[520px]">
            <MapView
              objects={objects}
              center={session.center}
              selectedId={selectedId}
              drawingId={drawingId}
              onSelect={setSelectedId}
              onMove={(id, pos) => update(id, { position: pos })}
              onAppendVertex={appendVertex}
              onPathChange={setPath}
            />
          </div>
        </Card>
      </div>

      {/* Legend */}
      <Card className="mt-6">
        <CardHeader title="Legend" subtitle={legendSummary(session.legend)} />
        <CardBody>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {session.legend.rules.map((r) => {
              const meta = objectMeta(r.objectType)
              return (
                <div key={r.objectType} className="flex items-center gap-2 rounded-lg border border-slate-100 px-3 py-2">
                  <span className="h-3 w-3 shrink-0" style={{ background: meta.color, borderRadius: meta.linear ? '2px' : '9999px' }} />
                  <div className="min-w-0">
                    <p className="truncate text-sm text-slate-700">{r.label}</p>
                    <p className="text-xs text-slate-400">
                      {[r.colorName, r.lineStyle, r.symbol].filter(Boolean).join(' · ') || '—'}
                    </p>
                  </div>
                  {r.confirmedByLegend && <Badge tone="green">legend</Badge>}
                </div>
              )
            })}
          </div>
          {session.legend.entries.length > 0 && (
            <div className="mt-4">
              <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Legend lines read</p>
              <ul className="max-h-40 space-y-0.5 overflow-y-auto text-sm text-slate-600">
                {session.legend.entries.map((e, i) => <li key={i} className="truncate">{e}</li>)}
              </ul>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Extraction */}
      <Card className="mt-6">
        <CardHeader title="Extracted from print" subtitle="OCR results" />
        <CardBody>
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
            <ExtractionList title="Feeders" items={session.extraction.feeders} />
            <ExtractionList title="Sections" items={session.extraction.sections} />
            <ExtractionList title="Fiber counts" items={session.extraction.fiberCounts} />
            <ExtractionList title="Sheets" items={session.extraction.sheets} />
            <ExtractionList title="Stations" items={session.extraction.stations} />
            <ExtractionList title="Streets" items={session.extraction.streets} />
            <ExtractionList title="Footage labels" items={session.extraction.footageLabels} />
            <ExtractionList title="Span lengths" items={session.extraction.spanLengths} />
            <ExtractionList title="Construction notes" items={session.extraction.notes} />
          </div>
          {session.thumbnails.length > 0 && (
            <div className="mt-6">
              <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                <FileText size={13} /> Pages
              </p>
              <div className="flex flex-wrap gap-3">
                {session.thumbnails.map((src, i) => (
                  <div key={i} className="relative">
                    <img src={src} alt={`Page ${i + 1}`} className="h-40 rounded-lg border border-slate-200" />
                    {session.legend.legendPageIndex === i && (
                      <span className="absolute left-1 top-1"><Badge tone="blue">legend</Badge></span>
                    )}
                    {i === 0 && (
                      <span className="absolute right-1 top-1"><Badge tone="slate">cover</Badge></span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardBody>
      </Card>

      {selected && (
        <ObjectEditorDrawer
          object={selected}
          onClose={() => setSelectedId(null)}
          onChange={(patch) => update(selected.id, patch)}
          onDelete={() => {
            printStore.deleteObject(session.id, selected.id)
            setSelectedId(null)
          }}
        />
      )}
    </div>
  )
}

function MapToolbar({
  selected,
  drawingId,
  onToggleDraw,
  onUndo,
  onClear,
}: {
  selected: DetectedObject | null
  drawingId: string | null
  onToggleDraw: () => void
  onUndo: () => void
  onClear: () => void
}) {
  const isLinear = selected ? objectMeta(selected.type).linear : false
  const drawing = !!selected && drawingId === selected.id
  const vertices = selected?.path?.length ?? 0

  const btn = 'inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-medium transition'

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2">
      <span className="flex items-center gap-1.5 text-xs text-slate-500">
        <Spline size={14} className="text-slate-400" />
        {!selected
          ? 'Select an object to edit it on the map.'
          : !isLinear
            ? `${objectMeta(selected.type).label} — drag the marker to position it.`
            : drawing
              ? `Drawing route — click the map to add points (${vertices}). Drag points to adjust.`
              : `${objectMeta(selected.type).label} — draw its route on the map.`}
      </span>
      {isLinear && selected && (
        <div className="flex items-center gap-1.5">
          {drawing ? (
            <>
              <button onClick={onUndo} className={`${btn} border border-slate-200 text-slate-600 hover:bg-slate-50`}>
                <Undo2 size={13} /> Undo
              </button>
              <button onClick={onClear} className={`${btn} border border-slate-200 text-rose-600 hover:bg-rose-50`}>
                <Eraser size={13} /> Clear
              </button>
              <button onClick={onToggleDraw} className={`${btn} bg-brand-600 text-white hover:bg-brand-700`}>
                <Check size={13} /> Done
              </button>
            </>
          ) : (
            <button onClick={onToggleDraw} className={`${btn} bg-brand-600 text-white hover:bg-brand-700`}>
              <Spline size={13} /> {vertices >= 2 ? 'Edit route' : 'Draw route'}
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function CoverField({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 flex items-center gap-1 font-medium text-slate-800">
        {label === 'City' && value && <MapPin size={12} className="text-slate-400" />}
        {value || <span className="text-slate-300">—</span>}
      </p>
    </div>
  )
}

function ExtractionList({ title, items }: { title: string; items: string[] }) {
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {title} <span className="text-slate-300">({items.length})</span>
      </p>
      {items.length === 0 ? (
        <p className="text-sm text-slate-400">None found.</p>
      ) : (
        <ul className="max-h-40 space-y-0.5 overflow-y-auto text-sm text-slate-700">
          {items.map((it, i) => (
            <li key={i} className="truncate rounded px-1 hover:bg-slate-50" title={it}>{it}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
