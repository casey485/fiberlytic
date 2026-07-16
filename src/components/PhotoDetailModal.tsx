import { useNavigate } from 'react-router-dom'
import { MapPin, FileText, ShieldCheck } from 'lucide-react'
import { useData } from '../store/DataContext'
import { Modal } from './ui/Modal'
import { Button } from './ui/Form'
import { Badge } from './ui/Badge'
import { PhotoImg } from './PhotoImg'
import { QaStatusBadge } from './QaStatusBadge'
import { redlineMapTarget } from '../lib/markupNav'
import { PHOTO_FOLDER_LABELS, workObjectTypeLabel } from '../lib/photoLibrary'
import type { PhotoLibraryRow } from '../lib/photoLibrary'
import { workTypeLabel } from '../lib/format'

/** Full metadata + jump-off actions for one photo — the click-through target
 *  from the Photos folder grid. Reuses the exact "navigate to Field Map and
 *  zoom" mechanism NotificationBell.tsx already uses for markup-linked
 *  photos; raw-GPS-only photos (no markupId) use a sibling `focusLatLng`
 *  router-state key that KmzMap.tsx's existing focus effect also handles. */
export function PhotoDetailModal({ row, onClose }: { row: PhotoLibraryRow | null; onClose: () => void }) {
  const { data } = useData()
  const nav = useNavigate()
  if (!row) return null

  const inspection = row.markupId
    ? [...(data.markupInspections ?? [])].filter((i) => i.markupId === row.markupId).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    : null

  const viewOnMap = () => {
    if (row.markup) {
      const target = redlineMapTarget(row.markup)
      nav(target.pathname, { state: target.state })
    } else if (row.lat != null && row.lng != null && row.project) {
      nav(`/kmz/${row.project.id}`, { state: { focusLatLng: [row.lat, row.lng] } })
    }
  }

  const openProduction = () => {
    if (!row.project) return
    nav('/production', { state: { prefilterProjectId: row.project.id, prefilterDate: row.capturedAt?.slice(0, 10) } })
  }

  return (
    <Modal open={!!row} onClose={onClose} title={row.caption || 'Photo'} size="lg">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="aspect-[4/3] overflow-hidden rounded-lg bg-slate-100">
          <PhotoImg url={row.url} alt={row.caption ?? ''} className="h-full w-full object-cover" />
        </div>

        <div className="space-y-2 text-sm">
          <Row label="Project" value={row.project?.name ?? '—'} />
          <Row label="Folder" value={PHOTO_FOLDER_LABELS[row.folder]} />
          <Row label="Work Order" value={row.workOrderId ?? '—'} />
          <Row label="Crew / Sub" value={row.crewOrSubName} />
          <Row label="Employee" value={row.employeeName ?? '—'} />
          <Row label="Captured" value={row.capturedAt ? new Date(row.capturedAt).toLocaleString() : '—'} />
          <Row label="GPS" value={row.lat != null && row.lng != null ? `${row.lat.toFixed(5)}, ${row.lng.toFixed(5)}` : 'Not captured'} />
          <Row label="Work Type" value={row.workType ? (workTypeLabel[row.workType] ?? row.workType) : '—'} />
          <Row label="Production Item" value={workObjectTypeLabel(row.workObjectType) ?? '—'} />
          <div className="flex items-center justify-between py-0.5">
            <span className="text-xs font-medium text-slate-500">QA/QC Status</span>
            {row.qaStatus ? <QaStatusBadge status={row.qaStatus} /> : <span className="text-sm text-slate-400">—</span>}
          </div>
          {row.markup?.workId && (
            <Row label="Redline Reference" value={row.markup.workId} />
          )}
        </div>
      </div>

      {inspection && (
        <div className="mt-4 rounded-lg border border-slate-200 p-3">
          <p className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            <ShieldCheck size={12} /> QAQC Inspection
          </p>
          <div className="flex items-center gap-2 text-xs">
            <Badge tone={inspection.overallResult === 'pass' ? 'green' : inspection.overallResult === 'fail' ? 'red' : 'amber'}>
              {inspection.overallResult.toUpperCase()}
            </Badge>
            <span className="text-slate-400">
              {inspection.items.filter((i) => i.result === 'pass').length}/{inspection.items.length} passed
            </span>
          </div>
          {inspection.items.length > 0 && (
            <ul className="mt-2 space-y-1">
              {inspection.items.map((it) => (
                <li key={it.id} className="flex items-center justify-between text-xs">
                  <span className="text-slate-600">{it.label}</span>
                  <Badge tone={it.result === 'pass' ? 'green' : it.result === 'fail' ? 'red' : 'slate'}>{it.result.toUpperCase()}</Badge>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="mt-5 flex flex-wrap gap-2">
        <Button variant="secondary" onClick={viewOnMap} disabled={!row.markup && (row.lat == null || row.lng == null)}>
          <MapPin size={15} /> View on Map
        </Button>
        <Button variant="secondary" onClick={openProduction} disabled={!row.project}>
          <FileText size={15} /> Open Production Record
        </Button>
      </div>
    </Modal>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-slate-50 py-1 last:border-0">
      <span className="text-xs font-medium text-slate-500">{label}</span>
      <span className="text-right text-sm text-slate-800">{value}</span>
    </div>
  )
}
