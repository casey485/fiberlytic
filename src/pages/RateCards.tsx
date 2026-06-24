import { useState } from 'react'
import { Plus, Trash2, Pencil, ChevronDown, ChevronRight, Upload } from 'lucide-react'
import { useData } from '../store/DataContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Button, Field, Input, Select } from '../components/ui/Form'
import { moneyExact, formatDate } from '../lib/format'
import { BulkImportModal } from '../components/BulkImportModal'
import type { Client, RateCard, RateCardUnit, RateCardDivision, UOM } from '../types'

const DIVISIONS: RateCardDivision[] = ['Underground', 'Aerial']
const UOMS: UOM[] = ['LF', 'EA', 'SQFT']

// ---------------------------------------------------------------------------
// Client modal
// ---------------------------------------------------------------------------

function ClientModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: Client
  onSave: (name: string) => void
  onClose: () => void
}) {
  const [name, setName] = useState(initial?.name ?? '')
  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Edit client' : 'Add client'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { if (name.trim()) { onSave(name.trim()); onClose() } }}>Save</Button>
        </>
      }
    >
      <Field label="Client name">
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Essentia" autoFocus />
      </Field>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Rate card modal
// ---------------------------------------------------------------------------

type RcForm = { name: string; division: RateCardDivision; effectiveDate: string }

function RateCardModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: RateCard
  onSave: (f: RcForm) => void
  onClose: () => void
}) {
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState<RcForm>({
    name: initial?.name ?? '',
    division: initial?.division ?? 'Underground',
    effectiveDate: initial?.effectiveDate ?? today,
  })
  const set = <K extends keyof RcForm>(k: K, v: RcForm[K]) => setForm((f) => ({ ...f, [k]: v }))

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Edit rate card' : 'Add rate card'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => { if (form.name.trim()) { onSave(form); onClose() } }}>Save</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Field label="Card name">
            <Input value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="e.g. Essentia Underground 2025" autoFocus />
          </Field>
        </div>
        <Field label="Division">
          <Select value={form.division} onChange={(e) => set('division', e.target.value as RateCardDivision)}>
            {DIVISIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </Select>
        </Field>
        <Field label="Effective date">
          <Input type="date" value={form.effectiveDate} onChange={(e) => set('effectiveDate', e.target.value)} />
        </Field>
        <p className="sm:col-span-2 text-xs text-slate-400">Client: fixed to the selected client above.</p>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Rate card unit modal
// ---------------------------------------------------------------------------

type UnitForm = { unitCode: string; description: string; uom: UOM; rate: string }

function UnitModal({
  initial,
  onSave,
  onClose,
}: {
  initial?: RateCardUnit
  onSave: (f: UnitForm) => void
  onClose: () => void
}) {
  const [form, setForm] = useState<UnitForm>({
    unitCode: initial?.unitCode ?? '',
    description: initial?.description ?? '',
    uom: initial?.uom ?? 'LF',
    rate: initial ? String(initial.rate) : '',
  })
  const set = <K extends keyof UnitForm>(k: K, v: UnitForm[K]) => setForm((f) => ({ ...f, [k]: v }))
  const valid = form.unitCode.trim() && form.description.trim() && parseFloat(form.rate) > 0

  return (
    <Modal
      open
      onClose={onClose}
      title={initial ? 'Edit unit' : 'Add unit'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} onClick={() => { if (valid) { onSave(form); onClose() } }}>Save</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Unit code">
          <Input value={form.unitCode} onChange={(e) => set('unitCode', e.target.value)} placeholder="e.g. 1U4-1" autoFocus />
        </Field>
        <Field label="UOM">
          <Select value={form.uom} onChange={(e) => set('uom', e.target.value as UOM)}>
            {UOMS.map((u) => <option key={u} value={u}>{u}</option>)}
          </Select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Description">
            <Input value={form.description} onChange={(e) => set('description', e.target.value)} placeholder='e.g. Place (1) 1.25" HDPE Duct' />
          </Field>
        </div>
        <Field label="Rate ($/unit)">
          <Input type="number" step="0.01" min="0" value={form.rate} onChange={(e) => set('rate', e.target.value)} placeholder="0.00" />
        </Field>
      </div>
    </Modal>
  )
}

// ---------------------------------------------------------------------------
// Rate card row with expandable units
// ---------------------------------------------------------------------------

function RateCardRow({
  card,
  units,
  onEditCard,
  onDeleteCard,
  onAddUnit,
  onEditUnit,
  onDeleteUnit,
}: {
  card: RateCard
  units: RateCardUnit[]
  onEditCard: () => void
  onDeleteCard: () => void
  onAddUnit: () => void
  onEditUnit: (u: RateCardUnit) => void
  onDeleteUnit: (id: string) => void
}) {
  const [expanded, setExpanded] = useState(true)
  const ChevronIcon = expanded ? ChevronDown : ChevronRight

  return (
    <div className="mb-4 overflow-hidden rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          className="flex items-center gap-2 text-left"
          onClick={() => setExpanded((x) => !x)}
        >
          <ChevronIcon size={15} className="text-slate-400" />
          <div>
            <span className="font-medium text-slate-800">{card.name}</span>
            <span className="ml-2">
              <Badge tone={card.division === 'Underground' ? 'blue' : 'cyan'}>{card.division}</Badge>
            </span>
          </div>
          <span className="ml-2 text-xs text-slate-400">Effective {formatDate(card.effectiveDate)} · {units.length} units</span>
        </button>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" className="px-2 py-1 text-xs" onClick={onAddUnit}>
            <Plus size={13} /> Add unit
          </Button>
          <button onClick={onEditCard} className="p-1.5 text-slate-400 hover:text-brand-600" aria-label="Edit card">
            <Pencil size={14} />
          </button>
          <button
            onClick={() => { if (confirm('Delete this rate card and all its units?')) onDeleteCard() }}
            className="p-1.5 text-slate-400 hover:text-rose-600"
            aria-label="Delete card"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-slate-100">
          {units.length === 0 ? (
            <p className="px-4 py-4 text-sm text-slate-400">No units yet. Click "Add unit" to start.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="px-4 py-2 font-medium">Description</th>
                  <th className="px-4 py-2 font-medium">UOM</th>
                  <th className="px-4 py-2 text-right font-medium">Rate</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {units.map((u) => (
                  <tr key={u.id} className="border-t border-slate-50 hover:bg-slate-50/60">
                    <td className="px-4 py-2 font-mono text-xs font-semibold text-brand-700">{u.unitCode}</td>
                    <td className="px-4 py-2 text-slate-700">{u.description}</td>
                    <td className="px-4 py-2 text-slate-500">{u.uom}</td>
                    <td className="px-4 py-2 text-right font-medium text-slate-800">{moneyExact(u.rate)}</td>
                    <td className="px-4 py-2 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => onEditUnit(u)} className="p-1 text-slate-300 hover:text-brand-600" aria-label="Edit">
                          <Pencil size={13} />
                        </button>
                        <button onClick={() => onDeleteUnit(u.id)} className="p-1 text-slate-300 hover:text-rose-600" aria-label="Delete">
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

type Dialog =
  | { type: 'addClient' }
  | { type: 'editClient'; client: Client }
  | { type: 'addCard'; clientId: string }
  | { type: 'editCard'; card: RateCard }
  | { type: 'addUnit'; rateCardId: string }
  | { type: 'editUnit'; unit: RateCardUnit }
  | { type: 'bulkImport' }

export function RateCards() {
  const { data, addClient, updateClient, deleteClient, addRateCard, updateRateCard, deleteRateCard, addRateCardUnit, updateRateCardUnit, deleteRateCardUnit } = useData()
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const close = () => setDialog(null)

  return (
    <div>
      <PageHeader
        title="Rate Cards"
        description="Client-specific unit pricing. Rates are locked at time of production entry."
        action={
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setDialog({ type: 'bulkImport' })}>
              <Upload size={15} /> Bulk Import
            </Button>
            <Button onClick={() => setDialog({ type: 'addClient' })}>
              <Plus size={16} /> Add client
            </Button>
          </div>
        }
      />

      {data.clients.length === 0 && (
        <Card className="py-16 text-center">
          <p className="text-slate-400">No clients yet. Add a client to create rate cards.</p>
        </Card>
      )}

      {data.clients.map((client) => {
        const cards = data.rateCards.filter((rc) => rc.clientId === client.id)
        return (
          <Card key={client.id} className="mb-6">
            <CardHeader
              title={client.name}
              subtitle={`${cards.length} rate card${cards.length !== 1 ? 's' : ''}`}
              action={
                <div className="flex items-center gap-2">
                  <Button variant="ghost" className="text-xs" onClick={() => setDialog({ type: 'addCard', clientId: client.id })}>
                    <Plus size={13} /> Add rate card
                  </Button>
                  <button onClick={() => setDialog({ type: 'editClient', client })} className="p-1.5 text-slate-400 hover:text-brand-600" aria-label="Edit client">
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => { if (confirm(`Delete client "${client.name}" and all associated rate cards?`)) deleteClient(client.id) }}
                    className="p-1.5 text-slate-400 hover:text-rose-600"
                    aria-label="Delete client"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              }
            />
            <CardBody>
              {cards.length === 0 ? (
                <p className="text-sm text-slate-400">No rate cards for this client.</p>
              ) : (
                cards.map((card) => {
                  const units = data.rateCardUnits.filter((u) => u.rateCardId === card.id)
                  return (
                    <RateCardRow
                      key={card.id}
                      card={card}
                      units={units}
                      onEditCard={() => setDialog({ type: 'editCard', card })}
                      onDeleteCard={() => deleteRateCard(card.id)}
                      onAddUnit={() => setDialog({ type: 'addUnit', rateCardId: card.id })}
                      onEditUnit={(u) => setDialog({ type: 'editUnit', unit: u })}
                      onDeleteUnit={(id) => deleteRateCardUnit(id)}
                    />
                  )
                })
              )}
            </CardBody>
          </Card>
        )
      })}

      {/* Dialogs */}
      {dialog?.type === 'addClient' && (
        <ClientModal onSave={(name) => addClient({ name })} onClose={close} />
      )}
      {dialog?.type === 'editClient' && (
        <ClientModal initial={dialog.client} onSave={(name) => updateClient(dialog.client.id, { name })} onClose={close} />
      )}
      {dialog?.type === 'addCard' && (
        <RateCardModal
          onSave={(f) => addRateCard({ clientId: dialog.clientId, name: f.name, division: f.division, effectiveDate: f.effectiveDate })}
          onClose={close}
        />
      )}
      {dialog?.type === 'editCard' && (
        <RateCardModal
          initial={dialog.card}
          onSave={(f) => updateRateCard(dialog.card.id, { name: f.name, division: f.division, effectiveDate: f.effectiveDate })}
          onClose={close}
        />
      )}
      {dialog?.type === 'addUnit' && (
        <UnitModal
          onSave={(f) => addRateCardUnit({ rateCardId: dialog.rateCardId, unitCode: f.unitCode.toUpperCase(), description: f.description, uom: f.uom, rate: parseFloat(f.rate) })}
          onClose={close}
        />
      )}
      {dialog?.type === 'editUnit' && (
        <UnitModal
          initial={dialog.unit}
          onSave={(f) => updateRateCardUnit(dialog.unit.id, { unitCode: f.unitCode.toUpperCase(), description: f.description, uom: f.uom, rate: parseFloat(f.rate) })}
          onClose={close}
        />
      )}
      {dialog?.type === 'bulkImport' && <BulkImportModal onClose={close} />}
    </div>
  )
}
