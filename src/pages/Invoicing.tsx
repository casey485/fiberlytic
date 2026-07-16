import { useMemo, useState } from 'react'
import { Plus, Trash2, FileText, Download, FileSpreadsheet, FileType, X } from 'lucide-react'
import { useData } from '../store/DataContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardBody } from '../components/ui/Card'
import { StatCard } from '../components/ui/StatCard'
import { Modal } from '../components/ui/Modal'
import { Button, Field, Input, Select } from '../components/ui/Form'
import { InvoicePreviewCard } from '../components/InvoicePreviewCard'
import { QaStatusFilterSelect } from '../components/QaStatusFilterSelect'
import { listCrewsAndSubcontractors } from '../lib/crewOrSub'
import { weekStart, weekEnd } from '../lib/analytics'
import { money, moneyExact, formatDate, invoiceTotal, invoiceStatusMeta, localDateStr } from '../lib/format'
import { exportInvoicePdf, exportInvoiceExcel, exportInvoiceCsv } from '../lib/invoiceExport'
import { exportSplicingInvoiceMatrixExcel, isSpliceRateCode } from '../lib/spliceExport'
import {
  buildInvoiceCandidateRows, applyInvoiceFilters, invoiceFiltersActive, EMPTY_INVOICE_FILTERS,
  groupInvoiceCandidatesByProject, buildInvoiceLineItems, invoiceLineItemsTotal,
} from '../lib/invoiceSource'
import type { InvoiceFilterState } from '../lib/invoiceSource'
import type { Invoice, InvoiceLineItem, InvoiceStatus } from '../types'
import { WORK_OBJECT_TYPES } from '../lib/workObjectTypes'

const STATUS_FLOW: InvoiceStatus[] = ['draft', 'sent', 'paid', 'overdue']

