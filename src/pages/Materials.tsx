import { useMemo, useState } from 'react'
import { Plus, Trash2, AlertTriangle, Minus } from 'lucide-react'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardBody } from '../components/ui/Card'
import { StatCard } from '../components/ui/StatCard'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Button, Field, Input, Select } from '../components/ui/Form'
import { money, moneyExact, number } from '../lib/format'
import type { MaterialCategory } from '../types'

const CATEGORIES: { value: MaterialCategory; label: string }[] = [
  { value: 'cable', label: 'Cable' },
  { value: 'conduit', label: 'Conduit' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'splice', label: 'Splice' },
  { value: 'drop', label: 'Drop' },
  { value: 'consumable', label: 'Consumable' },
]

export function Materials() {
  const { data, addMaterial, updateMaterial, deleteMaterial } = useData()
  const { isAdmin } = useRole()
  const [open, setOpen] = useState(false)
  const [catFilter, setCatFilter] = useState<MaterialCategory | 'all'>('all')

  const filtered = useMemo(
    () => (catFilter === 'all' ? data.materials : data.materials.filter((m) => m.category === catFilter)),
    [data.materials, catFilter],
  )

  const totalValue = data.materials.reduce((s, m) => s + m.quantityOnHand * m.unitCost, 0)
  const lowStock = data.materials.filter((m) => m.quantityOnHand <= m.reorderLevel)

  const adjust = (id: string, current: number, delta: number) =>
    updateMaterial(id, { quantityOnHand: Math.max(0, current + delta) })

  // ── Field view — simplified checkout list, no prices ─────────────────────────
  if (!isAdmin) {
    return (
      <div>
        <PageHeader
          title="Materials"
          description="Check materials in or out. Contact your admin to add new items."
        />

        <div className="mb-4 flex flex-wrap gap-2">
          {(['all', ...CATEGORIES.map((c) => c.value)] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCatFilter(c as MaterialCategory | 'all')}
              className={`rounded-full px-3 py-1 text-sm font-medium transition ${
                catFilter === c ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
              }`}
            >
              {c === 'all' ? 'All' : CATEGORIES.find((x) => x.value === c)?.label}
            </button>
          ))}
        </div>

        <Card>
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2.5 font-medium">Material</th>
                  <th className="px-5 py-2.5 text-right font-medium">Available</th>
                  <th className="px-5 py-2.5 text-center font-medium">Check out / in</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((m) => {
                  const low = m.quantityOnHand <= m.reorderLevel
                  return (
                    <tr key={m.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="px-5 py-2.5">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-800">{m.name}</span>
                          {low && <Badge tone="amber">Low stock</Badge>}
                        </div>
                        <span className="text-xs capitalize text-slate-400">{m.category}</span>
                      </td>
                      <td className="px-5 py-2.5 text-right">
                        <span className={low ? 'font-semibold text-amber-600' : 'font-medium text-slate-800'}>
                          {number(m.quantityOnHand)}
                        </span>
                        <span className="text-xs text-slate-400"> {m.unit}</span>
                      </td>
                      <td className="px-5 py-2.5">
                        <div className="flex items-center justify-center gap-2">
                          <button
                            onClick={() => adjust(m.id, m.quantityOnHand, -getStep(m.unit))}
                            className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-600 hover:bg-slate-100"
                            aria-label="Check out"
                          >
                            <Minus size={11} /> Out
                          </button>
                          <button
                            onClick={() => adjust(m.id, m.quantityOnHand, getStep(m.unit))}
                            className="flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs text-emerald-700 hover:bg-emerald-100"
                            aria-label="Return"
                          >
                            <Plus size={11} /> Return
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={3} className="px-5 py-10 text-center text-slate-400">No materials in this category.</td></tr>
                )}
              </tbody>
            </table>
          </CardBody>
        </Card>
      </div>
    )
  }

  // ── Admin view ──────────────────────────────────────────────────────────────
  return (
    <div>
      <PageHeader
        title="Materials"
        description="Inventory on hand, valuation, and reorder alerts."
        action={
          <Button onClick={() => setOpen(true)}>
            <Plus size={16} /> Add material
          </Button>
        }
      />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="SKUs tracked" value={number(data.materials.length)} />
        <StatCard label="Inventory value" value={money(totalValue)} />
        <StatCard
          label="Below reorder level"
          value={number(lowStock.length)}
          icon={lowStock.length > 0 ? <AlertTriangle size={20} className="text-amber-500" /> : undefined}
        />
      </div>

      <div className="mb-4 mt-6 flex flex-wrap gap-2">
        {(['all', ...CATEGORIES.map((c) => c.value)] as const).map((c) => (
          <button
            key={c}
            onClick={() => setCatFilter(c)}
            className={`rounded-full px-3 py-1 text-sm font-medium transition ${
              catFilter === c ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {c === 'all' ? 'All' : CATEGORIES.find((x) => x.value === c)?.label}
          </button>
        ))}
      </div>

      <Card>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                <th className="px-5 py-2.5 font-medium">Material</th>
                <th className="px-5 py-2.5 font-medium">SKU</th>
                <th className="px-5 py-2.5 font-medium">Supplier</th>
                <th className="px-5 py-2.5 text-right font-medium">On hand</th>
                <th className="px-5 py-2.5 text-center font-medium">Adjust</th>
                <th className="px-5 py-2.5 text-right font-medium">Unit cost</th>
                <th className="px-5 py-2.5 text-right font-medium">Value</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((m) => {
                const low = m.quantityOnHand <= m.reorderLevel
                return (
                  <tr key={m.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-5 py-2.5">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-slate-800">{m.name}</span>
                        {low && <Badge tone="amber">Low</Badge>}
                      </div>
                      <span className="text-xs capitalize text-slate-400">{m.category}</span>
                    </td>
                    <td className="px-5 py-2.5 text-slate-500">{m.sku}</td>
                    <td className="px-5 py-2.5 text-slate-500">{m.supplier}</td>
                    <td className="px-5 py-2.5 text-right">
                      <span className={low ? 'font-semibold text-amber-600' : 'font-medium text-slate-800'}>
                        {number(m.quantityOnHand)}
                      </span>
                      <span className="text-xs text-slate-400"> {m.unit}</span>
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => adjust(m.id, m.quantityOnHand, -getStep(m.unit))}
                          className="rounded-md border border-slate-200 p-1 text-slate-500 hover:bg-slate-100"
                          aria-label="Decrease"
                        >
                          <Minus size={13} />
                        </button>
                        <button
                          onClick={() => adjust(m.id, m.quantityOnHand, getStep(m.unit))}
                          className="rounded-md border border-slate-200 p-1 text-slate-500 hover:bg-slate-100"
                          aria-label="Increase"
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                    </td>
                    <td className="px-5 py-2.5 text-right text-slate-600">{moneyExact(m.unitCost)}</td>
                    <td className="px-5 py-2.5 text-right font-medium text-slate-800">{money(m.quantityOnHand * m.unitCost)}</td>
                    <td className="px-5 py-2.5 text-right">
                      <button onClick={() => deleteMaterial(m.id)} className="text-slate-300 hover:text-rose-600" aria-label="Delete">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-slate-400">No materials in this category.</td></tr>
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <NewMaterialModal open={open} onClose={() => setOpen(false)} onCreate={addMaterial} />
    </div>
  )
}

/** Bulk materials (cable, conduit) adjust by 500; discrete by 1. */
const getStep = (unit: string) => (unit === 'ft' ? 500 : 1)

function NewMaterialModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: ReturnType<typeof useData>['addMaterial']
}) {
  const [form, setForm] = useState({
    name: '',
    sku: '',
    category: 'cable' as MaterialCategory,
    unit: 'ft',
    quantityOnHand: 0,
    reorderLevel: 0,
    unitCost: 0,
    supplier: '',
  })
  const set = (k: keyof typeof form, v: string | number) => setForm((f) => ({ ...f, [k]: v }))

  const submit = () => {
    if (!form.name.trim()) return
    onCreate(form)
    onClose()
    setForm((f) => ({ ...f, name: '', sku: '', quantityOnHand: 0, reorderLevel: 0, unitCost: 0, supplier: '' }))
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Add material"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit}>Add material</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Name">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. 288ct Single-Mode Fiber" />
          </Field>
        </div>
        <Field label="SKU">
          <Input value={form.sku} onChange={(e) => set('sku', e.target.value)} />
        </Field>
        <Field label="Supplier">
          <Input value={form.supplier} onChange={(e) => set('supplier', e.target.value)} />
        </Field>
        <Field label="Category">
          <Select value={form.category} onChange={(e) => set('category', e.target.value)}>
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </Select>
        </Field>
        <Field label="Unit">
          <Input value={form.unit} onChange={(e) => set('unit', e.target.value)} placeholder="ft, ea, pk…" />
        </Field>
        <Field label="Quantity on hand">
          <Input type="number" value={form.quantityOnHand} onChange={(e) => set('quantityOnHand', Number(e.target.value))} />
        </Field>
        <Field label="Reorder level">
          <Input type="number" value={form.reorderLevel} onChange={(e) => set('reorderLevel', Number(e.target.value))} />
        </Field>
        <Field label="Unit cost ($)">
          <Input type="number" step="0.01" value={form.unitCost} onChange={(e) => set('unitCost', Number(e.target.value))} />
        </Field>
      </div>
    </Modal>
  )
}
