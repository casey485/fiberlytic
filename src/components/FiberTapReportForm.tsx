/**
 * Standalone "Fiber Tap Report" capture form — digitizes the paper report a
 * splicing crew fills out per node/OLT: launch-site optical readings, then
 * one row per fiber tap with per-port dBm/link-loss readings and a required
 * power-meter-reading photo per active port. Not tied to the map/Add Work
 * wizard (taps aren't independently geolocated in the source paperwork) —
 * mirrors MaterialRequestForm's shape: a plain structured form tied to a
 * project, reached from the Subcontractor Dashboard.
 */
import { useEffect, useRef, useState } from 'react'
import { Camera, Check, Plus, Trash2 } from 'lucide-react'
import { useData } from '../store/DataContext'
import { Card, CardBody } from './ui/Card'
import { Button, Field, Input, Select } from './ui/Form'
import { compressImage } from '../lib/imageCompress'
import { saveBlob, loadBlob } from '../lib/fileStore'
import { localDateStr } from '../lib/format'
import { computeLinkLossDb } from '../lib/spliceExport'
import type { FiberTapEntry, FiberTapPort, FiberTapReport } from '../types'

function newTap(): FiberTapEntry {
  return { id: crypto.randomUUID(), tapName: '', tapType: 'MST', portCount: 2, portsSpliced: 0, bufferFiberColorToPort1: '', ports: [] }
}

function syncPorts(tap: FiberTapEntry, portsSpliced: number): FiberTapPort[] {
  const next: FiberTapPort[] = []
  for (let p = 1; p <= portsSpliced; p++) {
    next.push(tap.ports.find((x) => x.portNumber === p) ?? { portNumber: p, dbm: null, linkLossDb: null, photoId: null })
  }
  return next
}

function PortPhotoThumb({ photoUrl }: { photoUrl: string }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (photoUrl.startsWith('idb:')) loadBlob(photoUrl.slice(4)).then(setSrc)
    else setSrc(photoUrl)
  }, [photoUrl])
  if (!src) return null
  return <img src={src} className="h-8 w-8 rounded object-cover border border-slate-200" />
}

interface Props {
  reportId: string
  uploaderName: string
  onClose: () => void
}

