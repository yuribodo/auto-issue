import { BrowserRouter, Routes, Route } from 'react-router-dom'

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<div>Dashboard placeholder</div>} />
      </Routes>
    </BrowserRouter>
  )
}
