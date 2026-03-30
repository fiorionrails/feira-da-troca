import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

const WS_URL = 'ws://localhost:8000/ws/admin'

export function useAdminWebSocket() {
  const navigate = useNavigate()
  const [isConnected, setIsConnected] = useState(false)
  const [nextCode, setNextCode] = useState('F---')
  const [recentComandas, setRecentComandas] = useState([])
  const [economyStream, setEconomyStream] = useState([])
  
  const ws = useRef(null)

  useEffect(() => {
    let isMounted = true

    const token = sessionStorage.getItem('ouroboros_token')
    if (!token) {
      if (isMounted) navigate('/')
      return
    }

    const connect = () => {
      ws.current = new WebSocket(`${WS_URL}?token=${token}`)

      ws.current.onopen = () => { if (isMounted) setIsConnected(true) }
      
      ws.current.onmessage = (event) => {
        if (!isMounted) return
        const msg = JSON.parse(event.data)
        
        switch (msg.type) {
          case 'connected':
            setNextCode(msg.next_code)
            break
          case 'update_next_code':
            setNextCode(msg.next_code)
            break
          case 'comanda_created':
            setRecentComandas(prev => [msg, ...prev].slice(0, 10))
            break
          case 'admin_balance_updated': // Alguem fez venda lá na loja
            setEconomyStream(prev => [msg, ...prev].slice(0, 10))
            break
        }
      }

      ws.current.onclose = (e) => {
        if (!isMounted) return
        setIsConnected(false)
        if (e.code === 1008) {
           alert("Token Admin Inválido!")
           navigate('/')
        } else {
           setTimeout(connect, 3000)
        }
      }
    }

    connect()
    
    return () => { 
      isMounted = false
      if (ws.current) ws.current.close() 
    }
  }, [navigate])

  const createComanda = useCallback((holderName, initialBalance) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'create_comanda',
        holder_name: holderName,
        initial_balance: initialBalance
      }))
    }
  }, [])

  return { isConnected, nextCode, recentComandas, economyStream, createComanda }
}
