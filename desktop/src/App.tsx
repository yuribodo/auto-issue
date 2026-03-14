import { BrowserRouter, Routes, Route } from 'react-router-dom'
import Login from './pages/Login'
import Onboarding from './pages/Onboarding'
import Dashboard from './pages/Dashboard'
import RunDetail from './pages/RunDetail'
import CreateRun from './pages/CreateRun'
import History from './pages/History'
import Analytics from './pages/Analytics'
import Settings from './pages/Settings'
import Sidebar from './components/Sidebar'

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

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        {/* Auth routes - no sidebar */}
        <Route path="/" element={<Login />} />
        <Route path="/onboarding" element={<Onboarding />} />

        {/* App routes - with sidebar */}
        <Route path="/dashboard" element={<AppLayout><Dashboard /></AppLayout>} />
        <Route path="/run/:id" element={<AppLayout><RunDetail /></AppLayout>} />
        <Route path="/create-run" element={<AppLayout><CreateRun /></AppLayout>} />
        <Route path="/history" element={<AppLayout><History /></AppLayout>} />
        <Route path="/analytics" element={<AppLayout><Analytics /></AppLayout>} />
        <Route path="/settings" element={<AppLayout><Settings /></AppLayout>} />
      </Routes>
    </BrowserRouter>
  )
}
