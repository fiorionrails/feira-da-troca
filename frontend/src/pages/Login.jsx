import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Store, TerminalSquare } from 'lucide-react'

const STORE_TOKEN_REGEX = /^[A-Z0-9]{6}$/

export default function Login() {
  const navigate = useNavigate()
  const [token, setToken] = useState('')
  const [role, setRole] = useState('store') // 'store' | 'admin'
  const [error, setError] = useState('')

  const handleLogin = (e) => {
    e.preventDefault()
    if (!token.trim()) return

    if (role === 'store' && !STORE_TOKEN_REGEX.test(token)) {
      setError('Token de loja inválido. Deve ter exatamente 6 caracteres alfanuméricos (ex: XJ92KF).')
      return
    }

    setError('')
    sessionStorage.setItem('ouroboros_token', token)
    if (role === 'admin') navigate('/admin')
    else navigate('/store')
  }

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <form onSubmit={handleLogin} className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '400px', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
          <img
            src="/ouroboros.png"
            alt="Ouroboros"
            style={{
              width: '80px',
              height: '80px',
              filter: 'drop-shadow(0 0 12px var(--lime-glow))',
              animation: 'spin 20s linear infinite'
            }}
          />
        </div>
        <h2 style={{ marginBottom: '8px', color: 'var(--text-main)' }}>Ouroboros</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '32px', fontSize: '0.9rem' }}>
          Economia Circular Sustentável
        </p>

        <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
          <button 
            type="button"
            className={`btn ${role === 'store' ? '' : 'btn-outline'}`}
            style={{ flex: 1 }}
            onClick={() => setRole('store')}
          >
            <Store size={18} /> Loja
          </button>
          <button 
            type="button" 
            className={`btn ${role === 'admin' ? '' : 'btn-outline'}`}
            style={{ flex: 1 }}
            onClick={() => setRole('admin')}
          >
            <TerminalSquare size={18} /> Banco
          </button>
        </div>

        <div style={{ textAlign: 'left', marginBottom: '24px' }}>
          <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            CHAVE DE ACESSO ({role.toUpperCase()})
          </label>
          <input 
            type={role === 'admin' ? 'password' : 'text'} 
            className="input-premium"
            placeholder={role === 'admin' ? 'Digite a senha do mestre...' : 'Ex: XJ92KF'}
            value={token}
            onChange={(e) => { setError(''); setToken(role === 'admin' ? e.target.value : e.target.value.toUpperCase()) }}
            required
            autoFocus
          />
          {error && <p style={{ marginTop: '8px', fontSize: '0.82rem', color: 'var(--danger)' }}>{error}</p>}
        </div>

        <button type="submit" className="btn btn-success" style={{ width: '100%', padding: '16px' }}>
          ENTRAR NO TERMINAL
        </button>
      </form>
    </div>
  )
}
