import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { AuthResponse, AuthTokenResponsePassword, SignUpWithPasswordCredentials, User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'

interface Credentials {
  email: string
  password: string
}

interface AuthContextValue {
  user: User | null
  signUp: (data: SignUpWithPasswordCredentials) => Promise<AuthResponse>
  signIn: (data: Credentials) => Promise<AuthTokenResponsePassword>
  signOut: () => Promise<{ error: Error | null }>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check active sessions and sets the user
    supabase.auth.getSession()
      .then(({ data: { session } }) => {
        setUser(session?.user ?? null)
        setLoading(false)
      })
      .catch((error: unknown) => {
        console.error('Error getting session:', error)
        setUser(null)
        setLoading(false)
      })

    // Listen for changes on auth state (logged in, signed out, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      setLoading(false)
    })

    return () => subscription.unsubscribe()
  }, [])

  const value: AuthContextValue = {
    signUp: (data) => supabase.auth.signUp(data),
    signIn: (data) => supabase.auth.signInWithPassword(data),
    signOut: () => supabase.auth.signOut(),
    user,
  }

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  )
}

// Export hook separately to avoid Fast Refresh issues
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) throw new Error('useAuth va usato dentro <AuthProvider>')
  return context
}