export function Invoicing() {
  const [tab, setTab] = useState<'invoices' | 'generate'>('invoices')
  return (
    <div>
      <PageHeader
        title="Invoicing"
        description="A live production billing center — approved production flows straight into invoices, no duplicate entry."
      />
      <div className="mb-6 flex gap-1 rounded-lg border border-slate-200 bg-slate-50 p-1 w-fit">
        {(['invoices', 'generate'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-md px-4 py-1.5 text-sm font-medium transition ${
              tab === t ? 'bg-white shadow-sm text-slate-900' : 'text-slate-400 hover:text-slate-700'
            }`}
          >
            {t === 'invoices' ? 'Invoices' : 'Generate Invoices'}
          </button>
        ))}
      </div>
      {tab === 'invoices' ? <InvoicesTab onGenerate={() => setTab('generate')} /> : <GenerateInvoicesTab onGenerated={() => setTab('invoices')} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Invoices tab — existing list + manual entry + view/export/history
// ---------------------------------------------------------------------------

function InvoicesTab({ onGenerate }: { onGenerate: () => void }) {
  const { data, addInvoice, updateInvoice, deleteInvoice } = useData()
  const [open, setOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all')
  const [viewInvoice, setViewInvoice] = useState<Invoice | null>(null)

  const invoices = useMemo(() => {
    const list = statusFilter === 'all' ? data.invoices : data.invoices.filter((i) => i.status === statusFilter)
    return [...list].sort((a, b) => b.issueDate.localeCompare(a.issueDate))
  }, [data.invoices, statusFilter])

  const totals = useMemo(() => {
    let billed = 0, outstanding = 0, overdue = 0, paid = 0
    for (const i of data.invoices) {
      const t = invoiceTotal(i)
      billed += t
      if (i.status === 'paid') paid += t
      if (i.status === 'sent' || i.status === 'overdue') outstanding += t
      if (i.status === 'overdue') overdue += t
    }
    return { billed, outstanding, overdue, paid }
  }, [data.invoices])

  return (
    <div>
      <div className="mb-6 flex justify-end gap-2">
        <Button variant="secondary" onClick={onGenerate}>
          <FileText size={16} /> Generate from production
        </Button>
        <Button onClick={() => setOpen(true)}>
          <Plus size={16} /> New invoice
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total billed" value={money(totals.billed)} />
        <StatCard label="Outstanding" value={money(totals.outstanding)} hint="sent + overdue" />
        <StatCard label="Overdue" value={money(totals.overdue)} icon={<FileText size={20} className={totals.overdue > 0 ? 'text-rose-500' : ''} />} />
        <StatCard label="Collected" value={money(totals.paid)} />
      </div>

      <div className="mb-4 mt-6 flex flex-wrap gap-2">
        {(['all', ...STATUS_FLOW] as const).map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`rounded-full px-3 py-1 text-sm font-medium capitalize transition ${
              statusFilter === s ? 'bg-brand-600 text-white' : 'bg-white text-slate-400 ring-1 ring-slate-200 hover:bg-slate-50'
            }`}
          >
            {s}
          </button>
        ))}
      </div>

      <Card>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-2.5 font-medium">Invoice</th>
                <th className="px-5 py-2.5 font-medium">Client / Project</th>
                <th className="px-5 py-2.5 font-medium">Issued</th>
                <th className="px-5 py-2.5 font-medium">Due</th>
                <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                <th className="px-5 py-2.5 font-medium">Status</th>
                <th className="px-5 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((inv) => {
                const project = data.projects.find((p) => p.id === inv.projectId)
                return (
                  <tr key={inv.id} className="cursor-pointer border-b border-slate-50 hover:bg-slate-50/60" onClick={() => setViewInvoice(inv)}>
                    <td className="px-5 py-3 font-medium text-slate-800">{inv.number}</td>
                    <td className="px-5 py-3">
                      <p className="text-slate-700">{inv.client}</p>
                      <p className="text-xs text-slate-500">{project?.name ?? '—'}</p>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-400">{formatDate(inv.issueDate)}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-400">{formatDate(inv.dueDate)}</td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-800">{money(invoiceTotal(inv))}</td>
                    <td className="px-5 py-3" onClick={(e) => e.stopPropagation()}>
                      <Select
                        value={inv.status}
                        onChange={(e) => updateInvoice(inv.id, { status: e.target.value as InvoiceStatus, paidDate: e.target.value === 'paid' ? new Date().toISOString() : inv.paidDate })}
                        className="w-28 !py-1 !text-xs"
                      >
                        {STATUS_FLOW.map((s) => <option key={s} value={s}>{invoiceStatusMeta[s].label}</option>)}
                      </Select>
                    </td>
                    <td className="px-5 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                      <button onClick={() => deleteInvoice(inv.id)} className="text-slate-600 hover:text-rose-600" aria-label="Delete">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                )
              })}
              {invoices.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-500">No invoices found.</td></tr>
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <NewInvoiceModal open={open} onClose={() => setOpen(false)} onCreate={addInvoice} />
      {viewInvoice && <InvoiceDetailModal invoice={viewInvoice} onClose={() => setViewInvoice(null)} />}
    </div>
  )
}

function InvoiceDetailModal({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const { data } = useData()
  const project = data.projects.find((p) => p.id === invoice.projectId)
  const client = invoice.clientId ? data.clients.find((c) => c.id === invoice.clientId) ?? null : null
  const billingRows = (data.markupBilling ?? []).filter((b) => (invoice.sourceBillingIds ?? []).includes(b.id))
  const hasSpliceLines = billingRows.some((b) => isSpliceRateCode(b.rateCode))
  const spliceLineRows = billingRows.map((b) => {
    const markup = (data.fieldMarkups ?? []).find((m) => m.id === b.markupId)
    const enclosure = (data.spliceEnclosures ?? []).find((s) => s.markupId === b.markupId)
    return { billing: b, markup, enclosure }
  })

  return (
    <Modal open onClose={onClose} title={invoice.number} size="xl">
      <InvoicePreviewCard
        projectName={project?.name ?? '—'}
        clientName={invoice.client}
        invoiceNumber={invoice.number}
        issueDate={invoice.issueDate}
        billingPeriod={invoice.billingPeriodStart && invoice.billingPeriodEnd ? `${formatDate(invoice.billingPeriodStart)} – ${formatDate(invoice.billingPeriodEnd)}` : null}
        lineItems={invoice.lineItems}
        actions={
          <>
            <Button
              variant="secondary"
              onClick={() => project && exportInvoicePdf(invoice, { id: project.id, name: project.name, location: project.location }, client, billingRows)}
              disabled={!project || billingRows.length === 0}
            >
              <Download size={14} /> PDF
            </Button>
            <Button variant="secondary" onClick={() => exportInvoiceExcel(invoice, project)}>
              <FileSpreadsheet size={14} /> Excel
            </Button>
            <Button variant="secondary" onClick={() => exportInvoiceCsv(invoice)}>
              <FileType size={14} /> CSV
            </Button>
            {hasSpliceLines && (
              <Button variant="secondary" onClick={() => exportSplicingInvoiceMatrixExcel(invoice, spliceLineRows)}>
                <FileSpreadsheet size={14} /> Splicing Matrix
              </Button>
            )}
          </>
        }
      />
      {billingRows.length === 0 && (invoice.sourceBillingIds ?? []).length > 0 && (
        <p className="mt-3 text-xs text-amber-600">Some source production lines for this invoice no longer exist — PDF export needs at least one to render.</p>
      )}
    </Modal>
  )
}

let liCounter = 0
const blankLine = (): InvoiceLineItem => ({ id: `nli-${liCounter++}`, description: '', quantity: 1, unitPrice: 0 })

function NewInvoiceModal({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: ReturnType<typeof useData>['addInvoice']
}) {
  const { data } = useData()
  const today = localDateStr()
  const due = new Date()
  due.setDate(due.getDate() + 30)
  const dueStr = localDateStr(due)

  const [form, setForm] = useState({
    number: `INV-${1046 + Math.floor((Date.now() / 1000) % 1000)}`,
    projectId: data.projects[0]?.id ?? '',
    client: data.projects[0]?.client ?? '',
    issueDate: today,
    dueDate: dueStr,
    status: 'draft' as InvoiceStatus,
  })
  const [lines, setLines] = useState<InvoiceLineItem[]>([blankLine()])

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))
  const setLine = (id: string, patch: Partial<InvoiceLineItem>) =>
    setLines((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)))

  const total = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)

  const onProject = (projectId: string) => {
    const proj = data.projects.find((p) => p.id === projectId)
    setForm((f) => ({ ...f, projectId, client: proj?.client ?? f.client }))
  }

  const submit = () => {
    const validLines = lines.filter((l) => l.description.trim() && l.quantity > 0)
    if (!form.projectId || validLines.length === 0) return
    onCreate({ ...form, lineItems: validLines, sourceBillingIds: [] })
    onClose()
    setLines([blankLine()])
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New invoice"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit}>Create invoice</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Invoice number">
          <Input value={form.number} onChange={(e) => set('number', e.target.value)} />
        </Field>
        <Field label="Project">
          <Select value={form.projectId} onChange={(e) => onProject(e.target.value)}>
            {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Client">
          <Input value={form.client} onChange={(e) => set('client', e.target.value)} />
        </Field>
        <Field label="Status">
          <Select value={form.status} onChange={(e) => set('status', e.target.value)}>
            {STATUS_FLOW.map((s) => <option key={s} value={s}>{invoiceStatusMeta[s].label}</option>)}
          </Select>
        </Field>
        <Field label="Issue date">
          <Input type="date" value={form.issueDate} onChange={(e) => set('issueDate', e.target.value)} />
        </Field>
        <Field label="Due date">
          <Input type="date" value={form.dueDate} onChange={(e) => set('dueDate', e.target.value)} />
        </Field>
      </div>

      <div className="mt-5">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-slate-400">Line items</span>
          <button onClick={() => setLines((ls) => [...ls, blankLine()])} className="text-xs font-medium text-brand-600 hover:text-brand-700">
            + Add line
          </button>
        </div>
        <div className="space-y-2">
          {lines.map((l) => (
            <div key={l.id} className="grid grid-cols-12 gap-2">
              <div className="col-span-6">
                <Input placeholder="Description" value={l.description} onChange={(e) => setLine(l.id, { description: e.target.value })} />
              </div>
              <div className="col-span-2">
                <Input type="number" placeholder="Qty" value={l.quantity} onChange={(e) => setLine(l.id, { quantity: Number(e.target.value) })} />
              </div>
              <div className="col-span-3">
                <Input type="number" step="0.01" placeholder="Unit $" value={l.unitPrice} onChange={(e) => setLine(l.id, { unitPrice: Number(e.target.value) })} />
              </div>
              <div className="col-span-1 flex items-center justify-center">
                <button
                  onClick={() => setLines((ls) => (ls.length > 1 ? ls.filter((x) => x.id !== l.id) : ls))}
                  className="text-slate-600 hover:text-rose-600"
                  aria-label="Remove line"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-end border-t border-slate-100 pt-3 text-sm">
          <span className="text-slate-400">Total:&nbsp;</span>
          <span className="font-semibold text-slate-900">{moneyExact(total)}</span>
        </div>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Generate Invoices tab — filter-driven, live multi-project preview, batch
// generate straight from approved production. Supersedes the old
// single-project "From field work" modal.
// ---------------------------------------------------------------------------

function GenerateInvoicesTab({ onGenerated }: { onGenerated: () => void }) {
  const { data, addInvoice, updateMarkupBilling } = useData()
  const [filters, setFilters] = useState<InvoiceFilterState>(EMPTY_INVOICE_FILTERS)
  const [generating, setGenerating] = useState(false)

  const candidates = useMemo(() => buildInvoiceCandidateRows(data), [data])
  const filtered = useMemo(() => applyInvoiceFilters(candidates, filters, data), [candidates, filters, data])
  const grouped = useMemo(() => groupInvoiceCandidatesByProject(filtered), [filtered])

  const setFilter = <K extends keyof InvoiceFilterState>(k: K, v: InvoiceFilterState[K]) => setFilters((f) => ({ ...f, [k]: v }))
  const clearFilters = () => setFilters(EMPTY_INVOICE_FILTERS)

  const setThisWeek = () => { const t = localDateStr(); setFilters((f) => ({ ...f, dateFrom: weekStart(t), dateTo: weekEnd(t) })) }
  const setThisMonth = () => {
    const now = new Date()
    setFilters((f) => ({
      ...f,
      dateFrom: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`,
      dateTo: localDateStr(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    }))
  }

  const previews = useMemo(() => {
    return [...grouped.entries()]
      .map(([projectId, rows]) => {
        const project = rows[0].project!
        const client = rows[0].client ?? null
        const { lineItems, sourceBillingIds } = buildInvoiceLineItems(rows)
        const dates = rows.map((r) => r.billing.date ?? r.markup.createdAt?.slice(0, 10)).filter((d): d is string => !!d).sort()
        return {
          projectId, project, client, lineItems, sourceBillingIds,
          periodStart: dates[0] ?? null, periodEnd: dates[dates.length - 1] ?? null,
        }
      })
      .sort((a, b) => a.project.name.localeCompare(b.project.name))
  }, [grouped])

  const totalAcrossAll = previews.reduce((s, p) => s + invoiceLineItemsTotal(p.lineItems), 0)

  const generate = () => {
    if (previews.length === 0 || generating) return
    const summary = previews.map((p) => `${p.project.name} — ${p.lineItems.length} line${p.lineItems.length === 1 ? '' : 's'}, ${moneyExact(invoiceLineItemsTotal(p.lineItems))}`).join('\n')
    if (!confirm(`Generate ${previews.length} invoice${previews.length === 1 ? '' : 's'}?\n\n${summary}`)) return

    setGenerating(true)
    const today = localDateStr()
    const due = new Date()
    due.setDate(due.getDate() + 30)
    for (const p of previews) {
      const invoiceId = addInvoice({
        number: `INV-${1046 + Math.floor((Date.now() / 1000 + Math.random() * 997) % 1000)}`,
        projectId: p.projectId,
        clientId: p.client?.id ?? null,
        client: p.client?.name ?? p.project.client,
        issueDate: today,
        dueDate: localDateStr(due),
        billingPeriodStart: p.periodStart,
        billingPeriodEnd: p.periodEnd,
        status: 'draft',
        lineItems: p.lineItems,
        sourceBillingIds: p.sourceBillingIds,
      })
      for (const id of p.sourceBillingIds) updateMarkupBilling(id, { invoiceId })
    }
    setGenerating(false)
    setFilters(EMPTY_INVOICE_FILTERS)
    onGenerated()
  }

  const clients = data.clients ?? []
  const crewOrSubOptions = listCrewsAndSubcontractors(data)

  return (
    <div>
      <Card className="mb-5">
        <CardBody className="flex flex-wrap items-end gap-3">
          <FilterField label="Customer">
            <Select value={filters.clientId} onChange={(e) => setFilter('clientId', e.target.value)} className="w-40">
              <option value="">All customers</option>
              {clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </FilterField>
          <FilterField label="Project">
            <Select value={filters.projectId} onChange={(e) => setFilter('projectId', e.target.value)} className="w-44">
              <option value="">All projects</option>
              {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </FilterField>
          <FilterField label="Work Order">
            <Input value={filters.workOrderQuery} onChange={(e) => setFilter('workOrderQuery', e.target.value)} placeholder="e.g. WO-TRN" className="w-32" />
          </FilterField>
          <FilterField label="Contractor / Crew / Sub">
            <Select value={filters.crewOrSubId} onChange={(e) => setFilter('crewOrSubId', e.target.value)} className="w-40">
              <option value="">All crews</option>
              {crewOrSubOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </FilterField>
          <FilterField label="From">
            <Input type="date" value={filters.dateFrom} onChange={(e) => setFilter('dateFrom', e.target.value)} className="w-36" />
          </FilterField>
          <FilterField label="To">
            <Input type="date" value={filters.dateTo} onChange={(e) => setFilter('dateTo', e.target.value)} className="w-36" />
          </FilterField>
          <div className="flex gap-1.5">
            <button onClick={setThisWeek} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50">This Week</button>
            <button onClick={setThisMonth} className="rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50">This Month</button>
          </div>
          <FilterField label="Production Type">
            <Select value={filters.productionType} onChange={(e) => setFilter('productionType', e.target.value as InvoiceFilterState['productionType'])} className="w-44">
              <option value="">All production types</option>
              {WORK_OBJECT_TYPES.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
            </Select>
          </FilterField>
          <FilterField label="Approval Status">
            <QaStatusFilterSelect value={filters.approvalStatus || 'all'} onChange={(v) => setFilter('approvalStatus', v === 'all' ? '' : v)} className="w-44" />
          </FilterField>
          <FilterField label="Invoiced">
            <Select value={filters.invoicedFilter} onChange={(e) => setFilter('invoicedFilter', e.target.value as InvoiceFilterState['invoicedFilter'])} className="w-40">
              <option value="">Any</option>
              <option value="not_invoiced">Not Yet Invoiced</option>
              <option value="invoiced">Previously Invoiced</option>
            </Select>
          </FilterField>
          <FilterField label="Paid">
            <Select value={filters.paidUnpaid} onChange={(e) => setFilter('paidUnpaid', e.target.value as InvoiceFilterState['paidUnpaid'])} className="w-32">
              <option value="">Any</option>
              <option value="unpaid">Unpaid</option>
              <option value="paid">Paid</option>
            </Select>
          </FilterField>
          {invoiceFiltersActive(filters) && (
            <button onClick={clearFilters} className="flex items-center gap-1 text-xs font-medium text-slate-400 hover:text-slate-600">
              <X size={13} /> Clear filters
            </button>
          )}
        </CardBody>
      </Card>

      {previews.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-12 text-center text-slate-400">
          <FileText size={32} />
          <p>No billable, approved production matches these filters.</p>
        </Card>
      ) : (
        <>
          <div className="mb-4 flex items-center justify-between">
            <p className="text-sm text-slate-500">
              {previews.length} invoice{previews.length === 1 ? '' : 's'} ready · {moneyExact(totalAcrossAll)} total
            </p>
            <Button onClick={generate} disabled={generating}>
              {generating ? 'Generating…' : `Generate Invoice${previews.length === 1 ? '' : 's'} (${previews.length})`}
            </Button>
          </div>
          <div className="space-y-4">
            {previews.map((p) => (
              <InvoicePreviewCard
                key={p.projectId}
                projectName={p.project.name}
                clientName={p.client?.name ?? p.project.client}
                invoiceNumber="Assigned on generate"
                issueDate={localDateStr()}
                billingPeriod={p.periodStart && p.periodEnd ? `${formatDate(p.periodStart)} – ${formatDate(p.periodEnd)}` : null}
                lineItems={p.lineItems}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function FilterField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="mb-1 block text-[11px] font-medium text-slate-500">{label}</span>
      {children}
    </div>
  )
}
