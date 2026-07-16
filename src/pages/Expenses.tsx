import { useMemo, useRef, useState } from 'react'
import { Plus, Trash2, CheckCircle, Upload, Download, X, AlertCircle, FileSpreadsheet } from 'lucide-react'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { Button, Field, Input, Select } from '../components/ui/Form'
import { money, moneyExact, formatDate, localDateStr } from '../lib/format'
import { weekStart, weekEnd } from '../lib/analytics'
import type { Crew, Project } from '../types'

// ── CSV bulk upload modal ────────────────────────────────────────────────────

type ParsedRow = {
  rowNum: number
  date: string
  crewName: string
  projectName: string
  location: string
  description: string
  amount: string
  // resolved
  crew: Crew | null
  project: Project | null
  errors: string[]
}

function parseCsv(text: string): string[][] {
  return text.trim().split(/\r?\n/).map((line) => {
    const cells: string[] = []
    let cur = '', inQ = false
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { cells.push(cur.trim()); cur = '' }
      else cur += ch
    }
    cells.push(cur.trim())
    return cells
  })
}

function BulkExpenseModal({ onClose, crews, projects, onImport }: {
  onClose: () => void
  crews: Crew[]
  projects: Project[]
  onImport: (rows: ParsedRow[]) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [rows, setRows] = useState<ParsedRow[]>([])
  const [dragging, setDragging] = useState(false)
  const [imported, setImported] = useState(false)

  const today = localDateStr()

  const downloadTemplate = () => {
    const header = 'Date,Crew Name,Project Name,Location,Description,Amount'
    const example = `${today},Crew A,Project Name Here,Fuel stop on Main St,Fuel,85.00`
    const blob = new Blob([header + '\n' + example], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'expense_bulk_template.csv'
    a.click()
  }

  const findCrew   = (name: string) => crews.find((c) => c.name.toLowerCase() === name.toLowerCase()) ?? null
  const findProject = (name: string) => projects.find((p) => p.name.toLowerCase() === name.toLowerCase()) ?? null

  const parseFile = (text: string) => {
    const lines = parseCsv(text)
    if (lines.length < 2) { setRows([]); return }
    const dataLines = lines.slice(1).filter((r) => r.some((c) => c))
    const parsed: ParsedRow[] = dataLines.map((cols, i) => {
      const [date = '', crewName = '', projectName = '', location = '', description = '', amount = ''] = cols
      const errors: string[] = []
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) errors.push('Date must be YYYY-MM-DD')
      const crew = findCrew(crewName)
      if (!crew) errors.push(`Crew "${crewName}" not found`)
      const project = findProject(projectName)
      if (!project) errors.push(`Project "${projectName}" not found`)
      if (!description.trim()) errors.push('Description is required')
      const amt = parseFloat(amount)
      if (isNaN(amt) || amt <= 0) errors.push('Amount must be a positive number')
      return { rowNum: i + 2, date, crewName, projectName, location, description, amount, crew, project, errors }
    })
    setRows(parsed)
    setImported(false)
  }

  const handleFile = (file: File) => {
    if (!file.name.endsWith('.csv') && file.type !== 'text/csv') {
      alert('Please upload a .csv file')
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => parseFile(e.target?.result as string)
    reader.readAsText(file)
  }

  const validRows = rows.filter((r) => r.errors.length === 0)
  const errorRows = rows.filter((r) => r.errors.length > 0)

  const handleImport = () => {
    onImport(validRows)
    setImported(true)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} />
      <div className="relative w-full max-w-4xl max-h-[90vh] overflow-y-auto rounded-2xl border border-slate-200 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <FileSpreadsheet size={20} className="text-amber-600" />
            <div>
              <p className="font-semibold text-slate-800">Bulk Upload Expenses</p>
              <p className="text-xs text-slate-400">Upload a CSV file to import multiple expenses at once</p>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={20} /></button>
        </div>

        <div className="p-6 space-y-5">
          {/* Step 1 — template */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">Step 1 — Download the template</p>
            <button
              onClick={downloadTemplate}
              className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-100 px-4 py-2.5 text-sm font-medium text-slate-600 hover:border-brand-600 hover:text-amber-600 transition"
            >
              <Download size={15} /> Download CSV template
            </button>
            <p className="mt-2 text-xs text-slate-400">
              Columns: <span className="text-slate-500">Date (YYYY-MM-DD) · Crew Name · Project Name · Location · Description · Amount</span>
            </p>
          </div>

          {/* Step 2 — upload */}
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-slate-400">Step 2 — Upload your filled CSV</p>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragging(true) }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
              onClick={() => fileRef.current?.click()}
              className={`flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed py-8 text-center transition ${
                dragging ? 'border-brand-500 bg-brand-600/10' : 'border-slate-200 hover:border-brand-600/50'
              }`}
            >
              <Upload size={24} className="text-slate-400" />
              <p className="text-sm font-medium text-slate-500">Drop your CSV here or click to browse</p>
              <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden"
                onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])} />
            </div>
          </div>

          {/* Preview */}
          {rows.length > 0 && (
            <div>
              <div className="mb-3 flex items-center justify-between">
                <p className="text-xs font-semibold uppercase tracking-widest text-slate-400">
                  Step 3 — Review &amp; Import
                </p>
                <div className="flex items-center gap-3 text-xs">
                  <span className="text-emerald-600">{validRows.length} ready</span>
                  {errorRows.length > 0 && <span className="text-rose-600">{errorRows.length} with errors</span>}
                </div>
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-200 text-left">
                      {['#','Date','Crew','Project','Location','Description','Amount','Status'].map((h) => (
                        <th key={h} className="px-3 py-2 font-semibold uppercase tracking-wide text-slate-400 first:pl-4 last:pr-4">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.rowNum} className={`border-b border-slate-100 ${r.errors.length > 0 ? 'bg-rose-50' : ''}`}>
                        <td className="pl-4 py-2 text-slate-400">{r.rowNum}</td>
                        <td className="px-3 py-2 text-slate-500">{r.date}</td>
                        <td className={`px-3 py-2 ${r.crew ? 'text-slate-600' : 'text-rose-600'}`}>{r.crewName || '—'}</td>
                        <td className={`px-3 py-2 ${r.project ? 'text-slate-600' : 'text-rose-600'}`}>{r.projectName || '—'}</td>
                        <td className="px-3 py-2 text-slate-400">{r.location || '—'}</td>
                        <td className="px-3 py-2 text-slate-600">{r.description || '—'}</td>
                        <td className="px-3 py-2 text-slate-600">{r.amount ? `$${parseFloat(r.amount).toFixed(2)}` : '—'}</td>
                        <td className="pr-4 py-2">
                          {r.errors.length === 0 ? (
                            <span className="text-emerald-600">✓ Ready</span>
                          ) : (
                            <span className="flex items-start gap-1 text-rose-600">
                              <AlertCircle size={12} className="mt-0.5 shrink-0" />
                              {r.errors[0]}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {errorRows.length > 0 && (
                <p className="mt-2 text-xs text-slate-400">
                  Rows with errors will be skipped. Fix them in your CSV and re-upload to include them.
                </p>
              )}

              <div className="mt-4 flex items-center gap-3">
                {!imported ? (
                  <Button onClick={handleImport} disabled={validRows.length === 0}>
                    <Upload size={15} /> Import {validRows.length} expense{validRows.length !== 1 ? 's' : ''}
                  </Button>
                ) : (
                  <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-4 py-2.5 text-sm font-medium text-emerald-700">
                    <CheckCircle size={16} /> {validRows.length} expense{validRows.length !== 1 ? 's' : ''} imported successfully!
                  </div>
                )}
                <Button variant="secondary" onClick={onClose}>Close</Button>
              </div>
            </div>
          )}

          {/* Crew & project name reference */}
          <details className="group">
            <summary className="cursor-pointer text-xs font-semibold uppercase tracking-widest text-slate-400 hover:text-slate-500">
              View valid crew &amp; project names ▾
            </summary>
            <div className="mt-3 grid grid-cols-2 gap-4">
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-400">Crews</p>
                {crews.map((c) => <p key={c.id} className="text-xs text-slate-500">{c.name}</p>)}
              </div>
              <div>
                <p className="mb-1 text-xs font-semibold text-slate-400">Projects</p>
                {projects.map((p) => <p key={p.id} className="text-xs text-slate-500">{p.name}</p>)}
              </div>
            </div>
          </details>
        </div>
      </div>
    </div>
  )
}

function monthStart(dateStr: string): string {
  return dateStr.slice(0, 7) + '-01'
}
function monthEnd(dateStr: string): string {
  const d = new Date(dateStr.slice(0, 7) + '-01T00:00:00')
  d.setMonth(d.getMonth() + 1)
  d.setDate(0)
  return localDateStr(d)
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
  const { isAdmin, activeEmployeeId } = useRole()
  const today = localDateStr()
  const [dateStart, setDateStart] = useState(() => monthStart(today))
  const [dateEnd, setDateEnd] = useState(() => monthEnd(today))
  const [crewFilter, setCrewFilter] = useState('all')
  const [showForm, setShowForm] = useState(false)
  const [showBulk, setShowBulk] = useState(false)

  const resetToThisMonth = () => {
    const now = localDateStr()
    setDateStart(monthStart(now))
    setDateEnd(monthEnd(now))
  }

  const resetToThisWeek = () => {
    const now = localDateStr()
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

  const fieldEmp = !isAdmin && activeEmployeeId ? data.employees.find((e) => e.id === activeEmployeeId) : null
  const defaultCrewId = fieldEmp?.defaultCrewId ?? data.crews[0]?.id ?? ''
  const [form, setForm] = useState<ExpenseForm>({
    date: today,
    crewId: defaultCrewId,
    jobId: projectForCrew(defaultCrewId),
    location: '',
    description: '',
    amount: '',
  })
  const [lastSubmitted, setLastSubmitted] = useState<string | null>(null)
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
    setLastSubmitted(form.description.trim())
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

  // ── Shared entry form ────────────────────────────────────────────────────────
  const entryForm = (
    <Card className={isAdmin ? 'mb-5 border-brand-200 bg-brand-50/30' : ''}>
      <CardBody>
        {isAdmin && <p className="mb-4 text-sm font-semibold text-slate-700">New crew expense</p>}
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
            />
          </Field>
        </div>
        <div className="mt-4 flex gap-2">
          <Button onClick={submit} disabled={!canSubmit}>Save expense</Button>
          {isAdmin && <Button variant="secondary" onClick={() => setShowForm(false)}>Cancel</Button>}
        </div>
      </CardBody>
    </Card>
  )

  // ── Field view — entry form + this employee's crew expenses ─────────────────
  if (!isAdmin) {
    // Collect this employee's crew IDs
    const emp = data.employees.find((e) => e.id === activeEmployeeId)
    const myCrewIds = new Set<string>()
    if (emp) {
      for (const crew of data.crews) {
        if (emp.defaultCrewId === crew.id) myCrewIds.add(crew.id)
        if (crew.foremanId === emp.id) myCrewIds.add(crew.id)
        if (crew.members.some((m) => m.employeeId === emp.id && m.active)) myCrewIds.add(crew.id)
      }
    }
    const todayExpenses = [...data.jobExpenses]
      .filter((ex) => ex.date === today && (myCrewIds.size === 0 || !ex.crewId || myCrewIds.has(ex.crewId)))
      .sort((a, b) => b.date.localeCompare(a.date))

    return (
      <div>
        <PageHeader
          title="Log Expense"
          description="Submit a job-site expense for your crew."
        />

        {lastSubmitted && (
          <div className="mb-4 flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            <CheckCircle size={16} className="shrink-0" />
            Expense submitted: <strong>{lastSubmitted}</strong>
          </div>
        )}

        {entryForm}

        {todayExpenses.length > 0 && (
          <div className="mt-6">
            <p className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">Submitted today</p>
            <Card>
              <CardBody className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                      <th className="px-5 py-2 font-medium">Crew</th>
                      <th className="px-5 py-2 font-medium">Description</th>
                      <th className="px-5 py-2 font-medium">Location</th>
                      <th className="px-5 py-2 font-medium">Project</th>
                      <th className="px-5 py-2 text-right font-medium">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {todayExpenses.map((ex) => {
                      const crew = data.crews.find((c) => c.id === ex.crewId)
                      const proj = data.projects.find((p) => p.id === ex.jobId)
                      return (
                        <tr key={ex.id} className="border-b border-slate-50">
                          <td className="px-5 py-2.5">
                            {crew
                              ? <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{crew.name}</span>
                              : <span className="text-slate-600">—</span>}
                          </td>
                          <td className="px-5 py-2.5 text-slate-700">{ex.description}</td>
                          <td className="px-5 py-2.5 text-slate-400">{ex.location || ex.vendor || '—'}</td>
                          <td className="px-5 py-2.5 text-xs text-slate-500">{proj?.name ?? '—'}</td>
                          <td className="px-5 py-2.5 text-right font-semibold text-slate-800">{moneyExact(ex.amount)}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </CardBody>
            </Card>
          </div>
        )}
      </div>
    )
  }

  const handleBulkImport = (rows: ParsedRow[]) => {
    for (const r of rows) {
      if (!r.crew || !r.project) continue
      addJobExpense({
        date: r.date,
        jobId: r.project.id,
        crewId: r.crew.id,
        location: r.location.trim() || undefined,
        vendor: r.location.trim() || '',
        description: r.description.trim(),
        amount: Math.round(parseFloat(r.amount) * 100) / 100,
      })
    }
  }

  // ── Admin view — full history with filters and totals ─────────────────────────
  return (
    <div>
      {showBulk && (
        <BulkExpenseModal
          onClose={() => setShowBulk(false)}
          crews={data.crews}
          projects={data.projects}
          onImport={handleBulkImport}
        />
      )}

      <PageHeader
        title="Crew Expenses"
        description="Daily job-site expenses tied to each crew — automatically flow into P&L."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowBulk(true)}>
              <Upload size={16} /> Bulk upload
            </Button>
            <Button onClick={() => setShowForm((v) => !v)}>
              <Plus size={16} /> Log expense
            </Button>
          </div>
        }
      />

      {showForm && entryForm}

      {/* Filter bar */}
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <Select value={crewFilter} onChange={(e) => setCrewFilter(e.target.value)} className="w-44">
          <option value="all">All crews</option>
          {data.crews.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <Input type="date" value={dateStart} onChange={(e) => setDateStart(e.target.value)} className="w-40" />
        <span className="text-sm text-slate-500">to</span>
        <Input type="date" value={dateEnd} onChange={(e) => setDateEnd(e.target.value)} className="w-40" />
        <button onClick={resetToThisMonth} className="text-sm font-medium text-brand-600 hover:text-brand-700">
          This month
        </button>
        <button onClick={resetToThisWeek} className="text-sm font-medium text-slate-500 hover:text-slate-400">
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
                <p className="text-xs text-slate-500">{crew?.name ?? 'Unknown crew'}</p>
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

      {/* Full expense list */}
      <Card>
        <CardHeader
          title={`Crew expenses · ${expenses.length} ${expenses.length === 1 ? 'entry' : 'entries'}`}
          subtitle={expenses.length > 0 ? `${money(totalInRange)} total` : undefined}
        />
        {expenses.length === 0 ? (
          <CardBody>
            <p className="py-10 text-center text-sm text-slate-500">
              No crew expenses in this date range. Click "Log expense" to add one.
            </p>
          </CardBody>
        ) : (
          <CardBody className="p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
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
                      <td className="whitespace-nowrap px-5 py-2.5 text-slate-400">{formatDate(ex.date)}</td>
                      <td className="px-5 py-2.5">
                        {crew
                          ? <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">{crew.name}</span>
                          : <span className="text-slate-600">—</span>}
                      </td>
                      <td className="px-5 py-2.5 text-slate-400">{ex.location || ex.vendor || <span className="text-slate-600">—</span>}</td>
                      <td className="px-5 py-2.5 text-slate-700">{ex.description}</td>
                      <td className="px-5 py-2.5 text-xs text-slate-500">{proj?.name ?? '—'}</td>
                      <td className="px-5 py-2.5 text-right font-semibold text-slate-800">{moneyExact(ex.amount)}</td>
                      <td className="px-5 py-2.5 text-right">
                        <button
                          onClick={() => deleteJobExpense(ex.id)}
                          className="text-slate-600 hover:text-rose-600"
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
