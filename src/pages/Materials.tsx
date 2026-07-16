import { useMemo, useState } from 'react'
import { Plus, Trash2, AlertTriangle, Minus, PackageCheck } from 'lucide-react'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { StatCard } from '../components/ui/StatCard'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Button, Field, Input, Select } from '../components/ui/Form'
import { MaterialRequestForm } from '../components/MaterialRequestForm'
import type { MaterialRequester } from '../components/MaterialRequestForm'
import { projectAssignedToSubcontractor } from '../lib/printAssignment'
import { money, moneyExact, number } from '../lib/format'
import type { Material, MaterialCategory, MaterialRequest } from '../types'

const CATEGORIES: { value: MaterialCategory; label: string }[] = [
  { value: 'cable', label: 'Cable' },
  { value: 'conduit', label: 'Conduit' },
  { value: 'hardware', label: 'Hardware' },
  { value: 'splice', label: 'Splice' },
  { value: 'drop', label: 'Drop' },
  { value: 'consumable', label: 'Consumable' },
]

const requestDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

function requestSummary(request: MaterialRequest, materials: Material[]) {
  return request.items
    .map((it) => {
      const m = materials.find((mm) => mm.id === it.materialId)
      return `${number(it.quantity)} ${m?.unit ?? ''} ${m?.name ?? 'Unknown item'}`.trim()
    })
    .join(', ')
}

/** Who's submitting + which projects they can submit a request against, per
 *  role. Mirrors the "my projects" derivation each dashboard already uses
 *  (crew → currentProjectId for field, supervisorId for supervisor,
 *  assignment/production for subcontractor) so a submitted request always
 *  routes to a supervisor who genuinely oversees that project. */
function useRequesterContext(): { projects: ReturnType<typeof useData>['data']['projects']; requester: MaterialRequester | null } {
  const { data } = useData()
  const { role, activeEmployeeId, activeSubcontractorId, activeSupervisorEmployeeId } = useRole()

  return useMemo(() => {
    if (role === 'subcontractor' && activeSubcontractorId) {
      const sub = data.subcontractors.find((s) => s.id === activeSubcontractorId)
      if (!sub) return { projects: [], requester: null }
      const projects = data.projects.filter((p) =>
        (p.subcontractorIds ?? []).includes(sub.id)
        || projectAssignedToSubcontractor(p.id, sub.id, data.projectFiles ?? [], data.mapCutPackages ?? []),
      )
      return { projects, requester: { subcontractorId: sub.id, name: sub.companyName } }
    }
    if (role === 'supervisor' && activeSupervisorEmployeeId) {
      const emp = data.employees.find((e) => e.id === activeSupervisorEmployeeId)
      if (!emp) return { projects: [], requester: null }
      return { projects: data.projects.filter((p) => p.supervisorId === emp.id), requester: { employeeId: emp.id, name: emp.name } }
    }
    if (role === 'field' && activeEmployeeId) {
      const emp = data.employees.find((e) => e.id === activeEmployeeId)
      if (!emp) return { projects: [], requester: null }
      const crewIds = new Set(
        data.crews
          .filter((c) => c.id === emp.defaultCrewId || c.foremanId === emp.id || c.members.some((m) => m.employeeId === emp.id && m.active))
          .map((c) => c.id),
      )
      const projectIds = new Set(data.crews.filter((c) => crewIds.has(c.id) && c.currentProjectId).map((c) => c.currentProjectId!))
      return { projects: data.projects.filter((p) => projectIds.has(p.id)), requester: { employeeId: emp.id, name: emp.name } }
    }
    return { projects: [], requester: null }
  }, [role, activeEmployeeId, activeSubcontractorId, activeSupervisorEmployeeId, data])
}

function RequestRow({ request, materials, showRequester, onFulfill }: {
  request: MaterialRequest
  materials: Material[]
  showRequester?: boolean
  onFulfill?: () => void
}) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-50 px-5 py-3 last:border-0">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {showRequester && <span className="text-sm font-semibold text-slate-800">{request.requestedByName}</span>}
          <Badge tone={request.status === 'fulfilled' ? 'green' : 'amber'}>
            {request.status === 'fulfilled' ? 'Fulfilled' : 'Pending pickup'}
          </Badge>
          <span className="text-xs text-slate-400">{requestDate(request.createdAt)}</span>
        </div>
        <p className="mt-1 text-sm text-slate-600">{requestSummary(request, materials)}</p>
        {request.notes && <p className="mt-1 text-xs italic text-slate-400">"{request.notes}"</p>}
      </div>
      {onFulfill && request.status === 'pending' && (
        <Button variant="secondary" onClick={onFulfill} className="shrink-0">
          <PackageCheck size={14} /> Mark fulfilled
        </Button>
      )}
    </div>
  )
}

