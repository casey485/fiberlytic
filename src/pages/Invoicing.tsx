import { useMemo, useState } from 'react'
import { Plus, Trash2, FileText } from 'lucide-react'
import { useData } from '../store/DataContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardBody } from '../components/ui/Card'
import { StatCard } from '../components/ui/StatCard'
import { Modal } from '../components/ui/Modal'
import { Button, Field, Input, Select } from '../components/ui/Form'
import { money, moneyExact, formatDate, invoiceTotal, invoiceStatusMeta } from '../lib/format'
import { billableMarkupLines } from '../lib/analytics'
import type { InvoiceLineItem, InvoiceStatus } from '../types'

const STATUS_FLOW: InvoiceStatus[] = ['draft', 'sent', 'paid', 'overdue']

export function Invoicing() {
  const { data, addInvoice, updateInvoice, deleteInvoice } = useData()
  const [open, setOpen] = useState(false)
  const [fromFieldWorkOpen, setFromFieldWorkOpen] = useState(false)
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all')

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
      <PageHeader
        title="Invoicing"
        description="Bill clients and track what's outstanding, overdue, and paid."
        action={
          <>
            <Button variant="secondary" onClick={() => setFromFieldWorkOpen(true)}>
              <FileText size={16} /> From field work
            </Button>
            <Button onClick={() => setOpen(true)}>
              <Plus size={16} /> New invoice
            </Button>
          </>
        }
      />

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
              statusFilter === s ? 'bg-brand-600 text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200 hover:bg-slate-50'
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
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
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
                  <tr key={inv.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-5 py-3 font-medium text-slate-800">{inv.number}</td>
                    <td className="px-5 py-3">
                      <p className="text-slate-700">{inv.client}</p>
                      <p className="text-xs text-slate-400">{project?.name ?? '—'}</p>
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatDate(inv.issueDate)}</td>
                    <td className="whitespace-nowrap px-5 py-3 text-slate-600">{formatDate(inv.dueDate)}</td>
                    <td className="px-5 py-3 text-right font-semibold text-slate-800">{money(invoiceTotal(inv))}</td>
                    <td className="px-5 py-3">
                      <Select
                        value={inv.status}
                        onChange={(e) => updateInvoice(inv.id, { status: e.target.value as InvoiceStatus })}
                        className="w-28 !py-1 !text-xs"
                      >
                        {STATUS_FLOW.map((s) => <option key={s} value={s}>{invoiceStatusMeta[s].label}</option>)}
                      </Select>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <button onClick={() => deleteInvoice(inv.id)} className="text-slate-300 hover:text-rose-600" aria-label="Delete">
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                )
              })}
              {invoices.length === 0 && (
                <tr><td colSpan={7} className="px-5 py-10 text-center text-slate-400">No invoices found.</td></tr>
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      <NewInvoiceModal open={open} onClose={() => setOpen(false)} onCreate={addInvoice} />
      <FromFieldWorkModal open={fromFieldWorkOpen} onClose={() => setFromFieldWorkOpen(false)} />
    </div>
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
  const today = new Date().toISOString().slice(0, 10)
  const due = new Date()
  due.setDate(due.getDate() + 30)
  const dueStr = due.toISOString().slice(0, 10)

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
    onCreate({ ...form, lineItems: validLines })
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
          <span className="text-xs font-medium text-slate-600">Line items</span>
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
                  className="text-slate-300 hover:text-rose-600"
                  aria-label="Remove line"
                >
                  <Trash2 size={15} />
                </button>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-3 flex justify-end border-t border-slate-100 pt-3 text-sm">
          <span className="text-slate-500">Total:&nbsp;</span>
          <span className="font-semibold text-slate-900">{moneyExact(total)}</span>
        </div>
      </div>
    </Modal>
  )
}

/** Invoice modal sourced from a project's billed-but-not-yet-invoiced Field Map Work Objects. */
function FromFieldWorkModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, addInvoice, updateMarkupBilling } = useData()
  const today = new Date().toISOString().slice(0, 10)
  const due = new Date()
  due.setDate(due.getDate() + 30)
  const dueStr = due.toISOString().slice(0, 10)

  const [projectId, setProjectId] = useState(data.projects[0]?.id ?? '')
  const [form, setForm] = useState({
    number: `INV-${1046 + Math.floor((Date.now() / 1000) % 1000)}`,
    client: data.projects[0]?.client ?? '',
    issueDate: today,
    dueDate: dueStr,
    status: 'draft' as InvoiceStatus,
  })

  const { lines, sourceBillingIds } = useMemo(
    () => (projectId ? billableMarkupLines(data, projectId) : { lines: [], sourceBillingIds: [] }),
    [data, projectId],
  )

  const onProject = (id: string) => {
    setProjectId(id)
    const p = data.projects.find((x) => x.id === id)
    setForm((f) => ({ ...f, client: p?.client ?? f.client }))
  }

  const total = lines.reduce((s, l) => s + l.quantity * l.unitPrice, 0)

  const submit = () => {
    if (!projectId || lines.length === 0) return
    const invoiceId = addInvoice({
      number: form.number,
      projectId,
      client: form.client,
      issueDate: form.issueDate,
      dueDate: form.dueDate,
      status: form.status,
      lineItems: lines,
    })
    for (const billingId of sourceBillingIds) updateMarkupBilling(billingId, { invoiceId })
    onClose()
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Invoice from field work"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={lines.length === 0}>Create invoice</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Bill to project">
          <Select value={projectId} onChange={(e) => onProject(e.target.value)}>
            {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
        </Field>
        <Field label="Invoice number">
          <Input value={form.number} onChange={(e) => setForm((f) => ({ ...f, number: e.target.value }))} />
        </Field>
        <Field label="Client">
          <Input value={form.client} onChange={(e) => setForm((f) => ({ ...f, client: e.target.value }))} />
        </Field>
        <Field label="Issue date">
          <Input type="date" value={form.issueDate} onChange={(e) => setForm((f) => ({ ...f, issueDate: e.target.value }))} />
        </Field>
        <Field label="Due date">
          <Input type="date" value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
        </Field>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-xs font-medium text-slate-600">
          Line items <span className="text-slate-400">— from billed Work Objects on the Field Map; set unit prices</span>
        </p>
        {lines.length === 0 ? (
          <p className="rounded-lg bg-slate-50 px-3 py-4 text-center text-sm text-slate-400">
            No billed, not-yet-invoiced work for this project.
          </p>
        ) : (
          <div className="space-y-2">
            {lines.map((l) => (
              <div key={l.id} className="grid grid-cols-12 gap-2">
                <div className="col-span-7">
                  <Input value={l.description} readOnly />
                </div>
                <div className="col-span-2">
                  <Input type="number" value={l.quantity} readOnly />
                </div>
                <div className="col-span-3">
                  <Input type="number" step="0.01" placeholder="Unit $" value={l.unitPrice} readOnly />
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="mt-3 flex justify-end border-t border-slate-100 pt-3 text-sm">
          <span className="text-slate-500">Total:&nbsp;</span>
          <span className="font-semibold text-slate-900">{moneyExact(total)}</span>
        </div>
      </div>
    </Modal>
  )
}
