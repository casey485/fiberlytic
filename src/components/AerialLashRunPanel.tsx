import { useState } from 'react'
import { X, Trash2, CheckCircle, Circle, ChevronDown, ChevronRight } from 'lucide-react'
import { useData } from '../store/DataContext'
import { PoleFormModal } from './PoleFormModal'
import type { AerialLashFiberRun, AerialPole } from '../types'

const LASH_COLOR = '#a7dce8'

interface Props {
  run: AerialLashFiberRun
  onClose: () => void
  onDelete: () => void
}

export function AerialLashRunPanel({ run, onClose, onDelete }: Props) {
  const { updateAerialLashFiberRun, deleteAerialLashFiberRun } = useData()

  const [editingPole, setEditingPole] = useState<{ pole: AerialPole; index: number } | null>(null)
  const [notesOpen,   setNotesOpen]   = useState(false)
  const [notes,       setNotes]       = useState(run.notes ?? '')
  const [notesDirty,  setNotesDirty]  = useState(false)

  const totalPoles  = run.poles.length
  const donePoles   = run.poles.filter((p) => p.completed).length
  const missingTick = run.poles.filter((p) => !p.tickMark).length
  const pct = totalPoles > 0 ? Math.round((donePoles / totalPoles) * 100) : 0

  function handlePoleUpdate(updated: AerialPole) {
    const poles = run.poles.map((p) => p.poleNumber === updated.poleNumber ? updated : p)
    const allDone = poles.every((p) => p.completed)
    updateAerialLashFiberRun(run.id, {
      poles,
      status: allDone ? 'complete' : 'in_progress',
    })
  }

  function handleDelete() {
    if (!confirm(`Delete this aerial run (${totalPoles} poles)?`)) return
    deleteAerialLashFiberRun(run.id)
    onDelete()
  }

  function saveNotes() {
    updateAerialLashFiberRun(run.id, { notes: notes.trim() || null })
    setNotesDirty(false)
  }

  return (
    <div className="flex flex-col h-full bg-[#0d0d0d] text-slate-300 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-[#1e1e1e] shrink-0">
        <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: LASH_COLOR }} />
        <span className="text-[12px] font-semibold text-slate-100 flex-1 truncate">Aerial Lash Fiber Run</span>
        <button onClick={handleDelete} className="rounded p-1 text-slate-700 hover:text-red-400 hover:bg-red-400/10 transition" title="Delete run">
          <Trash2 size={12} />
        </button>
        <button onClick={onClose} className="rounded p-1 text-slate-600 hover:text-slate-200 hover:bg-white/5 transition">
          <X size={13} />
        </button>
      </div>

      {/* Summary stats */}
      <div className="px-3 py-2.5 border-b border-[#161616] shrink-0">
        <div className="grid grid-cols-3 gap-2 mb-2.5">
          <div className="rounded-lg bg-[#1a1a1a] px-2 py-1.5 text-center">
            <div className="text-[16px] font-bold text-slate-100">{totalPoles}</div>
            <div className="text-[9px] uppercase tracking-wider text-slate-600 mt-0.5">Poles</div>
          </div>
          <div className="rounded-lg bg-[#1a1a1a] px-2 py-1.5 text-center">
            <div className="text-[16px] font-bold text-slate-100">
              {run.totalFootage > 0 ? `${run.totalFootage.toLocaleString()}` : '—'}
            </div>
            <div className="text-[9px] uppercase tracking-wider text-slate-600 mt-0.5">Feet</div>
          </div>
          <div className="rounded-lg bg-[#1a1a1a] px-2 py-1.5 text-center">
            <div className="text-[16px] font-bold" style={{ color: pct === 100 ? '#22c55e' : LASH_COLOR }}>{pct}%</div>
            <div className="text-[9px] uppercase tracking-wider text-slate-600 mt-0.5">Done</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="h-1.5 rounded-full bg-[#1e1e1e] overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${pct}%`, background: pct === 100 ? '#22c55e' : LASH_COLOR }}
          />
        </div>
        {missingTick > 0 && (
          <p className="text-[10px] text-amber-500 mt-1.5">{missingTick} pole{missingTick !== 1 ? 's' : ''} missing tick mark</p>
        )}
      </div>

      {/* Notes collapsible */}
      <div className="border-b border-[#161616] shrink-0">
        <button
          onClick={() => setNotesOpen((v) => !v)}
          className="flex items-center gap-1.5 w-full px-3 py-2 text-[10px] text-slate-500 hover:text-slate-300 transition"
        >
          {notesOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
          Run Notes {run.notes && !notesOpen && <span className="ml-1 text-slate-600 truncate">{run.notes}</span>}
        </button>
        {notesOpen && (
          <div className="px-3 pb-2">
            <textarea
              rows={3}
              value={notes}
              onChange={(e) => { setNotes(e.target.value); setNotesDirty(true) }}
              placeholder="Notes about this run…"
              className="w-full rounded-lg bg-[#1a1a1a] border border-[#2a2a2a] px-2.5 py-1.5 text-[11px] text-slate-200 placeholder-slate-600 outline-none focus:border-[#a7dce8]/50 resize-none"
            />
            {notesDirty && (
              <button onClick={saveNotes} className="mt-1 text-[10px] font-semibold transition" style={{ color: LASH_COLOR }}>
                Save notes
              </button>
            )}
          </div>
        )}
      </div>

      {/* Pole list */}
      <div className="flex-1 overflow-y-auto">
        <div className="px-3 py-2 flex items-center justify-between">
          <span className="text-[9px] uppercase tracking-wider text-slate-600">Poles</span>
          <span className="text-[9px] text-slate-700">{donePoles}/{totalPoles} complete</span>
        </div>
        {run.poles.map((pole, idx) => (
          <button
            key={pole.poleNumber}
            onClick={() => setEditingPole({ pole, index: idx })}
            className="group w-full flex items-start gap-2.5 px-3 py-2 hover:bg-white/4 transition text-left"
          >
            {pole.completed ? (
              <CheckCircle size={14} className="shrink-0 mt-0.5 text-emerald-500" />
            ) : (
              <Circle size={14} className="shrink-0 mt-0.5" style={{ color: LASH_COLOR }} />
            )}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-semibold text-slate-200">Pole {pole.poleNumber}</span>
                {pole.tickMark && (
                  <span className="text-[10px] text-slate-500 font-mono">{pole.tickMark}</span>
                )}
                {!pole.tickMark && (
                  <span className="text-[9px] text-amber-600 italic">no tick mark</span>
                )}
              </div>
              <div className="flex items-center gap-2 mt-0.5">
                {pole.crewName && <span className="text-[9px] text-slate-600">{pole.crewName}</span>}
                {pole.dateTime && (
                  <span className="text-[9px] text-slate-700">
                    {new Date(pole.dateTime).toLocaleDateString()}
                  </span>
                )}
              </div>
              {pole.notes && <p className="text-[10px] text-slate-600 truncate mt-0.5">{pole.notes}</p>}
            </div>
            <span className="text-[10px] text-slate-700 shrink-0 group-hover:text-slate-500 transition">Edit</span>
          </button>
        ))}
      </div>

      {/* Footer: created date */}
      <div className="px-3 py-2 border-t border-[#1e1e1e] shrink-0">
        <p className="text-[9px] text-slate-700">
          Created {new Date(run.createdAt).toLocaleDateString()}
          {run.updatedAt && ` · Updated ${new Date(run.updatedAt).toLocaleDateString()}`}
        </p>
      </div>

      {/* Pole edit modal */}
      {editingPole && (
        <PoleFormModal
          pole={editingPole.pole}
          runId={run.id}
          onSave={handlePoleUpdate}
          onClose={() => setEditingPole(null)}
        />
      )}
    </div>
  )
}
