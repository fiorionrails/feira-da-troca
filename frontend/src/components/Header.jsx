import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Wifi, WifiOff, LogOut, BarChart3, Clock, Sun, Moon } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'

export default function Header({
  role, // 'admin' | 'store' | 'analytics'
  isConnected = true,
  storeInfo = null, // { name: 'Loja X' }
  onLogout
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
          <div style={styles.timeWrapper}>
            <Clock size={16} color="var(--text-muted)" />
            <span style={styles.time}>
              {currentTime.toLocaleTimeString('pt-BR', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              })}
            </span>
          </div>

          {/* Status de Conexão WebSocket */}
          {(role === 'admin' || role === 'store') && (
            <div style={styles.statusWrapper}>
              {isConnected ? (
                <>
                  <div style={styles.statusDot} />
                  <Wifi size={18} color="var(--lime-primary)" />
                  <span style={styles.statusText}>Conectado</span>
                </>
              ) : (
                <>
                  <WifiOff size={18} color="var(--danger)" />
                  <span style={{ ...styles.statusText, color: 'var(--danger)' }}>
                    Desconectado
                  </span>
                </>
              )}
            </div>
          )}

          {/* Botão de Tema */}
          <button
            onClick={toggleTheme}
            style={styles.iconButton}
            title={theme === 'dark' ? 'Modo Claro' : 'Modo Escuro'}
          >
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>

          {/* Botão Analytics (apenas no Admin) */}
          {role === 'admin' && (
            <button
              onClick={() => window.open('/analytics', '_blank')}
              style={styles.iconButton}
              title="Abrir Analytics"
            >
              <BarChart3 size={20} />
            </button>
          )}

          {/* Botão Logout */}
          {role !== 'analytics' && (
            <button
              onClick={handleLogout}
              style={styles.logoutButton}
              title="Sair"
            >
              <LogOut size={18} />
              <span style={styles.logoutText}>Sair</span>
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
    gap: '16px',
  },
  timeWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    background: 'var(--element-bg)',
    borderRadius: '6px',
    border: '1px solid var(--border-lime)',
  },
  time: {
    fontSize: '0.85rem',
    fontWeight: 600,
    color: 'var(--text-muted)',
    fontVariantNumeric: 'tabular-nums',
  },
  statusWrapper: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 12px',
    background: 'var(--element-bg)',
    borderRadius: '6px',
    border: '1px solid var(--border-lime)',
    position: 'relative',
  },
  statusDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: 'var(--lime-primary)',
    boxShadow: '0 0 8px var(--lime-primary)',
    animation: 'pulse 2s ease-in-out infinite',
  },
  statusText: {
    fontSize: '0.85rem',
    fontWeight: 600,
    color: 'var(--lime-primary)',
  },
  iconButton: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '10px',
    background: 'var(--lime-glow)',
    border: '1px solid var(--border-lime)',
    borderRadius: '6px',
    color: 'var(--lime-primary)',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  },
  logoutButton: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px 16px',
    background: 'transparent',
    border: '1px solid var(--border-lime)',
    borderRadius: '6px',
    color: 'var(--lime-primary)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.9rem',
    fontWeight: 600,
    transition: 'all 0.2s ease',
  },
  logoutText: {
    '@media (max-width: 640px)': {
      display: 'none',
    },
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
      background: var(--lime-glow) !important;
      border-color: var(--lime-primary) !important;
      transform: translateY(-1px);
    }
    header button:active {
      transform: translateY(0);
    }
  `
  if (!document.querySelector('style[data-header-styles]')) {
    styleSheet.setAttribute('data-header-styles', 'true')
    document.head.appendChild(styleSheet)
  }
}
