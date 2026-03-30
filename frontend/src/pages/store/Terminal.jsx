import { useState, useEffect } from 'react'
import { Wifi, WifiOff, CreditCard, Search, ArrowRight, LogOut, Store } from 'lucide-react'
import { useStoreWebSocket, playSound } from '../../hooks/useStoreWebSocket'
import { useNavigate } from 'react-router-dom'

export default function Terminal() {
  const navigate = useNavigate()
  const { isConnected, storeInfo, lastQueryData, lastDebitResult, queryBalance, requestDebit, clearQuery, clearSearch } = useStoreWebSocket()
  
  const [code, setCode] = useState('')
  const [amountInput, setAmountInput] = useState('')

  // Efeito p/ tocar som e mostrar tela de sucesso/falha
  useEffect(() => {
    if (lastDebitResult) {
      if (lastDebitResult.success) playSound('success')
      else playSound('error')
    }
  }, [lastDebitResult])

  const handleSearch = (e) => {
    e.preventDefault()
    if (code.trim()) {
        queryBalance(code.trim())
        setAmountInput('') // reseta o input debito ao buscar nova comanda
    }
  }

  const handleDebit = (e) => {
      e.preventDefault()
      if (amountInput && code) {
          requestDebit(code.trim(), amountInput)
      }
  }

  const handleAmountChange = (e) => {
      setAmountInput(e.target.value)
      if (lastDebitResult) clearQuery() // Limpa erros amarelos anteriores ao digitar novo valor (mas nao limpa a comanda)
  }

  const handleCodeChange = (e) => {
      setCode(e.target.value.toUpperCase())
      if (lastQueryData) clearSearch() // Limpa a tela inteira quando começa a buscar nova pessoa
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      
      {/* Header Premium */}
      <header className="glass-panel" style={{ borderRadius: 0, borderTop: 0, borderLeft: 0, borderRight: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div style={{ padding: '8px', background: 'var(--accent-primary)', borderRadius: '8px' }}>
                <Store size={20} color="white" />
            </div>
            <h2 style={{ margin: 0, fontSize: '1.2rem' }}>{storeInfo?.name || "Carregando..."}</h2>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: isConnected ? 'var(--success)' : 'var(--danger)', fontWeight: '600' }}>
                {isConnected ? <><Wifi size={18}/> Online</> : <><WifiOff size={18}/> Offline</>}
            </div>
            <button 
                onClick={() => { sessionStorage.removeItem('ouroboros_token'); navigate('/'); }} 
                className="btn btn-outline" 
                style={{ padding: '6px 12px', fontSize: '0.8rem', gap: '4px', borderColor: 'var(--danger)', color: 'var(--danger)' }}
                title="Sair do Terminal"
            >
                <LogOut size={16} /> Sair
            </button>
        </div>
      </header>

      {/* Main Terminal Area */}
      <main style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' }}>
         <div style={{ width: '100%', maxWidth: '600px', display: 'flex', flexDirection: 'column', gap: '24px' }}>
            
            {/* Bloco 1: Busca Central Ouroboros Fxxx */}
            <form onSubmit={handleSearch} className="glass-panel" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '32px' }}>
                <h3 style={{ margin: 0, color: 'var(--text-muted)' }}>CÓDIGO DA COMANDA</h3>
                
                <div style={{ display: 'flex', gap: '12px', width: '100%', maxWidth: '400px' }}>
                    <input 
                        type="text" 
                        value={code}
                        onChange={handleCodeChange}
                        placeholder="Ex: F001"
                        className="input-premium"
                        style={{ fontSize: '2rem', textAlign: 'center', textTransform: 'uppercase', letterSpacing: '4px' }}
                        autoFocus
                    />
                    <button type="submit" className="btn btn-outline" style={{ padding: '0 24px' }}>
                        <Search size={24}/>
                    </button>
                </div>
            </form>

            {/* Bloco 2: Resultado e Debito Rápido */}
            {lastQueryData && !lastQueryData.error && (
                <div className="glass-panel animate-fade-in" style={{ padding: '32px' }}>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '32px' }}>
                        <div>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '4px' }}>TÍTULAR DA CONTA</p>
                            <h2 style={{ fontSize: '1.8rem', margin: 0 }}>{lastQueryData.holder_name}</h2>
                            <span style={{ background: 'rgba(255,255,255,0.1)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', letterSpacing: '2px' }}>{code}</span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '4px' }}>SALDO DISPONÍVEL</p>
                            <h2 style={{ fontSize: '2.5rem', margin: 0, color: 'var(--success)' }}>
                                {lastQueryData.balance} ETC
                            </h2>
                        </div>
                    </div>

                    <form onSubmit={handleDebit} style={{ borderTop: '1px solid var(--border-glass)', paddingTop: '24px', display: 'flex', gap: '16px' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem' }}>VALOR DO DÉBITO (ETECOINS)</label>
                            <input 
                                type="number" 
                                min="1"
                                step="1"
                                className="input-premium"
                                placeholder="Ex: 5"
                                value={amountInput}
                                onChange={handleAmountChange}
                                onKeyDown={(e) => ["e", "E", "+", "-", ".", ","].includes(e.key) && e.preventDefault()}
                                style={{ fontSize: '1.2rem' }}
                                required
                            />
                        </div>
                        <button type="submit" className="btn btn-danger" style={{ alignSelf: 'flex-end', height: '52px', padding: '0 32px' }}>
                            <CreditCard style={{ marginRight: '8px' }}/> DEBITAR 
                        </button>
                    </form>

                    {lastDebitResult && (
                        <div className="animate-fade-in" style={{ 
                            marginTop: '16px', padding: '16px', borderRadius: '8px',
                            background: lastDebitResult.success ? 'rgba(16,185,129,0.1)' : 'rgba(239,68,68,0.1)',
                            border: `1px solid ${lastDebitResult.success ? 'var(--success)' : 'var(--danger)'}`
                        }}>
                             {lastDebitResult.success 
                                ? "✅ Débito efetuado com sucesso!"
                                : lastDebitResult.reason === 'insufficient_balance' 
                                    ? `❌ Saldo Insuficiente. Faltam: ${lastDebitResult.requested - lastDebitResult.current_balance} ETC`
                                    : "❌ Valor inválido."
                             }
                        </div>
                    )}
                </div>
            )}

            {lastQueryData && lastQueryData.error && (
                <div className="glass-panel animate-fade-in" style={{ textAlign: 'center', borderColor: 'var(--danger)' }}>
                    <h3 style={{ color: 'var(--danger)' }}>Comanda {code || "Fxxx"} não encontrada na carteira local.</h3>
                </div>
            )}
            
         </div>
      </main>
    </div>
  )
}
