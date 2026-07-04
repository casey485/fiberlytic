import type { MapReadingPage } from '../../types'

function parseFootageValue(text: string): number {
  const match = text.replace(/,/g, '').match(/(\d+(?:\.\d+)?)/)
  return match ? Number(match[1]) : 0
}

function uniqueCableSizes(page: MapReadingPage): string {
  const sizes = new Set<string>()
  for (const seg of page.routeGraph?.segments ?? []) {
    if (seg.classification === 'construction_24ct') sizes.add('24ct')
    if (seg.classification === 'construction_48ct') sizes.add('48ct')
    if (seg.classification === 'construction_96ct') sizes.add('96ct')
    if (seg.classification === 'overlash') sizes.add('Overlash')
    if (seg.classification === 'fiber_only') sizes.add('Fiber Only')
    if (seg.classification === 'strand_only') sizes.add('Strand Only')
  }
  return sizes.size > 0 ? [...sizes].join(', ') : '—'
}

const STATUS_LABEL: Record<MapReadingPage['status'], string> = {
  not_read: 'Not Read', reading: 'Reading', complete: 'Complete', needs_review: 'Needs Review', error: 'Error',
}
const STATUS_CLASS: Record<MapReadingPage['status'], string> = {
  not_read: 'bg-slate-500/15 text-slate-400',
  reading: 'bg-brand-500/15 text-brand-300',
  complete: 'bg-emerald-500/15 text-emerald-400',
  needs_review: 'bg-rose-500/15 text-rose-400',
  error: 'bg-rose-500/15 text-rose-400',
}

/** The batch overview shown once a session has pages — reviewed before diving
 *  into any single page, per "auto-detect and highlight everything first,
 *  then let the user review." */
export function SummaryTable({ pages }: { pages: MapReadingPage[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[#2a2a2a]">
      <table className="w-full text-left text-[11px]">
        <thead className="bg-[#141414] text-slate-500">
          <tr>
            <th className="px-2 py-1.5 font-medium">Page #</th>
            <th className="px-2 py-1.5 font-medium">Routes</th>
            <th className="px-2 py-1.5 font-medium">Total Footage</th>
            <th className="px-2 py-1.5 font-medium">Cable Sizes</th>
            <th className="px-2 py-1.5 font-medium">Slack Loops</th>
            <th className="px-2 py-1.5 font-medium">Splice Locations</th>
            <th className="px-2 py-1.5 font-medium">FE Labels</th>
            <th className="px-2 py-1.5 font-medium">FT Labels</th>
            <th className="px-2 py-1.5 font-medium">Road Names</th>
            <th className="px-2 py-1.5 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-[#1e1e1e]">
          {pages.map((p, i) => {
            const footageTotal = p.detections.filter((d) => d.type === 'footage').reduce((s, d) => s + parseFootageValue(d.text), 0)
            const feCount = p.detections.filter((d) => d.type === 'fe_label').length
            const ftCount = p.detections.filter((d) => d.type === 'ft_label').length
            const coilCount = p.detections.filter((d) => d.type === 'coil').length
            const spliceCount = p.detections.filter((d) => d.type === 'splice').length
            const roadNames = [...new Set(p.detections.filter((d) => d.type === 'road_name').map((d) => d.text))]
            return (
              <tr key={p.id}>
                <td className="px-2 py-1.5 text-slate-300">{i + 1}</td>
                <td className="px-2 py-1.5 text-slate-300">{p.routeGraph?.segments.length ?? 0}</td>
                <td className="px-2 py-1.5 text-slate-300">{footageTotal > 0 ? `${footageTotal.toLocaleString()} ft` : '—'}</td>
                <td className="px-2 py-1.5 text-slate-300">{uniqueCableSizes(p)}</td>
                <td className="px-2 py-1.5 text-slate-300">{coilCount}</td>
                <td className="px-2 py-1.5 text-slate-300">{spliceCount}</td>
                <td className="px-2 py-1.5 text-slate-300">{feCount}</td>
                <td className="px-2 py-1.5 text-slate-300">{ftCount}</td>
                <td className="px-2 py-1.5 text-slate-300">{roadNames.length > 0 ? roadNames.join(', ') : '—'}</td>
                <td className="px-2 py-1.5">
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${STATUS_CLASS[p.status]}`}>
                    {STATUS_LABEL[p.status]}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
