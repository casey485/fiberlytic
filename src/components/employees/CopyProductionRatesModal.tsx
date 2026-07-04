import { useState } from 'react'
import { useData } from '../../store/DataContext'
import { Modal } from '../ui/Modal'
import { Button, Field, Select } from '../ui/Form'
import { moneyExact } from '../../lib/format'
import { productionPayTypeLabel } from '../../lib/productionPay'

/** Master setup tool: copies one employee's whole Production Pay Rates table
 *  onto another employee, so every unit code doesn't have to be re-entered
 *  by hand. Unit codes the target already has are skipped, never overwritten
 *  — safe to re-run. */
export function CopyProductionRatesModal({ onClose }: { onClose: () => void }) {
  const { data, addEmployeeProductionRate } = useData()
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')

  const employees = data.employees.filter((e) => e.active).sort((a, b) => a.name.localeCompare(b.name))
  const sourceRates = data.employeeProductionRates.filter((r) => r.employeeId === fromId)
  const targetCodes = new Set(data.employeeProductionRates.filter((r) => r.employeeId === toId).map((r) => r.unitCode))
  const toCopy = sourceRates.filter((r) => !targetCodes.has(r.unitCode))
  const skipped = sourceRates.length - toCopy.length
  const fromEmp = employees.find((e) => e.id === fromId)
  const toEmp = employees.find((e) => e.id === toId)

  const valid = !!fromId && !!toId && fromId !== toId && toCopy.length > 0

  const confirmCopy = () => {
    for (const r of toCopy) {
      addEmployeeProductionRate({
        employeeId: toId,
        unitCode: r.unitCode,
        unitDescription: r.unitDescription,
        rate: r.rate,
        payType: r.payType,
        effectiveDate: r.effectiveDate,
        active: r.active,
        notes: r.notes,
      })
    }
    onClose()
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Copy Production Pay Rates"
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} onClick={confirmCopy}>
            Copy {toCopy.length > 0 ? `${toCopy.length} rate${toCopy.length === 1 ? '' : 's'}` : 'rates'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Copy from">
          <Select value={fromId} onChange={(e) => setFromId(e.target.value)}>
            <option value="">— Select employee —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
        </Field>
        <Field label="Copy to">
          <Select value={toId} onChange={(e) => setToId(e.target.value)}>
            <option value="">— Select employee —</option>
            {employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
          </Select>
        </Field>
      </div>

      {fromId && toId && fromId === toId && (
        <p className="mt-4 text-sm text-amber-600">Pick two different employees.</p>
      )}

      {fromId && toId && fromId !== toId && (
        <div className="mt-4">
          {sourceRates.length === 0 ? (
            <p className="text-sm text-slate-400">{fromEmp?.name} has no production pay rates to copy.</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-slate-500">
                {toCopy.length} rate{toCopy.length === 1 ? '' : 's'} will be copied to {toEmp?.name}
                {skipped > 0 ? ` · ${skipped} skipped (already set for ${toEmp?.name})` : ''}.
              </p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-2 py-1.5 font-medium">Code</th>
                    <th className="px-2 py-1.5 font-medium">Description</th>
                    <th className="px-2 py-1.5 font-medium">Pay type</th>
                    <th className="px-2 py-1.5 text-right font-medium">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {toCopy.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50">
                      <td className="px-2 py-1.5 font-mono text-xs font-semibold text-brand-700">{r.unitCode}</td>
                      <td className="px-2 py-1.5 text-slate-700">{r.unitDescription}</td>
                      <td className="px-2 py-1.5 text-slate-500">{productionPayTypeLabel(r.payType)}</td>
                      <td className="px-2 py-1.5 text-right font-medium text-slate-800">{moneyExact(r.rate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </div>
      )}
    </Modal>
  )
}
