import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wifi, WifiOff, LogOut, BarChart3, Clock, Sun, Moon, Store, Package, ClipboardList } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'

export default function Header({
  role, // 'admin' | 'store' | 'analytics'
  isConnected = true,
  storeInfo = null, // { name: 'Loja X' }
  onLogout,
  onManageStores = null,
}) {
  const navigate = useNavigate()
  const { theme, toggleTheme } = useTheme()
  const [currentTime, setCurrentTime] = useState(new Date())

  useEffect(() => {
    const timer = setInterval(() => setCurrentTime(new Date()), 1000)
    return () => clearInterval(timer)
  }, [])

  const handleLogout = () => {
    if (onLogout) onLogout()
    sessionStorage.removeItem('ouroboros_token')
    navigate('/')
  }

  const getRoleName = () => {
    if (role === 'admin') return 'Banco Central'
    if (role === 'store') return storeInfo?.name || 'Terminal Loja'
    if (role === 'analytics') return 'Analytics'
    return 'Ouroboros'
  }

  const getRoleColor = () => {
    if (role === 'admin') return 'var(--lime-primary)'
    if (role === 'store') return 'var(--lime-light)'
    return 'var(--text-muted)'
  }

  return (
    <header style={styles.header}>
      <div style={styles.container}>
        {/* Logo e Nome do Sistema */}
        <div style={styles.logoSection}>
          <div style={styles.logoWrapper}>
            <img
              src="/ouroboros.png"
              alt="Ouroboros"
              style={{
                width: '40px',
                height: '40px',
                filter: 'drop-shadow(0 0 8px var(--lime-glow))',
                animation: 'spin 20s linear infinite'
              }}
            />
          </div>
          <div style={styles.titleWrapper}>
            <h1 style={styles.title}>Ouroboros</h1>
            <span style={{ ...styles.roleTag, color: getRoleColor() }}>
              {getRoleName()}
            </span>
          </div>
        </div>

        {/* Seção de Status e Ações */}
        <div style={styles.rightSection}>

          {/* Relógio */}
          <div style={styles.chip}>
            <Clock size={16} />
            <span style={styles.chipText}>
              {currentTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>

          {/* Status WS */}
          {(role === 'admin' || role === 'store') && (
            <div
              style={{ ...styles.chip, color: isConnected ? 'var(--lime-primary)' : 'var(--danger)' }}
              title={isConnected ? 'Conectado' : 'Desconectado'}
            >
              {isConnected ? <Wifi size={16} /> : <WifiOff size={16} />}
            </div>
          )}

          {/* Tema */}
          <button onClick={toggleTheme} style={styles.chip} title={theme === 'dark' ? 'Modo Claro' : 'Modo Escuro'}>
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          </button>

          {/* Gerenciar Lojas (admin) */}
          {role === 'admin' && onManageStores && (
            <button onClick={onManageStores} style={styles.chip} title="Gerenciar Lojas">
              <Store size={16} />
            </button>
          )}

          {/* Analytics (admin) */}
          {role === 'admin' && (
            <button onClick={() => window.open('/analytics', '_blank')} style={styles.chip} title="Abrir Analytics">
              <BarChart3 size={16} />
            </button>
          )}

          {/* Distribuição de Caixas (admin) */}
          {role === 'admin' && (
            <button onClick={() => navigate('/admin/distribution')} style={styles.chip} title="Gerenciar Distribuição">
              <Package size={16} />
            </button>
          )}

          {/* Packing / Montagem (admin/voluntário logado) */}
          {role === 'admin' && (
            <button onClick={() => navigate('/packing')} style={styles.chip} title="Montagem de Caixas (Packing)">
              <ClipboardList size={16} />
            </button>
          )}

          {/* Logout */}
          {role !== 'analytics' && (
            <button onClick={handleLogout} style={styles.chip} title="Sair">
              <LogOut size={16} />
              <span style={styles.chipText} data-header-logout-text="">Sair</span>
            </button>
          )}

        </div>
      </div>
    </header>
  )
}

const styles = {
  header: {
    background: 'var(--bg-card)',
    borderBottom: '1px solid var(--border-lime)',
    boxShadow: '0 2px 12px rgba(0, 0, 0, 0.5)',
    position: 'sticky',
    top: 0,
    zIndex: 1000,
    backdropFilter: 'blur(10px)',
  },
  container: {
    maxWidth: '1600px',
    margin: '0 auto',
    padding: '16px 24px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '24px',
  },
  logoSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  logoWrapper: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleWrapper: {
    display: 'flex',
    flexDirection: 'column',
    gap: '2px',
  },
  title: {
    fontSize: '1.5rem',
    fontWeight: 700,
    color: 'var(--text-main)',
    margin: 0,
    letterSpacing: '-0.02em',
  },
  roleTag: {
    fontSize: '0.75rem',
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    opacity: 0.9,
  },
  rightSection: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  chip: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '8px 12px',
    background: 'var(--lime-glow)',
    border: '1px solid var(--border-lime)',
    borderRadius: '6px',
    color: 'var(--lime-primary)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.2s ease',
  },
  chipText: {
    fontSize: '0.85rem',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
}

// Adicionar keyframes CSS globalmente (será injetado via style tag)
if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style')
  styleSheet.textContent = `
    @keyframes pulse {
      0%, 100% {
        opacity: 1;
        transform: scale(1);
      }
      50% {
        opacity: 0.6;
        transform: scale(0.9);
      }
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    header button:hover {
      background: var(--border-lime) !important;
      border-color: var(--lime-primary) !important;
      transform: translateY(-1px);
    }
    header button:active {
      transform: translateY(0);
    }
    @media (max-width: 640px) {
      [data-header-logout-text] {
        display: none;
      }
    }
  `
  if (!document.querySelector('style[data-header-styles]')) {
    styleSheet.setAttribute('data-header-styles', 'true')
    document.head.appendChild(styleSheet)
  }
}
