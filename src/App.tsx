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
import { RateCards } from './pages/RateCards'
import { Employees } from './pages/Employees'
import { EquipmentPage } from './pages/Equipment'
import { ExpensesPage } from './pages/Expenses'

export default function App() {
  const location = useLocation()
  return (
    <Layout>
      <ErrorBoundary key={location.pathname}>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectDetail />} />
        <Route path="/crews" element={<Crews />} />
        <Route path="/production" element={<Production />} />
        <Route path="/pnl" element={<DailyPnL />} />
        <Route path="/materials" element={<Materials />} />
        <Route path="/photos" element={<Photos />} />
        <Route path="/invoicing" element={<Invoicing />} />
        <Route path="/rate-cards" element={<RateCards />} />
        <Route path="/employees" element={<Employees />} />
        <Route path="/equipment" element={<EquipmentPage />} />
        <Route path="/expenses" element={<ExpensesPage />} />
        <Route path="/print-reader" element={<PrintReader />} />
        <Route path="/print-reader/:sessionId" element={<PrintReview />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </ErrorBoundary>
    </Layout>
  )
}
