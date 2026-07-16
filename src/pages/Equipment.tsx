import { useState } from 'react'
import { Plus, Pencil, Trash2, Wrench } from 'lucide-react'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardBody } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Button, Field, Input, Select, Textarea } from '../components/ui/Form'
import { money, localDateStr } from '../lib/format'
import { daysInMonth } from '../lib/analytics'
import type { Equipment, EquipmentCategory } from '../types'

const TODAY = localDateStr()

const CATEGORIES: EquipmentCategory[] = [
  'Bore Rig',
  'Bucket Truck',
  'Mini Excavator',
  'Vac Truck',
  'Trailer',
  'Trencher',
  'Other',
]

type EqForm = {
  name: string
  category: EquipmentCategory
  description: string
  monthlyCost: string
  crewId: string
  deployedFrom: string
  active: boolean
}

const today = () => localDateStr()

const blankForm = (): EqForm => ({
  name: '',
  category: 'Bore Rig',
  description: '',
  monthlyCost: '',
  crewId: '',
  deployedFrom: today(),
  active: true,
})

function equipmentToForm(eq: Equipment): EqForm {
  return {
    name: eq.name,
    category: eq.category,
    description: eq.description ?? '',
    monthlyCost: String(eq.monthlyCost),
    crewId: eq.crewId ?? '',
    deployedFrom: eq.deployedFrom ?? today(),
    active: eq.active,
  }
}

