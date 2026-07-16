import { useMemo, useState } from 'react'
import { PackageCheck } from 'lucide-react'
import { useData } from '../store/DataContext'
import { Card, CardBody } from './ui/Card'
import { Button, Field, Select, Textarea } from './ui/Form'
import type { Material, MaterialCategory, Project } from '../types'

const CATEGORIES: { value: MaterialCategory; label: string }[] = [
  { value: 'cable', label: 'Cable' },
  { value: 'conduit', label: 'Conduit' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'splice', label: 'Splice' },
  { value: 'drop', label: 'Drop' },
  { value: 'consumable', label: 'Consumable' },
]

/** Who's submitting — mirrors Notification's requester discriminator (mutually
 *  exclusive employeeId/subcontractorId), plus a display name snapshot. */
export interface MaterialRequester {
  employeeId?: string | null
  subcontractorId?: string | null
  name: string
}

/** Select materials + quantities and submit as one batch "material list" — it
 *  routes to the project's supervisor, who uses it to go pick that material
 *  up (e.g. from the customer) and marks it fulfilled once done. Used by
 *  field/subcontractor/supervisor roles from Materials.tsx's non-admin view. */
export function MaterialRequestForm({ projects, requester }: { projects: Project[]; requester: MaterialRequester }) {
  const { data, addMaterialRequest } = useData()
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '')
  const [catFilter, setCatFilter] = useState<MaterialCategory | 'all'>('all')
  const [selected, setSelected] = useState<Map<string, number>>(new Map())
  const [notes, setNotes] = useState('')
  const [justSubmitted, setJustSubmitted] = useState(false)

  const filtered = useMemo(
    () => (catFilter === 'all' ? data.materials : data.materials.filter((m) => m.category === catFilter)),
    [data.materials, catFilter],
  )

  const toggle = (m: Material, checked: boolean) => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (checked) next.set(m.id, next.get(m.id) ?? 1)
      else next.delete(m.id)
      return next
    })
    setJustSubmitted(false)
  }

  const setQty = (materialId: string, qty: number) => {
    setSelected((prev) => {
      const next = new Map(prev)
      if (next.has(materialId)) next.set(materialId, Math.max(0, qty))
      return next
    })
  }

  const selectedCount = [...selected.values()].filter((q) => q > 0).length
  const canSubmit = !!projectId && selectedCount > 0

  const submit = () => {
    if (!canSubmit) return
    addMaterialRequest({
      projectId,
      requestedByEmployeeId: requester.employeeId ?? null,
      requestedBySubcontractorId: requester.subcontractorId ?? null,
      requestedByName: requester.name,
      items: [...selected.entries()].filter(([, qty]) => qty > 0).map(([materialId, quantity]) => ({ materialId, quantity })),
      notes: notes.trim() || null,
    })
    setSelected(new Map())
    setNotes('')
    setJustSubmitted(true)
  }

  if (projects.length === 0) {
    return (
      <Card>
        <CardBody>
          <p className="text-sm text-slate-500">
            You're not assigned to a project yet — ask your supervisor or admin to assign you before submitting a material list.
          </p>
        </CardBody>
      </Card>
    )
  }

  return (
    <Card>
      <CardBody>
        {justSubmitted && (
          <div className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            <PackageCheck size={16} /> Material list submitted to your supervisor.
          </div>
        )}

        <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Project" required>
            <Select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
              {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {(['all', ...CATEGORIES.map((c) => c.value)] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCatFilter(c as MaterialCategory | 'all')}
              className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                catFilter === c ? 'bg-brand-600 text-white' : 'bg-white text-slate-400 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {c === 'all' ? 'All' : CATEGORIES.find((x) => x.value === c)?.label}
            </button>
          ))}
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="w-10 px-4 py-2.5"></th>
                <th className="px-2 py-2.5 font-medium">Material</th>
                <th className="px-4 py-2.5 text-right font-medium">Quantity</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const checked = selected.has(m.id)
                return (
                  <tr key={m.id} className={`border-b border-slate-50 last:border-0 ${checked ? 'bg-brand-50/40' : ''}`}>
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(e) => toggle(m, e.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-200"
                        aria-label={`Select ${m.name}`}
                      />
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="font-medium text-slate-800">{m.name}</span>
                      <span className="ml-2 text-xs capitalize text-slate-400">{m.category}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <input
                          type="number"
                          min={0}
                          disabled={!checked}
                          value={selected.get(m.id) ?? ''}
                          onChange={(e) => setQty(m.id, Number(e.target.value))}
                          className="w-20 rounded-md border border-slate-300 px-2 py-1 text-right text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100 disabled:bg-slate-50 disabled:text-slate-300"
                        />
                        <span className="w-8 text-left text-xs text-slate-500">{m.unit}</span>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={3} className="px-5 py-10 text-center text-slate-500">No materials in this category.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4">
          <Field label="Notes for your supervisor (optional)">
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. Need this by Thursday for the Maple St crew" />
          </Field>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <p className="text-xs text-slate-500">{selectedCount} item{selectedCount === 1 ? '' : 's'} selected</p>
          <Button onClick={submit} disabled={!canSubmit}>
            <PackageCheck size={16} /> Submit material list
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}
