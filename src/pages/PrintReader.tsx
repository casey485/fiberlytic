import { useRef, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { FileUp, Loader2, FileText, Trash2, MapPin, ScanText } from 'lucide-react'
import { PageHeader } from '../components/ui/PageHeader'
import { Card, CardBody, CardHeader } from '../components/ui/Card'
import { Button } from '../components/ui/Form'
import { Badge } from '../components/ui/Badge'
import { renderPdf } from '../features/printkmz/pdf'
import { runOcr, parseExtraction } from '../features/printkmz/ocr'
import { buildLegend } from '../features/printkmz/legendEngine'
import { detectObjects } from '../features/printkmz/detect'
import { printStore, usePrintSessions } from '../features/printkmz/store'
import { isSupabaseConfigured } from '../features/printkmz/supabase'
import type { LngLat, PrintSession } from '../features/printkmz/types'
import { formatDate } from '../lib/format'

function defaultCenter(): LngLat {
  const raw = import.meta.env.VITE_DEFAULT_CENTER
  if (raw) {
    const [lng, lat] = raw.split(',').map(Number)
    if (!isNaN(lng) && !isNaN(lat)) return { lng, lat }
  }
  return { lng: -91.6656, lat: 41.9779 } // Cedar Rapids, IA
}

type Stage = 'idle' | 'rendering' | 'ocr' | 'detecting' | 'done' | 'error'

let sessionSeq = 0
const sessionId = () => `sess-${Date.now().toString(36)}-${(sessionSeq++).toString(36)}`

export function PrintReader() {
  const navigate = useNavigate()
  const sessions = usePrintSessions()
  const fileRef = useRef<HTMLInputElement>(null)
  const [stage, setStage] = useState<Stage>('idle')
  const [progress, setProgress] = useState('')
  const [error, setError] = useState('')

  const process = async (file: File) => {
    if (!file || file.type !== 'application/pdf') {
      setError('Please choose a PDF file.')
      setStage('error')
      return
    }
    setError('')
    try {
      setStage('rendering')
      setProgress('Rendering PDF pages…')
      const { pageCount, images, thumbnails } = await renderPdf(file, (p, t) =>
        setProgress(`Rendering page ${p} of ${t}…`),
      )

      setStage('ocr')
      setProgress('Reading text with OCR… (first run downloads the language model)')
      const pages = await runOcr(images, (p) =>
        setProgress(`OCR page ${p.page || 1} of ${p.total} — ${Math.round(p.progress * 100)}%`),
      )

      setStage('detecting')
      setProgress('Reading cover + legend and detecting objects…')
      const extraction = parseExtraction(pages)
      const legend = buildLegend(pages)
      const center = defaultCenter()
      const id = sessionId()
      const objects = detectObjects(id, extraction, legend, center)

      const session: PrintSession = {
        id,
        fileName: file.name,
        createdAt: new Date().toISOString(),
        pageCount,
        thumbnails,
        extraction,
        legend,
        center,
        objects,
      }
      printStore.createSession(session, images)
      setStage('done')
      navigate(`/print-reader/${id}`)
    } catch (e) {
      console.error(e)
      setError(e instanceof Error ? e.message : 'Failed to process PDF.')
      setStage('error')
    }
  }

  const busy = stage === 'rendering' || stage === 'ocr' || stage === 'detecting'

  return (
    <div>
      <PageHeader
        title="PDF Print Reader + KMZ Builder"
        description="Upload a construction print: read the cover + legend, detect field objects, review on a map, and export a hierarchical KMZ."
      />

      <Card>
        <CardBody>
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              if (!busy) process(e.dataTransfer.files?.[0] as File)
            }}
            className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50 px-6 py-12 text-center"
          >
            {busy ? (
              <>
                <Loader2 size={32} className="animate-spin text-brand-600" />
                <p className="font-medium text-slate-800">{stageLabel(stage)}</p>
                <p className="text-sm text-slate-500">{progress}</p>
              </>
            ) : (
              <>
                <FileUp size={32} className="text-brand-600" />
                <div>
                  <p className="font-medium text-slate-800">Drop a construction print PDF here</p>
                  <p className="text-sm text-slate-500">or choose a file to begin processing</p>
                </div>
                <Button onClick={() => fileRef.current?.click()}>
                  <ScanText size={16} /> Choose PDF
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={(e) => e.target.files?.[0] && process(e.target.files[0])}
                />
              </>
            )}
            {error && <p className="text-sm text-rose-600">{error}</p>}
          </div>

          <p className="mt-3 text-center text-xs text-slate-400">
            Persistence: {isSupabaseConfigured ? 'Supabase (configured)' : 'local only — add Supabase keys to .env to sync'}
            {' · '}Processing runs entirely in your browser.
          </p>
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Sessions" subtitle={`${sessions.length} processed print${sessions.length === 1 ? '' : 's'}`} />
        <CardBody className="p-0">
          {sessions.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-slate-400">No prints processed yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {sessions.map((s) => {
                const approved = s.objects.filter((o) => o.status === 'approved').length
                const loc = [s.extraction.cover.city, s.extraction.cover.state].filter(Boolean).join(', ')
                return (
                  <li key={s.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50">
                    <Link to={`/print-reader/${s.id}`} className="flex min-w-0 items-center gap-3">
                      <FileText size={18} className="shrink-0 text-slate-400" />
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-slate-800">
                          {s.extraction.cover.projectName || s.fileName}
                        </p>
                        <p className="flex items-center gap-2 text-xs text-slate-400">
                          {loc && <span className="flex items-center gap-1"><MapPin size={11} /> {loc}</span>}
                          <span>· {s.objects.length} objects</span>
                          <span>· {approved} approved</span>
                          <span>· {formatDate(s.createdAt.slice(0, 10))}</span>
                        </p>
                      </div>
                    </Link>
                    <div className="flex items-center gap-3">
                      <Badge tone="slate">{s.pageCount} pg</Badge>
                      <button
                        onClick={() => confirm(`Delete session "${s.fileName}"?`) && printStore.deleteSession(s.id)}
                        className="text-slate-300 hover:text-rose-600"
                        aria-label="Delete session"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </CardBody>
      </Card>
    </div>
  )
}

function stageLabel(stage: Stage) {
  return {
    idle: '',
    rendering: 'Rendering PDF',
    ocr: 'Running OCR',
    detecting: 'Reading cover & legend',
    done: 'Done',
    error: 'Error',
  }[stage]
}
