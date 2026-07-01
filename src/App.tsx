import { Routes, Route, Navigate, useLocation } from 'react-router-dom'
import { Layout } from './components/Layout'
import { ErrorBoundary } from './components/ErrorBoundary'
import { Dashboard } from './pages/Dashboard'
import { Projects } from './pages/Projects'
import { ProjectDetail } from './pages/ProjectDetail'
import { Crews } from './pages/Crews'
import { Production } from './pages/Production'
import { DailyPnL } from './pages/DailyPnL'
import { Materials } from './pages/Materials'
import { Photos } from './pages/Photos'
import { Invoicing } from './pages/Invoicing'
import { PrintReader } from './pages/PrintReader'
import { PrintReview } from './pages/PrintReview'
import { ProjectPrints } from './pages/ProjectPrints'
import { Redline } from './pages/Redline'
import { RedlineEditor } from './pages/RedlineEditor'
import { RateCards } from './pages/RateCards'
import { Employees } from './pages/Employees'
import { EquipmentPage } from './pages/Equipment'
import { ExpensesPage } from './pages/Expenses'
import { ClockIn } from './pages/ClockIn'
import { PayStubs } from './pages/PayStubs'
import { KmzProduction } from './pages/KmzProduction'
import { KmzMap } from './pages/KmzMap'
import { Login } from './pages/Login'
import { SetupWizard } from './pages/SetupWizard'
import { useRole } from './store/RoleContext'
import { useAuth } from './store/AuthContext'

function AdminRoute({ element }: { element: React.ReactElement }) {
  const { isAdmin } = useRole()
  return isAdmin ? element : <Navigate to="/" replace />
}

function FullScreenSpinner() {
  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
      <div className="flex flex-col items-center gap-4">
        <div className="h-8 w-8 rounded-full border-2 border-orange-500/30 border-t-orange-500 animate-spin" />
        <p className="text-xs text-slate-600">Loading…</p>
      </div>
    </div>
  )
}

export default function App() {
  const location = useLocation()
  const { user, loading, setupDone } = useAuth()

  if (loading) return <FullScreenSpinner />
  if (!setupDone) return <SetupWizard />
  if (!user) return <Login />

  return (
    <Layout>
      <ErrorBoundary key={location.pathname}>
        <Routes>
          {/* Shared routes */}
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/production" element={<Production />} />
          <Route path="/clock-in" element={<ClockIn />} />
          <Route path="/expenses" element={<ExpensesPage />} />
          <Route path="/materials" element={<Materials />} />
          <Route path="/redline" element={<Redline />} />
          <Route path="/redline/:fileId" element={<RedlineEditor />} />
          <Route path="/kmz" element={<KmzProduction />} />
          <Route path="/kmz/:projectId" element={<KmzMap />} />

          {/* Admin-only routes */}
          <Route path="/crews"      element={<AdminRoute element={<Crews />} />} />
          <Route path="/employees"  element={<AdminRoute element={<Employees />} />} />
          <Route path="/pnl"        element={<AdminRoute element={<DailyPnL />} />} />
          <Route path="/pay-stubs"  element={<AdminRoute element={<PayStubs />} />} />
          <Route path="/rate-cards" element={<AdminRoute element={<RateCards />} />} />
          <Route path="/equipment"  element={<AdminRoute element={<EquipmentPage />} />} />
          <Route path="/photos"     element={<AdminRoute element={<Photos />} />} />
          <Route path="/invoicing"  element={<AdminRoute element={<Invoicing />} />} />
          <Route path="/print-reader"            element={<AdminRoute element={<PrintReader />} />} />
          <Route path="/print-reader/:sessionId" element={<PrintReview />} />
          <Route path="/project-prints"          element={<ProjectPrints />} />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </ErrorBoundary>
    </Layout>
  )
}
