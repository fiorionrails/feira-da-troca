import { useState, useEffect, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'

const WS_URL = 'ws://localhost:8000/ws/store'

export function useStoreWebSocket() {
  const navigate = useNavigate()
  const [isConnected, setIsConnected] = useState(false)
  const [storeInfo, setStoreInfo] = useState(null)
  const [lastQueryData, setLastQueryData] = useState(null)
  const [lastDebitResult, setLastDebitResult] = useState(null)

  const ws = useRef(null)

  useEffect(() => {
    let isMounted = true

    const connectStore = () => {
      const token = sessionStorage.getItem('ouroboros_token')
      if (!token) {
        if (isMounted) navigate('/')
        return
      }

      ws.current = new WebSocket(`${WS_URL}?token=${token}`)

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

      ws.current.onclose = (e) => {
        if (!isMounted) return
        setIsConnected(false)
        if (e.code === 1008) {
          alert("Token da Loja Inválido!")
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

  const clearQuery = () => setLastDebitResult(null)
  const clearSearch = () => { setLastQueryData(null); setLastDebitResult(null); }

  return { isConnected, storeInfo, lastQueryData, lastDebitResult, queryBalance, requestDebit, clearQuery, clearSearch }
}

// Utility para tocar som digital via Web Audio API 
export const playSound = (type) => {
    const ctx = new (window.AudioContext || window.webkitAudioContext)()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.connect(gain)
    gain.connect(ctx.destination)

    if (type === 'success') {
        osc.type = 'sine'
        osc.frequency.setValueAtTime(800, ctx.currentTime)
        osc.frequency.exponentialRampToValueAtTime(1200, ctx.currentTime + 0.1)
        gain.gain.setValueAtTime(0.5, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.2)
        osc.start(ctx.currentTime)
        osc.stop(ctx.currentTime + 0.2)
    } else {
        osc.type = 'sawtooth'
        osc.frequency.setValueAtTime(200, ctx.currentTime)
        osc.frequency.linearRampToValueAtTime(100, ctx.currentTime + 0.3)
        gain.gain.setValueAtTime(0.5, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3)
        osc.start(ctx.currentTime)
        osc.stop(ctx.currentTime + 0.3)
    }
}
