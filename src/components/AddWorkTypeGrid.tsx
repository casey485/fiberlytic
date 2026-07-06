/** Add Work modal — Step 1: pick a work type. One card per WORK_OBJECT_TYPES entry,
 *  plus a visually distinct "Non-Billable Item" option that skips the wizard entirely
 *  (see startNonBillableLine in KmzMap.tsx / PdfPrintMode.tsx). */
import { Minus } from 'lucide-react'
import { WORK_OBJECT_TYPES } from '../lib/workObjectTypes'
import type { WorkObjectTypeDef } from '../lib/workObjectTypes'

interface Props {
  onSelect: (type: WorkObjectTypeDef) => void
  onSelectNonBillable: () => void
}

export function AddWorkTypeGrid({ onSelect, onSelectNonBillable }: Props) {
  return (
    <div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {WORK_OBJECT_TYPES.map((t) => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => onSelect(t)}
              className="flex flex-col items-center gap-2 rounded-lg border border-[#2a2a2a] bg-[#181818] p-3 text-center transition hover:border-[#3a3a3a] hover:bg-[#1e1e1e]"
            >
              <span
                className="flex h-9 w-9 items-center justify-center rounded-full"
                style={{ background: t.defaultColor + '22', color: t.defaultColor }}
              >
                <Icon size={18} />
              </span>
              <span className="text-[11px] font-medium leading-tight text-slate-300">{t.label}</span>
            </button>
          )
        })}
      </div>

      <div className="my-3 border-t border-[#2a2a2a]" />

      <button
        onClick={onSelectNonBillable}
        className="flex w-full items-center gap-3 rounded-lg border border-dashed border-[#3a3a3a] bg-transparent p-3 text-left transition hover:border-slate-500 hover:bg-white/5"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-500/15 text-slate-400">
          <Minus size={18} />
        </span>
        <span>
          <span className="block text-[11px] font-medium leading-tight text-slate-300">Non-Billable Item</span>
          <span className="block text-[10px] text-slate-500">Reference line only — no billing, draws instantly</span>
        </span>
      </button>
    </div>
  )
}
