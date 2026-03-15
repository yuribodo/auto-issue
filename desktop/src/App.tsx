import { createContext, useContext, useState, useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom'
import { getMe } from './lib/ipc'
import type { User } from './lib/types'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import RunDetail from './pages/RunDetail'
import CreateRun from './pages/CreateRun'
import History from './pages/History'
import Analytics from './pages/Analytics'
import Settings from './pages/Settings'
import Sidebar from './components/Sidebar'

interface AuthContextValue {
  user: User | null
  setUser: (user: User | null) => void
  loading: boolean
}

export const AuthContext = createContext<AuthContextValue>({
  user: null,
  setUser: () => {},
  loading: true,
})

export function useAuth() {
  return useContext(AuthContext)
}

function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>
      <Sidebar />
      <div style={{ flex: 1, minWidth: 0, overflow: 'hidden' }}>
        {children}
      </div>
    </div>
  )
}

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg)', fontFamily: 'var(--font-mono)', fontSize: '13px', color: 'var(--fg-muted)' }}>
        Loading...
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/" replace />
  }

  return <>{children}</>
}

function AuthRouter() {
  const { setUser } = useAuth()
  const navigate = useNavigate()

  useEffect(() => {
    const unsub = window.electronAPI.on('auth:success', (...args: unknown[]) => {
      const user = args[0] as User
      setUser(user)
      navigate('/dashboard')
    })
    return unsub
  }, [navigate, setUser])

  return (
    <Routes>
      {/* Auth routes - no sidebar */}
      <Route path="/" element={<Login />} />
      <Route path="/onboarding" element={<ProtectedRoute><Onboarding /></ProtectedRoute>} />

      {/* App routes - with sidebar */}
      <Route path="/dashboard" element={<ProtectedRoute><AppLayout><Dashboard /></AppLayout></ProtectedRoute>} />
      <Route path="/run/:id" element={<ProtectedRoute><AppLayout><RunDetail /></AppLayout></ProtectedRoute>} />
      <Route path="/create-run" element={<ProtectedRoute><AppLayout><CreateRun /></AppLayout></ProtectedRoute>} />
      <Route path="/history" element={<ProtectedRoute><AppLayout><History /></AppLayout></ProtectedRoute>} />
      <Route path="/analytics" element={<ProtectedRoute><AppLayout><Analytics /></AppLayout></ProtectedRoute>} />
      <Route path="/settings" element={<ProtectedRoute><AppLayout><Settings /></AppLayout></ProtectedRoute>} />
    </Routes>
  )
}

export function App() {
  const [user, setUser] = useState<User | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    getMe().then((u) => {
      setUser(u)
      setLoading(false)
    }).catch(() => {
      setLoading(false)
    })
  }, [])

  return (
    <AuthContext.Provider value={{ user, setUser, loading }}>
      <HashRouter>
        <AuthRouter />
      </HashRouter>
    </AuthContext.Provider>
  )
}
