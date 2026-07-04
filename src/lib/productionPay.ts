// ---------------------------------------------------------------------------
// Employee production pay — rate lookup + calculation. Deliberately reads
// ONLY EmployeeProductionRate, never RateCard/RateCardUnit/
// ProductionLineItem.rateSnapshot (the customer-billing side) — the two must
// never cross. Allocation (which employee gets credit for how much of a
// crew's quantity) is a separate, manual admin step recorded as
// ProductionPayAllocation; this module just prices whatever's been allocated.
// ---------------------------------------------------------------------------

import type {
  EmployeeProductionRate, ProductionEntry, ProductionLineItem, ProductionPayAllocation, ProductionPayType,
} from '../types'

export const PRODUCTION_PAY_TYPES: { value: ProductionPayType; label: string }[] = [
  { value: 'per_foot', label: 'Per Foot' },
  { value: 'per_unit', label: 'Per Unit' },
  { value: 'per_handhole', label: 'Per Handhole' },
  { value: 'per_bore', label: 'Per Bore' },
  { value: 'per_tie_in', label: 'Per Tie-In' },
  { value: 'per_box', label: 'Per Box' },
  { value: 'custom', label: 'Custom' },
]
export const productionPayTypeLabel = (t: ProductionPayType): string =>
  PRODUCTION_PAY_TYPES.find((p) => p.value === t)?.label ?? t

/** Picks the rate to use for one employee/unitCode as of a given work date:
 *  the active rate with the latest effectiveDate on or before that date.
 *  A rate that only becomes effective in the future never applies
 *  retroactively. Returns null if the employee has no qualifying rate for
 *  that unit — callers must surface that as "no production pay rate found,"
 *  never fall back to the customer rate card. */
export function findEmployeeProductionRate(
  rates: EmployeeProductionRate[],
  employeeId: string,
  unitCode: string,
  asOfDate: string,
): EmployeeProductionRate | null {
  const candidates = rates.filter(
    (r) => r.employeeId === employeeId && r.unitCode === unitCode && r.active && r.effectiveDate <= asOfDate,
  )
  if (candidates.length === 0) return null
  return candidates.reduce((best, r) => (r.effectiveDate > best.effectiveDate ? r : best))
}

export interface ProductionPayLine {
  allocation: ProductionPayAllocation
  unitCode: string
  quantity: number
  /** null means no matching active EmployeeProductionRate was found — this
   *  line contributes $0 and should be surfaced as a warning, never priced
   *  off the customer rate card. */
  rate: EmployeeProductionRate | null
  pay: number
}

export interface ProductionPayResult {
  lines: ProductionPayLine[]
  total: number
}

/** Computes one employee's production pay across a set of allocations
 *  (typically pre-filtered to a pay period by the caller). */
export function calculateProductionPay(
  employeeId: string,
  allocations: ProductionPayAllocation[],
  lineItemsById: Map<string, ProductionLineItem>,
  entriesById: Map<string, ProductionEntry>,
  rates: EmployeeProductionRate[],
): ProductionPayResult {
  const own = allocations.filter((a) => a.employeeId === employeeId)
  const lines: ProductionPayLine[] = own.map((a) => {
    const lineItem = lineItemsById.get(a.productionLineItemId)
    const entry = entriesById.get(a.productionEntryId)
    const unitCode = lineItem?.unitCode ?? ''
    const rate = entry ? findEmployeeProductionRate(rates, employeeId, unitCode, entry.date) : null
    const pay = rate ? a.quantity * rate.rate : 0
    return { allocation: a, unitCode, quantity: a.quantity, rate, pay }
  })
  return { lines, total: lines.reduce((s, l) => s + l.pay, 0) }
}
