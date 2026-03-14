import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/login" replace />} />
      <Route path="/login" element={<Login />} />
      <Route path="/dashboard" element={<div>Dashboard</div>} />
      <Route path="/runs/:id" element={<div>RunDetail</div>} />
    </Routes>
  )
}
