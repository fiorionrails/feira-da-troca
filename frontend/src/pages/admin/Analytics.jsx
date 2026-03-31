import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
  BarChart, Bar
} from 'recharts'
import { Activity, Users, Coins, TrendingUp, Store, Zap, ArrowLeft, ShoppingCart } from 'lucide-react'

const COLORS = ['#10b981', '#34d399', '#6ee7b7', '#a7f3d0', '#d1fae5', '#065f46', '#047857', '#059669']

function AnimatedNumber({ value, suffix = '' }) {
  const [display, setDisplay] = useState(0)
  const prev = useRef(0)

  useEffect(() => {
    const start = prev.current
    const end = value
    if (start === end) return
    const duration = 600
    const startTime = performance.now()

    const animate = (now) => {
      const elapsed = now - startTime
      const progress = Math.min(elapsed / duration, 1)
      const eased = 1 - Math.pow(1 - progress, 3)
      setDisplay(Math.round(start + (end - start) * eased))
      if (progress < 1) requestAnimationFrame(animate)
      else prev.current = end
    }
    requestAnimationFrame(animate)
  }, [value])

  return <>{display.toLocaleString('pt-BR')}{suffix}</>
}

const CustomTooltip = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: '#0f111a', border: '1px solid rgba(16,185,129,0.3)', borderRadius: '8px', padding: '12px 16px', boxShadow: '0 8px 24px rgba(0,0,0,0.6)' }}>
      <p style={{ color: '#94a3b8', fontSize: '0.8rem', marginBottom: '8px' }}>{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color, fontSize: '0.9rem', fontWeight: 600 }}>
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  )
}

