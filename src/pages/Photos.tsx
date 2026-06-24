import { useMemo, useRef, useState } from 'react'
import { Upload, Trash2, ImageOff } from 'lucide-react'
import { useData } from '../store/DataContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Modal } from '../components/ui/Modal'
import { Button, Field, Input, Select } from '../components/ui/Form'
import { formatDate } from '../lib/format'
import type { BadgeTone } from '../lib/format'
import type { PhotoCategory } from '../types'

const CATEGORIES: { value: PhotoCategory; label: string; tone: BadgeTone }[] = [
  { value: 'before', label: 'Before', tone: 'slate' },
  { value: 'progress', label: 'Progress', tone: 'blue' },
  { value: 'after', label: 'After', tone: 'green' },
  { value: 'issue', label: 'Issue', tone: 'red' },
  { value: 'safety', label: 'Safety', tone: 'amber' },
]
const catMeta = (c: PhotoCategory) => CATEGORIES.find((x) => x.value === c)!

export function Photos() {
  const { data, deletePhoto } = useData()
  const [open, setOpen] = useState(false)
  const [projectFilter, setProjectFilter] = useState('all')
  const [catFilter, setCatFilter] = useState<PhotoCategory | 'all'>('all')

  const filtered = useMemo(() => {
    return data.photos.filter(
      (p) =>
        (projectFilter === 'all' || p.projectId === projectFilter) &&
        (catFilter === 'all' || p.category === catFilter),
    )
  }, [data.photos, projectFilter, catFilter])

  return (
    <div>
      <PageHeader
        title="Photos"
        description="Field documentation — before, progress, issues, and safety."
        action={
          <Button onClick={() => setOpen(true)}>
            <Upload size={16} /> Upload photo
          </Button>
        }
      />

      <div className="mb-5 flex flex-wrap gap-2">
        <Select value={projectFilter} onChange={(e) => setProjectFilter(e.target.value)} className="w-56">
          <option value="all">All projects</option>
          {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </Select>
        <Select value={catFilter} onChange={(e) => setCatFilter(e.target.value as PhotoCategory | 'all')} className="w-44">
          <option value="all">All categories</option>
          {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </Select>
      </div>

      {filtered.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-12 text-center text-slate-400">
          <ImageOff size={32} />
          <p>No photos match these filters.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filtered.map((photo) => {
            const project = data.projects.find((p) => p.id === photo.projectId)
            const meta = catMeta(photo.category)
            return (
              <Card key={photo.id} className="group overflow-hidden">
                <div className="relative aspect-[4/3] bg-slate-100">
                  <img src={photo.url} alt={photo.caption} className="h-full w-full object-cover" loading="lazy" />
                  <div className="absolute left-2 top-2">
                    <Badge tone={meta.tone}>{meta.label}</Badge>
                  </div>
                  <button
                    onClick={() => deletePhoto(photo.id)}
                    className="absolute right-2 top-2 rounded-md bg-white/90 p-1.5 text-slate-500 opacity-0 transition hover:text-rose-600 group-hover:opacity-100"
                    aria-label="Delete photo"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
                <div className="p-3">
                  <p className="truncate text-sm font-medium text-slate-800">{photo.caption}</p>
                  <p className="mt-0.5 truncate text-xs text-slate-400">{project?.name ?? 'Unknown project'}</p>
                  <p className="mt-1 text-xs text-slate-400">{formatDate(photo.date)} · {photo.uploadedBy}</p>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      <UploadModal open={open} onClose={() => setOpen(false)} />
    </div>
  )
}

function UploadModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { data, addPhoto } = useData()
  const fileRef = useRef<HTMLInputElement>(null)
  const today = new Date().toISOString().slice(0, 10)
  const [form, setForm] = useState({
    projectId: data.projects[0]?.id ?? '',
    caption: '',
    category: 'progress' as PhotoCategory,
    date: today,
    uploadedBy: 'Office',
    url: '',
  })
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }))

  const onFile = (file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => set('url', String(reader.result))
    reader.readAsDataURL(file)
  }

  const submit = () => {
    if (!form.projectId || !form.url) return
    addPhoto({ ...form, caption: form.caption || 'Untitled photo' })
    onClose()
    setForm((f) => ({ ...f, caption: '', url: '' }))
    if (fileRef.current) fileRef.current.value = ''
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Upload photo"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!form.url}>Save photo</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Image file">
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={(e) => onFile(e.target.files?.[0])}
            className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100"
          />
        </Field>
        {form.url && (
          <img src={form.url} alt="preview" className="max-h-48 w-full rounded-lg object-cover" />
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Caption">
              <Input value={form.caption} onChange={(e) => set('caption', e.target.value)} placeholder="Describe the photo" />
            </Field>
          </div>
          <Field label="Project">
            <Select value={form.projectId} onChange={(e) => set('projectId', e.target.value)}>
              {data.projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </Select>
          </Field>
          <Field label="Category">
            <Select value={form.category} onChange={(e) => set('category', e.target.value)}>
              {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </Select>
          </Field>
          <Field label="Date">
            <Input type="date" value={form.date} onChange={(e) => set('date', e.target.value)} />
          </Field>
          <Field label="Uploaded by">
            <Input value={form.uploadedBy} onChange={(e) => set('uploadedBy', e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  )
}
