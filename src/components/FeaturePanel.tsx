import { useState } from 'react'
import { X, ChevronDown, Save, Trash2, Ruler } from 'lucide-react'
import { useData } from '../store/DataContext'
import { localDateStr } from '../lib/format'
import { FEATURE_STATUS_META } from '../types'
import type { MapFeature, FeatureStatus } from '../types'

const STATUSES: FeatureStatus[] = ['not_started', 'in_progress', 'complete', 'issue', 'rework']
const WORK_TYPES = ['Trench', 'Directional Bore', 'Aerial', 'Hand Dig', 'Splice', 'MDU', 'Cable Plow', 'Restoration']
const INSTALL_TYPES = ['Conduit', 'Direct Bury', 'Aerial Lash', 'Aerial Self-Support', 'HDPE', 'Other']

function StatusDot({ status }: { status: FeatureStatus }) {
  const meta = FEATURE_STATUS_META[status]
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium" style={{ color: meta.color }}>
      <span className="h-2 w-2 rounded-full shrink-0" style={{ background: meta.color }} />
      {meta.label}
    </span>
  )
}

interface Props {
  feature: MapFeature
  onClose: () => void
  onStatusChange?: (id: string, status: FeatureStatus) => void
}

export function FeaturePanel({ feature, onClose, onStatusChange }: Props) {
  const { data, addFeatureProduction, deleteFeatureProduction, setFeatureStatus, updateMapFeature } = useData()
  const [tab, setTab] = useState<'production' | 'history' | 'details'>('production')

  // Production form state
  const today = localDateStr()
  const [date,             setDate]             = useState(today)
  const [crewId,           setCrewId]           = useState(data.crews[0]?.id ?? '')
  const [workType,         setWorkType]         = useState<string>('')
  const [unitCode,         setUnitCode]         = useState<string>('')
  const [installType,      setInstallType]      = useState<string>('')
  const [footageCompleted, setFootageCompleted] = useState<number>(feature.calculatedLengthFt ?? 0)
  const [rockFootage,      setRockFootage]      = useState<number>(0)
  const [handholes,        setHandholes]        = useState<number>(0)
  const [quantity,         setQuantity]         = useState<number>(feature.calculatedLengthFt ?? 0)
  const [rate,             setRate]             = useState<number>(0)
  const [laborCost,        setLaborCost]        = useState<number>(0)
  const [equipmentCost,    setEquipmentCost]    = useState<number>(0)
  const [materialCost,     setMaterialCost]     = useState<number>(0)
  const [notes,            setNotes]            = useState('')
  const [restoration,      setRestoration]      = useState(false)
  const [entryStatus,      setEntryStatus]      = useState<FeatureStatus>('in_progress')
  const [saving,           setSaving]           = useState(false)

  const revenueAmount = Math.round(quantity * rate * 100) / 100
  const totalCost     = laborCost + equipmentCost + materialCost
  const profit        = revenueAmount - totalCost
  const margin        = revenueAmount > 0 ? Math.round((profit / revenueAmount) * 100) : 0

  const selectedCrew = data.crews.find((c) => c.id === crewId)
  const history = (data.featureProduction ?? [])
    .filter((e) => e.mapFeatureId === feature.id)
    .sort((a, b) => b.date.localeCompare(a.date))

  // Try to auto-fill rate from rate card
  function lookupRate(code: string) {
    if (!code) return
    const unit = data.rateCardUnits.find((u) => u.unitCode.toLowerCase() === code.toLowerCase())
    if (unit) setRate(unit.rate)
  }

  async function save() {
    if (!crewId) return
    setSaving(true)
    addFeatureProduction({
      projectId: feature.projectId,
      mapFeatureId: feature.id,
      crewId,
      crewName: selectedCrew?.name ?? crewId,
      date,
      workType:          workType || null,
      unitCode:          unitCode || null,
      footageCompleted,
      rockFootage,
      handholes,
      quantity,
      rate,
      revenueAmount,
      laborCost,
      equipmentCost,
      materialCost,
      totalCost,
      profit,
      notes:       notes || null,
      status:      entryStatus,
      installType: installType || null,
      restorationNeeded: restoration,
      crewMemberIds: [],
    })
    onStatusChange?.(feature.id, entryStatus)
    // Reset form
    setNotes('')
    setRockFootage(0)
    setHandholes(0)
    setSaving(false)
    setTab('history')
  }

  function handleDeleteEntry(id: string) {
    if (confirm('Delete this production entry?')) deleteFeatureProduction(id)
  }

  function handleStatusChange(s: FeatureStatus) {
    setFeatureStatus(feature.id, s)
    onStatusChange?.(feature.id, s)
  }

  const geo = (() => { try { return JSON.parse(feature.geometryGeoJson) } catch { return null } })()
  const coordCount = geo?.coordinates
    ? (Array.isArray(geo.coordinates[0]) ? (geo.coordinates as number[][]).length : 1)
    : 0

  return (
    <div className="flex h-full flex-col bg-[#0d0d0d] text-slate-200">
      {/* Header */}
      <div className="flex items-start gap-2 border-b border-[#1e1e1e] px-4 py-3">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold truncate">{feature.name ?? '(unnamed feature)'}</p>
          <p className="text-xs text-slate-500 truncate mt-0.5">{feature.layerName} · {feature.featureType}</p>
        </div>
        <button onClick={onClose} className="shrink-0 rounded p-1 text-slate-500 hover:text-white hover:bg-white/5 transition">
          <X size={14} />
        </button>
      </div>

      {/* Status bar */}
      <div className="flex items-center gap-2 border-b border-[#1e1e1e] px-4 py-2">
        <StatusDot status={feature.status} />
        <div className="relative ml-auto">
          <select
            value={feature.status}
            onChange={(e) => handleStatusChange(e.target.value as FeatureStatus)}
            className="rounded border border-[#2a3347] bg-[#141414] px-2 py-1 text-[11px] text-slate-300 appearance-none pr-5 outline-none focus:border-brand-500"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>{FEATURE_STATUS_META[s].label}</option>
            ))}
          </select>
          <ChevronDown size={10} className="absolute right-1.5 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
        </div>
      </div>

      {/* Quick stats */}
      <div className="flex items-center gap-4 border-b border-[#1e1e1e] px-4 py-2 text-xs">
        {feature.calculatedLengthFt != null && (
          <span className="flex items-center gap-1 text-slate-400">
            <Ruler size={11} className="text-slate-600" />
            {feature.calculatedLengthFt.toLocaleString()} ft
          </span>
        )}
        {feature.fiberCount && (
          <span className="text-slate-400">{feature.fiberCount}-count</span>
        )}
        {feature.feederName && (
          <span className="text-slate-400">{feature.feederName}</span>
        )}
        <span className="text-slate-500">{history.length} entr{history.length === 1 ? 'y' : 'ies'}</span>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[#1e1e1e]">
        {(['production', 'history', 'details'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-2 text-xs font-medium transition ${
              tab === t
                ? 'border-b-2 border-brand-500 text-brand-400'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            {t === 'production' ? 'Production' : t === 'history' ? `History (${history.length})` : 'Details'}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">

        {/* PRODUCTION TAB */}
        {tab === 'production' && (
          <div className="p-4 space-y-3">
            {/* Date + Crew row */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-brand-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Crew</label>
                <select
                  value={crewId}
                  onChange={(e) => setCrewId(e.target.value)}
                  className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-brand-500"
                >
                  <option value="">— select —</option>
                  {data.crews.filter((c) => c.status !== 'off').map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Work type + Install type */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Work Type</label>
                <select
                  value={workType}
                  onChange={(e) => setWorkType(e.target.value)}
                  className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-brand-500"
                >
                  <option value="">— select —</option>
                  {WORK_TYPES.map((w) => <option key={w} value={w}>{w}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Install Type</label>
                <select
                  value={installType}
                  onChange={(e) => setInstallType(e.target.value)}
                  className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-brand-500"
                >
                  <option value="">— select —</option>
                  {INSTALL_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
            </div>

            {/* Unit code + Rate */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Unit Code</label>
                <input
                  type="text"
                  placeholder="e.g. UG-LF"
                  value={unitCode}
                  onChange={(e) => { setUnitCode(e.target.value); lookupRate(e.target.value) }}
                  className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-brand-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Rate ($/unit)</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={rate}
                  onChange={(e) => setRate(parseFloat(e.target.value) || 0)}
                  className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-brand-500"
                />
              </div>
            </div>

            {/* Footage + Quantity */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Footage Completed (ft)</label>
                <input
                  type="number"
                  min={0}
                  value={footageCompleted}
                  onChange={(e) => { const v = parseFloat(e.target.value) || 0; setFootageCompleted(v); setQuantity(v) }}
                  className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-brand-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Quantity (billable)</label>
                <input
                  type="number"
                  min={0}
                  value={quantity}
                  onChange={(e) => setQuantity(parseFloat(e.target.value) || 0)}
                  className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-brand-500"
                />
              </div>
            </div>

            {/* Rock footage + Handholes */}
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Rock Footage (ft)</label>
                <input
                  type="number"
                  min={0}
                  value={rockFootage}
                  onChange={(e) => setRockFootage(parseFloat(e.target.value) || 0)}
                  className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-brand-500"
                />
              </div>
              <div>
                <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Handholes (#)</label>
                <input
                  type="number"
                  min={0}
                  value={handholes}
                  onChange={(e) => setHandholes(parseInt(e.target.value) || 0)}
                  className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-brand-500"
                />
              </div>
            </div>

            {/* Cost inputs */}
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Labor $', val: laborCost, set: setLaborCost },
                { label: 'Equipment $', val: equipmentCost, set: setEquipmentCost },
                { label: 'Material $', val: materialCost, set: setMaterialCost },
              ].map(({ label, val, set }) => (
                <div key={label}>
                  <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">{label}</label>
                  <input
                    type="number"
                    min={0}
                    step={0.01}
                    value={val}
                    onChange={(e) => set(parseFloat(e.target.value) || 0)}
                    className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-brand-500"
                  />
                </div>
              ))}
            </div>

            {/* Revenue / Cost / Profit summary */}
            <div className="rounded-md border border-[#2a3347] bg-[#0a0f1a] p-3 space-y-1.5">
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Revenue ({quantity} × ${rate})</span>
                <span className="text-emerald-400 font-semibold">${revenueAmount.toLocaleString('en', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between text-xs">
                <span className="text-slate-500">Total Cost</span>
                <span className="text-red-400">${totalCost.toLocaleString('en', { minimumFractionDigits: 2 })}</span>
              </div>
              <div className="border-t border-[#1e1e1e] pt-1.5 flex justify-between text-xs font-semibold">
                <span className="text-slate-300">Profit ({margin}% margin)</span>
                <span className={profit >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                  ${profit.toLocaleString('en', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>

            {/* Notes */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Notes</label>
              <textarea
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Field conditions, issues, special notes…"
                className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-brand-500 resize-none"
              />
            </div>

            {/* Restoration checkbox */}
            <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
              <input
                type="checkbox"
                checked={restoration}
                onChange={(e) => setRestoration(e.target.checked)}
                className="rounded"
              />
              Restoration needed
            </label>

            {/* Status after entry */}
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Mark Feature As</label>
              <div className="flex flex-wrap gap-1.5">
                {STATUSES.map((s) => (
                  <button
                    key={s}
                    onClick={() => setEntryStatus(s)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-medium border transition ${
                      entryStatus === s
                        ? 'border-transparent text-white'
                        : 'border-[#2a3347] text-slate-500 hover:text-slate-300'
                    }`}
                    style={entryStatus === s ? { background: FEATURE_STATUS_META[s].color } : {}}
                  >
                    {FEATURE_STATUS_META[s].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Save */}
            <button
              onClick={save}
              disabled={saving || !crewId}
              className="w-full flex items-center justify-center gap-2 rounded-md bg-brand-600 py-2 text-xs font-semibold text-white hover:bg-brand-500 disabled:opacity-40 transition"
            >
              <Save size={13} /> {saving ? 'Saving…' : 'Save Production Entry'}
            </button>
          </div>
        )}

        {/* HISTORY TAB */}
        {tab === 'history' && (
          <div className="p-4 space-y-3">
            {history.length === 0 ? (
              <p className="text-xs text-slate-600 text-center py-8">No production entries yet.</p>
            ) : (
              <>
                {/* Totals */}
                <div className="rounded-md border border-[#2a3347] bg-[#0a0f1a] p-3 grid grid-cols-2 gap-2 text-xs">
                  {[
                    { label: 'Total Footage', val: `${history.reduce((s, e) => s + e.footageCompleted, 0).toLocaleString()} ft` },
                    { label: 'Revenue', val: `$${history.reduce((s, e) => s + e.revenueAmount, 0).toLocaleString('en', { minimumFractionDigits: 0 })}` },
                    { label: 'Total Cost', val: `$${history.reduce((s, e) => s + e.totalCost, 0).toLocaleString('en', { minimumFractionDigits: 0 })}` },
                    { label: 'Profit', val: `$${history.reduce((s, e) => s + e.profit, 0).toLocaleString('en', { minimumFractionDigits: 0 })}` },
                  ].map(({ label, val }) => (
                    <div key={label}>
                      <p className="text-slate-500">{label}</p>
                      <p className="text-slate-200 font-semibold">{val}</p>
                    </div>
                  ))}
                </div>

                {history.map((e) => (
                  <div key={e.id} className="rounded-md border border-[#1e2430] bg-[#0d1117] p-3 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium text-slate-200">{e.date}</span>
                      <div className="flex items-center gap-2">
                        <StatusDot status={e.status} />
                        <button
                          onClick={() => handleDeleteEntry(e.id)}
                          className="text-slate-600 hover:text-red-400 transition"
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </div>
                    <p className="text-xs text-slate-400">{e.crewName} · {e.workType ?? 'No work type'}</p>
                    <div className="flex items-center gap-3 text-[11px] text-slate-500">
                      {e.footageCompleted > 0 && <span>{e.footageCompleted.toLocaleString()} ft</span>}
                      {e.handholes > 0 && <span>{e.handholes} handholes</span>}
                      {e.rockFootage > 0 && <span>{e.rockFootage} ft rock</span>}
                      {e.revenueAmount > 0 && <span className="text-emerald-500 ml-auto">${e.revenueAmount.toLocaleString('en', { minimumFractionDigits: 0 })}</span>}
                    </div>
                    {e.notes && <p className="text-[11px] text-slate-500 italic">{e.notes}</p>}
                    {e.restorationNeeded && <p className="text-[11px] text-orange-400">⚠ Restoration needed</p>}
                  </div>
                ))}
              </>
            )}
          </div>
        )}

        {/* DETAILS TAB */}
        {tab === 'details' && (
          <div className="p-4 space-y-3">
            {feature.description && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Description</p>
                <p className="text-xs text-slate-300 leading-relaxed">{feature.description}</p>
              </div>
            )}

            <div className="space-y-1.5 text-xs">
              {[
                ['Layer', feature.layerName],
                ['Type', feature.featureType],
                ['Length', feature.calculatedLengthFt != null ? `${feature.calculatedLengthFt.toLocaleString()} ft` : null],
                ['Fiber Count', feature.fiberCount?.toString() ?? null],
                ['Feeder', feature.feederName],
                ['Work Type', feature.workType],
                ['Install Type', feature.installType],
                ['Style Color', feature.styleColor],
                ['Coordinates', coordCount > 0 ? `${coordCount} pts` : null],
              ].filter(([, v]) => v).map(([k, v]) => (
                <div key={k as string} className="flex gap-2">
                  <span className="w-28 shrink-0 text-slate-500">{k}</span>
                  <span className="text-slate-300">{v}</span>
                </div>
              ))}
            </div>

            {feature.extendedData && Object.keys(feature.extendedData).length > 0 && (
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1.5">Extended Data</p>
                <div className="rounded-md border border-[#1e2430] divide-y divide-[#1e2430] overflow-hidden">
                  {Object.entries(feature.extendedData).map(([k, v]) => (
                    <div key={k} className="flex gap-2 px-2 py-1.5">
                      <span className="w-28 shrink-0 text-[11px] text-slate-500 truncate">{k}</span>
                      <span className="text-[11px] text-slate-300 truncate">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Assign crew to feature */}
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-1">Assigned Crew</p>
              <select
                value={feature.assignedCrewId ?? ''}
                onChange={(e) => updateMapFeature(feature.id, { assignedCrewId: e.target.value || null })}
                className="w-full rounded border border-[#2a3347] bg-[#141414] px-2 py-1.5 text-xs text-slate-200 outline-none focus:border-brand-500"
              >
                <option value="">— none —</option>
                {data.crews.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
