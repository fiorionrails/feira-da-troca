import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { BACKEND_WS } from '../config'

export function useAdminWebSocket() {
  const navigate = useNavigate()
  const [isConnected, setIsConnected] = useState(false)
  const [nextCode, setNextCode] = useState('F---')
  const [recentComandas, setRecentComandas] = useState([])
  const [economyStream, setEconomyStream] = useState([])
  const [wsError, setWsError] = useState(null)
  const [lastCategoryUpdate, setLastCategoryUpdate] = useState(0)

  const ws = useRef(null)

  useEffect(() => {
    let isMounted = true

    const token = sessionStorage.getItem('ouroboros_token')
    if (!token) {
      if (isMounted) navigate('/')
      return
    }

    const connect = () => {
      ws.current = new WebSocket(`${BACKEND_WS}/ws/admin?token=${token}`)

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
            setRecentComandas(prev => [{ ...msg, _ts: Date.now() }, ...prev].slice(0, 10))
            break
          case 'admin_balance_updated':
            setEconomyStream(prev => [{ ...msg, _ts: Date.now() }, ...prev].slice(0, 10))
            break
          case 'credit_confirmed':
            setRecentComandas(prev => [{ ...msg, type: 'credit_added', _ts: Date.now() }, ...prev].slice(0, 10))
            break
          case 'category_updated':
            console.log('[WS] Nova categoria detectada! Avisando Dashboard...');
            setRecentComandas(prev => [{ type: 'category_updated', name: msg.category.name, _ts: Date.now() }, ...prev].slice(0, 10))
            setLastCategoryUpdate(Date.now())
            break
        }
      }

      ws.current.onerror = () => {
        if (isMounted) setIsConnected(false)
      }

      ws.current.onclose = (e) => {
        if (!isMounted) return
        setIsConnected(false)
        if (e.code === 1008) {
          setWsError('Token de administrador inválido.')
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

  const createComanda = useCallback((holderName, initialBalance, cartItems = []) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'create_comanda',
        holder_name: holderName,
        initial_balance: initialBalance,
        cart_items: cartItems,
      }))
    }
  }, [])

  const addCredit = useCallback((comandaCode, amount, cartItems = []) => {
    if (ws.current && ws.current.readyState === WebSocket.OPEN) {
      ws.current.send(JSON.stringify({
        type: 'add_credit',
        comanda_code: comandaCode,
        amount,
        cart_items: cartItems,
      }))
    }
  }, [])

  return { isConnected, nextCode, recentComandas, economyStream, wsError, createComanda, addCredit, lastCategoryUpdate }
}

