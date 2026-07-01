import {
  createContext, useContext, useEffect, useState, type ReactNode,
} from 'react'
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  setPersistence,
  browserLocalPersistence,
  browserSessionPersistence,
  type User,
} from 'firebase/auth'
import { auth, firebaseConfigured } from '../lib/firebase'

const SETUP_KEY = 'fiberlytic:auth:setup:v1'

export interface SetupRecord {
  done: boolean
  adminEmail: string
  adminUid: string
  createdAt: string
}

function loadSetup(): SetupRecord | null {
  try {
    const raw = localStorage.getItem(SETUP_KEY)
    return raw ? (JSON.parse(raw) as SetupRecord) : null
  } catch {
    return null
  }
}

export function markSetupDone(adminEmail: string, adminUid: string) {
  const record: SetupRecord = {
    done: true,
    adminEmail,
    adminUid,
    createdAt: new Date().toISOString(),
  }
  localStorage.setItem(SETUP_KEY, JSON.stringify(record))
}

interface AuthCtxValue {
  user: User | null
  loading: boolean
  setupDone: boolean
  firebaseReady: boolean
  login: (email: string, password: string, remember: boolean) => Promise<void>
  logout: () => Promise<void>
  sendReset: (email: string) => Promise<void>
}

const AuthContext = createContext<AuthCtxValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser]       = useState<User | null>(null)
  const [loading, setLoading] = useState(true)
  const setup = loadSetup()
  const setupDone = !!setup?.done

  useEffect(() => {
    if (!auth) { setLoading(false); return }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
    })
    return unsub
  }, [])

  const login = async (email: string, password: string, remember: boolean) => {
    if (!auth) throw new Error('Firebase not configured. Add credentials to .env.local.')
    await setPersistence(auth, remember ? browserLocalPersistence : browserSessionPersistence)
    await signInWithEmailAndPassword(auth, email, password)
  }

  const logout = async () => {
    if (!auth) return
    await signOut(auth)
  }

  const sendReset = async (email: string) => {
    if (!auth) throw new Error('Firebase not configured.')
    await sendPasswordResetEmail(auth, email)
  }

  return (
    <AuthContext.Provider value={{
      user, loading, setupDone,
      firebaseReady: firebaseConfigured,
      login, logout, sendReset,
    }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
