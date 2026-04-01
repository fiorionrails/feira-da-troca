import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { BACKEND_WS } from '../config'

export function useStoreWebSocket() {
  const navigate = useNavigate()
  const [isConnected, setIsConnected] = useState(false)
  const [storeInfo, setStoreInfo] = useState(null)
  const [lastQueryData, setLastQueryData] = useState(null)
  const [lastDebitResult, setLastDebitResult] = useState(null)
  const [wsError, setWsError] = useState(null)

  const ws = useRef(null)

  useEffect(() => {
    let isMounted = true

    const connectStore = () => {
      const token = sessionStorage.getItem('ouroboros_token')
      if (!token) {
        if (isMounted) navigate('/')
        return
      }

      ws.current = new WebSocket(`${BACKEND_WS}/ws/store?token=${token}`)

      ws.current.onopen = () => { if (isMounted) setIsConnected(true) }

      ws.current.onmessage = (event) => {
        if (!isMounted) return
        const msg = JSON.parse(event.data)
        switch (msg.type) {
          case 'connected':
            setStoreInfo({ id: msg.store_id, name: msg.store_name })
            break
          case 'balance_response':
            setLastQueryData(msg)
            break
          case 'debit_confirmed':
            setLastDebitResult({ success: true, ...msg })
            setLastQueryData({ holder_name: msg.holder_name, balance: msg.new_balance })
            break
          case 'debit_rejected':
            setLastDebitResult({ success: false, ...msg })
            break
          case 'error':
            if (msg.reason === 'comanda_not_found') {
              setLastQueryData({ error: 'Comanda não encontrada' })
            }
            break
          case 'balance_updated':
            setLastQueryData(prev => {
              if (prev && prev.comanda_code === msg.comanda_code) {
                return { ...prev, balance: msg.new_balance }
              }
              return prev
            })
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
          setWsError('Token da loja inválido.')
          navigate('/')
        } else {
          setTimeout(connectStore, 2000)
        }
      }
    }

    connectStore()

    return () => {
      isMounted = false
      if (ws.current) ws.current.close()
    }
  }, [navigate])

  const queryBalance = useCallback((code) => {
    setLastQueryData(null)
    setLastDebitResult(null)
    if (ws.current?.readyState === WebSocket.OPEN && code) {
      ws.current.send(JSON.stringify({ type: 'balance_query', comanda_code: code.toUpperCase() }))
    }
  }, [])

  const requestDebit = useCallback((code, amountRaw) => {
    const amount = parseInt(amountRaw, 10)
    if (ws.current?.readyState === WebSocket.OPEN && amount > 0) {
      ws.current.send(JSON.stringify({ type: 'debit_request', comanda_code: code.toUpperCase(), amount }))
    }
  }, [])

  const clearQuery = useCallback(() => setLastDebitResult(null), [])
  const clearSearch = useCallback(() => { setLastQueryData(null); setLastDebitResult(null) }, [])

  return { isConnected, storeInfo, lastQueryData, lastDebitResult, wsError, queryBalance, requestDebit, clearQuery, clearSearch }
}