function EquipmentModal({
  initial,
  onClose,
  onSave,
}: {
  initial?: Equipment
  onClose: () => void
  onSave: (form: EqForm) => void
}) {
  const { data } = useData()
  const [form, setForm] = useState<EqForm>(initial ? equipmentToForm(initial) : blankForm())
  const set = <K extends keyof EqForm>(k: K, v: EqForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  const monthly = parseFloat(form.monthlyCost) || 0
  const daily = monthly / daysInMonth(TODAY)

  const valid = form.name.trim() && monthly > 0

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? `Edit — ${initial.name}` : 'Add equipment'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} onClick={() => onSave(form)}>
            {initial ? 'Save changes' : 'Add equipment'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Equipment name">
            <Input
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              placeholder="e.g. McLaughlin Vermeer 24/40 Bore Rig"
              autoFocus
            />
          </Field>
        </div>
        <Field label="Category">
          <Select value={form.category} onChange={(e) => set('category', e.target.value as EquipmentCategory)}>
            {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field label="Assign to crew">
          <Select value={form.crewId} onChange={(e) => set('crewId', e.target.value)}>
            <option value="">— Unassigned —</option>
            {data.crews.filter((c) => c.status !== 'off').map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </Select>
        </Field>
        <Field label="Deployed to site on">
          <Input
            type="date"
            value={form.deployedFrom}
            onChange={(e) => set('deployedFrom', e.target.value)}
          />
        </Field>
        <Field label="Monthly cost ($)">
          <Input
            type="number"
            min="0"
            step="0.01"
            value={form.monthlyCost}
            onChange={(e) => set('monthlyCost', e.target.value)}
            placeholder="0.00"
          />
        </Field>
        <Field label="Daily cost (auto)">
          <div className="flex h-10 items-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">
            {daily > 0 ? money(daily) : '—'}
            {daily > 0 && <span className="ml-1.5 text-xs font-normal text-slate-500">/ day · {daysInMonth(TODAY)} days this month</span>}
          </div>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description (optional)">
            <Textarea
              rows={2}
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="Serial number, VIN, notes..."
            />
          </Field>
        </div>
        <div className="sm:col-span-2 flex items-center gap-3">
          <input
            id="eq-active"
            type="checkbox"
            checked={form.active}
            onChange={(e) => set('active', e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-brand-600"
          />
          <label htmlFor="eq-active" className="text-sm text-slate-700">Active — include in crew daily cost calculations</label>
        </div>
      </div>
    </Modal>
  )
}

export function EquipmentPage() {
  const { data, addEquipment, updateEquipment, deleteEquipment } = useData()
  const { isAdmin } = useRole()
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState<Equipment | null>(null)

  const save = (form: EqForm, existing?: Equipment) => {
    const payload = {
      name: form.name.trim(),
      category: form.category,
      description: form.description.trim() || undefined,
      monthlyCost: parseFloat(form.monthlyCost) || 0,
      crewId: form.crewId || null,
      deployedFrom: form.crewId ? form.deployedFrom : undefined,
      active: form.active,
    }
    if (existing) {
      updateEquipment(existing.id, payload)
    } else {
      addEquipment(payload)
    }
    setAdding(false)
    setEditing(null)
  }

  const remove = (eq: Equipment) => {
    if (confirm(`Delete "${eq.name}"? This cannot be undone.`)) {
      deleteEquipment(eq.id)
    }
  }

  const totalMonthly = data.equipment.filter((e) => e.active).reduce((s, e) => s + e.monthlyCost, 0)
  const totalDaily = totalMonthly / daysInMonth(TODAY)

  // Group equipment by crew for the summary cards
  const byCrew = new Map<string | null, Equipment[]>()
  for (const eq of data.equipment) {
    const key = eq.crewId
    byCrew.set(key, [...(byCrew.get(key) ?? []), eq])
  }

  return (
    <div>
      <PageHeader
        title="Equipment"
        description="Track crew equipment with monthly costs amortized to a daily rate on production entries."
        action={
          isAdmin ? (
            <Button onClick={() => setAdding(true)}>
              <Plus size={16} /> Add equipment
            </Button>
          ) : undefined
        }
      />

      {/* Summary strip */}
      {isAdmin && data.equipment.length > 0 && (
        <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Active pieces</p>
            <p className="mt-1 text-2xl font-bold text-slate-800">{data.equipment.filter((e) => e.active).length}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Total monthly cost</p>
            <p className="mt-1 text-2xl font-bold text-slate-800">{money(totalMonthly)}</p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white p-4">
            <p className="text-xs uppercase tracking-wide text-slate-500">Total daily cost</p>
            <p className="mt-1 text-2xl font-bold text-brand-600">{money(totalDaily)}</p>
            <p className="mt-0.5 text-xs text-slate-500">across all active equipment</p>
          </div>
        </div>
      )}

      {data.equipment.length === 0 ? (
        <Card className="py-16 text-center">
          <Wrench size={32} className="mx-auto mb-3 text-slate-600" />
          <p className="text-slate-400 font-medium">No equipment added yet</p>
          <p className="mt-1 text-sm text-slate-500">Add bore rigs, trucks, and other equipment to track their cost per production day.</p>
          {isAdmin && (
            <Button className="mt-4" onClick={() => setAdding(true)}>
              <Plus size={15} /> Add first piece of equipment
            </Button>
          )}
        </Card>
      ) : (
        <Card>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-5 py-3 font-medium">Equipment</th>
                  <th className="px-5 py-3 font-medium">Category</th>
                  <th className="px-5 py-3 font-medium">Crew</th>
                  <th className="px-5 py-3 font-medium">On site since</th>
                  {isAdmin && <th className="px-5 py-3 text-right font-medium">Monthly cost</th>}
                  {isAdmin && <th className="px-5 py-3 text-right font-medium">Daily cost</th>}
                  <th className="px-5 py-3 font-medium">Status</th>
                  {isAdmin && <th className="px-5 py-3" />}
                </tr>
              </thead>
              <tbody>
                {data.equipment.map((eq) => {
                  const crew = data.crews.find((c) => c.id === eq.crewId)
                  const daily = eq.monthlyCost / daysInMonth(TODAY)
                  return (
                    <tr key={eq.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="px-5 py-3">
                        <p className="font-medium text-slate-800">{eq.name}</p>
                        {eq.description && <p className="text-xs text-slate-500 mt-0.5">{eq.description}</p>}
                      </td>
                      <td className="px-5 py-3 text-slate-400">{eq.category}</td>
                      <td className="px-5 py-3">
                        {crew ? (
                          <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{crew.name}</span>
                        ) : (
                          <span className="text-slate-500">—</span>
                        )}
                      </td>
                      <td className="px-5 py-3 text-slate-400 text-xs">
                        {eq.deployedFrom ? eq.deployedFrom : <span className="text-slate-600">—</span>}
                      </td>
                      {isAdmin && (
                        <td className="px-5 py-3 text-right text-slate-700">{money(eq.monthlyCost)}</td>
                      )}
                      {isAdmin && (
                        <td className="px-5 py-3 text-right font-semibold text-brand-700">{money(daily)}</td>
                      )}
                      <td className="px-5 py-3">
                        <Badge tone={eq.active ? 'green' : 'slate'}>
                          {eq.active ? 'Active' : 'Inactive'}
                        </Badge>
                      </td>
                      {isAdmin && (
                        <td className="px-5 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            <button
                              onClick={() => setEditing(eq)}
                              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-700"
                              aria-label="Edit"
                            >
                              <Pencil size={14} />
                            </button>
                            <button
                              onClick={() => remove(eq)}
                              className="rounded p-1 text-slate-500 hover:bg-rose-50 hover:text-rose-600"
                              aria-label="Delete"
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
              {isAdmin && data.equipment.filter((e) => e.active).length > 1 && (
                <tfoot>
                  <tr className="border-t-2 border-slate-200 bg-slate-50">
                    <td colSpan={3} className="px-5 py-3 text-right text-xs font-semibold uppercase tracking-wide text-slate-400">
                      Active totals
                    </td>
                    <td className="px-5 py-3 text-right font-bold text-slate-800">{money(totalMonthly)}</td>
                    <td className="px-5 py-3 text-right font-bold text-brand-700">{money(totalDaily)}</td>
                    <td colSpan={2} />
                  </tr>
                </tfoot>
              )}
            </table>
          </CardBody>
        </Card>
      )}

      {/* Per-crew cost breakdown */}
      {isAdmin && data.equipment.some((e) => e.crewId && e.active) && (
        <div className="mt-6">
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-400">Daily cost by crew</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...byCrew.entries()]
              .filter(([crewId]) => crewId !== null)
              .map(([crewId, items]) => {
                const crew = data.crews.find((c) => c.id === crewId)
                const activeItems = items.filter((e) => e.active)
                if (activeItems.length === 0) return null
                const crewMonthly = activeItems.reduce((s, e) => s + e.monthlyCost, 0)
                const crewDaily = crewMonthly / daysInMonth(TODAY)
                return (
                  <div key={crewId} className="rounded-xl border border-slate-200 bg-white p-4">
                    <p className="text-sm font-semibold text-slate-800">{crew?.name ?? 'Unknown crew'}</p>
                    <p className="mt-2 text-2xl font-bold text-brand-600">{money(crewDaily)}<span className="ml-1 text-xs font-normal text-slate-500">/day</span></p>
                    <p className="text-xs text-slate-500">{money(crewMonthly)}/mo · {activeItems.length} item{activeItems.length !== 1 ? 's' : ''}</p>
                    <ul className="mt-3 space-y-1">
                      {activeItems.map((e) => (
                        <li key={e.id} className="flex items-center justify-between text-xs text-slate-400">
                          <span>{e.name}</span>
                          <span className="font-medium">{money(e.monthlyCost / daysInMonth(TODAY))}/day</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )
              })}
          </div>
        </div>
      )}

      {adding && (
        <EquipmentModal onClose={() => setAdding(false)} onSave={(form) => save(form)} />
      )}
      {editing && (
        <EquipmentModal initial={editing} onClose={() => setEditing(null)} onSave={(form) => save(form, editing)} />
      )}
    </div>
  )
}
