import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import StoreTerminal from './pages/store/Terminal'
import AdminDashboard from './pages/admin/Dashboard'
import Analytics from './pages/admin/Analytics'

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Login />} />
        
        {/* Lojas rotas */}
        <Route path="/store" element={<StoreTerminal />} />
        
        {/* Painel Administrativo / Banco */}
        <Route path="/admin" element={<AdminDashboard />} />
        
        {/* Dashboard Analítico (público — telão) */}
        <Route path="/analytics" element={<Analytics />} />
        
        {/* 404 Fallback */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
