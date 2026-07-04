import { useState } from 'react'
import { Plus, Pencil, Trash2, ArrowLeft } from 'lucide-react'
import { useData } from '../../store/DataContext'
import { useRole } from '../../store/RoleContext'
import { Modal } from '../ui/Modal'
import { Button, Field, Input, Select, Textarea } from '../ui/Form'
import { Badge } from '../ui/Badge'
import { moneyExact, formatDate } from '../../lib/format'
import { PRODUCTION_PAY_TYPES, productionPayTypeLabel } from '../../lib/productionPay'
import type { Employee, EmployeeProductionRate, ProductionPayType } from '../../types'

type RateForm = {
  unitCode: string
  unitDescription: string
  rate: string
  payType: ProductionPayType
  effectiveDate: string
  active: boolean
  notes: string
}

function emptyForm(initial?: EmployeeProductionRate): RateForm {
  const today = new Date().toISOString().slice(0, 10)
  return {
    unitCode: initial?.unitCode ?? '',
    unitDescription: initial?.unitDescription ?? '',
    rate: initial ? String(initial.rate) : '',
    payType: initial?.payType ?? 'per_foot',
    effectiveDate: initial?.effectiveDate ?? today,
    active: initial?.active ?? true,
    notes: initial?.notes ?? '',
  }
}

/** Add/edit sub-form shown in place of the rate list, inside the same Modal —
 *  avoids stacking two Modal overlays for what's really one flow. */
function RateFormView({
  initial,
  unitCodes,
  onSave,
  onCancel,
}: {
  initial?: EmployeeProductionRate
  unitCodes: string[]
  onSave: (f: RateForm) => void
  onCancel: () => void
}) {
  const [form, setForm] = useState<RateForm>(emptyForm(initial))
  const set = <K extends keyof RateForm>(k: K, v: RateForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  const valid = form.unitCode.trim() && form.unitDescription.trim() && parseFloat(form.rate) >= 0 && form.effectiveDate

  return (
    <>
      <button onClick={onCancel} className="mb-3 flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
        <ArrowLeft size={13} /> Back to rates
      </button>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Unit code">
          <Input
            list="employee-production-rate-unit-codes"
            value={form.unitCode}
            onChange={(e) => set('unitCode', e.target.value)}
            placeholder="e.g. 1U4-1"
            autoFocus
          />
          <datalist id="employee-production-rate-unit-codes">
            {unitCodes.map((c) => <option key={c} value={c} />)}
          </datalist>
        </Field>
        <Field label="Pay type">
          <Select value={form.payType} onChange={(e) => set('payType', e.target.value as ProductionPayType)}>
            {PRODUCTION_PAY_TYPES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Unit description">
            <Input value={form.unitDescription} onChange={(e) => set('unitDescription', e.target.value)} placeholder='e.g. 1.25" Conduct' />
          </Field>
        </div>
        <Field label="Employee production rate ($)" hint="What we pay this employee — never the customer rate card price.">
          <Input type="number" step="0.01" min="0" value={form.rate} onChange={(e) => set('rate', e.target.value)} placeholder="0.00" />
        </Field>
        <Field label="Effective date">
          <Input type="date" value={form.effectiveDate} onChange={(e) => set('effectiveDate', e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Notes (optional)">
            <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} className="rounded border-slate-300" />
          Active
        </label>
      </div>
      <div className="mt-4 flex justify-end gap-2">
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        <Button disabled={!valid} onClick={() => { if (valid) onSave(form) }}>Save</Button>
      </div>
    </>
  )
}

export function ProductionPayRatesModal({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const { data, addEmployeeProductionRate, updateEmployeeProductionRate, deleteEmployeeProductionRate } = useData()
  const { isAdmin } = useRole()
  const [editing, setEditing] = useState<{ open: boolean; rate: EmployeeProductionRate | null }>({ open: false, rate: null })

  const rates = data.employeeProductionRates
    .filter((r) => r.employeeId === employee.id)
    .sort((a, b) => (a.unitCode < b.unitCode ? -1 : a.unitCode > b.unitCode ? 1 : 0))
  const unitCodes = [...new Set(data.rateCardUnits.map((u) => u.unitCode))].sort()

  const save = (f: RateForm) => {
    const payload = {
      employeeId: employee.id,
      unitCode: f.unitCode.trim().toUpperCase(),
      unitDescription: f.unitDescription.trim(),
      rate: parseFloat(f.rate) || 0,
      payType: f.payType,
      effectiveDate: f.effectiveDate,
      active: f.active,
      notes: f.notes.trim() || undefined,
    }
    if (editing.rate) updateEmployeeProductionRate(editing.rate.id, payload)
    else addEmployeeProductionRate(payload)
    setEditing({ open: false, rate: null })
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Production Pay Rates — ${employee.name}`}
      size="lg"
      footer={<Button variant="secondary" onClick={onClose}>Close</Button>}
    >
      {editing.open ? (
        <RateFormView
          initial={editing.rate ?? undefined}
          unitCodes={unitCodes}
          onSave={save}
          onCancel={() => setEditing({ open: false, rate: null })}
        />
      ) : (
        <>
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs text-slate-500">
              What we pay {employee.name} per unit of production — separate from what we bill the client.
            </p>
            {isAdmin && (
              <Button variant="ghost" className="px-2 py-1 text-xs" onClick={() => setEditing({ open: true, rate: null })}>
                <Plus size={13} /> Add rate
              </Button>
            )}
          </div>
          {!isAdmin && (
            <p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
              View only — switch to Admin to add or change production pay rates.
            </p>
          )}
          {rates.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-400">No production pay rates set for this employee yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-2 py-2 font-medium">Code</th>
                  <th className="px-2 py-2 font-medium">Description</th>
                  <th className="px-2 py-2 font-medium">Pay type</th>
                  <th className="px-2 py-2 text-right font-medium">Rate</th>
                  <th className="px-2 py-2 font-medium">Effective</th>
                  <th className="px-2 py-2 font-medium">Status</th>
                  {isAdmin && <th className="px-2 py-2"></th>}
                </tr>
              </thead>
              <tbody>
                {rates.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-2 py-2 font-mono text-xs font-semibold text-brand-700">{r.unitCode}</td>
                    <td className="px-2 py-2 text-slate-700">{r.unitDescription}</td>
                    <td className="px-2 py-2 text-slate-500">{productionPayTypeLabel(r.payType)}</td>
                    <td className="px-2 py-2 text-right font-medium text-slate-800">{moneyExact(r.rate)}</td>
                    <td className="px-2 py-2 text-slate-500">{formatDate(r.effectiveDate)}</td>
                    <td className="px-2 py-2">
                      <Badge tone={r.active ? 'green' : 'slate'}>{r.active ? 'Active' : 'Inactive'}</Badge>
                    </td>
                    {isAdmin && (
                      <td className="px-2 py-2 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <button onClick={() => setEditing({ open: true, rate: r })} className="p-1 text-slate-300 hover:text-brand-600" aria-label="Edit">
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() => { if (confirm(`Delete the ${r.unitCode} production rate for ${employee.name}?`)) deleteEmployeeProductionRate(r.id) }}
                            className="p-1 text-slate-300 hover:text-rose-600"
                            aria-label="Delete"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </Modal>
  )
}
