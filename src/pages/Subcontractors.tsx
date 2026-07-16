import { useState } from 'react'
import { Plus, Pencil, Trash2, AlertTriangle, ShieldAlert, X } from 'lucide-react'
import { useData } from '../store/DataContext'
import { Card, CardBody } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Button, Field, Input, Select, Textarea } from '../components/ui/Form'
import type { Subcontractor } from '../types'

type SubForm = {
  companyName: string
  contactName: string
  phone: string
  email: string
  projectRateCards: { projectId: string; rateCardId: string }[]
  payRatePercent: string
  insuranceExpiresAt: string
  insuranceNotes: string
  active: boolean
  notes: string
}

function SubcontractorModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: Subcontractor
  onSave: (f: SubForm) => void
  onClose: () => void
}) {
  const { data } = useData()
  const [form, setForm] = useState<SubForm>({
    companyName: initial?.companyName ?? '',
    contactName: initial?.contactName ?? '',
    phone: initial?.phone ?? '',
    email: initial?.email ?? '',
    projectRateCards: initial?.projectRateCards ?? [],
    payRatePercent: initial?.payRatePercent != null ? String(initial.payRatePercent) : '',
    insuranceExpiresAt: initial?.insuranceExpiresAt ?? '',
    insuranceNotes: initial?.insuranceNotes ?? '',
    active: initial?.active ?? true,
    notes: initial?.notes ?? '',
  })
  const set = <K extends keyof SubForm>(k: K, v: SubForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  const valid = form.companyName.trim().length > 0

  const addProjectRateCard = () => {
    const usedIds = new Set(form.projectRateCards.map((pr) => pr.projectId))
    const firstAvailable = data.projects.find((p) => !usedIds.has(p.id))
    if (!firstAvailable) return
    set('projectRateCards', [...form.projectRateCards, { projectId: firstAvailable.id, rateCardId: '' }])
  }
  const updateProjectRateCard = (index: number, patch: Partial<{ projectId: string; rateCardId: string }>) => {
    set('projectRateCards', form.projectRateCards.map((pr, i) => (i === index ? { ...pr, ...patch } : pr)))
  }
  const removeProjectRateCard = (index: number) => {
    set('projectRateCards', form.projectRateCards.filter((_, i) => i !== index))
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Edit subcontractor' : 'Add subcontractor'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} onClick={() => { if (valid) { onSave(form); onClose() } }}>Save</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Company name">
          <Input value={form.companyName} onChange={(e) => set('companyName', e.target.value)} placeholder="e.g. Bore Masters LLC" autoFocus />
        </Field>
        <Field label="Contact name">
          <Input value={form.contactName} onChange={(e) => set('contactName', e.target.value)} placeholder="Primary contact" />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} placeholder="(555) 555-5555" />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} placeholder="contact@company.com" />
        </Field>
        <Field label="Pay rate %" hint="What percent of the rate card's price they're actually paid — e.g. 80 = they're paid 80% of each billing line, we keep the rest. This is the only dollar figure their dashboard ever shows; leave blank to hide all earnings until set.">
          <Input
            type="number" min={0} max={100} step={1}
            value={form.payRatePercent}
            onChange={(e) => set('payRatePercent', e.target.value)}
            placeholder="e.g. 80"
          />
        </Field>
        <div className="sm:col-span-2">
          <div className="mb-1.5 flex items-center justify-between">
            <label className="block text-sm font-medium text-slate-700">Project rate cards</label>
            <button
              type="button"
              onClick={addProjectRateCard}
              disabled={form.projectRateCards.length >= data.projects.length}
              className="flex items-center gap-1 text-xs font-medium text-brand-600 hover:text-brand-700 disabled:opacity-40"
            >
              <Plus size={12} /> Add project
            </button>
          </div>
          <p className="mb-2 text-xs text-slate-400">
            Working several projects at once with a different negotiated rate on each? Set them here, one row per project — this wins over that project's own rate card for whichever project matches.
          </p>
          {form.projectRateCards.length === 0 ? (
            <p className="rounded-lg border border-dashed border-slate-200 px-3 py-2.5 text-xs text-slate-500">No per-project overrides yet — every job falls back to using that project's own rate card.</p>
          ) : (
            <div className="space-y-2">
              {form.projectRateCards.map((pr, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select
                    className="flex-1"
                    value={pr.projectId}
                    onChange={(e) => updateProjectRateCard(i, { projectId: e.target.value })}
                  >
                    {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </Select>
                  <Select
                    className="flex-1"
                    value={pr.rateCardId}
                    onChange={(e) => updateProjectRateCard(i, { rateCardId: e.target.value })}
                  >
                    <option value="">— select rate card —</option>
                    {data.rateCards.map((rc) => <option key={rc.id} value={rc.id}>{rc.name}</option>)}
                  </Select>
                  <button
                    type="button"
                    onClick={() => removeProjectRateCard(i)}
                    className="shrink-0 rounded p-1.5 text-slate-600 hover:bg-rose-50 hover:text-rose-600"
                    aria-label="Remove"
                  >
                    <X size={14} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <Field label="Insurance expires">
          <Input type="date" value={form.insuranceExpiresAt ?? ''} onChange={(e) => set('insuranceExpiresAt', e.target.value)} />
        </Field>
        <div className="sm:col-span-2">
          <Field label="Insurance notes">
            <Input value={form.insuranceNotes} onChange={(e) => set('insuranceNotes', e.target.value)} placeholder="Policy #, carrier, coverage notes" />
          </Field>
        </div>
        <div className="sm:col-span-2">
          <Field label="Notes">
            <Textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={2} />
          </Field>
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={form.active}
            onChange={(e) => set('active', e.target.checked)}
            className="rounded border-slate-300"
          />
          Active
        </label>
      </div>
    </Modal>
  )
}

/** True within 30 days of expiring or already expired — flagged in the list so
 *  an admin doesn't discover a lapsed policy only when a claim comes up. */
function insuranceIsStale(expiresAt?: string | null): boolean {
  if (!expiresAt) return false
  const days = (new Date(expiresAt).getTime() - Date.now()) / 86_400_000
  return days < 30
}

export function SubcontractorsList() {
  const { data, addSubcontractor, updateSubcontractor, deleteSubcontractor } = useData()
  const [dialog, setDialog] = useState<{ open: boolean; sub: Subcontractor | null }>({ open: false, sub: null })

  const save = (form: SubForm) => {
    const payload = {
      companyName: form.companyName.trim(),
      contactName: form.contactName.trim() || null,
      phone: form.phone.trim() || null,
      email: form.email.trim() || null,
      // Drop any row where a project was picked but no rate card was chosen
      // yet — an incomplete override shouldn't silently fall through to "no
      // rate card at all" for that project.
      projectRateCards: form.projectRateCards.filter((pr) => pr.projectId && pr.rateCardId),
      payRatePercent: form.payRatePercent.trim() === '' ? null : Math.min(100, Math.max(0, parseFloat(form.payRatePercent))),
      insuranceExpiresAt: form.insuranceExpiresAt || null,
      insuranceNotes: form.insuranceNotes.trim() || null,
      active: form.active,
      notes: form.notes.trim() || null,
    }
    if (dialog.sub) {
      updateSubcontractor(dialog.sub.id, payload)
    } else {
      addSubcontractor(payload)
    }
  }

  const active = (data.subcontractors ?? []).filter((s) => s.active)
  const inactive = (data.subcontractors ?? []).filter((s) => !s.active)

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm text-slate-500">Outside crews with their own rate agreements and insurance — assign them to a redline on the Field Map to bill against their rate card.</p>
        <Button onClick={() => setDialog({ open: true, sub: null })}>
          <Plus size={16} /> Add subcontractor
        </Button>
      </div>

      <Card>
        <CardBody className="p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-500">
                <th className="px-5 py-3 font-medium">Company</th>
                <th className="px-5 py-3 font-medium">Contact</th>
                <th className="px-5 py-3 font-medium">Phone / Email</th>
                <th className="px-5 py-3 font-medium">Rate Cards</th>
                <th className="px-5 py-3 font-medium">Pay Rate</th>
                <th className="px-5 py-3 font-medium">Insurance</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {active.map((sub) => {
                const projectRateCardCount = sub.projectRateCards?.length ?? 0
                const stale = insuranceIsStale(sub.insuranceExpiresAt)
                return (
                  <tr key={sub.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                    <td className="px-5 py-3 font-medium text-slate-800">{sub.companyName}</td>
                    <td className="px-5 py-3 text-slate-400">{sub.contactName ?? '—'}</td>
                    <td className="px-5 py-3 text-slate-400">
                      {sub.phone && <div>{sub.phone}</div>}
                      {sub.email && <div>{sub.email}</div>}
                      {!sub.phone && !sub.email && '—'}
                    </td>
                    <td className="px-5 py-3 text-slate-400">
                      {projectRateCardCount > 0
                        ? `${projectRateCardCount} project${projectRateCardCount === 1 ? '' : 's'} set`
                        : '— uses project default —'}
                    </td>
                    <td className="px-5 py-3">
                      {sub.payRatePercent != null ? (
                        <span className="text-slate-400">{sub.payRatePercent}%</span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-amber-600" title="No pay rate set — their dashboard shows no earnings until one is configured">
                          <AlertTriangle size={12} /> Not set
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      {sub.insuranceExpiresAt ? (
                        <span className={`inline-flex items-center gap-1 ${stale ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>
                          {stale && <ShieldAlert size={12} />}
                          {new Date(sub.insuranceExpiresAt).toLocaleDateString()}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-5 py-3">
                      <Badge tone="green">Active</Badge>
                    </td>
                    <td className="px-5 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setDialog({ open: true, sub })} className="p-1.5 text-slate-600 hover:text-brand-600" aria-label="Edit">
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => { if (confirm(`Remove ${sub.companyName}?`)) deleteSubcontractor(sub.id) }}
                          className="p-1.5 text-slate-600 hover:text-rose-600"
                          aria-label="Delete"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}

              {inactive.map((sub) => (
                <tr key={sub.id} className="border-b border-slate-50 opacity-50 hover:bg-slate-50/60">
                  <td className="px-5 py-3 font-medium text-slate-400">{sub.companyName}</td>
                  <td className="px-5 py-3 text-slate-500">{sub.contactName ?? '—'}</td>
                  <td className="px-5 py-3 text-slate-500">—</td>
                  <td className="px-5 py-3 text-slate-500">—</td>
                  <td className="px-5 py-3 text-slate-500">—</td>
                  <td className="px-5 py-3 text-slate-500">—</td>
                  <td className="px-5 py-3"><Badge tone="slate">Inactive</Badge></td>
                  <td className="px-5 py-3 text-right">
                    <button onClick={() => setDialog({ open: true, sub })} className="p-1.5 text-slate-600 hover:text-brand-600" aria-label="Edit">
                      <Pencil size={14} />
                    </button>
                  </td>
                </tr>
              ))}

              {(data.subcontractors ?? []).length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-10 text-center text-slate-500">
                    <div className="flex flex-col items-center gap-1.5">
                      <AlertTriangle size={18} className="opacity-40" />
                      No subcontractors yet. Add one to assign outside crews to redlines with their own rate card.
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardBody>
      </Card>

      {dialog.open && (
        <SubcontractorModal
          initial={dialog.sub ?? undefined}
          onSave={save}
          onClose={() => setDialog({ open: false, sub: null })}
        />
      )}
    </div>
  )
}