export function FiberTapReportForm({ reportId, uploaderName, onClose }: Props) {
  const { data, updateFiberTapReport, addPhoto } = useData()
  const report = data.fiberTapReports.find((r) => r.id === reportId)
  const fileRef = useRef<HTMLInputElement>(null)
  const [capturingPort, setCapturingPort] = useState<{ tapId: string; portNumber: number } | null>(null)

  if (!report) return null

  function patch(p: Partial<FiberTapReport>) {
    updateFiberTapReport(reportId, p)
  }
  function updateTap(tapId: string, tapPatch: Partial<FiberTapEntry>) {
    if (!report) return
    patch({ taps: report.taps.map((t) => (t.id === tapId ? { ...t, ...tapPatch } : t)) })
  }
  function updatePort(tapId: string, portNumber: number, portPatch: Partial<FiberTapPort>) {
    if (!report) return
    patch({
      taps: report.taps.map((t) =>
        t.id === tapId ? { ...t, ports: t.ports.map((p) => (p.portNumber === portNumber ? { ...p, ...portPatch } : p)) } : t,
      ),
    })
  }
  function photoForPort(tapId: string, portNumber: number) {
    return data.photos.find((p) => p.spliceProofSlot?.kind === 'tap_port' && p.spliceProofSlot.tapEntryId === tapId && p.spliceProofSlot.portNumber === portNumber)
  }

  async function onPortPhotoFile(file: File | undefined) {
    if (!file || !report || !capturingPort) return
    const compressed = await compressImage(file)
    const key = 'tap-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2)
    await saveBlob(key, compressed)
    addPhoto({
      projectId: report.projectId,
      caption: `Tap port ${capturingPort.portNumber} light level`,
      category: 'progress',
      date: localDateStr(),
      uploadedBy: uploaderName,
      url: 'idb:' + key,
      capturedAt: new Date().toISOString(),
      spliceProofSlot: { kind: 'tap_port', tapEntryId: capturingPort.tapId, portNumber: capturingPort.portNumber },
    })
    setCapturingPort(null)
  }

  const missingPhotos = report.taps.flatMap((t) =>
    Array.from({ length: t.portsSpliced }, (_, i) => i + 1)
      .filter((port) => !photoForPort(t.id, port))
      .map((port) => `${t.tapName || 'Tap'} — Port ${port}`),
  )
  const canFinish = missingPhotos.length === 0 && report.taps.length > 0

  return (
    <Card>
      <CardBody>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => onPortPhotoFile(e.target.files?.[0])}
        />
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="PRISM ID"><Input value={report.prismId} onChange={(e) => patch({ prismId: e.target.value })} /></Field>
          <Field label="Node Number"><Input value={report.nodeNumber} onChange={(e) => patch({ nodeNumber: e.target.value })} /></Field>
          <Field label="Node Location / Optical Launch Site">
            <Input value={report.nodeLocation} onChange={(e) => patch({ nodeLocation: e.target.value })} />
          </Field>
          <Field label="Contractor Company"><Input value={report.contractorCompany} onChange={(e) => patch({ contractorCompany: e.target.value })} /></Field>
          <Field label="Splicer Name"><Input value={report.splicerName} onChange={(e) => patch({ splicerName: e.target.value })} /></Field>
          <Field label="Optical Source at Launch Site"><Input value={report.opticalSourceLabel} onChange={(e) => patch({ opticalSourceLabel: e.target.value })} /></Field>
          <Field label="Optical Power at Launch (dBm)">
            <Input type="number" value={report.opticalPowerDbm ?? ''} onChange={(e) => patch({ opticalPowerDbm: e.target.value === '' ? null : Number(e.target.value) })} />
          </Field>
          <Field label="Wavelength Used at Launch (nm)">
            <Input type="number" value={report.wavelengthNm ?? ''} onChange={(e) => patch({ wavelengthNm: e.target.value === '' ? null : Number(e.target.value) })} />
          </Field>
        </div>

        <div className="space-y-3">
          {report.taps.map((tap) => (
            <div key={tap.id} className="rounded-lg border border-slate-200 p-3">
              <div className="mb-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Field label="Tap Name"><Input value={tap.tapName} onChange={(e) => updateTap(tap.id, { tapName: e.target.value })} /></Field>
                <Field label="Tap Type">
                  <Select value={tap.tapType} onChange={(e) => updateTap(tap.id, { tapType: e.target.value as 'MST' | 'OTE' })}>
                    <option value="MST">MST</option>
                    <option value="OTE">OTE</option>
                  </Select>
                </Field>
                <Field label="Port Count">
                  <Input type="number" min={0} value={tap.portCount} onChange={(e) => updateTap(tap.id, { portCount: Math.max(0, Number(e.target.value)) })} />
                </Field>
                <Field label="Ports Spliced">
                  <Input type="number" min={0} max={tap.portCount}
                    value={tap.portsSpliced}
                    onChange={(e) => {
                      const n = Math.max(0, Number(e.target.value))
                      updateTap(tap.id, { portsSpliced: n, ports: syncPorts(tap, n) })
                    }}
                  />
                </Field>
              </div>
              <Field label="Buffer/Fiber Color Spliced to Port #1" hint='e.g. "BL-BL" or "SPLITTER F1"'>
                <Input value={tap.bufferFiberColorToPort1} onChange={(e) => updateTap(tap.id, { bufferFiberColorToPort1: e.target.value })} />
              </Field>
              {tap.ports.length > 0 && (
                <table className="mt-2 w-full text-xs">
                  <thead>
                    <tr className="text-left text-slate-500">
                      <th className="py-1 pr-2 font-medium">Port</th>
                      <th className="py-1 pr-2 font-medium">dBm</th>
                      <th className="py-1 pr-2 font-medium">Link Loss (dB)</th>
                      <th className="py-1 font-medium">Photo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tap.ports.map((port) => {
                      const photo = photoForPort(tap.id, port.portNumber)
                      return (
                        <tr key={port.portNumber} className="border-t border-slate-100">
                          <td className="py-1.5 pr-2">{port.portNumber}</td>
                          <td className="py-1.5 pr-2">
                            <input
                              type="number"
                              value={port.dbm ?? ''}
                              onChange={(e) => {
                                const v = e.target.value === '' ? null : Number(e.target.value)
                                updatePort(tap.id, port.portNumber, { dbm: v, linkLossDb: computeLinkLossDb(report.opticalPowerDbm, v) })
                              }}
                              className="w-16 rounded border border-slate-300 px-1.5 py-0.5"
                            />
                          </td>
                          <td className="py-1.5 pr-2">
                            <input
                              type="number"
                              value={port.linkLossDb ?? ''}
                              onChange={(e) => updatePort(tap.id, port.portNumber, { linkLossDb: e.target.value === '' ? null : Number(e.target.value) })}
                              className="w-16 rounded border border-slate-300 px-1.5 py-0.5"
                            />
                          </td>
                          <td className="py-1.5">
                            <div className="flex items-center gap-1.5">
                              {photo && <PortPhotoThumb photoUrl={photo.url} />}
                              <button
                                onClick={() => { setCapturingPort({ tapId: tap.id, portNumber: port.portNumber }); fileRef.current?.click() }}
                                className={`flex items-center gap-1 rounded px-1.5 py-1 text-[11px] ${photo ? 'text-emerald-600' : 'text-amber-600 hover:bg-amber-50'}`}
                              >
                                {photo ? <Check size={12} /> : <Camera size={12} />}
                                {photo ? 'Captured' : 'Required'}
                              </button>
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
              <button
                onClick={() => patch({ taps: report.taps.filter((t) => t.id !== tap.id) })}
                className="mt-2 flex items-center gap-1 text-[11px] text-slate-400 hover:text-red-500"
              >
                <Trash2 size={11} /> Remove tap
              </button>
            </div>
          ))}
          <Button variant="secondary" onClick={() => patch({ taps: [...report.taps, newTap()] })}>
            <Plus size={14} /> Add Tap
          </Button>
        </div>

        {missingPhotos.length > 0 && (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            Missing required port photos: {missingPhotos.join(', ')}
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <Button onClick={onClose} disabled={!canFinish}>Done</Button>
        </div>
      </CardBody>
    </Card>
  )
}
