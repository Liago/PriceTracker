import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

export type ThemeChoice = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'

interface ThemeContextValue {
  choice: ThemeChoice
  resolved: ResolvedTheme
  setChoice: (choice: ThemeChoice) => void
  toggle: () => void
}

const STORAGE_KEY = 'theme'

const ThemeContext = createContext<ThemeContextValue | null>(null)

function readStoredChoice(): ThemeChoice {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Storage non disponibile (finestra privata): si segue il sistema.
  }
  return 'system'
}

function systemPrefersDark(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-color-scheme: dark)').matches
}

/**
 * Chiaro, scuro o "come il sistema".
 *
 * La scelta esplicita finisce in `data-theme` su <html>; con "sistema" il
 * l'attributo viene tolto e decide la media query nel CSS. `resolved` serve a
 * chi deve sapere il colore effettivo (il grafico, i toast).
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [choice, setChoiceState] = useState<ThemeChoice>(readStoredChoice)
  const [systemDark, setSystemDark] = useState<boolean>(systemPrefersDark)

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (event: MediaQueryListEvent) => setSystemDark(event.matches)
    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  useEffect(() => {
    const root = document.documentElement
    if (choice === 'system') root.removeAttribute('data-theme')
    else root.setAttribute('data-theme', choice)
    try {
      if (choice === 'system') localStorage.removeItem(STORAGE_KEY)
      else localStorage.setItem(STORAGE_KEY, choice)
    } catch {
      // Ignorato: la scelta vale comunque per questa sessione.
    }
  }, [choice])

  const resolved: ResolvedTheme = choice === 'system' ? (systemDark ? 'dark' : 'light') : choice

  const setChoice = useCallback((next: ThemeChoice) => setChoiceState(next), [])
  const toggle = useCallback(() => {
    setChoiceState(resolved === 'dark' ? 'light' : 'dark')
  }, [resolved])

  const value = useMemo(() => ({ choice, resolved, setChoice, toggle }), [choice, resolved, setChoice, toggle])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

// Hook esportato a parte per non disturbare il Fast Refresh.
// eslint-disable-next-line react-refresh/only-export-components
export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme va usato dentro <ThemeProvider>')
  return context
}
