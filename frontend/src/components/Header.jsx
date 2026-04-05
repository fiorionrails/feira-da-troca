import { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { Wifi, WifiOff, LogOut, BarChart3, Clock, Sun, Moon, Store, Package, ClipboardList, TerminalSquare } from 'lucide-react'
import { useTheme } from '../context/ThemeContext'

const ADMIN_NAV = [
  { path: '/admin',               icon: TerminalSquare, label: 'Banco'        },
  { path: '/admin/distribution',  icon: Package,        label: 'Distribuição' },
  { path: '/packing',             icon: ClipboardList,  label: 'Packing'      },
  { path: '/analytics',           icon: BarChart3,      label: 'Analytics'    },
]

const STORE_NAV = [
  { path: '/store', icon: Store, label: 'Terminal' },
]

export default function Header({
  role,
  isConnected = true,
  storeInfo = null,
  onLogout,
  onManageStores = null,
}) {
  const navigate = useNavigate()
  const location = useLocation()
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

  const navItems = role === 'admin' ? ADMIN_NAV : role === 'store' ? STORE_NAV : []

  return (
    <header style={styles.header}>
      <div style={styles.container}>

        {/* Logo */}
        <div style={styles.logoSection}>
          <img
            src="/ouroboros.png"
            alt="Ouroboros"
            style={{ width: 36, height: 36, filter: 'drop-shadow(0 0 8px var(--lime-glow))', animation: 'spin 20s linear infinite' }}
          />
          <h1 style={styles.title}>Ouroboros</h1>
        </div>

        {/* Navegação central */}
        {navItems.length > 0 && (
          <nav style={styles.nav}>
            {navItems.map(({ path, icon: Icon, label }) => {
              const active = location.pathname === path
              return (
                <button
                  key={path}
                  onClick={() => navigate(path)}
                  style={{ ...styles.navBtn, ...(active ? styles.navBtnActive : {}) }}
                  title={label}
                >
                  <Icon size={15} />
                  <span style={styles.navLabel}>{label}</span>
                </button>
              )
            })}
          </nav>
        )}

        {/* Ações à direita */}
        <div style={styles.rightSection}>

          {/* Relógio */}
          <div style={styles.chip}>
            <Clock size={15} />
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
              {isConnected ? <Wifi size={15} /> : <WifiOff size={15} />}
            </div>
          )}

          {/* Gerenciar Lojas */}
          {role === 'admin' && onManageStores && (
            <button onClick={onManageStores} style={styles.chip} title="Gerenciar Lojas">
              <Store size={15} />
            </button>
          )}

          {/* Tema */}
          <button onClick={toggleTheme} style={styles.chip} title={theme === 'dark' ? 'Modo Claro' : 'Modo Escuro'}>
            {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
          </button>

          {/* Logout */}
          {role !== 'analytics' && (
            <button onClick={handleLogout} style={styles.chip} title="Sair">
              <LogOut size={15} />
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
    boxShadow: '0 2px 12px rgba(0,0,0,0.5)',
    position: 'sticky',
    top: 0,
    zIndex: 1000,
    backdropFilter: 'blur(10px)',
  },
  container: {
    maxWidth: '1600px',
    margin: '0 auto',
    padding: '0 24px',
    height: 60,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 16,
  },
  logoSection: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flexShrink: 0,
  },
  title: {
    fontSize: '1.1rem',
    fontWeight: 700,
    color: 'var(--text-main)',
    margin: 0,
    letterSpacing: '-0.02em',
  },
  nav: {
    display: 'flex',
    alignItems: 'stretch',
    alignSelf: 'stretch',
    gap: 4,
  },
  navBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: '0 14px',
    background: 'transparent',
    border: '1px solid transparent',
    borderRadius: 6,
    color: 'var(--text-muted)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '0.85rem',
    fontWeight: 500,
    transition: 'all 0.15s ease',
  },
  navBtnActive: {
    background: 'var(--lime-glow)',
    border: '1px solid var(--border-lime)',
    color: 'var(--lime-primary)',
  },
  navLabel: {
    fontSize: '0.85rem',
    fontWeight: 600,
  },
  rightSection: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexShrink: 0,
  },
  chip: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 12px',
    background: 'var(--lime-glow)',
    border: '1px solid var(--border-lime)',
    borderRadius: 6,
    color: 'var(--lime-primary)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'all 0.15s ease',
  },
  chipText: {
    fontSize: '0.85rem',
    fontWeight: 600,
    fontVariantNumeric: 'tabular-nums',
  },
}

if (typeof document !== 'undefined') {
  const styleSheet = document.createElement('style')
  styleSheet.textContent = `
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    header button:hover {
      background: var(--border-lime) !important;
      border-color: var(--lime-primary) !important;
      color: var(--lime-primary) !important;
      transform: translateY(-1px);
    }
    header button:active { transform: translateY(0); }
    @media (max-width: 768px) {
      [data-header-logout-text] { display: none; }
    }
    @media (max-width: 600px) {
      header nav span { display: none; }
    }
  `
  if (!document.querySelector('style[data-header-styles]')) {
    styleSheet.setAttribute('data-header-styles', 'true')
    document.head.appendChild(styleSheet)
  }
}