export function Materials() {
  const { data, addMaterial, updateMaterial, deleteMaterial, markMaterialRequestFulfilled } = useData()
  const { isAdmin, role } = useRole()
  const [open, setOpen] = useState(false)
  const [catFilter, setCatFilter] = useState<MaterialCategory | 'all'>('all')
  const { projects: myProjects, requester } = useRequesterContext()

  const filtered = useMemo(
    () => (catFilter === 'all' ? data.materials : data.materials.filter((m) => m.category === catFilter)),
    [data.materials, catFilter],
  )

  const totalValue = data.materials.reduce((s, m) => s + m.quantityOnHand * m.unitCost, 0)
  const lowStock = data.materials.filter((m) => m.quantityOnHand <= m.reorderLevel)

  const adjust = (id: string, current: number, delta: number) =>
    updateMaterial(id, { quantityOnHand: Math.max(0, current + delta) })

  // ── Non-admin view — submit a material list (checkout request) ───────────────
  if (!isAdmin) {
    const myProjectIds = new Set(myProjects.map((p) => p.id))
    const myRequests = requester
      ? (data.materialRequests ?? [])
          .filter((r) => (requester.employeeId && r.requestedByEmployeeId === requester.employeeId)
            || (requester.subcontractorId && r.requestedBySubcontractorId === requester.subcontractorId))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      : []
    const isSupervisor = role === 'supervisor'
    const incoming = isSupervisor
      ? (data.materialRequests ?? [])
          .filter((r) => myProjectIds.has(r.projectId))
          .sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : a.status === 'pending' ? -1 : 1))
      : []

    return (
      <div>
        <PageHeader
          title="Materials"
          description="Select what you need and submit a material list — it goes straight to your supervisor."
        />

        {requester ? (
          <MaterialRequestForm projects={myProjects} requester={requester} />
        ) : (
          <Card>
            <CardBody>
              <p className="text-sm text-slate-500">Select your name from the Dashboard first, then come back here to submit a material list.</p>
            </CardBody>
          </Card>
        )}

        {isSupervisor && (
          <Card className="mt-6">
            <CardHeader title="Requests From Your Crews" subtitle="Material lists submitted on projects you supervise." />
            <CardBody className="p-0">
              {incoming.length === 0 ? (
                <p className="px-5 py-6 text-sm text-slate-500">No material lists submitted yet.</p>
              ) : (
                incoming.map((r) => (
                  <RequestRow
                    key={r.id}
                    request={r}
                    materials={data.materials}
                    showRequester
                    onFulfill={() => markMaterialRequestFulfilled(r.id)}
                  />
                ))
              )}
            </CardBody>
          </Card>
        )}

        {myRequests.length > 0 && (
          <Card className="mt-6">
            <CardHeader title="Your Recent Requests" subtitle="Material lists you've submitted." />
            <CardBody className="p-0">
              {myRequests.map((r) => <RequestRow key={r.id} request={r} materials={data.materials} />)}
            </CardBody>
          </Card>
        )}
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
              catFilter === c ? 'bg-brand-600 text-white' : 'bg-white text-slate-400 ring-1 ring-slate-200 hover:bg-slate-50'
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
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
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
                      <span className="text-xs capitalize text-slate-500">{m.category}</span>
                    </td>
                    <td className="px-5 py-2.5 text-slate-400">{m.sku}</td>
                    <td className="px-5 py-2.5 text-slate-400">{m.supplier}</td>
                    <td className="px-5 py-2.5 text-right">
                      <span className={low ? 'font-semibold text-amber-600' : 'font-medium text-slate-800'}>
                        {number(m.quantityOnHand)}
                      </span>
                      <span className="text-xs text-slate-500"> {m.unit}</span>
                    </td>
                    <td className="px-5 py-2.5">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => adjust(m.id, m.quantityOnHand, -getStep(m.unit))}
                          className="rounded-md border border-slate-200 p-1 text-slate-400 hover:bg-slate-100"
                          aria-label="Decrease"
                        >
                          <Minus size={13} />
                        </button>
                        <button
                          onClick={() => adjust(m.id, m.quantityOnHand, getStep(m.unit))}
                          className="rounded-md border border-slate-200 p-1 text-slate-400 hover:bg-slate-100"
                          aria-label="Increase"
                        >
                          <Plus size={13} />
                        </button>
                      </div>
                    </td>
                    <td className="px-5 py-2.5 text-right text-slate-400">{moneyExact(m.unitCost)}</td>
                    <td className="px-5 py-2.5 text-right font-medium text-slate-800">{money(m.quantityOnHand * m.unitCost)}</td>
                    <td className="px-5 py-2.5 text-right">
                      <button onClick={() => deleteMaterial(m.id)} className="text-slate-600 hover:text-rose-600" aria-label="Delete">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                )
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={8} className="px-5 py-10 text-center text-slate-500">No materials in this category.</td></tr>
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Material Requests" subtitle="Check-out lists submitted by crews and subcontractors, across all projects." />
        <CardBody className="p-0">
          {(data.materialRequests ?? []).length === 0 ? (
            <p className="px-5 py-6 text-sm text-slate-500">No material lists submitted yet.</p>
          ) : (
            [...(data.materialRequests ?? [])]
              .sort((a, b) => (a.status === b.status ? b.createdAt.localeCompare(a.createdAt) : a.status === 'pending' ? -1 : 1))
              .map((r) => (
                <RequestRow
                  key={r.id}
                  request={r}
                  materials={data.materials}
                  showRequester
                  onFulfill={() => markMaterialRequestFulfilled(r.id)}
                />
              ))
          )}
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
