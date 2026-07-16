import { useRef, useState } from 'react'
import { NavLink, useLocation, useNavigate } from 'react-router-dom'
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
  Download,
  Upload,
  ShieldCheck,
  Building2,
  ClipboardCheck,
  Eye,
  Sun,
  Moon,
  Wallet,
  Map,
  Languages,
  Scissors,
  ScanSearch,
  ChevronDown,
  UserCog,
  PanelLeftClose,
  PanelLeftOpen,
} from 'lucide-react'
import { useData } from '../store/DataContext'
import { exportAllData, importAllData } from '../lib/dataBackup'
import { useRole } from '../store/RoleContext'
import type { AppRole } from '../store/RoleContext'
import { NotificationBell } from './NotificationBell'
import { useTheme } from '../store/ThemeContext'
import { useLocale } from '../store/LocaleContext'
import { LOCALES } from '../i18n'

// Always visible in the sidebar — the day-to-day items. Everything else
// collapses into the "More" section below (see SidebarLinks).
const adminNavPinned = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/kmz', label: 'Field Map', icon: Map },
  { to: '/qa-review', label: 'QA/QC Review', icon: ClipboardCheck },
  { to: '/crews', label: 'Crews & Subs', icon: Users },
  { to: '/production', label: 'Production', icon: Activity },
  { to: '/pnl', label: 'P&L', icon: DollarSign },
]

const adminNavMore = [
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/map-cuts', label: 'Map Cuts', icon: Scissors },
  { to: '/map-reading', label: 'Map Reading', icon: ScanSearch },
  { to: '/employees', label: 'Employees', icon: HardHat },
  { to: '/clock-in', label: 'Time Clock', icon: Clock },
  { to: '/pay-stubs', label: 'Pay Stubs', icon: Wallet },
  { to: '/rate-cards', label: 'Rate Cards', icon: CreditCard },
  { to: '/equipment', label: 'Equipment', icon: Wrench },
  { to: '/expenses', label: 'Expenses', icon: Receipt },
  { to: '/materials', label: 'Materials', icon: Package },
  { to: '/photos', label: 'Photos', icon: Image },
  { to: '/invoicing', label: 'Invoicing', icon: FileText },
]


// Just one entry — My Projects, Field Map, Materials, Time Clock, and
// Production status all now live as tabs/actions directly on the In-House
// Dashboard (see FieldDashboard in pages/Dashboard.tsx), so there's nothing
// left for a sidebar to link to.
const fieldNav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
]

// Test-phase simulation of a subcontractor company's view — see RoleContext's
// AppRole doc comment. Just one entry — Field Map now lives as a tab on the
// Dashboard itself (see SubcontractorDashboard in pages/Dashboard.tsx).
const subcontractorNav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
]

// A supervisor's job is overseeing specific projects, not doing the field
// work themselves. Just one entry — My Projects, Field Map, and QA/QC
// Review now live as tabs on the Dashboard itself (see SupervisorDashboard
// in pages/Dashboard.tsx).
const supervisorNav = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
]

function Brand() {
  return (
    <div className="flex items-center gap-2.5 px-2">
      <img src="/logo.svg" alt="FiberLytic" className="h-9 w-9 rounded-lg object-cover" />
      <div>
        <p className="font-heading text-base leading-none">
          <span className="font-bold text-white">FIBER</span>
          <span className="font-normal text-slate-400">LYTIC</span>
        </p>
        <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wide leading-none text-slate-500">By Provium Tech</p>
      </div>
    </div>
  )
}

function NavItem({ to, label, icon: Icon, end, onNavigate }: { to: string; label: string; icon: typeof LayoutDashboard; end?: boolean; onNavigate?: () => void }) {
  return (
    <NavLink
      to={to}
      end={end}
      onClick={onNavigate}
      className={({ isActive }) =>
        `flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
          isActive
            ? 'bg-[#1d1d1d] text-white'
            : 'text-slate-200 hover:bg-white/6 hover:text-white'
        }`
      }
    >
      <Icon size={16} />
      {label}
    </NavLink>
  )
}

function SidebarLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { role, isAdmin } = useRole()
  const location = useLocation()
  // Auto-expand "More" when landing directly on one of its pages (e.g. a
  // bookmark or refresh) so the active highlight isn't hidden behind a
  // collapsed section — otherwise defaults closed, per the pinned-nav request.
  const startsExpanded = adminNavMore.some((item) => location.pathname.startsWith(item.to) && item.to !== '/')
  const [showMore, setShowMore] = useState(startsExpanded)

  if (role === 'subcontractor') {
    return (
      <nav className="mt-4 space-y-0.5 px-2">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-amber-500">
          Subcontractor View
        </p>
        {subcontractorNav.map((item) => <NavItem key={item.to} {...item} onNavigate={onNavigate} />)}
      </nav>
    )
  }

  if (role === 'supervisor') {
    return (
      <nav className="mt-4 space-y-0.5 px-2">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-cyan-500">
          Supervisor View
        </p>
        {supervisorNav.map((item) => <NavItem key={item.to} {...item} onNavigate={onNavigate} />)}
      </nav>
    )
  }

  if (!isAdmin) {
    return (
      <nav className="mt-4 space-y-0.5 px-2">
        <p className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-widest text-brand-500">
          In-House View
        </p>
        {fieldNav.map((item) => <NavItem key={item.to} {...item} onNavigate={onNavigate} />)}
      </nav>
    )
  }

  return (
    <nav className="mt-4 space-y-0.5 px-2">
      {adminNavPinned.map((item) => <NavItem key={item.to} {...item} onNavigate={onNavigate} />)}

      <button
        onClick={() => setShowMore((s) => !s)}
        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm font-medium text-slate-200 transition-colors hover:bg-white/6 hover:text-white"
      >
        <span>More</span>
        <ChevronDown size={15} className={`transition-transform ${showMore ? 'rotate-180' : ''}`} />
      </button>
      {showMore && adminNavMore.map((item) => <NavItem key={item.to} {...item} onNavigate={onNavigate} />)}
    </nav>
  )
}

// 'subcontractor'/'supervisor' are test-phase UI simulations only — see
// RoleContext's AppRole doc comment.
const ROLE_ORDER: AppRole[] = ['admin', 'field', 'supervisor', 'subcontractor']
const ROLE_LABEL: Record<AppRole, string> = { admin: 'Admin view', field: 'In-House view', supervisor: 'Supervisor view', subcontractor: 'Subcontractor view' }
const ROLE_COLOR: Record<AppRole, string> = { admin: 'text-emerald-400', field: 'text-brand-400', supervisor: 'text-cyan-400', subcontractor: 'text-amber-400' }
const ROLE_ICON: Record<AppRole, typeof ShieldCheck> = { admin: ShieldCheck, field: Eye, supervisor: UserCog, subcontractor: Building2 }

