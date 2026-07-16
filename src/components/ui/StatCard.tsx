import type { ReactNode } from 'react'

export function StatCard({
  label,
  value,
  icon,
  hint,
  trend,
}: {
  label: string
  value: string
  icon?: ReactNode
  hint?: string
  trend?: { value: string; positive: boolean }
}) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium text-slate-500">{label}</p>
        {icon && <div className="text-brand-600">{icon}</div>}
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      <div className="mt-1 flex items-center gap-2">
        {trend && (
          <span className={trend.positive ? 'text-xs font-medium text-emerald-600' : 'text-xs font-medium text-rose-600'}>
            {trend.positive ? '▲' : '▼'} {trend.value}
          </span>
        )}
        {hint && <span className="text-xs text-slate-400">{hint}</span>}
      </div>
    </div>
  )
}
