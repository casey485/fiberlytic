import { useEffect, useState } from 'react'
import { Loader2, AlertCircle, CheckCircle2, CircleDashed, AlertTriangle } from 'lucide-react'
import type { MapReadingPage } from '../../types'
import { loadBlob } from '../../lib/fileStore'
import { DropZone } from './DropZone'

interface PageThumbnailListProps {
  pages: MapReadingPage[]
  selectedPageId: string | null
  onSelectPage: (id: string) => void
  onFilesAdded: (files: File[]) => void
}

function Thumb({ blobKey }: { blobKey: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => { loadBlob(blobKey).then(setSrc) }, [blobKey])
  if (!src) return <div className="h-16 w-16 shrink-0 animate-pulse rounded bg-[#1e1e1e]" />
  return <img src={src} className="h-16 w-16 shrink-0 rounded border border-[#2a3347] object-cover" />
}

const STATUS_ICON: Record<MapReadingPage['status'], React.ReactNode> = {
  not_read: <CircleDashed size={12} className="text-slate-500" />,
  reading: <Loader2 size={12} className="animate-spin text-brand-400" />,
  complete: <CheckCircle2 size={12} className="text-emerald-500" />,
  needs_review: <AlertTriangle size={12} className="text-rose-400" />,
  error: <AlertCircle size={12} className="text-rose-500" />,
}
const STATUS_LABEL: Record<MapReadingPage['status'], string> = {
  not_read: 'Not Read', reading: 'Reading…', complete: 'Complete', needs_review: 'Needs Review', error: 'Error',
}

export function PageThumbnailList({ pages, selectedPageId, onSelectPage, onFilesAdded }: PageThumbnailListProps) {
  return (
    <div className="flex h-full flex-col gap-2">
      <DropZone onFiles={onFilesAdded} compact />
      <div className="flex-1 space-y-1.5 overflow-y-auto">
        {pages.length === 0 ? (
          <p className="rounded border border-dashed border-[#2a2a2a] px-2 py-4 text-center text-[11px] text-slate-600">
            No pages uploaded yet.
          </p>
        ) : (
          pages.map((p) => (
            <button
              key={p.id}
              onClick={() => onSelectPage(p.id)}
              className={`flex w-full items-center gap-2 rounded-lg border px-2 py-2 text-left transition ${
                p.id === selectedPageId ? 'border-brand-500 bg-brand-900/20' : 'border-[#2a2a2a] hover:border-[#3a3a3a]'
              }`}
            >
              <Thumb blobKey={p.imageBlobKey} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[11px] font-medium text-slate-200">{p.notes.pageName || p.fileName}</p>
                <p className="truncate text-[10px] text-slate-500">
                  {p.fileName}{p.pageIndexInFile > 0 ? ` · p.${p.pageIndexInFile + 1}` : ''}
                </p>
                <p className="mt-0.5 flex items-center gap-1 text-[10px] text-slate-600">
                  {STATUS_ICON[p.status]}
                  {p.status === 'error' ? (p.error ?? 'Error')
                    : p.status === 'not_read' || p.status === 'reading' ? STATUS_LABEL[p.status]
                    : `${STATUS_LABEL[p.status]} · ${p.detections.length} detection${p.detections.length === 1 ? '' : 's'}`}
                </p>
              </div>
            </button>
          ))
        )}
      </div>
    </div>
  )
}
