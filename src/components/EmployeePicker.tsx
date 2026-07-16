import { Users } from 'lucide-react'
import type { Employee } from '../types'

export function EmployeePicker({ onSelect, employees }: { onSelect: (id: string) => void; employees: Employee[] }) {
  const sorted = [...employees].sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center">
      <div className="mb-8 text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-600">
          <Users size={28} className="text-white" />
        </div>
        <h2 className="text-2xl font-bold text-slate-900">Who are you?</h2>
        <p className="mt-1 text-sm text-slate-500">Select your name to see your personal dashboard</p>
      </div>
      <div className="grid w-full max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
        {sorted.map((emp) => (
          <button
            key={emp.id}
            onClick={() => onSelect(emp.id)}
            className="flex items-center gap-4 rounded-2xl border border-slate-200 bg-white p-4 text-left transition hover:border-brand-400 hover:shadow-md active:scale-[0.98]"
          >
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
              {emp.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
            </div>
            <div>
              <p className="font-semibold text-slate-900">{emp.name}</p>
              <p className="text-xs text-slate-500">{emp.role}</p>
              {emp.isForeman && (
                <span className="mt-0.5 inline-flex items-center rounded bg-brand-100 px-1.5 py-0.5 text-[10px] font-semibold text-brand-700">
                  Foreman
                </span>
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}