export default function Analytics() {
  const navigate = useNavigate()
  const [data, setData] = useState(null)
  const [liveFeed, setLiveFeed] = useState([])
  const [flash, setFlash] = useState(null)
  const wsRef = useRef(null)
  const prevKpis = useRef(null)

  // Polling a cada 3s — sem reload, só setState
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch('http://localhost:8000/api/reports/analytics')
        if (res.ok) {
          const newData = await res.json()
          
          // Detectar mudanças nos KPIs pra flash
          if (prevKpis.current && data) {
            const changed = Object.keys(newData.kpis).find(k => newData.kpis[k] !== prevKpis.current[k])
            if (changed) {
              setFlash(changed)
              setTimeout(() => setFlash(null), 800)
            }
          }
          prevKpis.current = newData.kpis
          setData(newData)
        }
      } catch (e) { /* silencioso */ }
    }

    fetchData()
    const interval = setInterval(fetchData, 3000)
    return () => clearInterval(interval)
  }, [])

  // WebSocket público pra feed ao vivo (conecta como admin listener se possível, senão só poll)
  useEffect(() => {
    const token = sessionStorage.getItem('ouroboros_token')
    if (!token) return

    const connect = () => {
      wsRef.current = new WebSocket(`ws://localhost:8000/ws/admin?token=${token}`)
      wsRef.current.onmessage = (event) => {
        const msg = JSON.parse(event.data)
        if (msg.type === 'comanda_created' || msg.type === 'admin_balance_updated') {
          setLiveFeed(prev => [{ ...msg, _ts: new Date().toLocaleTimeString('pt-BR') }, ...prev].slice(0, 20))
        }
      }
      wsRef.current.onclose = (e) => {
        if (e.code !== 1008) setTimeout(connect, 3000)
      }
    }
    connect()
    return () => { if (wsRef.current) wsRef.current.close() }
  }, [])

  if (!data) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <Activity size={48} color="var(--accent-primary)" style={{ animation: 'fadeIn 1s infinite alternate' }} />
          <p style={{ marginTop: '16px', color: 'var(--text-muted)' }}>Carregando dados da feira...</p>
        </div>
      </div>
    )
  }

  const { kpis, transactions_per_minute, top_stores, category_distribution } = data

  const kpiCards = [
    { key: 'total_comandas', label: 'Comandas', value: kpis.total_comandas, icon: Users, suffix: '', color: '#10b981' },
    { key: 'total_emitido', label: 'Total Emitido', value: Math.floor(kpis.total_emitido / 100), icon: TrendingUp, suffix: ' ETC', color: '#34d399' },
    { key: 'total_gasto', label: 'Total Gasto', value: Math.floor(kpis.total_gasto / 100), icon: ShoppingCart, suffix: ' ETC', color: '#ef4444' },
    { key: 'total_circulante', label: 'Em Circulação', value: Math.floor(kpis.total_circulante / 100), icon: Coins, suffix: ' ETC', color: '#f59e0b' },
    { key: 'total_transacoes', label: 'Transações', value: kpis.total_transacoes, icon: Activity, suffix: '', color: '#8b5cf6' },
    { key: 'lojas_ativas', label: 'Lojas', value: kpis.lojas_ativas, icon: Store, suffix: '', color: '#06b6d4' },
  ]

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* Header */}
      <header className="glass-panel" style={{ borderRadius: 0, borderTop: 0, borderLeft: 0, borderRight: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 24px', background: 'rgba(16, 185, 129, 0.03)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <button onClick={() => navigate('/admin')} style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}>
            <ArrowLeft size={20} />
          </button>
          <Activity size={22} color="var(--accent-primary)" />
          <h2 style={{ margin: 0, fontSize: '1.1rem', color: 'var(--accent-primary)' }}>Analytics — Feira da Troca</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--success)', fontSize: '0.85rem' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', animation: 'fadeIn 1s infinite alternate' }} />
          Ao vivo · atualiza a cada 3s
        </div>
      </header>

      {/* Scrollable Content */}
      <main style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>

        {/* KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '16px' }}>
          {kpiCards.map(kpi => (
            <div
              key={kpi.key}
              className="glass-panel"
              style={{
                padding: '20px',
                textAlign: 'center',
                transition: 'all 0.3s ease',
                borderColor: flash === kpi.key ? kpi.color : undefined,
                boxShadow: flash === kpi.key ? `0 0 20px ${kpi.color}40` : undefined
              }}
            >
              <kpi.icon size={20} color={kpi.color} style={{ marginBottom: '8px' }} />
              <p style={{ color: 'var(--text-muted)', fontSize: '0.75rem', letterSpacing: '1px', marginBottom: '4px' }}>{kpi.label.toUpperCase()}</p>
              <h2 style={{ fontSize: '2rem', margin: 0, color: kpi.color }}>
                <AnimatedNumber value={kpi.value} suffix={kpi.suffix} />
              </h2>
            </div>
          ))}
        </div>

        {/* Row 2: Area Chart + Pie */}
        <div style={{ display: 'grid', gridTemplateColumns: '2.5fr 1fr', gap: '24px', minHeight: '320px' }}>

          {/* Area Chart */}
          <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <h3 style={{ fontSize: '0.95rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <TrendingUp size={18} color="var(--accent-primary)" /> Transações por Minuto
            </h3>
            <div style={{ flex: 1, minHeight: 0 }}>
              {transactions_per_minute.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={transactions_per_minute} margin={{ top: 5, right: 20, left: 0, bottom: 5 }}>
                    <defs>
                      <linearGradient id="gradCredits" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                      </linearGradient>
                      <linearGradient id="gradDebits" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.4} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" />
                    <XAxis dataKey="minute" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} />
                    <YAxis tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip />} />
                    <Area type="monotone" dataKey="credits" name="Créditos" stroke="#10b981" fill="url(#gradCredits)" strokeWidth={2} dot={false} />
                    <Area type="monotone" dataKey="debits" name="Débitos" stroke="#ef4444" fill="url(#gradDebits)" strokeWidth={2} dot={false} />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                  <p>Nenhuma transação nas últimas 2 horas.</p>
                </div>
              )}
            </div>
          </div>

          {/* Pie Chart */}
          <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <h3 style={{ fontSize: '0.95rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Coins size={18} color="var(--accent-primary)" /> Categorias
            </h3>
            <div style={{ flex: 1, minHeight: 0 }}>
              {category_distribution.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={category_distribution}
                      dataKey="count"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius="40%"
                      outerRadius="75%"
                      paddingAngle={3}
                      stroke="none"
                    >
                      {category_distribution.map((_, i) => (
                        <Cell key={i} fill={COLORS[i % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                  <p>Sem categorias.</p>
                </div>
              )}
            </div>
            {/* Legend */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '12px' }}>
              {category_distribution.slice(0, 6).map((cat, i) => (
                <span key={i} style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                  <div style={{ width: 8, height: 8, borderRadius: '2px', background: COLORS[i % COLORS.length] }} />
                  {cat.name}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Row 3: Bar Chart + Live Feed */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '24px', minHeight: '300px' }}>

          {/* Bar Chart — Top Lojas */}
          <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column' }}>
            <h3 style={{ fontSize: '0.95rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Store size={18} color="var(--accent-primary)" /> Ranking de Lojas
            </h3>
            <div style={{ flex: 1, minHeight: 0 }}>
              {top_stores.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={top_stores} layout="vertical" margin={{ top: 5, right: 20, left: 10, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" horizontal={false} />
                    <XAxis type="number" tick={{ fill: '#94a3b8', fontSize: 11 }} axisLine={{ stroke: 'rgba(255,255,255,0.1)' }} tickFormatter={v => `${Math.floor(v/100)}`} />
                    <YAxis type="category" dataKey="name" tick={{ fill: '#f8fafc', fontSize: 12 }} axisLine={false} width={120} />
                    <Tooltip content={<CustomTooltip />} formatter={(v) => [`${Math.floor(v/100)} ETC`, 'Fatur.']} />
                    <Bar dataKey="total" name="Faturamento" fill="#10b981" radius={[0, 6, 6, 0]} barSize={20} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>
                  <p>Nenhuma venda registrada ainda.</p>
                </div>
              )}
            </div>
          </div>

          {/* Live Feed */}
          <div className="glass-panel" style={{ padding: '24px', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <h3 style={{ fontSize: '0.95rem', marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' }}>
              <Zap size={18} color="var(--accent-primary)" /> Feed Ao Vivo
            </h3>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {liveFeed.map((evt, i) => (
                <div
                  key={i}
                  className={i === 0 ? 'animate-fade-in' : ''}
                  style={{
                    padding: '12px 16px',
                    background: 'rgba(0,0,0,0.2)',
                    borderLeft: `3px solid ${evt.type === 'comanda_created' ? 'var(--accent-primary)' : 'var(--danger)'}`,
                    borderRadius: '4px',
                    fontSize: '0.85rem'
                  }}
                >
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginRight: '8px' }}>{evt._ts}</span>
                  {evt.type === 'comanda_created'
                    ? <><strong style={{ color: 'var(--accent-primary)' }}>+{evt.code}</strong> — {evt.holder_name} ({evt.balance} ETC)</>
                    : <><strong style={{ color: 'var(--danger)' }}>-{Math.floor(evt.amount/100)} ETC</strong> — {evt.comanda_code} na {evt.store_name}</>
                  }
                </div>
              ))}
              {liveFeed.length === 0 && (
                <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                  <p>Aguardando eventos ao vivo...</p>
                </div>
              )}
            </div>
          </div>
        </div>

      </main>
    </div>
  )
}
