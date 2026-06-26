import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, FileText, ExternalLink, X } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { loadBlob } from '../lib/fileStore'
import { formatDate } from '../lib/format'

function formatBytes(b: number) {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

export function ProjectPrints() {
  const { data } = useData()
  const { activeEmployeeId } = useRole()
  const [viewingUrl, setViewingUrl] = useState<string | null>(null)
  const [viewingName, setViewingName] = useState('')
  const [loading, setLoading] = useState(false)

  const activeEmployee = activeEmployeeId
    ? data.employees.find((e) => e.id === activeEmployeeId) ?? null
    : null

  // Collect all project IDs for crews this employee is on
  const myProjectIds = new Set<string>()
  for (const crew of data.crews) {
    const onCrew =
      (activeEmployee?.defaultCrewId && crew.id === activeEmployee.defaultCrewId) ||
      crew.foremanId === activeEmployee?.id ||
      crew.members.some((m) => m.employeeId === activeEmployee?.id && m.active)
    if (onCrew && crew.currentProjectId) myProjectIds.add(crew.currentProjectId)
  }

  const myProjects = data.projects.filter((p) => myProjectIds.has(p.id))

  // Group PDFs by project — only show PDF files
  const filesByProject = myProjects
    .map((proj) => ({
      project: proj,
      files: data.projectFiles.filter((f) => f.projectId === proj.id && f.fileType === 'pdf'),
    }))
    .filter((g) => g.files.length > 0)

  const totalFiles = filesByProject.reduce((s, g) => s + g.files.length, 0)

  const openPdf = async (fileId: string, name: string) => {
    setLoading(true)
    try {
      const dataUrl = await loadBlob(fileId)
      if (!dataUrl) { alert('File not found.'); return }
      setViewingUrl(dataUrl)
      setViewingName(name)
    } finally {
      setLoading(false)
    }
  }

  const openInTab = async (fileId: string, name: string) => {
    const dataUrl = await loadBlob(fileId)
    if (!dataUrl) { alert('File not found.'); return }
    const win = window.open('', '_blank')
    if (win) {
      win.document.write(
        `<html><head><title>${name}</title></head><body style="margin:0"><embed src="${dataUrl}" type="application/pdf" width="100%" height="100%" /></body></html>`
      )
    }
  }

  return (
    <div>
      <Link to="/" className="mb-3 inline-flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700">
        <ArrowLeft size={16} /> Back to Dashboard
      </Link>

      <PageHeader
        title="Print Access"
        description={totalFiles > 0
          ? `${totalFiles} PDF${totalFiles === 1 ? '' : 's'} across your projects`
          : 'PDFs uploaded to your projects'}
      />

      {/* Inline PDF viewer */}
      {viewingUrl && (
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-sm font-medium text-slate-700">{viewingName}</p>
            <div className="flex items-center gap-3">
              <button
                onClick={() => {
                  const win = window.open('', '_blank')
                  if (win) {
                    win.document.write(
                      `<html><head><title>${viewingName}</title></head><body style="margin:0"><embed src="${viewingUrl}" type="application/pdf" width="100%" height="100%" /></body></html>`
                    )
                  }
                }}
                className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700"
              >
                <ExternalLink size={13} /> Open full screen
              </button>
              <button
                onClick={() => setViewingUrl(null)}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700"
              >
                <X size={13} /> Close
              </button>
            </div>
          </div>
          <div className="overflow-hidden rounded-xl border border-slate-200 shadow-sm">
            <embed
              src={viewingUrl}
              type="application/pdf"
              className="h-[70vh] w-full"
            />
          </div>
        </div>
      )}

      {filesByProject.length === 0 ? (
        <Card>
          <CardBody>
            <p className="py-8 text-center text-sm text-slate-400">
              {myProjects.length === 0
                ? 'No active projects assigned to your crew.'
                : 'No PDFs have been uploaded to your projects yet. Ask your admin to upload prints from the project page.'}
            </p>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-6">
          {filesByProject.map(({ project, files }) => (
            <Card key={project.id}>
              <CardHeader
                title={project.name}
                subtitle={`${files.length} PDF${files.length === 1 ? '' : 's'}`}
              />
              <CardBody className="p-0">
                <ul className="divide-y divide-slate-100">
                  {files.map((f) => (
                    <li key={f.id} className="flex items-center gap-3 px-5 py-3">
                      <FileText size={18} className="shrink-0 text-brand-500" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-800">{f.name}</p>
                        <p className="text-xs text-slate-400">
                          {formatBytes(f.size)} · {formatDate(f.uploadedAt.slice(0, 10))}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <button
                          onClick={() => openPdf(f.id, f.name)}
                          disabled={loading}
                          className="rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-brand-700 disabled:opacity-50"
                        >
                          Open
                        </button>
                        <button
                          onClick={() => openInTab(f.id, f.name)}
                          className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                          title="Open in new tab"
                        >
                          <ExternalLink size={13} />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
