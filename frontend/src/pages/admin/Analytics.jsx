import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
  BarChart, Bar
} from 'recharts'
import { Activity, Users, Coins, TrendingUp, Store, ShoppingCart, Zap } from 'lucide-react'
import { BACKEND_HTTP, BACKEND_WS } from '../../config'
import Layout from '../../components/Layout'
import { useTheme } from '../../context/ThemeContext'

const COLORS = ['#349754', '#42b368', '#56c67c', '#6bd890', '#7feba4', '#2a7a43', '#226535', '#1a5027']

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

const CustomTooltip = ({ active, payload, label, dark }) => {
  if (!active || !payload?.length) return null
  return (
    <div style={{
      background: dark ? '#0a0a0a' : '#ffffff',
      border: '1px solid var(--border-lime)',
      borderRadius: '8px',
      padding: '12px 16px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.15)'
    }}>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '8px' }}>{label}</p>
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
  const { theme } = useTheme()
  const dark = theme === 'dark'

  // Cores adaptativas para os charts do Recharts (não suportam CSS vars diretamente)
  const chartColors = {
    text:       dark ? '#94a3b8' : '#475569',
    textStrong: dark ? '#f1f5f9' : '#1e293b',
    grid:       dark ? 'rgba(255,255,255,0.06)' : 'rgba(0,0,0,0.08)',
    axis:       dark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.15)',
  }

  const [data, setData] = useState(null)
  const [liveFeed, setLiveFeed] = useState([])
  const [flash, setFlash] = useState(null)
  const wsRef = useRef(null)
  const prevKpis = useRef(null)

  // Polling a cada 3s — sem reload, só setState
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await fetch(`${BACKEND_HTTP}/api/reports/analytics`)
        if (res.ok) {
          const newData = await res.json()

          // Detectar mudanças nos KPIs pra flash; prevKpis.current serve como guard de "primeiro load"
          if (prevKpis.current) {
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
      wsRef.current = new WebSocket(`${BACKEND_WS}/ws/admin?token=${token}`)
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
      <Layout role="analytics" isConnected={true}>
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div style={{ textAlign: 'center' }}>
            <Activity size={48} color="var(--lime-primary)" style={{ animation: 'fadeIn 1s infinite alternate' }} />
            <p style={{ marginTop: '16px', color: 'var(--text-muted)' }}>Carregando dados da feira...</p>
          </div>
        </div>
      </Layout>
    )
  }

  const { kpis, transactions_per_minute, top_stores, category_distribution } = data

  const kpiCards = [
    { key: 'total_comandas', label: 'Comandas', value: kpis.total_comandas, icon: Users, suffix: '', color: '#349754' },
    { key: 'total_emitido', label: 'Total Emitido', value: kpis.total_emitido, icon: TrendingUp, suffix: ' ETC', color: '#42b368' },
    { key: 'total_gasto', label: 'Total Gasto', value: kpis.total_gasto, icon: ShoppingCart, suffix: ' ETC', color: '#ef4444' },
    { key: 'total_circulante', label: 'Em Circulação', value: kpis.total_circulante, icon: Coins, suffix: ' ETC', color: '#f59e0b' },
    { key: 'total_transacoes', label: 'Transações', value: kpis.total_transacoes, icon: Activity, suffix: '', color: '#56c67c' },
    { key: 'lojas_ativas', label: 'Lojas', value: kpis.lojas_ativas, icon: Store, suffix: '', color: '#6bd890' },
  ]

  return (
    <Layout role="analytics" isConnected={true}>
      {/* Info Bar */}
      <div style={{ padding: '12px 24px', background: 'rgba(52, 151, 84, 0.05)', borderBottom: '1px solid var(--border-lime)', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '8px' }}>
        <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--lime-primary)', animation: 'fadeIn 1s infinite alternate' }} />
        <span style={{ color: 'var(--lime-primary)', fontSize: '0.85rem', fontWeight: 600 }}>Ao vivo · atualiza a cada 3s</span>
      </div>

      {/* Scrollable Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px', display: 'flex', flexDirection: 'column', gap: '24px' }}>

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
                    <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} />
                    <XAxis dataKey="minute" tick={{ fill: chartColors.text, fontSize: 11 }} axisLine={{ stroke: chartColors.axis }} />
                    <YAxis tick={{ fill: chartColors.text, fontSize: 11 }} axisLine={{ stroke: chartColors.axis }} allowDecimals={false} />
                    <Tooltip content={<CustomTooltip dark={dark} />} />
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
                    <CartesianGrid strokeDasharray="3 3" stroke={chartColors.grid} horizontal={false} />
                    <XAxis type="number" tick={{ fill: chartColors.text, fontSize: 11 }} axisLine={{ stroke: chartColors.axis }} tickFormatter={v => `${v}`} />
                    <YAxis type="category" dataKey="name" tick={{ fill: chartColors.textStrong, fontSize: 12, fontWeight: 600 }} axisLine={false} width={120} />
                    <Tooltip content={<CustomTooltip dark={dark} />} formatter={(v) => [`${v} ETC`, 'Fatur.']} />
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
                    background: 'var(--element-bg)',
                    borderLeft: `3px solid ${evt.type === 'comanda_created' ? 'var(--accent-primary)' : 'var(--danger)'}`,
                    borderRadius: '4px',
                    fontSize: '0.85rem'
                  }}
                >
                  <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginRight: '8px' }}>{evt._ts}</span>
                  {evt.type === 'comanda_created'
                    ? <><strong style={{ color: 'var(--accent-primary)' }}>+{evt.code}</strong> — {evt.holder_name} ({evt.balance} ETC)</>
                    : <><strong style={{ color: 'var(--danger)' }}>-{evt.amount} ETC</strong> — {evt.comanda_code} na {evt.store_name}</>
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

      </div>
    </Layout>
  )
}
