import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'

const THEME_KEY = 'fiberlytic:theme'

interface ThemeCtxValue {
  isDark: boolean
  toggleTheme: () => void
}

const ThemeContext = createContext<ThemeCtxValue | null>(null)

function applyDark(dark: boolean) {
  document.documentElement.classList.toggle('dark', dark)
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
}

function getInitialDark(): boolean {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'dark') return true
  } catch { /* localStorage blocked */ }
  return false
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [isDark, setIsDark] = useState<boolean>(getInitialDark)

  // Apply on first mount (index.html script already handles the very first paint)
  useEffect(() => {
    applyDark(isDark)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleTheme = () => {
    const next = !isDark
    try { localStorage.setItem(THEME_KEY, next ? 'dark' : 'light') } catch { /* blocked */ }
    applyDark(next)   // synchronous DOM update — no waiting on useEffect
    setIsDark(next)
  }

  return (
    <ThemeContext.Provider value={{ isDark, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTheme() {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider')
  return ctx
}
