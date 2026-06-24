import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  FolderKanban,
  Users,
  Activity,
  DollarSign,
  Package,
  Image,
  FileText,
  ScanText,
  CreditCard,
  HardHat,
  Wrench,
  Receipt,
  Menu,
  X,
  RotateCcw,
  ShieldCheck,
  Eye,
} from 'lucide-react'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'

const nav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/crews', label: 'Crews', icon: Users },
  { to: '/employees', label: 'Employees', icon: HardHat },
  { to: '/production', label: 'Production', icon: Activity },
  { to: '/pnl', label: 'P&L', icon: DollarSign },
  { to: '/rate-cards', label: 'Rate Cards', icon: CreditCard },
  { to: '/equipment', label: 'Equipment', icon: Wrench },
  { to: '/expenses', label: 'Expenses', icon: Receipt },
  { to: '/materials', label: 'Materials', icon: Package },
  { to: '/photos', label: 'Photos', icon: Image },
  { to: '/invoicing', label: 'Invoicing', icon: FileText },
  { to: '/print-reader', label: 'Print Reader', icon: ScanText },
]

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600">
        <svg viewBox="0 0 32 32" className="h-6 w-6">
          <path d="M9 22 L16 10 L23 22" fill="none" stroke="#22d3ee" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
          <circle cx="16" cy="10" r="2.4" fill="#22d3ee" />
          <circle cx="9" cy="22" r="2.4" fill="#ffffff" />
          <circle cx="23" cy="22" r="2.4" fill="#ffffff" />
        </svg>
      </div>
      <div>
        <p className="text-base font-bold leading-none text-white">Nextgen Fiber LLC</p>
        <p className="mt-0.5 text-[11px] leading-none text-brand-200">Fiber Ops Platform</p>
      </div>
    </div>
  )
}

function SidebarLinks({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav className="mt-6 space-y-1 px-2">
      {nav.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition ${
              isActive ? 'bg-brand-600/90 text-white' : 'text-brand-100 hover:bg-white/10 hover:text-white'
            }`
          }
        >
          <Icon size={18} />
          {label}
        </NavLink>
      ))}
    </nav>
  )
}

function RoleToggle() {
  const { role, setRole } = useRole()
  const isAdmin = role === 'admin'
  return (
    <button
      onClick={() => setRole(isAdmin ? 'field' : 'admin')}
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition hover:bg-white/10 ${
        isAdmin ? 'text-emerald-300' : 'text-amber-300'
      }`}
      title={isAdmin ? 'Switch to Field view (hides rates)' : 'Switch to Admin view (shows rates)'}
    >
      {isAdmin ? <ShieldCheck size={14} /> : <Eye size={14} />}
      {isAdmin ? 'Admin view' : 'Field view'}
    </button>
  )
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { resetData } = useData()
  const location = useLocation()

  const onReset = () => {
    if (confirm('Reset all data back to the sample dataset? This clears your local changes.')) {
      resetData()
    }
  }

  return (
    <div className="flex min-h-screen bg-slate-100">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col bg-slate-900 lg:flex">
        <div className="flex h-16 items-center border-b border-white/10 px-4">
          <Brand />
        </div>
        <SidebarLinks />
        <div className="mt-auto space-y-1 p-3">
          <RoleToggle />
          <button
            onClick={onReset}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-brand-200 hover:bg-white/10"
          >
            <RotateCcw size={14} /> Reset sample data
          </button>
        </div>
      </aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 flex h-full w-64 flex-col bg-slate-900">
            <div className="flex h-16 items-center justify-between border-b border-white/10 px-4">
              <Brand />
              <button onClick={() => setMobileOpen(false)} className="text-white/70 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <SidebarLinks onNavigate={() => setMobileOpen(false)} />
            <div className="mt-auto space-y-1 p-3">
              <RoleToggle />
            </div>
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur lg:px-8">
          <button className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu size={22} className="text-slate-600" />
          </button>
          <div className="flex flex-1 items-center justify-between">
            <p className="text-sm text-slate-400">
              {location.pathname === '/' ? 'Overview' : ''}
            </p>
            <div className="flex items-center gap-3">
              <div className="hidden text-right sm:block">
                <p className="text-sm font-medium text-slate-700">NextGen Fiber LLC</p>
                <p className="text-xs text-slate-400">Operations</p>
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-brand-100 text-sm font-semibold text-brand-700">
                NF
              </div>
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  )
}
