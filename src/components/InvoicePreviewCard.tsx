import type { ReactNode } from 'react'
import { Card, CardBody } from './ui/Card'
import { moneyExact, formatDate } from '../lib/format'
import type { InvoiceLineItem } from '../types'

/** One shared render for both "live preview while filtering" (Invoicing.tsx's
 *  Generate Invoices panel, before anything is saved) and "viewing an
 *  already-generated invoice" (its detail view) — visually matches
 *  fieldMapExport.ts's drawInvoicePage() layout (Bill To/invoice #/date, a
 *  Date/Unit/Description/UOM/Qty/Rate/Amount table, grand total) so the
 *  on-screen preview and the exported PDF never look like two different
 *  documents. */
export function InvoicePreviewCard({
  projectName,
  clientName,
  invoiceNumber,
  issueDate,
  billingPeriod,
  lineItems,
  actions,
}: {
  projectName: string
  clientName: string
  invoiceNumber: string
  issueDate: string
  billingPeriod?: string | null
  lineItems: InvoiceLineItem[]
  actions?: ReactNode
}) {
  const total = lineItems.reduce((s, l) => s + l.quantity * l.unitPrice, 0)

  return (
    <Card className="overflow-hidden">
      <div className="h-1.5 bg-slate-900" />
      <CardBody>
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-4">
            <InfoField label="Project" value={projectName} />
            <InfoField label="Customer" value={clientName || '—'} />
            <InfoField label="Invoice #" value={invoiceNumber} />
            <InfoField label="Date" value={formatDate(issueDate)} />
            {billingPeriod && <InfoField label="Billing Period" value={billingPeriod} />}
          </div>
          {actions && <div className="flex shrink-0 gap-2">{actions}</div>}
        </div>

        <div className="overflow-hidden rounded-lg border border-slate-200">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-3 py-2 font-medium">Description</th>
                <th className="px-3 py-2 font-medium">UOM</th>
                <th className="px-3 py-2 text-right font-medium">Qty</th>
                <th className="px-3 py-2 text-right font-medium">Unit Price</th>
                <th className="px-3 py-2 text-right font-medium">Total</th>
              </tr>
            </thead>
            <tbody>
              {lineItems.map((l) => (
                <tr key={l.id} className="border-b border-slate-50 last:border-0">
                  <td className="px-3 py-2 text-slate-700">{l.description}</td>
                  <td className="px-3 py-2 text-slate-400">{l.uom ?? '—'}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{l.quantity.toLocaleString()}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{moneyExact(l.unitPrice)}</td>
                  <td className="px-3 py-2 text-right font-medium text-slate-800">{moneyExact(l.quantity * l.unitPrice)}</td>
                </tr>
              ))}
              {lineItems.length === 0 && (
                <tr><td colSpan={5} className="px-3 py-6 text-center text-slate-400">No line items match the current filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-3 flex justify-end border-t border-slate-100 pt-3">
          <span className="mr-2 text-sm text-slate-400">Grand Total:</span>
          <span className="text-lg font-bold text-slate-900">{moneyExact(total)}</span>
        </div>
      </CardBody>
    </Card>
  )
}

function InfoField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-wide text-slate-400">{label}</p>
      <p className="font-medium text-slate-800">{value}</p>
    </div>
  )
}
