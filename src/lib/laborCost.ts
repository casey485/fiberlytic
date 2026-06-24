import type { Crew, CrewMember, PayType } from '../types'

// ---------------------------------------------------------------------------
// Labor / crew cost calculation
//
// Production cost is driven by the people on the crew:
//   hourly      → rate × hours worked
//   daily       → rate (flat, regardless of hours)
//   production  → rate × production quantity (footage)
//
// A crew's labor cost is the sum across its ACTIVE members. If a crew has no
// active members yet (e.g. legacy data), we fall back to the crew-level pay
// (payType/payAmount), and finally to the deprecated `dayRate` as a daily rate.
// ---------------------------------------------------------------------------

export const PAY_TYPES: { value: PayType; label: string; unit: string }[] = [
  { value: 'hourly', label: 'Hourly', unit: '/hr' },
  { value: 'daily', label: 'Daily', unit: '/day' },
  { value: 'production', label: 'Production', unit: '/unit' },
]

export const payLabel = (t: PayType) => PAY_TYPES.find((p) => p.value === t)?.label ?? t
export const payUnit = (t: PayType) => PAY_TYPES.find((p) => p.value === t)?.unit ?? ''

/** Cost of one pay line for the given hours + production quantity. */
export function costFor(payType: PayType, payAmount: number, hours: number, productionQty: number): number {
  switch (payType) {
    case 'hourly':
      return payAmount * hours
    case 'daily':
      return payAmount
    case 'production':
      return payAmount * productionQty
    default:
      return 0
  }
}

export const memberCost = (m: CrewMember, hours: number, productionQty: number) =>
  costFor(m.payType, m.payAmount, hours, productionQty)

export interface EmployeeCostLine {
  member: CrewMember
  cost: number
}

export interface CrewCostResult {
  /** Per-active-employee cost breakdown. Empty when falling back to crew pay. */
  lines: EmployeeCostLine[]
  /** Total labor cost == total crew cost. */
  total: number
  /** True when the total came from crew-level/legacy pay, not members. */
  fallback: boolean
}

/** Compute a crew's labor cost for a day of work. */
export function crewLaborCost(crew: Crew | undefined, hours: number, productionQty: number): CrewCostResult {
  if (!crew) return { lines: [], total: 0, fallback: true }

  const active = (crew.members ?? []).filter((m) => m.active)
  if (active.length > 0) {
    const lines = active.map((member) => ({ member, cost: memberCost(member, hours, productionQty) }))
    const total = lines.reduce((s, l) => s + l.cost, 0)
    return { lines, total: Math.round(total), fallback: false }
  }

  // Fallback: crew-level pay, then legacy dayRate (treated as a daily rate).
  const payType = crew.payType ?? 'daily'
  const payAmount = crew.payAmount ?? crew.dayRate ?? 0
  return { lines: [], total: Math.round(costFor(payType, payAmount, hours, productionQty)), fallback: true }
}

/** Active headcount (falls back to legacy `size`). */
export const crewHeadcount = (crew: Crew) =>
  crew.members?.length ? crew.members.filter((m) => m.active).length : (crew.size ?? 0)