// Three separate, directly-clickable tabs instead of one button that cycles
// through all three on repeated clicks — jump straight to the view you want
// instead of clicking through the ones you don't.
function RoleTabs() {
  const { role, setRole } = useRole()
  const navigate = useNavigate()
  return (
    <div className="space-y-0.5">
      {ROLE_ORDER.map((r) => {
        const Icon = ROLE_ICON[r]
        const active = role === r
        return (
          <button
            key={r}
            onClick={() => {
              if (active) return
              setRole(r)
              // Whatever page you were on almost never exists in the new
              // role's nav (e.g. admin's /pnl isn't in the field or
              // subcontractor sidebar) — land on that role's Dashboard
              // instead of a page it can't navigate away from.
              navigate('/')
            }}
            className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition ${
              active ? `bg-white/10 ${ROLE_COLOR[r]}` : 'text-slate-500 hover:bg-white/8 hover:text-slate-300'
            }`}
            title={active ? undefined : `Switch to ${ROLE_LABEL[r]}`}
            aria-current={active ? 'true' : undefined}
          >
            <Icon size={14} />
            {ROLE_LABEL[r]}
          </button>
        )
      })}
    </div>
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

/**
 * For carrying your real crews/employees/projects/etc. to a device that's
 * never opened this app before — a fresh browser has nothing saved, so it
 * would otherwise fall back to placeholder demo data (see data/seed.ts).
 * Export here, then Import that same file on the new device, and it starts
 * from an exact copy instead. Photos/PDFs/KMZ files live separately in this
 * browser's IndexedDB and aren't included — those still need re-uploading
 * on the new device.
 */
function DataBackupControls() {
  const { data } = useData()
  const importInputRef = useRef<HTMLInputElement>(null)

  const onImportFile = async (file: File) => {
    if (!confirm('Import this file? It will completely replace everything currently in this browser — crews, employees, projects, all of it — with no undo.')) {
      return
    }
    // importAllData itself catches its own failure modes and returns { ok:
    // false }, but this outer try/catch is deliberate defense-in-depth — a
    // failed import must NEVER be silent (see importAllData's doc comment):
    // without this, an unanticipated exception here would look identical to
    // a successful import, leaving whatever placeholder data was already on
    // screen with no explanation.
    try {
      const result = await importAllData(file)
      if (!result.ok) alert(result.error ?? 'Import failed.')
    } catch (err) {
      alert(`Import failed: ${err instanceof Error ? err.message : 'unknown error'}`)
    }
  }

  return (
    <>
      <button
        onClick={() => exportAllData(data)}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 transition hover:bg-white/8 hover:text-slate-300"
      >
        <Download size={14} /> Export all data
      </button>
      <button
        onClick={() => importInputRef.current?.click()}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-500 transition hover:bg-white/8 hover:text-slate-300"
      >
        <Upload size={14} /> Import all data
      </button>
      <input
        ref={importInputRef}
        type="file"
        accept="application/json,.json"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) onImportFile(file)
          e.target.value = ''
        }}
      />
    </>
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
  const { role, activeEmployeeId, setActiveEmployee, activeSupervisorEmployeeId, setActiveSupervisorEmployee } = useRole()
  const { data } = useData()
  // Supervisor keeps its own separate identity (activeSupervisorEmployeeId)
  // from In-House view's activeEmployeeId — see RoleContext's doc comment on
  // why sharing one caused a stale-identity bug. This chip covers both
  // roles' display, just reading whichever id belongs to the active role.
  if (role !== 'field' && role !== 'supervisor') return null
  const activeId = role === 'supervisor' ? activeSupervisorEmployeeId : activeEmployeeId
  const clearActive = role === 'supervisor' ? () => setActiveSupervisorEmployee(null) : () => setActiveEmployee(null)
  if (!activeId) return null
  const emp = data.employees.find((e) => e.id === activeId)
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
        onClick={clearActive}
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-500 hover:bg-white/10 hover:text-slate-300"
      >
        Switch
      </button>
    </div>
  )
}

function SubcontractorChip() {
  const { role, activeSubcontractorId, setActiveSubcontractor } = useRole()
  const { data } = useData()
  if (role !== 'subcontractor' || !activeSubcontractorId) return null
  const sub = (data.subcontractors ?? []).find((s) => s.id === activeSubcontractorId)
  if (!sub) return null
  const initials = sub.companyName.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()
  return (
    <div className="mb-1 flex items-center gap-2 rounded-lg bg-white/5 px-3 py-2">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-amber-600 text-[11px] font-bold text-white">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-semibold text-slate-200">{sub.companyName}</p>
        <p className="text-[10px] text-slate-500">Subcontractor</p>
      </div>
      <button
        onClick={() => setActiveSubcontractor(null)}
        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium text-slate-500 hover:bg-white/10 hover:text-slate-300"
      >
        Switch
      </button>
    </div>
  )
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false)
  // Desktop sidebar hide/show — persisted so it stays collapsed across
  // reloads, same pattern as ThemeToggle/LocaleToggle. Every role shares
  // this one Layout, so admin/supervisor/subcontractor/in-house all get it.
  const [sidebarOpen, setSidebarOpen] = useState(() => localStorage.getItem('fiberlytic:sidebarOpen') !== 'false')
  const toggleSidebar = () => {
    setSidebarOpen((open) => {
      const next = !open
      localStorage.setItem('fiberlytic:sidebarOpen', String(next))
      return next
    })
  }
  const { resetData, data } = useData()
  const { isDark, toggleTheme } = useTheme()
  const { role, activeEmployeeId, activeSubcontractorId } = useRole()
  const activeEmployee = (role === 'field' && activeEmployeeId)
    ? data.employees.find((e) => e.id === activeEmployeeId) ?? null
    : null
  const activeSubcontractor = (role === 'subcontractor' && activeSubcontractorId)
    ? (data.subcontractors ?? []).find((s) => s.id === activeSubcontractorId) ?? null
    : null
  // Unified topbar identity — name/subtitle/initials, whichever session is active.
  const identity = activeEmployee
    ? { name: activeEmployee.name, subtitle: activeEmployee.role }
    : activeSubcontractor
    ? { name: activeSubcontractor.companyName, subtitle: 'Subcontractor' }
    : null

  const onReset = () => {
    if (confirm('Reset all data back to the sample dataset? This clears your local changes.')) {
      resetData()
    }
  }

  const sidebarBg = 'border-r border-[#1e1e1e] bg-[#0a0a0a]'

  return (
    <div className="flex min-h-screen bg-transparent">
      {/* Desktop sidebar — hidden entirely (not just narrowed) when collapsed;
          the header toggle button below brings it back. */}
      {sidebarOpen && (
        <aside className={`hidden w-56 shrink-0 flex-col lg:flex sticky top-0 h-screen ${sidebarBg}`}>
          <div className="flex h-14 items-center border-b border-[#1e1e1e] px-4">
            <Brand />
          </div>
          <div className="flex-1 overflow-y-auto">
            <SidebarLinks />
          </div>
          <div className="space-y-0.5 border-t border-[#1e1e1e] p-2">
            <FieldEmployeeChip />
            <SubcontractorChip />
            <ThemeToggle />
            <LocaleToggle />
            <RoleTabs />
            <DataBackupControls />
            <button
              onClick={onReset}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium text-slate-600 hover:bg-white/6 hover:text-slate-400"
            >
              <RotateCcw size={13} /> Reset sample data
            </button>
          </div>
        </aside>
      )}

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
              <RoleTabs />
              <DataBackupControls />
            </div>
          </aside>
        </div>
      )}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col bg-brand-50">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur lg:px-6">
          <button className="lg:hidden" onClick={() => setMobileOpen(true)} aria-label="Open menu">
            <Menu size={22} className="text-slate-400" />
          </button>
          <button
            className="hidden rounded-md p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 lg:flex"
            onClick={toggleSidebar}
            aria-label={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          >
            {sidebarOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
          </button>
          <div className="flex flex-1 items-center justify-end">
            <div className="flex items-center gap-3">
              <NotificationBell />
              <button
                onClick={toggleTheme}
                className="rounded-md p-1.5 text-slate-400 hover:text-slate-600 lg:hidden"
                aria-label="Toggle theme"
              >
                {isDark ? <Sun size={18} /> : <Moon size={18} />}
              </button>
              <div className="hidden text-right sm:block">
                {identity ? (
                  <>
                    <p className="text-sm font-semibold text-slate-800">{identity.name}</p>
                    <p className="text-xs text-slate-500">{identity.subtitle}</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-semibold text-slate-800">FiberLytic</p>
                    <p className="text-xs text-slate-500">Operations</p>
                  </>
                )}
              </div>
              {identity ? (
                <div className={`flex h-8 w-8 items-center justify-center rounded-full text-xs font-bold text-white ${activeSubcontractor ? 'bg-amber-600' : 'bg-brand-600'}`}>
                  {identity.name.split(' ').map((n) => n[0]).join('').slice(0, 2).toUpperCase()}
                </div>
              ) : (
                <img src="/logo.svg" alt="FiberLytic" className="h-8 w-8 rounded-full border border-slate-200 object-cover" />
              )}
            </div>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 lg:px-6">{children}</main>
      </div>
    </div>
  )
}
