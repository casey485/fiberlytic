import { Link } from 'react-router-dom'
import { FileText, File, Download, Pencil } from 'lucide-react'
import { useData } from '../store/DataContext'
import { loadBlob } from '../lib/fileStore'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { formatDate } from '../lib/format'

function formatBytes(b: number) {
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(0)} KB`
  return `${(b / (1024 * 1024)).toFixed(1)} MB`
}

export function Redline() {
  const { data } = useData()

  // Group files by project
  const byProject = data.projects
    .map((p) => ({
      project: p,
      files: data.projectFiles.filter((f) => f.projectId === p.id),
    }))
    .filter((g) => g.files.length > 0)

  const unattached = data.projectFiles.filter(
    (f) => !data.projects.find((p) => p.id === f.projectId),
  )

  const markupCount = (fileId: string) =>
    new Set(data.annotations.filter((a) => a.fileId === fileId).map((a) => a.page)).size

  const downloadFile = async (fileId: string, name: string) => {
    const dataUrl = await loadBlob(fileId)
    if (!dataUrl) { alert('File not found in storage.'); return }
    const a = document.createElement('a')
    a.href = dataUrl
    a.download = name
    a.click()
  }

  return (
    <div>
      <PageHeader
        title="Redline"
        description="Open a project PDF to mark up prints, add notes, and draw on plans"
      />

      {byProject.length === 0 && unattached.length === 0 && (
        <Card>
          <CardBody>
            <p className="text-sm text-slate-400">
              No project files yet.{' '}
              <Link to="/projects" className="text-brand-600 hover:underline">
                Upload a PDF from a project page
              </Link>{' '}
              to start redlining.
            </p>
          </CardBody>
        </Card>
      )}

      <div className="space-y-6">
        {byProject.map(({ project, files }) => (
          <Card key={project.id}>
            <CardHeader
              title={project.name}
              subtitle={project.client}
              action={
                <Link to={`/projects/${project.id}`} className="text-xs text-brand-600 hover:underline">
                  View project
                </Link>
              }
            />
            <CardBody className="p-0">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left text-xs uppercase tracking-wide text-slate-400">
                    <th className="px-5 py-2.5 font-medium">File</th>
                    <th className="px-5 py-2.5 font-medium">Type</th>
                    <th className="px-5 py-2.5 font-medium">Size</th>
                    <th className="px-5 py-2.5 font-medium">Added</th>
                    <th className="px-5 py-2.5 font-medium">Markup</th>
                    <th className="px-5 py-2.5" />
                  </tr>
                </thead>
                <tbody>
                  {files.map((f) => {
                    const pages = markupCount(f.id)
                    return (
                      <tr key={f.id} className="border-b border-slate-50 hover:bg-slate-50/60">
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-2 font-medium text-slate-700">
                            {f.fileType === 'pdf' ? <FileText size={16} className="text-red-500" /> : <File size={16} className="text-emerald-500" />}
                            {f.name}
                          </div>
                        </td>
                        <td className="px-5 py-3">
                          <span className={`rounded px-2 py-0.5 text-xs font-semibold uppercase ${
                            f.fileType === 'pdf' ? 'bg-red-50 text-red-600' :
                            f.fileType === 'kmz' ? 'bg-emerald-50 text-emerald-600' :
                            'bg-slate-100 text-slate-500'
                          }`}>
                            {f.fileType}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-slate-500">{formatBytes(f.size)}</td>
                        <td className="px-5 py-3 text-slate-400">{formatDate(f.uploadedAt)}</td>
                        <td className="px-5 py-3">
                          {pages > 0 ? (
                            <Badge tone="blue">{pages} page{pages > 1 ? 's' : ''} marked</Badge>
                          ) : (
                            <span className="text-slate-300 text-xs">none</span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {f.fileType === 'pdf' ? (
                            <Link
                              to={`/redline/${f.id}`}
                              className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-brand-700"
                            >
                              <Pencil size={13} /> Open in Redline
                            </Link>
                          ) : (
                            <button
                              onClick={() => downloadFile(f.id, f.name)}
                              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
                            >
                              <Download size={13} /> Download
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </CardBody>
          </Card>
        ))}
      </div>
    </div>
  )
}
