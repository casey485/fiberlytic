import { createContext, useContext, useState, type ReactNode } from 'react'

export type AppRole = 'admin' | 'field'

const ROLE_KEY     = 'fiberlytic:role'
const EMPLOYEE_KEY = 'fiberlytic:activeEmployee'

interface RoleCtxValue {
  role: AppRole
  isAdmin: boolean
  setRole: (r: AppRole) => void
  activeEmployeeId: string | null
  setActiveEmployee: (id: string | null) => void
}

const RoleContext = createContext<RoleCtxValue | null>(null)

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<AppRole>(() => {
    const stored = localStorage.getItem(ROLE_KEY)
    return stored === 'field' ? 'field' : 'admin'
  })

  const [activeEmployeeId, setActiveEmployeeState] = useState<string | null>(() =>
    localStorage.getItem(EMPLOYEE_KEY),
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

  return (
    <RoleContext.Provider value={{ role, isAdmin: role === 'admin', setRole, activeEmployeeId, setActiveEmployee }}>
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
