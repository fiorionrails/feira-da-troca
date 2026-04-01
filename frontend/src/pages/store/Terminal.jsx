import { useState, useEffect, useRef } from 'react'
import { Wifi, WifiOff, CreditCard, Search, LogOut, Store, ShoppingCart, Plus, Minus, X } from 'lucide-react'
import { useStoreWebSocket } from '../../hooks/useStoreWebSocket'
import { playSound } from '../../utils/sound'
import { useNavigate } from 'react-router-dom'
import { BACKEND_HTTP } from '../../config'

export default function Terminal() {
  const navigate = useNavigate()
  const { isConnected, storeInfo, lastQueryData, lastDebitResult, wsError, queryBalance, requestDebit, clearQuery, clearSearch } = useStoreWebSocket()

  const [code, setCode] = useState('')

  // Cart State System
  const [categories, setCategories] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [cart, setCart] = useState([])
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const searchInputRef = useRef(null)

  // Efeito p/ tocar som e limpar cart no sucesso
  useEffect(() => {
    if (lastDebitResult) {
      if (lastDebitResult.success) {
          playSound('success')
          setCart([]) // Limpa o carrinho ao finalizar com sucesso
          setCode('') // Limpa comanda
          clearSearch()
      }
      else playSound('error')
    }
  }, [lastDebitResult, clearSearch])

  // Fetch categories on mount
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const res = await fetch(`${BACKEND_HTTP}/api/categories`)
        if (res.ok) {
           const data = await res.json()
           setCategories(data.map(c => ({...c, ETC: c.price})))
        }
      } catch (err) {
         console.error("Falha ao puxar categorias do backend", err)
      }
    }
    fetchCategories()
  }, [])

  const filteredCategories = categories.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))

  const cartTotal = cart.reduce((acc, item) => acc + (item.ETC * item.quantity), 0)

  const addToCart = (category) => {
      setCart(prev => {
          const existing = prev.find(i => i.id === category.id)
          if (existing) {
              return prev.map(i => i.id === category.id ? { ...i, quantity: i.quantity + 1 } : i)
          }
          return [...prev, { ...category, quantity: 1 }]
      })
      setSearchQuery('')
      setIsDropdownOpen(false)
      searchInputRef.current?.focus()
      if (lastDebitResult) clearQuery() // limpa o erro antigo se começar a interagir
  }

  const updateQuantity = (id, delta) => {
      setCart(prev => prev.map(i => {
          if (i.id === id) {
              const newQ = i.quantity + delta
              return newQ > 0 ? { ...i, quantity: newQ } : i
          }
          return i
      }))
      if (lastDebitResult) clearQuery()
  }

  const removeFromCart = (id) => {
      setCart(prev => prev.filter(i => i.id !== id))
      if (lastDebitResult) clearQuery()
  }

  const handleSearch = (e) => {
    e.preventDefault()
    if (code.trim()) {
        queryBalance(code.trim())
    }
  }

  const handleDebit = (e) => {
      e.preventDefault()
      if (cartTotal > 0 && code && lastQueryData) {
          requestDebit(code.trim(), cartTotal)
      }
  }

  const handleCodeChange = (e) => {
      setCode(e.target.value.toUpperCase())
      if (lastQueryData) clearSearch() // Limpa a tela inteira quando começa a buscar nova pessoa
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>

      {/* Auth error banner */}
      {wsError && (
        <div style={{ padding: '10px 24px', background: 'rgba(239,68,68,0.15)', borderBottom: '1px solid var(--danger)', color: 'var(--danger)', fontSize: '0.9rem', textAlign: 'center' }}>
          {wsError}
        </div>
      )}

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
      <main style={{ flex: 1, padding: '32px', display: 'grid', gridTemplateColumns: 'minmax(350px, 1fr) minmax(350px, 1fr)', gap: '32px' }}>
          
          {/* Coluna 1: Buscar Comanda & Debitar */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
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

            {/* Resultado e Debito */}
            {lastQueryData && !lastQueryData.error && (
                <div className="glass-panel animate-fade-in" style={{ padding: '32px', display: 'flex', flexDirection: 'column' }}>
                    
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '4px' }}>TÍTULAR DA CONTA</p>
                            <h2 style={{ fontSize: '1.8rem', margin: 0 }}>{lastQueryData.holder_name}</h2>
                            <span style={{ background: 'rgba(255,255,255,0.1)', padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem', letterSpacing: '2px', display: 'inline-block', marginTop: '8px' }}>{code}</span>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '4px' }}>SALDO DISPONÍVEL</p>
                            <h2 style={{ fontSize: '2.5rem', margin: 0, color: 'var(--success)' }}>
                                {lastQueryData.balance} ETC
                            </h2>
                        </div>
                    </div>

                    <div style={{ marginTop: '32px', padding: '16px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', textAlign: 'center' }}>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', letterSpacing: '1px' }}>TOTAL A DEBITAR</p>
                        <h2 style={{ fontSize: '2.5rem', margin: '8px 0', color: cartTotal > 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                            {cartTotal} ETC
                        </h2>
                    </div>

                    <button 
                        onClick={handleDebit}
                        className="btn btn-danger" 
                        disabled={cartTotal === 0} 
                        style={{ marginTop: '16px', height: '52px', opacity: cartTotal === 0 ? 0.5 : 1, width: '100%', justifyContent: 'center' }}
                    >
                        <CreditCard style={{ marginRight: '8px' }}/> 
                        {cartTotal > 0 ? `DEBITAR ${cartTotal} ETC` : "ADICIONE ITENS AO CARRINHO"} 
                    </button>

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
                                    : "❌ Erro ao debitar."
                             }
                        </div>
                    )}
                </div>
            )}

            {lastQueryData && lastQueryData.error && (
                <div className="glass-panel animate-fade-in" style={{ textAlign: 'center', borderColor: 'var(--danger)' }}>
                    <h3 style={{ color: 'var(--danger)' }}>Comanda {code || "Fxxx"} não encontrada.</h3>
                </div>
            )}
          </div>

          {/* Coluna 2: Carrinho */}
          <div className="glass-panel animate-fade-in" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
             <div style={{ background: 'rgba(0,0,0,0.3)', padding: '24px', borderBottom: '1px solid var(--border-glass)' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                    <ShoppingCart size={20} color="var(--accent-primary)"/> Terminal de Vendas
                </h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                    Selecione os itens para debitar da comanda do aluno.
                </p>
             </div>

             <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, overflowY: 'auto' }}>
                 {/* Auto Complete Search */}
                 <div style={{ position: 'relative' }}>
                    <input 
                        ref={searchInputRef}
                        type="text" 
                        className="input-premium"
                        placeholder="Buscar item do catálogo..."
                        value={searchQuery}
                        onChange={(e) => {
                            setSearchQuery(e.target.value);
                            setIsDropdownOpen(true);
                        }}
                        onFocus={() => setIsDropdownOpen(true)}
                    />
                    
                    {/* Lista Flutuante de Dropdown */}
                    {isDropdownOpen && searchQuery && (
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: '#0f111a', border: '1px solid var(--border-glass)', borderRadius: '8px', marginTop: '4px', boxShadow: '0 10px 30px rgba(0,0,0,0.5)', maxHeight: '200px', overflowY: 'auto' }}>
                            {filteredCategories.length > 0 ? (
                                filteredCategories.map(cat => (
                                    <div 
                                        key={cat.id} 
                                        onClick={() => addToCart(cat)}
                                        style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid rgba(255,255,255,0.05)', transition: 'background 0.2s' }}
                                        onMouseOver={e => e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)'}
                                        onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                                    >
                                        <span>{cat.name}</span>
                                        <strong style={{ color: 'var(--accent-primary)' }}>{cat.ETC} ETC</strong>
                                    </div>
                                ))
                            ) : (
                                <div style={{ padding: '12px 16px', color: 'var(--text-muted)', textAlign: 'center' }}>
                                    Nenhum item encontrado no catálogo.
                                </div>
                            )}
                        </div>
                    )}
                 </div>

                 {/* Lista do Cart */}
                 <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' }}>
                    {cart.map(item => (
                        <div key={item.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', background: 'rgba(255,255,255,0.03)', borderRadius: '8px', border: '1px solid rgba(255,255,255,0.05)' }}>
                            <div style={{ flex: 1 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
                                    <strong style={{ fontSize: '1rem' }}>{item.name}</strong>
                                </div>
                                <span style={{ color: 'var(--success)', fontSize: '0.9rem' }}>{item.ETC} ETC /cada</span>
                            </div>
                            
                            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'rgba(0,0,0,0.4)', padding: '4px', borderRadius: '4px' }}>
                                    <button type="button" onClick={() => updateQuantity(item.id, -1)} style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', cursor: 'pointer', padding: '4px' }}><Minus size={14}/></button>
                                    <span style={{ minWidth: '20px', textAlign: 'center', fontWeight: 'bold' }}>{item.quantity}</span>
                                    <button type="button" onClick={() => updateQuantity(item.id, 1)} style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', cursor: 'pointer', padding: '4px' }}><Plus size={14}/></button>
                                </div>
                                <button type="button" onClick={() => removeFromCart(item.id)} style={{ background: 'transparent', border: 'none', color: 'var(--danger)', cursor: 'pointer', padding: '4px', marginLeft: '8px' }} title="Remover regra">
                                    <X size={18}/>
                                </button>
                            </div>
                        </div>
                    ))}

                    {cart.length === 0 && (
                        <div style={{ textAlign: 'center', color: 'var(--text-muted)', marginTop: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' }}>
                            <ShoppingCart size={48} opacity={0.3} />
                            O carrinho está vazio. Adicione os itens da loja para debitar.
                        </div>
                    )}
                 </div>
             </div>
          </div>
      </main>
    </div>
  )
}
