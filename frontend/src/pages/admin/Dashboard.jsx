import { useState, useEffect, useRef } from 'react'
import { Plus, Coins, ShoppingCart, X, Minus, Store, RefreshCw, Copy, Check } from 'lucide-react'
import { useAdminWebSocket } from '../../hooks/useAdminWebSocket'
import { useNavigate } from 'react-router-dom'
import { BACKEND_HTTP } from '../../config'
import Layout from '../../components/Layout'

export default function Dashboard() {
  const navigate = useNavigate()
  const { isConnected, nextCode, recentComandas, economyStream, wsError, createComanda, addCredit, lastCategoryUpdate } = useAdminWebSocket()
  
  const [holderName, setHolderName] = useState('')
  const [mode, setMode] = useState('new') // 'new' | 'existing'
  const [comandaCode, setComandaCode] = useState('')
  const [existingComanda, setExistingComanda] = useState(null)
  const [loadingComanda, setLoadingComanda] = useState(false)
  
  // Cart State System
  const [categories, setCategories] = useState([])
  const [searchQuery, setSearchQuery] = useState('')
  const [cart, setCart] = useState([])
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  
  const searchInputRef = useRef(null)

  // Store Management State
  const [showStoreModal, setShowStoreModal] = useState(false)
  const [storeList, setStoreList] = useState([])
  const [newStoreName, setNewStoreName] = useState('')
  const [copiedToken, setCopiedToken] = useState(null)

  const fetchStores = async () => {
      try {
          const token = sessionStorage.getItem('ouroboros_token')
          const res = await fetch(`${BACKEND_HTTP}/api/stores`, { headers: { 'token': token } })
          if (res.ok) setStoreList(await res.json())
      } catch (e) {
          console.error(e)
      }
  }

  useEffect(() => {
      if (showStoreModal) fetchStores()
  }, [showStoreModal])

  const handleCreateStore = async (e) => {
      e.preventDefault()
      if (!newStoreName.trim()) return
      try {
          const token = sessionStorage.getItem('ouroboros_token')
          const res = await fetch(`${BACKEND_HTTP}/api/stores`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'token': token },
              body: JSON.stringify({ name: newStoreName })
          })
          if (res.ok) {
              setNewStoreName('')
              fetchStores()
          }
      } catch (e) {
          console.error(e)
      }
  }

  const handleRevokeToken = async (storeId) => {
      if (!window.confirm("Isso desconectará a loja imediatamente e exigirá a inserção do novo token. Confirmar?")) return
      
      try {
          const token = sessionStorage.getItem('ouroboros_token')
          const res = await fetch(`${BACKEND_HTTP}/api/stores/${storeId}/revoke_token`, {
              method: 'POST',
              headers: { 'token': token }
          })
          if (res.ok) fetchStores()
      } catch (e) {
          console.error(e)
      }
  }

  const handleCopyHash = (tokenStr) => {
      navigator.clipboard.writeText(tokenStr)
      setCopiedToken(tokenStr)
      setTimeout(() => setCopiedToken(null), 2000)
  }


  // Fetch categories on mount
  useEffect(() => {
    const fetchCategories = async () => {
      try {
        const token = sessionStorage.getItem('ouroboros_token')
        const res = await fetch(`${BACKEND_HTTP}/api/categories?t=${Date.now()}`, {
          headers: { 'token': token }
        })
        if (res.ok) {
           const data = await res.json()
           // Forcing price into integer ETC mapping
           setCategories(data.map(c => ({...c, ETC: c.price})))
        }
      } catch (err) {
         console.error("Falha ao puxar categorias do backend", err)
      }
    }
    fetchCategories()
  }, [lastCategoryUpdate])

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
          const res = await fetch(`${BACKEND_HTTP}/api/categories`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'token': token },
              body: JSON.stringify({ name: name, price: price })
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
      const cartItems = cart.map(item => ({ name: item.name, quantity: item.quantity }))
      createComanda(holderName, cartTotal, cartItems)
      setHolderName('')
      setCart([])
    }
  }

  const handleAddCreditSubmit = (e) => {
    e.preventDefault()
    if (existingComanda && cartTotal > 0) {
      const cartItems = cart.map(item => ({ name: item.name, quantity: item.quantity }))
      addCredit(existingComanda.code, cartTotal, cartItems)
      setCart([])
      setComandaCode('')
      setExistingComanda(null)
    }
  }

  const searchComanda = async () => {
    if (!comandaCode.trim()) return
    setLoadingComanda(true)
    setExistingComanda(null)
    try {
      const token = sessionStorage.getItem('ouroboros_token')
      // Use the store WS balance query approach but via a simple REST-like fetch
      // Actually, let's query via a quick WebSocket-style approach. Simpler: query the DB via the existing balance_view
      const res = await fetch(`${BACKEND_HTTP}/api/comanda/${comandaCode.toUpperCase()}`, { headers: { 'token': token } })
      if (res.ok) {
        const data = await res.json()
        setExistingComanda(data)
      } else {
        setExistingComanda({ error: 'Comanda não encontrada' })
      }
    } catch (e) {
      setExistingComanda({ error: 'Erro de conexão' })
    }
    setLoadingComanda(false)
  }

  return (
    <Layout role="admin" isConnected={isConnected} onManageStores={() => setShowStoreModal(true)}>
      {/* Auth error banner */}
      {wsError && (
        <div style={{ padding: '10px 24px', background: 'rgba(239,68,68,0.15)', borderBottom: '1px solid var(--danger)', color: 'var(--danger)', fontSize: '0.9rem', textAlign: 'center' }}>
          {wsError}
        </div>
      )}

      {/* Main Grid: Mudei para 3 colunas, a do meio virou o Cart */}
      <div style={{ flex: 1, padding: '32px', display: 'grid', gridTemplateColumns: 'minmax(300px, 1.2fr) minmax(350px, 1fr) 1fr', gap: '32px' }}>
        
        {/* Coluna 1: Comanda — Nova ou Existente */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
            <div className="glass-panel animate-fade-in" style={{ padding: '32px', border: '2px solid rgba(16, 185, 129, 0.2)' }}>
                
                {/* Toggle Mode */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '24px' }}>
                    <button 
                        type="button"
                        className={`btn ${mode === 'new' ? '' : 'btn-outline'}`}
                        style={{ flex: 1, padding: '10px', fontSize: '0.85rem' }}
                        onClick={() => { setMode('new'); setExistingComanda(null); setComandaCode(''); }}
                    >
                        <Plus size={16} /> Nova Comanda
                    </button>
                    <button 
                        type="button"
                        className={`btn ${mode === 'existing' ? '' : 'btn-outline'}`}
                        style={{ flex: 1, padding: '10px', fontSize: '0.85rem' }}
                        onClick={() => { setMode('existing'); setHolderName(''); }}
                    >
                        <Coins size={16} /> Adicionar Crédito
                    </button>
                </div>

                {mode === 'new' ? (
                    <>
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
                            <div style={{ marginTop: '16px', padding: '16px', background: 'var(--element-bg)', borderRadius: '8px', textAlign: 'center' }}>
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
                    </>
                ) : (
                    <>
                        <form onSubmit={handleAddCreditSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem' }}>CÓDIGO DA COMANDA</label>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <input 
                                        type="text" 
                                        className="input-premium"
                                        placeholder="F001, F002..."
                                        value={comandaCode}
                                        onChange={(e) => setComandaCode(e.target.value.toUpperCase())}
                                        style={{ flex: 1, textTransform: 'uppercase', fontWeight: 700, fontSize: '1.2rem', letterSpacing: '2px' }}
                                    />
                                    <button type="button" className="btn" onClick={searchComanda} disabled={!comandaCode.trim() || loadingComanda} style={{ whiteSpace: 'nowrap' }}>
                                        {loadingComanda ? '...' : 'Buscar'}
                                    </button>
                                </div>
                            </div>

                            {/* Resultado da Busca */}
                            {existingComanda && !existingComanda.error && (
                                <div style={{ padding: '16px', background: 'rgba(16, 185, 129, 0.1)', borderRadius: '8px', border: '1px solid rgba(16, 185, 129, 0.3)' }}>
                                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '4px' }}>COMANDA ENCONTRADA</p>
                                    <h3 style={{ margin: '4px 0', color: 'var(--accent-primary)' }}>{existingComanda.code} — {existingComanda.holder_name}</h3>
                                    <p style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>Saldo atual: <strong style={{ color: 'var(--success)' }}>{existingComanda.balance} ETC</strong></p>
                                </div>
                            )}
                            {existingComanda && existingComanda.error && (
                                <div style={{ padding: '16px', background: 'rgba(239, 68, 68, 0.1)', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.3)', color: 'var(--danger)', fontSize: '0.9rem' }}>
                                    {existingComanda.error}
                                </div>
                            )}

                            <div style={{ marginTop: '8px', padding: '16px', background: 'var(--element-bg)', borderRadius: '8px', textAlign: 'center' }}>
                                <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', letterSpacing: '1px' }}>A ADICIONAR</p>
                                <h2 style={{ fontSize: '2.5rem', margin: '8px 0', color: cartTotal > 0 ? 'var(--success)' : 'var(--text-muted)' }}>
                                    +{cartTotal} ETC
                                </h2>
                            </div>
                            <button type="submit" className="btn btn-success" disabled={cartTotal === 0 || !existingComanda || existingComanda.error} style={{ marginTop: '8px', opacity: (cartTotal === 0 || !existingComanda || existingComanda.error) ? 0.5 : 1 }}>
                                <Coins size={18} /> ADICIONAR CRÉDITO
                            </button>
                            {cartTotal === 0 && <p style={{fontSize:'0.8rem', color:'var(--danger)', textAlign:'center'}}>Adicione itens no carrinho.</p>}
                        </form>
                    </>
                )}
            </div>
        </div>

        {/* Coluna 2: Carrinho de Avaliação */}
        <div className="glass-panel animate-fade-in" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: 0 }}>
             <div style={{ background: 'var(--element-bg)', padding: '24px', borderBottom: '1px solid var(--border-glass)' }}>
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
                        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 10, background: 'var(--bg-card)', border: '1px solid var(--border-glass)', borderRadius: '8px', marginTop: '4px', boxShadow: '0 10px 30px var(--input-bg-focus)', maxHeight: '200px', overflowY: 'auto' }}>
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
                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', background: 'var(--input-bg)', padding: '4px', borderRadius: '4px' }}>
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
                    .sort((a, b) => (b._ts || 0) - (a._ts || 0))
                    .map((evt, idx) => (
                        <div key={idx} style={{ padding: '16px', background: 'var(--element-bg)', borderLeft: `3px solid ${evt.type === 'comanda_created' ? 'var(--accent-primary)' : evt.type === 'credit_added' ? 'var(--success)' : evt.type === 'category_updated' ? 'var(--accent-primary)' : 'var(--danger)'}`, borderRadius: '4px' }}>
                            {evt.type === 'comanda_created' 
                                ? <><strong style={{ color: 'var(--accent-primary)' }}>+{evt.code}:</strong> Criada para <b>{evt.holder_name}</b> com inicial de {evt.balance} ETC</>
                                : evt.type === 'credit_added'
                                    ? <><strong style={{ color: 'var(--success)' }}>💰 {evt.code}:</strong> +{evt.amount} ETC adicionado para <b>{evt.holder_name}</b> (novo saldo: {evt.new_balance} ETC)</>
                                    : evt.type === 'category_updated'
                                        ? <><strong style={{ color: 'var(--accent-primary)' }}>📦 NOVA CATEGORIA:</strong> A categoria "<b>{evt.name}</b>" foi sincronizada em todos os caixas.</>
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

      </div>

      {/* MODAL DE LOJAS */}
      {showStoreModal && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', backdropFilter: 'blur(10px)', zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div className="glass-panel animate-fade-in" style={{ width: '90%', maxWidth: '800px', maxHeight: '90vh', display: 'flex', flexDirection: 'column', padding: 0 }}>
                <div style={{ padding: '24px', borderBottom: '1px solid var(--border-glass)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ display: 'flex', alignItems: 'center', gap: '12px', margin: 0 }}>
                        <Store size={24} color="var(--accent-primary)"/> Gestão do Comércio Local
                    </h2>
                    <button onClick={() => setShowStoreModal(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-main)', cursor: 'pointer' }}><X size={24}/></button>
                </div>
                
                <div style={{ padding: '32px', display: 'flex', flexDirection: 'column', gap: '32px', overflowY: 'auto' }}>
                    
                    {/* Add Store Form */}
                    <form onSubmit={handleCreateStore} style={{ display: 'flex', gap: '16px', alignItems: 'flex-end', background: 'rgba(16,185,129,0.05)', padding: '24px', borderRadius: '12px', border: '1px solid rgba(16,185,129,0.2)' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.85rem' }}>NOME DA NOVA LOJA</label>
                            <input 
                                type="text"
                                className="input-premium"
                                placeholder="Ex: Cantina do João, Sala do 3ºB..."
                                value={newStoreName}
                                onChange={e => setNewStoreName(e.target.value)}
                                required
                            />
                        </div>
                        <button type="submit" className="btn btn-success" style={{ height: '48px' }}>
                            <Plus size={18}/> CADASTRAR 
                        </button>
                    </form>

                    {/* Store List */}
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        <h3 style={{ margin: 0, color: 'var(--text-muted)' }}>LOJAS ATIVAS ({storeList.length})</h3>
                        {storeList.length === 0 && <p style={{ color: 'var(--text-muted)' }}>Nenhuma loja cadastrada.</p>}
                        
                        {storeList.map(store => (
                            <div key={store.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.02)', padding: '20px', borderRadius: '12px', border: '1px solid var(--border-glass)' }}>
                                <div>
                                    <h3 style={{ margin: '0 0 8px 0', fontSize: '1.2rem' }}>{store.name}</h3>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                        <code style={{ background: 'var(--input-bg-focus)', padding: '6px 12px', borderRadius: '4px', fontSize: '0.9rem', color: 'var(--accent-primary)' }}>
                                            {store.terminal_token}
                                        </code>
                                        <button 
                                            onClick={() => handleCopyHash(store.terminal_token)}
                                            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', display: 'flex', alignItems: 'center' }}
                                            title="Copiar Token"
                                        >
                                            {copiedToken === store.terminal_token ? <Check size={18} color="var(--success)"/> : <Copy size={18}/>}
                                        </button>
                                    </div>
                                </div>

                                <div>
                                    <button 
                                        onClick={() => handleRevokeToken(store.id)}
                                        className="btn btn-outline"
                                        style={{ borderColor: 'var(--danger)', color: 'var(--danger)' }}
                                    >
                                        <RefreshCw size={16}/> Regerar Token
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>

                </div>
            </div>
        </div>
      )}

    </Layout>
  )
}
