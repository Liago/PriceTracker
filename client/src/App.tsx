import { lazy, Suspense } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MotionConfig } from 'motion/react'
import { Toaster } from 'sonner'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider, useTheme } from './context/ThemeContext'
import Login from './pages/Login'
import Dashboard from './pages/Dashboard'
import Settings from './pages/Settings'
import Notifications from './pages/Notifications'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'

// Il dettaglio porta con sé Recharts: si scarica solo quando serve.
const ProductDetail = lazy(() => import('./pages/ProductDetail'))

const queryClient = new QueryClient()

/**
 * Un solo Toaster per tutta l'app: prima ce n'erano due (qui e nel Layout) e
 * ogni toast compariva due volte. Segue il tema scelto.
 */
function ThemedToaster() {
  const { resolved } = useTheme()
  return (
    <Toaster
      position="bottom-right"
      theme={resolved}
      richColors
      toastOptions={{ style: { fontFamily: 'var(--sans)', borderRadius: 14 } }}
    />
  )
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        {/* "user": chi chiede meno movimento ottiene solo dissolvenze. */}
        <MotionConfig reducedMotion="user">
          <AuthProvider>
            <ThemedToaster />
            <BrowserRouter>
              <Routes>
                <Route path="/login" element={<Login />} />

                <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
                  <Route path="/" element={<Dashboard />} />
                  <Route path="/product/:id" element={<Suspense fallback={null}><ProductDetail /></Suspense>} />
                  <Route path="/settings" element={<Settings />} />
                  <Route path="/notifications" element={<Notifications />} />
                </Route>

                {/* Fallback for unmatched routes, redirects to home if authenticated, or login if not */}
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </BrowserRouter>
          </AuthProvider>
        </MotionConfig>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

export default App
