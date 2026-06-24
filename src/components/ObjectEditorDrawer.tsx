import { useRef } from 'react'
import { X, Check, Trash2, Image as ImageIcon, PenLine } from 'lucide-react'
import type { DetectedObject } from '../features/printkmz/types'
import { OBJECT_TYPES, CONSTRUCTION_METHODS, objectMeta } from '../features/printkmz/types'
import { Field, Input, Select, Textarea, Button } from './ui/Form'
import { Badge } from './ui/Badge'

let attSeq = 0
const attId = (p: string) => `${p}-${Date.now().toString(36)}-${(attSeq++).toString(36)}`

/** Read an image file to a downscaled JPEG data URL (keeps localStorage small). */
function readImage(file: File, maxWidth = 1000): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const scale = Math.min(1, maxWidth / img.width)
        const c = document.createElement('canvas')
        c.width = Math.round(img.width * scale)
        c.height = Math.round(img.height * scale)
        c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
        resolve(c.toDataURL('image/jpeg', 0.7))
      }
      img.onerror = reject
      img.src = String(reader.result)
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

const numOrUndef = (v: string) => (v === '' ? undefined : Number(v))

export function ObjectEditorDrawer({
  object,
  onClose,
  onChange,
  onDelete,
}: {
  object: DetectedObject
  onClose: () => void
  onChange: (patch: Partial<DetectedObject>) => void
  onDelete: () => void
}) {
  const photoRef = useRef<HTMLInputElement>(null)
  const redlineRef = useRef<HTMLInputElement>(null)
  const meta = objectMeta(object.type)

  const addPhotos = async (files: FileList | null) => {
    if (!files) return
    const added = await Promise.all(
      [...files].map(async (f) => ({ id: attId('ph'), name: f.name, dataUrl: await readImage(f), addedAt: new Date().toISOString() })),
    )
    onChange({ photos: [...object.photos, ...added] })
    if (photoRef.current) photoRef.current.value = ''
  }

  const addRedlines = async (files: FileList | null) => {
    if (!files) return
    const added = await Promise.all(
      [...files].map(async (f) => ({ id: attId('rl'), name: f.name, dataUrl: await readImage(f, 1400), addedAt: new Date().toISOString() })),
    )
    onChange({ redlines: [...object.redlines, ...added] })
    if (redlineRef.current) redlineRef.current.value = ''
  }

  return (
    <div className="fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l border-slate-200 bg-white shadow-2xl">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-2">
          <span className="h-3 w-3 rounded-full" style={{ background: meta.color }} />
          <h3 className="text-sm font-semibold text-slate-900">Edit object</h3>
          <Badge tone={object.status === 'approved' ? 'green' : object.status === 'rejected' ? 'red' : 'amber'}>
            {object.status}
          </Badge>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100" aria-label="Close">
          <X size={18} />
        </button>
      </div>

      <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
        {/* Identity */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Type">
            <Select value={object.type} onChange={(e) => onChange({ type: e.target.value as DetectedObject['type'] })}>
              {OBJECT_TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
            </Select>
          </Field>
          <Field label="Label">
            <Input value={object.label} onChange={(e) => onChange({ label: e.target.value })} />
          </Field>
          <Field label="Construction method">
            <Select value={object.constructionMethod} onChange={(e) => onChange({ constructionMethod: e.target.value as DetectedObject['constructionMethod'] })}>
              {CONSTRUCTION_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </Select>
          </Field>
          <Field label="Road name">
            <Input value={object.roadName ?? ''} onChange={(e) => onChange({ roadName: e.target.value })} />
          </Field>
        </div>

        {/* Network attributes */}
        <section className="rounded-lg border border-slate-200 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Network</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Feeder">
              <Input value={object.feeder ?? ''} onChange={(e) => onChange({ feeder: e.target.value })} />
            </Field>
            <Field label="Section">
              <Input value={object.section ?? ''} onChange={(e) => onChange({ section: e.target.value })} />
            </Field>
            <Field label="Fiber count">
              <Input type="number" value={object.fiberCount ?? ''} onChange={(e) => onChange({ fiberCount: numOrUndef(e.target.value) })} />
            </Field>
            <Field label="Sheet">
              <Input value={object.sheet ?? ''} onChange={(e) => onChange({ sheet: e.target.value })} />
            </Field>
            <Field label="Footage (LF)">
              <Input type="number" value={object.footage ?? ''} onChange={(e) => onChange({ footage: numOrUndef(e.target.value) })} />
            </Field>
            <Field label="Span length (ft)">
              <Input type="number" value={object.spanLength ?? ''} onChange={(e) => onChange({ spanLength: numOrUndef(e.target.value) })} />
            </Field>
          </div>
        </section>

        {/* Production / billing */}
        <section className="rounded-lg border border-slate-200 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Production &amp; Billing</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Production qty">
              <Input type="number" value={object.productionQuantity ?? ''} onChange={(e) => onChange({ productionQuantity: numOrUndef(e.target.value) })} />
            </Field>
            <Field label="Billing qty">
              <Input type="number" value={object.billingQuantity ?? ''} onChange={(e) => onChange({ billingQuantity: numOrUndef(e.target.value) })} />
            </Field>
            <Field label="Crew assignment">
              <Input value={object.crewAssignment ?? ''} onChange={(e) => onChange({ crewAssignment: e.target.value })} />
            </Field>
            <Field label="Status">
              <Select value={object.status} onChange={(e) => onChange({ status: e.target.value as DetectedObject['status'] })}>
                <option value="pending">Pending</option>
                <option value="approved">Approved</option>
                <option value="rejected">Rejected</option>
              </Select>
            </Field>
          </div>
        </section>

        {/* Position */}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Latitude">
            <Input type="number" step="0.00001" value={object.position.lat} onChange={(e) => onChange({ position: { ...object.position, lat: Number(e.target.value) } })} />
          </Field>
          <Field label="Longitude">
            <Input type="number" step="0.00001" value={object.position.lng} onChange={(e) => onChange({ position: { ...object.position, lng: Number(e.target.value) } })} />
          </Field>
        </div>

        <Field label="Notes">
          <Textarea rows={2} value={object.notes ?? ''} onChange={(e) => onChange({ notes: e.target.value })} />
        </Field>

        {/* Attachments */}
        <section className="space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><ImageIcon size={13} /> Photos</span>
              <button onClick={() => photoRef.current?.click()} className="text-xs font-medium text-brand-600 hover:text-brand-700">+ Add</button>
              <input ref={photoRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addPhotos(e.target.files)} />
            </div>
            <AttachmentGrid items={object.photos} onRemove={(id) => onChange({ photos: object.photos.filter((p) => p.id !== id) })} />
          </div>
          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500"><PenLine size={13} /> Redlines</span>
              <button onClick={() => redlineRef.current?.click()} className="text-xs font-medium text-brand-600 hover:text-brand-700">+ Add</button>
              <input ref={redlineRef} type="file" accept="image/*" multiple className="hidden" onChange={(e) => addRedlines(e.target.files)} />
            </div>
            <AttachmentGrid items={object.redlines} onRemove={(id) => onChange({ redlines: object.redlines.filter((r) => r.id !== id) })} />
          </div>
        </section>
      </div>

      <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-5 py-4">
        <Button variant="ghost" className="text-rose-600 hover:bg-rose-50" onClick={onDelete}>
          <Trash2 size={15} /> Delete
        </Button>
        {object.status !== 'approved' ? (
          <Button onClick={() => onChange({ status: 'approved' })}>
            <Check size={15} /> Approve
          </Button>
        ) : (
          <Button variant="secondary" onClick={() => onChange({ status: 'pending' })}>
            Unapprove
          </Button>
        )}
      </div>
    </div>
  )
}

function AttachmentGrid({ items, onRemove }: { items: { id: string; dataUrl: string; name: string }[]; onRemove: (id: string) => void }) {
  if (items.length === 0) return <p className="text-xs text-slate-400">None attached.</p>
  return (
    <div className="grid grid-cols-4 gap-2">
      {items.map((it) => (
        <div key={it.id} className="group relative aspect-square overflow-hidden rounded-md border border-slate-200">
          <img src={it.dataUrl} alt={it.name} className="h-full w-full object-cover" />
          <button
            onClick={() => onRemove(it.id)}
            className="absolute right-0.5 top-0.5 rounded bg-white/90 p-0.5 text-slate-500 opacity-0 transition hover:text-rose-600 group-hover:opacity-100"
            aria-label="Remove"
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}
