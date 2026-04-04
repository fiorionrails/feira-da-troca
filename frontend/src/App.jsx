import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import Login from './pages/Login'
import StoreTerminal from './pages/store/Terminal'
import AdminDashboard from './pages/admin/Dashboard'
import Analytics from './pages/admin/Analytics'
import Distribution from './pages/admin/Distribution'
import Packing from './pages/packing/Packing'

function App() {
  return (
    <ThemeProvider>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Login />} />

          {/* Lojas rotas */}
          <Route path="/store" element={<StoreTerminal />} />

          {/* Painel Administrativo / Banco */}
          <Route path="/admin" element={<AdminDashboard />} />
          <Route path="/admin/distribution" element={<Distribution />} />

          {/* Montagem de Caixas (Voluntários) */}
          <Route path="/packing" element={<Packing />} />

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
