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
  CreditCard,
  HardHat,
  Wrench,
  Receipt,
  Clock,
  Menu,
  X,
  RotateCcw,
  ShieldCheck,
  Eye,
  Sun,
  Moon,
  Wallet,
  Map,
  Languages,
} from 'lucide-react'
import { useData } from '../store/DataContext'
import { useRole } from '../store/RoleContext'
import { useTheme } from '../store/ThemeContext'
import { useLocale } from '../store/LocaleContext'
import { LOCALES } from '../i18n'

const adminNav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/kmz', label: 'Field Map', icon: Map },
  { to: '/crews', label: 'Crews', icon: Users },
  { to: '/employees', label: 'Employees', icon: HardHat },
  { to: '/production', label: 'Production', icon: Activity },
  { to: '/clock-in', label: 'Time Clock', icon: Clock },
  { to: '/pnl', label: 'P&L', icon: DollarSign },
  { to: '/pay-stubs', label: 'Pay Stubs', icon: Wallet },
  { to: '/rate-cards', label: 'Rate Cards', icon: CreditCard },
  { to: '/equipment', label: 'Equipment', icon: Wrench },
  { to: '/expenses', label: 'Expenses', icon: Receipt },
  { to: '/materials', label: 'Materials', icon: Package },
  { to: '/photos', label: 'Photos', icon: Image },
  { to: '/invoicing', label: 'Invoicing', icon: FileText },
]

const fieldNav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'My Projects', icon: FolderKanban },
  { to: '/kmz', label: 'Field Map', icon: Map },
  { to: '/clock-in', label: 'Time Clock', icon: Clock },
  { to: '/production', label: 'Production', icon: Activity },
  { to: '/project-prints', label: 'Print Access', icon: Map },
  { to: '/expenses', label: 'Expenses', icon: Receipt },
  { to: '/materials', label: 'Materials', icon: Package },
]

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <img src="/logo.jpg" alt="Nextgen Fiber LLC" className="h-9 w-9 rounded-lg object-cover" />
      <div>
        <p className="text-base font-bold leading-none text-white">Nextgen Fiber LLC</p>
        <p className="mt-0.5 text-[11px] leading-none text-brand-300">Fiber Ops Platform</p>
      </div>
    </div>
  )
}

function SidebarLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { isAdmin } = useRole()
  const nav = isAdmin ? adminNav : fieldNav
  return (
    <nav className="mt-4 space-y-0.5 px-2">
      {!isAdmin && (
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-brand-500">
          Field View
        </p>
      )}
      {nav.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          onClick={onNavigate}
          className={({ isActive }) =>
            `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
              isActive
                ? 'bg-brand-600 text-white shadow-sm shadow-brand-900/50'
                : 'text-slate-400 hover:bg-white/6 hover:text-white'
            }`
          }
        >
          <Icon size={16} />
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
      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition hover:bg-white/8 ${
        isAdmin ? 'text-emerald-400' : 'text-brand-400'
      }`}
      title={isAdmin ? 'Switch to Field view' : 'Switch to Admin view'}
    >
      {isAdmin ? <ShieldCheck size={14} /> : <Eye size={14} />}
      {isAdmin ? 'Admin view' : 'Field view'}
    </button>
  )
}

function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme()
  return (
    <button
      onClick={toggleTheme}
      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 transition hover:bg-white/8 hover:text-slate-300"
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? <Sun size={14} /> : <Moon size={14} />}
      {isDark ? 'Light mode' : 'Dark mode'}
    </button>
  )
}

function LocaleToggle() {
  const { locale, setLocale } = useLocale()
  return (
    <label className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 transition hover:bg-white/8 hover:text-slate-300">
      <Languages size={14} className="shrink-0" />
      <select
        value={locale}
        onChange={(e) => setLocale(e.target.value as typeof locale)}
        className="w-full cursor-pointer border-none bg-transparent text-xs font-medium text-slate-500 outline-none hover:text-slate-300"
      >
        {LOCALES.map((l) => (
          <option key={l.code} value={l.code} className="bg-[#141414] text-slate-200">{l.label}</option>
        ))}
      </select>
    </label>
  )
}

function FieldEmployeeChip() {
  const { isAdmin, activeEmployeeId, setActiveEmployee } = useRole()
  const { data } = useData()
  if (isAdmin || !activeEmployeeId) return null
  const emp = data.employees.find((e) => e.id === activeEmployeeId)
  if (!emp) return null
  const initials = emp.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="mb-1 flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-[11px] font-bold text-white">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-slate-200">{emp.name}</p>
        <p className="text-[10px] text-slate-500">{emp.role}</p>
      </div>
      <button
        onClick={() => setActiveEmployee(null)}
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-500 hover:bg-white/10 hover:text-slate-300"
      >
        Switch
      </button>
    </div>
  )
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  const { resetData, data } = useData()
  const location = useLocation()
  const { isDark, toggleTheme } = useTheme()
  const { isAdmin, activeEmployeeId } = useRole()
  const activeEmployee = (!isAdmin && activeEmployeeId)
    ? data.employees.find((e) => e.id === activeEmployeeId) ?? null
    : null

  const onReset = () => {
    if (confirm('Reset all data back to the sample dataset? This clears your local changes.')) {
      resetData()
    }
  }

  const sidebarBg = 'border-r border-[#1e1e1e] bg-[#0a0a0a]/80 backdrop-blur-md'

  return (
    <div className="flex min-h-screen bg-transparent">
      {/* Desktop sidebar */}
      <aside className={`hidden w-56 shrink-0 flex-col lg:flex sticky top-0 h-screen ${sidebarBg}`}>
        <div className="flex h-14 items-center border-b border-[#1e1e1e] px-4">
          <Brand />
        </div>
        <div className="flex-1 overflow-y-auto">
          <SidebarLinks />
        </div>
        <div className="space-y-0.5 border-t border-[#1e1e1e] p-2">
          <FieldEmployeeChip />
          <ThemeToggle />
          <LocaleToggle />
          <RoleToggle />
          <button
            onClick={onReset}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-white/6 hover:text-slate-400"
          >
            <RotateCcw size={13} /> Reset sample data
          </button>
        </div>
      </aside>

      {/* Mobile sidebar */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMobileOpen(false)} />
          <aside className={`absolute left-0 top-0 flex h-full w-56 flex-col ${sidebarBg}`}>
            <div className="flex h-14 items-center justify-between border-b border-[#1e1e1e] px-4">
              <Brand />
              <button onClick={() => setMobileOpen(false)} className="text-slate-500 hover:text-white">
                <X size={20} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <SidebarLinks onNavigate={() => setMobileOpen(false)} />
            </div>
            <div className="space-y-0.5 border-t border-[#1e1e1e] p-2">
              <FieldEmployeeChip />
              <ThemeToggle />
              <LocaleToggle />
              <RoleToggle />
            </div>
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[#1e1e1e] bg-[#0e0e0e]/95 px-4 backdrop-blur lg:px-6">
          <button className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu size={22} className="text-slate-500" />
          </button>
          <div className="flex flex-1 items-center justify-between">
            <p className="text-sm font-medium text-slate-500">
              {location.pathname === '/' ? 'P&L Command Center' : ''}
            </p>
            <div className="flex items-center gap-3">
              <button
                onClick={toggleTheme}
                className="rounded-md p-1.5 text-slate-600 hover:text-slate-400 lg:hidden"
                aria-label="Toggle theme"
              >
                {isDark ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <div className="hidden text-right sm:block">
                {activeEmployee ? (
                  <>
                    <p className="text-sm font-semibold text-slate-200">{activeEmployee.name}</p>
                    <p className="text-xs text-slate-500">{activeEmployee.role}</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-slate-200">NextGen Fiber LLC</p>
                    <p className="text-xs text-slate-500">Operations</p>
                  </>
                )}
              </div>
              {activeEmployee ? (
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">
                  {activeEmployee.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
              ) : (
                <img src="/logo.jpg" alt="Nextgen Fiber LLC" className="h-8 w-8 rounded-full object-cover" />
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-6">{children}</main>
      </div>
    </div>
  )
}
