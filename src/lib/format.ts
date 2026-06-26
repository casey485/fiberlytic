import type { Invoice, InvoiceStatus, ProjectStatus, CrewStatus } from '../types'

const usd0 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 0,
})

const usd2 = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})

/** Currency with no cents — for dashboards and totals. */
export const money = (n: number) => usd0.format(n || 0)

/** Currency with cents — for invoices and line items. */
export const moneyExact = (n: number) => usd2.format(n || 0)

export const number = (n: number) => new Intl.NumberFormat('en-US').format(Math.round(n || 0))

export const percent = (n: number, digits = 0) =>
  `${(n * 100).toFixed(digits)}%`

/** "Mar 14, 2026" */
export const formatDate = (iso: string) => {
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

/** "Mar 14" — compact for chart axes. */
export const formatDateShort = (iso: string) => {
  const d = new Date(iso + 'T00:00:00')
  if (isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export const invoiceTotal = (inv: Invoice) =>
  inv.lineItems.reduce((sum, li) => sum + li.quantity * li.unitPrice, 0)

// --- Status display metadata --------------------------------------------------

export const projectStatusMeta: Record<ProjectStatus, { label: string; tone: BadgeTone }> = {
  planning: { label: 'Planning', tone: 'slate' },
  active: { label: 'Active', tone: 'blue' },
  on_hold: { label: 'On Hold', tone: 'amber' },
  complete: { label: 'Complete', tone: 'green' },
}

export const crewStatusMeta: Record<CrewStatus, { label: string; tone: BadgeTone }> = {
  active: { label: 'Active', tone: 'green' },
  idle: { label: 'Idle', tone: 'amber' },
  off: { label: 'Off', tone: 'slate' },
}

export const invoiceStatusMeta: Record<InvoiceStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'slate' },
  sent: { label: 'Sent', tone: 'blue' },
  paid: { label: 'Paid', tone: 'green' },
  overdue: { label: 'Overdue', tone: 'red' },
}

export const workTypeLabel: Record<string, string> = {
  aerial: 'Aerial',
  underground: 'Underground',
  directional_bore: 'Directional Bore',
  splicing: 'Splicing',
  mdu: 'MDU',
  cable_plow: 'Cable Plow',
}

export type BadgeTone = 'slate' | 'blue' | 'green' | 'amber' | 'red' | 'cyan'
