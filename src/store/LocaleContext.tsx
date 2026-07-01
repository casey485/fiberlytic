import { createContext, useContext, useState, type ReactNode } from 'react'
import i18n, { type LocaleCode } from '../i18n'

const LOCALE_KEY = 'fiberlytic:locale:v1'

interface LocaleCtxValue {
  locale: LocaleCode
  setLocale: (locale: LocaleCode) => void
}

const LocaleContext = createContext<LocaleCtxValue | null>(null)

function getInitialLocale(): LocaleCode {
  try {
    const stored = localStorage.getItem(LOCALE_KEY)
    if (stored === 'pt' || stored === 'es' || stored === 'en') return stored
  } catch { /* localStorage blocked */ }
  return 'en'
}

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<LocaleCode>(() => {
    const initial = getInitialLocale()
    i18n.changeLanguage(initial)
    return initial
  })

  const setLocale = (next: LocaleCode) => {
    try { localStorage.setItem(LOCALE_KEY, next) } catch { /* blocked */ }
    i18n.changeLanguage(next)
    setLocaleState(next)
  }

  return (
    <LocaleContext.Provider value={{ locale, setLocale }}>
      {children}
    </LocaleContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useLocale() {
  const ctx = useContext(LocaleContext)
  if (!ctx) throw new Error('useLocale must be used within a LocaleProvider')
  return ctx
}
