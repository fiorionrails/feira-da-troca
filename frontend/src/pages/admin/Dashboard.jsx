import { useState, useEffect, useRef } from 'react'
import { TerminalSquare, ShieldAlert, Plus, Coins, Zap, LogOut, ShoppingCart, X, Minus } from 'lucide-react'
import { useAdminWebSocket } from '../../hooks/useAdminWebSocket'
import { useNavigate } from 'react-router-dom'

export default function Dashboard() {
  const navigate = useNavigate()
  const { isConnected, nextCode, recentComandas, economyStream, createComanda } = useAdminWebSocket()
  
  const [holderName, setHolderName] = useState('')
  
  // Cart State System
  const [categories, setCategories] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [cart, setCart] = useState([])
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  
  const searchInputRef = useRef(null)

  // Fetch categories on mount
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const token = sessionStorage.getItem('ouroboros_token')
        const res = await fetch('http://localhost:8000/api/categories', {
          headers: { 'token': token }
        })
        if (res.ok) {
           const data = await res.json()
           // Forcing price into integer ETC mapping
           setCategories(data.map(c => ({...c, ETC: Math.floor(c.price / 100)})))
        }
      } catch (err) {
         console.error("Falha ao puxar categorias do backend", err)
      }
    }
    fetchCategories()
  }, [])

  const filteredCategories = categories.filter(c => c.name.toLowerCase().includes(searchQuery.toLowerCase()))
  
  const handleCreateCategory = async (name) => {
      const priceStr = window.prompt(`Qual o valor de avaliação (em ETECOINS) para a nova categoria "${name}"?`)
      if (!priceStr) return
      
      const price = parseInt(priceStr, 10)
      if (isNaN(price) || price <= 0) {
          alert('Valor numérico ETECOIN inválido!')
          return
      }

      try {
          const token = sessionStorage.getItem('ouroboros_token')
          const res = await fetch('http://localhost:8000/api/categories', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'token': token },
              body: JSON.stringify({ name: name, price: price * 100 }) // Converter para centavos pro backend DB nativo
          })

          if (res.ok) {
              const data = await res.json()
              const newCat = { ...data, ETC: price }
              setCategories(prev => [...prev, newCat].sort((a,b) => a.name.localeCompare(b.name)))
              addToCart(newCat)
          } else {
              const err = await res.json()
              alert(err.detail || 'Erro ao criar categoria')
          }
      } catch (err) {
          alert('Erro de rede ao conectar com backend')
      }
  }

  // Total do Cart
  const cartTotal = cart.reduce((acc, item) => acc + (item.ETC * item.quantity), 0)

  const addToCart = (category) => {
      setCart(prev => {
          const existing = prev.find(i => i.id === category.id)
          if (existing) {
              return prev.map(i => i.id === category.id ? { ...i, quantity: i.quantity + 1 } : i)
          }
          return [...prev, { ...category, quantity: 1 }]
      })
      
      // Reseta e foca na barra de pesquisa pra velocidade máxima UX
      setSearchQuery('')
      setIsDropdownOpen(false)
      searchInputRef.current?.focus()
  }

  const updateQuantity = (id, delta) => {
      setCart(prev => prev.map(i => {
          if (i.id === id) {
              const newQ = i.quantity + delta
              return newQ > 0 ? { ...i, quantity: newQ } : i
          }
          return i
      }))
  }

  const removeFromCart = (id) => {
      setCart(prev => prev.filter(i => i.id !== id))
  }

  const handleCreate = (e) => {
    e.preventDefault()
    if (holderName.trim() && cartTotal > 0) {
      createComanda(holderName, cartTotal) // manda como ETC pra gerar saldo, a api espera cents entao no backend temos que ver, mas nosso teste_api manda os inteiros de boa já ou não? 
      // Espera aí, no admin/WS a gente mudou o admin pra exibir `initial_balance` direto ou mandar certinho? Vamos resolver lá. O front envia ETC limpo agora.
      setHolderName('')
      setCart([])
    }
  }

  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      
      <header className="glass-panel" style={{ borderRadius: 0, borderTop: 0, borderLeft: 0, borderRight: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 24px', background: 'rgba(16, 185, 129, 0.05)', borderColor: 'var(--accent-primary)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <TerminalSquare size={24} color="var(--accent-primary)" />
            <h2 style={{ margin: 0, fontSize: '1.2rem', color: 'var(--accent-primary)' }}>Banco Organizador</h2>
        </div>
        
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: isConnected ? 'var(--success)' : 'var(--danger)', fontWeight: '600', fontSize: '0.9rem' }}>
                {isConnected ? <><Zap size={16}/> Sincronizado</> : <><ShieldAlert size={16}/> Offline</>}
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

      {/* Main Grid: Mudei para 3 colunas, a do meio virou o Cart */}
      <main style={{ flex: 1, padding: '32px', display: 'grid', gridTemplateColumns: 'minmax(300px, 1.2fr) minmax(350px, 1fr) 1fr', gap: '32px' }}>
        
        {/* Coluna 1: Comanda Gen e Input Name */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div className="glass-panel animate-fade-in" style={{ padding: '32px', border: '2px solid rgba(16, 185, 129, 0.2)' }}>
                <div style={{ marginBottom: '24px' }}>
                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '4px' }}>PRÓXIMA COMANDA DISPONÍVEL</p>
                    <h1 style={{ fontSize: '3.5rem', margin: 0, color: 'var(--text-main)', letterSpacing: '2px' }}>{nextCode}</h1>
                    <p style={{ fontSize: '0.8rem', color: 'var(--accent-primary)' }}>*Sincronizado entre caixas do Banco</p>
                </div>

                <form onSubmit={handleCreate} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                        <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem' }}>NOME DO ESTUDANTE</label>
                        <input 
                            type="text" 
                            className="input-premium"
                            placeholder="Nome do aluno / equipe..."
                            value={holderName}
                            onChange={(e) => setHolderName(e.target.value)}
                            required
                        />
                    </div>
                    
                    {/* Sum of Cart */}
                    <div style={{ marginTop: '16px', padding: '16px', background: 'rgba(0,0,0,0.3)', borderRadius: '8px', textAlign: 'center' }}>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', letterSpacing: '1px' }}>A DEPOSITAR</p>
                        <h2 style={{ fontSize: '2.5rem', margin: '8px 0', color: cartTotal > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                            {cartTotal} ETC
                        </h2>
                    </div>

                    <button type="submit" className="btn btn-success" disabled={cartTotal === 0 || !holderName} style={{ marginTop: '8px', opacity: (cartTotal === 0 || !holderName) ? 0.5 : 1 }}>
                        <Plus size={18} /> EMITIR COMANDA DE CRÉDITO
                    </button>
                    {cartTotal === 0 && <p style={{fontSize:'0.8rem', color:'var(--danger)', textAlign:'center'}}>Adicione itens no carrinho para depositar.</p>}
                </form>
            </div>
        </div>

        {/* Coluna 2: Carrinho de Avaliação */}
        <div className="glass-panel animate-fade-in" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
             <div style={{ background: 'rgba(0,0,0,0.3)', padding: '24px', borderBottom: '1px solid var(--border-glass)' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', margin: 0 }}>
                    <ShoppingCart size={20} color="var(--accent-primary)"/> Carrinho Ouroboros
                </h3>
                <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginTop: '8px' }}>
                    Avalie os produtos trazidos para gerar ETC.
                </p>
             </div>

             <div style={{ padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', flex: 1, overflowY: 'auto' }}>
                 {/* Auto Complete Search */}
                 <div style={{ position: 'relative' }}>
                    <input 
                        ref={searchInputRef}
                        type="text" 
                        className="input-premium"
                        placeholder="Buscar Jaqueta, Brinquedo..."
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
                            {filteredCategories.length > 0 && filteredCategories.map(cat => (
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
                            ))}
                            
                            {searchQuery.trim() && (
                                <div 
                                    onClick={() => handleCreateCategory(searchQuery)}
                                    style={{ padding: '12px 16px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', borderTop: '1px solid rgba(255,255,255,0.05)', transition: 'background 0.2s', color: 'var(--accent-primary)' }}
                                    onMouseOver={e => e.currentTarget.style.background = 'rgba(16, 185, 129, 0.1)'}
                                    onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                                >
                                    <Plus size={16} style={{marginRight: '8px'}} /> Criar categoria "{searchQuery}"
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
                            O carrinho está vazio. Busque e adicione os vestidos ou camisetas trazidas.
                        </div>
                    )}
                 </div>
             </div>
        </div>

        {/* Coluna 3: Live Feed Event Sourcing */}
        <div className="glass-panel animate-fade-in" style={{ padding: '32px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: '24px' }}>
                <h3 style={{ margin: 0 }}>Log Global Ao Vivo</h3>
                <span style={{ fontSize: '0.8rem', color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '4px' }}><div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--success)', animation: 'fadeIn 1s infinite alternate' }}></div> Streams</span>
            </div>
            
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                {
                    [...economyStream, ...recentComandas]
                    .sort((a,b) => -1)
                    .map((evt, idx) => (
                        <div key={idx} style={{ padding: '16px', background: 'rgba(0,0,0,0.2)', borderLeft: `3px solid ${evt.type === 'comanda_created' ? 'var(--accent-primary)' : 'var(--danger)'}`, borderRadius: '4px' }}>
                            {evt.type === 'comanda_created' 
                                ? <><strong style={{ color: 'var(--accent-primary)' }}>+{evt.code}:</strong> Criada para <b>{evt.holder_name}</b> com inicial de {evt.balance} ETC</>
                                : <><strong style={{ color: 'var(--danger)' }}>🔥 {evt.comanda_code}:</strong> -{evt.amount} ETC gasto na loja {evt.store_name} (novo saldo: {evt.new_balance} ETC)</>
                            }
                        </div>
                    ))
                }
                {[...economyStream, ...recentComandas].length === 0 && (
                    <p style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: '40px' }}>Nenhum evento registrado nesta sessão do navegador ainda.</p>
                )}
            </div>
        </div>

      </main>
    </div>
  )
}
