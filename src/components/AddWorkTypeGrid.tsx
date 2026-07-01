/** Add Work modal — Step 1: pick a work type. One card per WORK_OBJECT_TYPES entry. */
import { WORK_OBJECT_TYPES } from '../lib/workObjectTypes'
import type { WorkObjectTypeDef } from '../lib/workObjectTypes'

export function AddWorkTypeGrid({ onSelect }: { onSelect: (type: WorkObjectTypeDef) => void }) {
  return (
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
  )
}
