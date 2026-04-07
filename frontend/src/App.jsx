import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import Login from './pages/Login'
import StoreTerminal from './pages/store/Terminal'
import AdminDashboard from './pages/admin/Dashboard'
import Analytics from './pages/admin/Analytics'
import Distribution from './pages/admin/Distribution'
import Packing from './pages/packing/Packing'

function ProtectedRoute({ children }) {
  const token = sessionStorage.getItem('ouroboros_token')
  if (!token) return <Navigate to="/" replace />
  return children
}

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Login />} />

          {/* Lojas rotas */}
          <Route path="/store" element={<ProtectedRoute><StoreTerminal /></ProtectedRoute>} />

          {/* Painel Administrativo / Banco */}
          <Route path="/admin" element={<ProtectedRoute><AdminDashboard /></ProtectedRoute>} />
          <Route path="/admin/distribution" element={<ProtectedRoute><Distribution /></ProtectedRoute>} />

          {/* Montagem de Caixas (Voluntários) */}
          <Route path="/packing" element={<ProtectedRoute><Packing /></ProtectedRoute>} />

          {/* Dashboard Analítico (público — telão) */}
          <Route path="/analytics" element={<Analytics />} />

          {/* 404 Fallback */}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </ThemeProvider>
  )
}

export default App
