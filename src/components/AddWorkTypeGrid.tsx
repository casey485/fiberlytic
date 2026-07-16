/** Add Work modal — Step 1: pick a work type. One card per WORK_OBJECT_TYPES entry,
 *  plus a "Non-Billable Item" option that skips the wizard entirely (see
 *  startNonBillableLine in KmzMap.tsx / PdfPrintMode.tsx), and one such option per
 *  SEQUENTIAL_ANNOTATION_TYPES entry (Fiber Tick Mark / Fiber Loop / Snow Shoe — see
 *  startSequentialAnnotation). Those types are filtered out of WORK_OBJECT_TYPES'
 *  own mapping below — their normal cards there would open the full Details/Photos/
 *  Billing wizard, which doesn't apply to them (they're map annotations, not
 *  billable work) — but render as their own cards in the same grid, styled
 *  identically to every other tile, so nothing about the layout singles them out;
 *  only the small "No billing" tag (shared with COMMENT_ANNOTATION_TYPES entries
 *  like Restoration/QA-QC, which stay in the normal WORK_OBJECT_TYPES loop since
 *  they keep their normal drawing geometry) says these skip the wizard. */
import { Minus } from 'lucide-react'
import { WORK_OBJECT_TYPES, WORK_OBJECT_TYPE_MAP, SEQUENTIAL_ANNOTATION_TYPES, isCommentAnnotation } from '../lib/workObjectTypes'
import type { WorkObjectTypeDef, WorkObjectTypeId } from '../lib/workObjectTypes'

interface Props {
  onSelect: (type: WorkObjectTypeDef) => void
  onSelectNonBillable: () => void
  onSelectSequential: (typeId: WorkObjectTypeId) => void
}

const TILE_CLASS = 'flex flex-col items-center gap-2 rounded-lg border border-[#2a2a2a] bg-[#181818] p-3 text-center transition hover:border-[#3a3a3a] hover:bg-[#1e1e1e]'
const ICON_CLASS = 'flex h-9 w-9 items-center justify-center rounded-full'
const LABEL_CLASS = 'text-[11px] font-medium leading-tight text-slate-300'
const NO_BILLING_TAG = <span className="text-[9px] font-medium uppercase tracking-wide text-slate-500">No billing</span>

export function AddWorkTypeGrid({ onSelect, onSelectNonBillable, onSelectSequential }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {WORK_OBJECT_TYPES.filter((t) => !SEQUENTIAL_ANNOTATION_TYPES.includes(t.id)).map((t) => {
        const Icon = t.icon
        return (
          <button key={t.id} onClick={() => onSelect(t)} className={TILE_CLASS}>
            <span className={ICON_CLASS} style={{ background: t.defaultColor + '22', color: t.defaultColor }}>
              <Icon size={18} />
            </span>
            <span className={LABEL_CLASS}>{t.label}</span>
            {isCommentAnnotation(t.id) && NO_BILLING_TAG}
          </button>
        )
      })}

      <button onClick={onSelectNonBillable} className={TILE_CLASS}>
        <span className={`${ICON_CLASS} bg-slate-500/15 text-slate-400`}>
          <Minus size={18} />
        </span>
        <span className={LABEL_CLASS}>Non-Billable Item</span>
        {NO_BILLING_TAG}
      </button>

      {SEQUENTIAL_ANNOTATION_TYPES.map((typeId) => {
        const t = WORK_OBJECT_TYPE_MAP[typeId]
        const Icon = t.icon
        return (
          <button key={typeId} onClick={() => onSelectSequential(typeId)} className={TILE_CLASS}>
            <span className={ICON_CLASS} style={{ background: t.defaultColor + '22', color: t.defaultColor }}>
              <Icon size={18} />
            </span>
            <span className={LABEL_CLASS}>{t.label}</span>
            {NO_BILLING_TAG}
          </button>
        )
      })}
    </div>
  )
}
