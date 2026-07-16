import { createContext, useContext, useState, type ReactNode } from 'react'

// 'subcontractor' is a device-wide UI simulation for test-phase workflow
// validation only — same trust model as 'field' (anyone holding the device
// can flip it), not real per-company security. That's intentional: the real
// multi-tenant backend (see supabase/migrations/) is a separate, larger
// migration, deferred until this workflow is validated. Do not treat this
// role as a security boundary anywhere in the app.
export type AppRole = 'admin' | 'field' | 'subcontractor' | 'supervisor'

const ROLE_KEY           = 'fiberlytic:role'
const EMPLOYEE_KEY       = 'fiberlytic:activeEmployee'
const SUBCONTRACTOR_KEY  = 'fiberlytic:activeSubcontractor'
const SUPERVISOR_KEY     = 'fiberlytic:activeSupervisorEmployee'

interface RoleCtxValue {
  role: AppRole
  isAdmin: boolean
  setRole: (r: AppRole) => void
  activeEmployeeId: string | null
  setActiveEmployee: (id: string | null) => void
  activeSubcontractorId: string | null
  setActiveSubcontractor: (id: string | null) => void
  // Deliberately separate from activeEmployeeId even though a supervisor is
  // also an Employee record — sharing one id meant switching from In-House
  // view (where you'd picked, say, yourself as a crew member) straight to
  // Supervisor view silently carried that same identity over instead of
  // asking again, landing on a stranger's empty dashboard with no obvious
  // explanation. Each role now always asks "who are you" for itself.
  activeSupervisorEmployeeId: string | null
  setActiveSupervisorEmployee: (id: string | null) => void
}

const RoleContext = createContext<RoleCtxValue | null>(null)

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<AppRole>(() => {
    const stored = localStorage.getItem(ROLE_KEY)
    return stored === 'field' || stored === 'subcontractor' || stored === 'supervisor' ? stored : 'admin'
  })

  const [activeEmployeeId, setActiveEmployeeState] = useState<string | null>(() =>
    localStorage.getItem(EMPLOYEE_KEY),
  )

  const [activeSubcontractorId, setActiveSubcontractorState] = useState<string | null>(() =>
    localStorage.getItem(SUBCONTRACTOR_KEY),
  )

  const [activeSupervisorEmployeeId, setActiveSupervisorEmployeeState] = useState<string | null>(() =>
    localStorage.getItem(SUPERVISOR_KEY),
  )

  const setRole = (r: AppRole) => {
    localStorage.setItem(ROLE_KEY, r)
    setRoleState(r)
  }

  const setActiveEmployee = (id: string | null) => {
    if (id) localStorage.setItem(EMPLOYEE_KEY, id)
    else localStorage.removeItem(EMPLOYEE_KEY)
    setActiveEmployeeState(id)
  }

  const setActiveSubcontractor = (id: string | null) => {
    if (id) localStorage.setItem(SUBCONTRACTOR_KEY, id)
    else localStorage.removeItem(SUBCONTRACTOR_KEY)
    setActiveSubcontractorState(id)
  }

  const setActiveSupervisorEmployee = (id: string | null) => {
    if (id) localStorage.setItem(SUPERVISOR_KEY, id)
    else localStorage.removeItem(SUPERVISOR_KEY)
    setActiveSupervisorEmployeeState(id)
  }

  return (
    <RoleContext.Provider
      value={{
        role, isAdmin: role === 'admin', setRole,
        activeEmployeeId, setActiveEmployee,
        activeSubcontractorId, setActiveSubcontractor,
        activeSupervisorEmployeeId, setActiveSupervisorEmployee,
      }}
    >
      {children}
    </RoleContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useRole() {
  const ctx = useContext(RoleContext)
  if (!ctx) throw new Error('useRole must be used within a RoleProvider')
  return ctx
}
