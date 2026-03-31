import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Rocket, Store, TerminalSquare } from 'lucide-react'

export default function Login() {
  const navigate = useNavigate()
  const [token, setToken] = useState('')
  const [role, setRole] = useState('store') // 'store' | 'admin'

  const handleLogin = (e) => {
    e.preventDefault()
    if (!token.trim()) return

    // Salvamos na sessão e roteamos para a tela correta (onde o WS vai tentar logar)
    sessionStorage.setItem('ouroboros_token', token)
    if (role === 'admin') navigate('/admin')
    else navigate('/store')
  }

  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
      <form onSubmit={handleLogin} className="glass-panel animate-fade-in" style={{ width: '100%', maxWidth: '400px', textAlign: 'center' }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '20px' }}>
          <Rocket size={48} color="var(--accent-primary)" style={{ filter: 'drop-shadow(0 0 10px var(--accent-glow))' }}/>
        </div>
        <h2 style={{ marginBottom: '8px' }}>Ouroboros Ledger</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '32px', fontSize: '0.9rem' }}>
          Sistema de Transações Locais
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
            onChange={(e) => setToken(role === 'admin' ? e.target.value : e.target.value.toUpperCase())}
            required
            autoFocus
          />
        </div>

        <button type="submit" className="btn btn-success" style={{ width: '100%', padding: '16px' }}>
          ENTRAR NO TERMINAL
        </button>
      </form>
    </div>
  )
}
