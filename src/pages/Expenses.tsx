import { useMemo, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useData } from '../store/DataContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { Button, Field, Input, Select } from '../components/ui/Form'
import { money, moneyExact, formatDate } from '../lib/format'
import { weekStart, weekEnd } from '../lib/analytics'

function monthStart(dateStr: string): string {
  return dateStr.slice(0, 7) + '-01'
}
function monthEnd(dateStr: string): string {
  const d = new Date(dateStr.slice(0, 7) + '-01T00:00:00')
  d.setMonth(d.getMonth() + 1)
  d.setDate(0)
  return d.toISOString().slice(0, 10)
}

type ExpenseForm = {
  date: string
  crewId: string
  jobId: string
  location: string
  description: string
  amount: string
}

export function ExpensesPage() {
  const { data, addJobExpense, deleteJobExpense } = useData()
  const today = new Date().toISOString().slice(0, 10)
  const [dateStart, setDateStart] = useState(() => monthStart(today))
  const [dateEnd, setDateEnd] = useState(() => monthEnd(today))
  const [crewFilter, setCrewFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)

  const resetToThisMonth = () => {
    const now = new Date().toISOString().slice(0, 10)
    setDateStart(monthStart(now))
    setDateEnd(monthEnd(now))
  }

  const resetToThisWeek = () => {
    const now = new Date().toISOString().slice(0, 10)
    setDateStart(weekStart(now))
    setDateEnd(weekEnd(now))
  }

  const projectForCrew = (crewId: string): string => {
    if (!crewId) return data.projects[0]?.id ?? ''
    const crew = data.crews.find((c) => c.id === crewId)
    if (crew?.currentProjectId) return crew.currentProjectId
    const recent = [...data.production]
      .filter((e) => e.crewId === crewId)
      .sort((a, b) => b.date.localeCompare(a.date))[0]
    return recent?.projectId ?? data.projects[0]?.id ?? ''
  }

  const defaultCrewId = data.crews[0]?.id ?? ''
  const [form, setForm] = useState<ExpenseForm>({
    date: today,
    crewId: defaultCrewId,
    jobId: projectForCrew(defaultCrewId),
    location: '',
    description: '',
    amount: '',
  })
  const setF = <K extends keyof ExpenseForm>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const changeCrew = (crewId: string) => {
    setForm((f) => ({ ...f, crewId, jobId: projectForCrew(crewId) }))
  }

  const canSubmit = form.crewId && form.jobId && form.description.trim() && parseFloat(form.amount) > 0

  const submit = () => {
    if (!canSubmit) return
    addJobExpense({
      date: form.date,
      jobId: form.jobId,
      crewId: form.crewId,
      location: form.location.trim() || undefined,
      vendor: form.location.trim() || '',
      description: form.description.trim(),
      amount: Math.round(parseFloat(form.amount) * 100) / 100,
    })
    setForm((f) => ({ ...f, location: '', description: '', amount: '' }))
    setShowForm(false)
  }

  const expenses = useMemo(() => {
    return [...data.jobExpenses]
      .filter((ex) => {
        if (ex.date < dateStart || ex.date > dateEnd) return false
        if (!ex.crewId) return false
        if (crewFilter !== 'all' && ex.crewId !== crewFilter) return false
        return true
      })
      .sort((a, b) => b.date.localeCompare(a.date))
  }, [data.jobExpenses, dateStart, dateEnd, crewFilter])

  const totalInRange = expenses.reduce((s, ex) => s + ex.amount, 0)

  const crewTotals = useMemo(() => {
    const map = new Map<string, number>()
    for (const ex of expenses) {
      if (ex.crewId) map.set(ex.crewId, (map.get(ex.crewId) ?? 0) + ex.amount)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [expenses])

  return (
    <div>
      <PageHeader
        title="Crew Expenses"
        description="Daily job-site expenses tied to each crew — automatically flow into P&L."
        action={
          <Button onClick={() => setShowForm((v) => !v)}>
            <Plus size={16} /> Log expense
          </Button>
        }
      />

      {/* Inline entry form */}
      {showForm && (
        <Card className="mb-5 border-brand-200 bg-brand-50/30">
          <CardBody>
            <p className="mb-4 text-sm font-semibold text-slate-700">New crew expense</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Field label="Date">
                <Input type="date" value={form.date} onChange={(e) => setF('date', e.target.value)} />
              </Field>
              <Field label="Crew">
                <Select value={form.crewId} onChange={(e) => changeCrew(e.target.value)}>
                  <option value="">— Select crew —</option>
                  {data.crews.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </Field>
              <Field label="Project / job" hint="Auto-filled from crew — override if needed">
                <Select value={form.jobId} onChange={(e) => setF('jobId', e.target.value)}>
                  <option value="">— Select project —</option>
                  {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </Select>
              </Field>
              <Field label="Location">
                <Input
                  value={form.location}
                  onChange={(e) => setF('location', e.target.value)}
                  placeholder="e.g. Elmwood Ave & 5th St"
                />
              </Field>
              <Field label="Amount ($)">
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setF('amount', e.target.value)}
                  placeholder="0.00"
                />
              </Field>
              <Field label="Description — what was done / purchased">
                <Input
                  value={form.description}
                  onChange={(e) => setF('description', e.target.value)}
                  placeholder="e.g. Fuel, materials, permit fee…"
                  autoFocus
                />
              </Field>
            </div>
            <div className="mt-4 flex gap-2">
              <Button onClick={submit} disabled={!canSubmit}>Save expense</Button>
              <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Filter bar */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Select value={crewFilter} onChange={(e) => setCrewFilter(e.target.value)} className="w-44">
          <option value="all">All crews</option>
          {data.crews.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="w-40" />
        <span className="text-sm text-slate-400">to</span>
        <Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="w-40" />
        <button onClick={resetToThisMonth} className="text-sm font-medium text-brand-600 hover:text-brand-700">
          This month
        </button>
        <button onClick={resetToThisWeek} className="text-sm font-medium text-slate-400 hover:text-slate-600">
          This week
        </button>
      </div>

      {/* Per-crew summary cards */}
      {crewTotals.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-3">
          {crewTotals.map(([crewId, total]) => {
            const crew = data.crews.find((c) => c.id === crewId)
            return (
              <div key={crewId} className="rounded-xl border border-slate-200 bg-white px-4 py-3">
                <p className="text-xs text-slate-400">{crew?.name ?? 'Unknown crew'}</p>
                <p className="mt-0.5 text-xl font-bold text-slate-800">{money(total)}</p>
              </div>
            )
          })}
          {crewTotals.length > 1 && (
            <div className="rounded-xl border border-brand-200 bg-brand-50 px-4 py-3">
              <p className="text-xs text-brand-500">Total</p>
              <p className="mt-0.5 text-xl font-bold text-brand-700">{money(totalInRange)}</p>
            </div>
          )}
        </div>
      )}

      {/* Expense list */}
      <Card>
        <CardHeader
          title={`Crew expenses · ${expenses.length} ${expenses.length === 1 ? 'entry' : 'entries'}`}
          subtitle={expenses.length > 0 ? `${money(totalInRange)} total` : undefined}
        />
        {expenses.length === 0 ? (
          <CardBody>
            <p className="py-10 text-center text-sm text-slate-400">
              No crew expenses in this date range. Click "Log expense" to add one.
            </p>
          </CardBody>
        ) : (
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-5 py-2.5 font-medium">Date</th>
                  <th className="px-5 py-2.5 font-medium">Crew</th>
                  <th className="px-5 py-2.5 font-medium">Location</th>
                  <th className="px-5 py-2.5 font-medium">Description</th>
                  <th className="px-5 py-2.5 font-medium">Project</th>
                  <th className="px-5 py-2.5 text-right font-medium">Amount</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {expenses.map((ex) => {
                  const crew = data.crews.find((c) => c.id === ex.crewId)
                  const proj = data.projects.find((p) => p.id === ex.jobId)
                  return (
                    <tr key={ex.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                      <td className="whitespace-nowrap px-5 py-2.5 text-slate-500">{formatDate(ex.date)}</td>
                      <td className="px-5 py-2.5">
                        {crew
                          ? <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{crew.name}</span>
                          : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-5 py-2.5 text-slate-500">{ex.location || ex.vendor || <span className="text-slate-300">—</span>}</td>
                      <td className="px-5 py-2.5 text-slate-700">{ex.description}</td>
                      <td className="px-5 py-2.5 text-xs text-slate-400">{proj?.name ?? '—'}</td>
                      <td className="px-5 py-2.5 text-right font-semibold text-slate-800">{moneyExact(ex.amount)}</td>
                      <td className="px-5 py-2.5 text-right">
                        <button
                          onClick={() => deleteJobExpense(ex.id)}
                          className="text-slate-300 hover:text-rose-600"
                          aria-label="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-slate-200 bg-slate-50">
                  <td colSpan={5} className="px-5 py-2.5 text-right text-sm font-semibold text-slate-700">Total</td>
                  <td className="px-5 py-2.5 text-right font-bold text-slate-800">{money(totalInRange)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </CardBody>
        )}
      </Card>
    </div>
  )
}
