import { useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Camera, Video, ClipboardCheck, Paperclip, Download, Loader2, FolderOpen, FileArchive } from 'lucide-react'
import { useData } from '../store/DataContext'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Field, Select, Button } from '../components/ui/Form'
import { PhotoImg } from '../components/PhotoImg'
import { formatDate } from '../lib/format'
import { MARKUP_STATUS_META } from '../types'
import type { MarkupStatus, WorkObjectTypeId } from '../types'
import { WORK_OBJECT_TYPES, WORK_OBJECT_TYPE_MAP } from '../lib/workObjectTypes'
import { crewOrSubName } from '../lib/crewOrSub'
import { buildProjectDocumentation, filterWorkObjects, EMPTY_DOC_FILTERS, type DocFilterCriteria, type WorkObjectDocBundle } from '../lib/projectDocumentation'
import { DEFAULT_CLOSEOUT_OPTIONS, type CloseoutPackageOptions } from '../lib/closeoutExportOptions'
import { buildCloseoutPackagePdf } from '../lib/closeoutExport'
import { triggerDownload } from '../lib/kmzExport'

type Tab = 'documentation' | 'closeout'

function WorkObjectCard({ bundle }: { bundle: WorkObjectDocBundle }) {
  const { markup: m, photos, videos, inspections, attachments } = bundle
  const { data } = useData()
  const typeLabel = m.workObjectType ? WORK_OBJECT_TYPE_MAP[m.workObjectType]?.label ?? m.tool : m.tool
  const who = crewOrSubName(data, m.crewId, m.assignedSubcontractorId)
  const statusMeta = MARKUP_STATUS_META[m.status]
  const totalItems = photos.length + videos.length + inspections.length + attachments.length + (m.notes ? 1 : 0)
  if (totalItems === 0) return null

  return (
    <Card>
      <CardHeader
        title={`${typeLabel} — ${m.workId ?? m.id.slice(0, 10)}`}
        subtitle={`${who} · ${formatDate(m.workDate ?? m.createdAt.slice(0, 10))}`}
        action={
          <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: `${statusMeta.color}18`, color: statusMeta.color }}>
            {statusMeta.label}
          </span>
        }
      />
      <CardBody className="space-y-4">
        {m.notes && (
          <p className="text-sm text-slate-600">{m.notes}</p>
        )}

        {photos.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Camera size={12} /> Photos ({photos.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {photos.map((p) => (
                <div key={p.id} className="h-20 w-20 overflow-hidden rounded-lg border border-slate-200 bg-slate-50" title={p.caption ?? p.phase ?? undefined}>
                  <PhotoImg url={`idb:mkp-${p.id}`} alt={p.caption ?? ''} className="h-full w-full object-cover" loading="lazy" />
                </div>
              ))}
            </div>
          </div>
        )}

        {videos.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Video size={12} /> Videos ({videos.length})
            </p>
            <div className="flex flex-wrap gap-2">
              {videos.map((v) => (
                <span key={v.id} className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">
                  {v.caption || formatDate(v.takenAt.slice(0, 10))}
                </span>
              ))}
            </div>
          </div>
        )}

        {inspections.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <ClipboardCheck size={12} /> Inspections ({inspections.length})
            </p>
            <div className="space-y-1.5">
              {inspections.map((insp) => (
                <div key={insp.id} className="flex items-center gap-2 text-xs">
                  <Badge tone={insp.overallResult === 'pass' ? 'green' : insp.overallResult === 'fail' ? 'red' : 'amber'}>
                    {insp.overallResult.toUpperCase()}
                  </Badge>
                  <span className="text-slate-500">{formatDate(insp.createdAt.slice(0, 10))}</span>
                  <span className="text-slate-400">· {insp.items.filter((i) => i.result === 'pass').length}/{insp.items.length} passed</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {attachments.length > 0 && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              <Paperclip size={12} /> Attachments ({attachments.length})
            </p>
            <div className="space-y-1">
              {attachments.map((a) => (
                <p key={a.id} className="text-xs text-slate-600">{a.fileName}</p>
              ))}
            </div>
          </div>
        )}
      </CardBody>
    </Card>
  )
}

export function ProjectDocumentation() {
  const { id } = useParams<{ id: string }>()
  const { data } = useData()
  const [tab, setTab] = useState<Tab>('documentation')

  const project = data.projects.find((p) => p.id === id)
  const client = project?.clientId ? data.clients.find((c) => c.id === project.clientId) ?? null : null
  const projectCrewIds = project?.crewIds ?? []
  const projectSubIds = project?.subcontractorIds ?? []
  const crewOptions = data.crews.filter((c) => projectCrewIds.includes(c.id))
  const subOptions = (data.subcontractors ?? []).filter((s) => projectSubIds.includes(s.id))

  const doc = useMemo(() => (id ? buildProjectDocumentation(data, id) : { workObjects: [], generalPhotos: [] }), [data, id])

  // ── Documentation (browse) tab filters ──────────────────────────────────
  const [filters, setFilters] = useState<DocFilterCriteria>(EMPTY_DOC_FILTERS)
  const filteredWorkObjects = useMemo(() => filterWorkObjects(doc.workObjects, filters), [doc.workObjects, filters])
  const nonEmptyWorkObjects = filteredWorkObjects.filter((w) => w.photos.length + w.videos.length + w.inspections.length + w.attachments.length + (w.markup.notes ? 1 : 0) > 0)

  // ── Closeout Package tab ────────────────────────────────────────────────
  const [pkgFilters, setPkgFilters] = useState<DocFilterCriteria>(EMPTY_DOC_FILTERS)
  const [pkgOptions, setPkgOptions] = useState<CloseoutPackageOptions>(DEFAULT_CLOSEOUT_OPTIONS)
  const [generating, setGenerating] = useState(false)
  const pkgWorkObjects = useMemo(() => filterWorkObjects(doc.workObjects, pkgFilters), [doc.workObjects, pkgFilters])

  function toggleOption(key: keyof CloseoutPackageOptions) {
    setPkgOptions((o) => ({ ...o, [key]: !o[key] }))
  }

  async function handleGeneratePackage() {
    if (!project) return
    setGenerating(true)
    try {
      const pdf = await buildCloseoutPackagePdf({
        project, client, data,
        workObjects: pkgWorkObjects,
        generalPhotos: pkgOptions.includeGeneralPhotos ? doc.generalPhotos : [],
        options: pkgOptions,
      })
      const blob = pdf.output('blob')
      triggerDownload(blob, `${project.name.replace(/\s+/g, '_')}_Closeout_Package.pdf`)
    } finally {
      setGenerating(false)
    }
  }

  if (!project) {
    return <p className="text-sm text-slate-500">Project not found.</p>
  }

  // Parameterized (not a fixed JSX const) so the Documentation tab and the
  // Closeout Package tab can each drive their own independent filter state —
  // they're deliberately separate (EMPTY_DOC_FILTERS/pkgFilters), since
  // narrowing what you're browsing shouldn't silently narrow what a
  // generated package includes, or vice versa.
  function renderFilterBar(f: DocFilterCriteria, setF: (updater: (prev: DocFilterCriteria) => DocFilterCriteria) => void) {
    return (
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Field label="Crew">
          <Select value={f.crewId ?? ''} onChange={(e) => setF((prev) => ({ ...prev, crewId: e.target.value || null, subcontractorId: null }))}>
            <option value="">All crews</option>
            {crewOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label="Subcontractor">
          <Select value={f.subcontractorId ?? ''} onChange={(e) => setF((prev) => ({ ...prev, subcontractorId: e.target.value || null, crewId: null }))}>
            <option value="">All subcontractors</option>
            {subOptions.map((s) => <option key={s.id} value={s.id}>{s.companyName}</option>)}
          </Select>
        </Field>
        <Field label="Work type">
          <Select value={f.workType ?? ''} onChange={(e) => setF((prev) => ({ ...prev, workType: (e.target.value || null) as WorkObjectTypeId | null }))}>
            <option value="">All work types</option>
            {WORK_OBJECT_TYPES.map((wt) => <option key={wt.id} value={wt.id}>{wt.label}</option>)}
          </Select>
        </Field>
        <Field label="Status">
          <Select value={f.status ?? ''} onChange={(e) => setF((prev) => ({ ...prev, status: (e.target.value || null) as MarkupStatus | null }))}>
            <option value="">All statuses</option>
            {Object.entries(MARKUP_STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </Select>
        </Field>
        <Field label="Date from">
          <input type="date" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            value={f.dateFrom ?? ''} onChange={(e) => setF((prev) => ({ ...prev, dateFrom: e.target.value || null }))} />
        </Field>
        <Field label="Date to">
          <input type="date" className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-100"
            value={f.dateTo ?? ''} onChange={(e) => setF((prev) => ({ ...prev, dateTo: e.target.value || null }))} />
        </Field>
      </div>
    )
  }

  return (
    <div>
      <PageHeader
        title="Documentation"
        description={project.name}
        action={
          <Link to={`/projects/${id}`} className="flex items-center gap-1.5 rounded-lg border border-slate-300 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50">
            <ArrowLeft size={14} /> Back to project
          </Link>
        }
      />

      <div className="mb-5 flex gap-1 border-b border-slate-200">
        <button
          onClick={() => setTab('documentation')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${tab === 'documentation' ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          <FolderOpen size={14} /> Documentation
        </button>
        <button
          onClick={() => setTab('closeout')}
          className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition ${tab === 'closeout' ? 'border-brand-600 text-brand-600' : 'border-transparent text-slate-500 hover:text-slate-700'}`}
        >
          <FileArchive size={14} /> Closeout Package
        </button>
      </div>

      {tab === 'documentation' && (
        <div className="space-y-5">
          <Card>
            <CardBody>{renderFilterBar(filters, setFilters)}</CardBody>
          </Card>

          {doc.generalPhotos.length > 0 && (
            <Card>
              <CardHeader title="General project photos" subtitle={`${doc.generalPhotos.length} photo${doc.generalPhotos.length === 1 ? '' : 's'} — not tied to a specific Work Object`} />
              <CardBody>
                <div className="flex flex-wrap gap-2">
                  {doc.generalPhotos.map((p) => (
                    <div key={p.id} className="h-24 w-24 overflow-hidden rounded-lg border border-slate-200 bg-slate-50" title={p.caption}>
                      <PhotoImg url={p.url} alt={p.caption} className="h-full w-full object-cover" loading="lazy" />
                    </div>
                  ))}
                </div>
              </CardBody>
            </Card>
          )}

          {nonEmptyWorkObjects.length === 0 ? (
            <Card>
              <CardBody className="py-12 text-center text-sm text-slate-500">
                No documented Work Objects match these filters yet.
              </CardBody>
            </Card>
          ) : (
            nonEmptyWorkObjects.map((wo) => <WorkObjectCard key={wo.markup.id} bundle={wo} />)
          )}
        </div>
      )}

      {tab === 'closeout' && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <Card className="h-fit">
            <CardHeader title="What to include" subtitle="Pick exactly what this customer's package should have — nothing else shows up." />
            <CardBody className="space-y-4">
              {renderFilterBar(pkgFilters, setPkgFilters)}
              <div className="space-y-1.5 border-t border-slate-100 pt-3">
                {([
                  ['includeWorkObjectSummary', 'Work Object summary table'],
                  ['includePhotos', 'Work Object photos'],
                  ['includeGeneralPhotos', 'General project photos'],
                  ['includeInspections', 'Inspection results'],
                  ['includeNotes', 'Work Object notes'],
                  ['includeAttachments', 'Attachments (listed by name)'],
                  ['includeVideos', 'Videos (listed by name — not embedded)'],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex cursor-pointer items-center gap-2 text-sm text-slate-700">
                    <input type="checkbox" checked={pkgOptions[key]} onChange={() => toggleOption(key)} className="accent-brand-500" />
                    {label}
                  </label>
                ))}
              </div>
            </CardBody>
          </Card>

          <Card className="h-fit">
            <CardHeader title="Package preview" />
            <CardBody className="space-y-2 text-sm text-slate-600">
              <p><strong className="text-slate-800">{pkgWorkObjects.length}</strong> Work Object{pkgWorkObjects.length === 1 ? '' : 's'} match{pkgWorkObjects.length === 1 ? 'es' : ''} these filters</p>
              {pkgOptions.includePhotos && <p><strong className="text-slate-800">{pkgWorkObjects.reduce((s, w) => s + w.photos.length, 0)}</strong> Work Object photos</p>}
              {pkgOptions.includeGeneralPhotos && <p><strong className="text-slate-800">{doc.generalPhotos.length}</strong> general project photos</p>}
              {pkgOptions.includeInspections && <p><strong className="text-slate-800">{pkgWorkObjects.reduce((s, w) => s + w.inspections.length, 0)}</strong> inspection reports</p>}
              {pkgOptions.includeAttachments && <p><strong className="text-slate-800">{pkgWorkObjects.reduce((s, w) => s + w.attachments.length, 0)}</strong> attachments</p>}
              <Button onClick={handleGeneratePackage} disabled={generating} className="mt-3 w-full">
                {generating ? <><Loader2 size={15} className="animate-spin" /> Generating…</> : <><Download size={15} /> Download Closeout Package</>}
              </Button>
            </CardBody>
          </Card>
        </div>
      )}
    </div>
  )
}
