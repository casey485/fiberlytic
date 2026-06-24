import { createContext, useContext, useState, type ReactNode } from 'react'

export type AppRole = 'admin' | 'field'

const ROLE_KEY = 'fiberlytic:role'

interface RoleCtxValue {
  role: AppRole
  isAdmin: boolean
  setRole: (r: AppRole) => void
}

const RoleContext = createContext<RoleCtxValue | null>(null)

export function RoleProvider({ children }: { children: ReactNode }) {
  const [role, setRoleState] = useState<AppRole>(() => {
    const stored = localStorage.getItem(ROLE_KEY)
    return stored === 'field' ? 'field' : 'admin'
  })

  const setRole = (r: AppRole) => {
    localStorage.setItem(ROLE_KEY, r)
    setRoleState(r)
  }

  return (
    <RoleContext.Provider value={{ role, isAdmin: role === 'admin', setRole }}>
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
