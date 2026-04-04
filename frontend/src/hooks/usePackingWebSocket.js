import { useState, useEffect, useCallback, useRef } from 'react';

export function usePackingWebSocket(onMessage) {
  const [status, setStatus] = useState('connecting');
  const ws = useRef(null);
  const reconnectTimeout = useRef(null);

  const connect = useCallback(() => {
    const token = sessionStorage.getItem('ouroboros_token');
    if (!token) {
      setStatus('unauthorized');
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.hostname === 'localhost' ? 'localhost:5000' : window.location.host;
    const wsUrl = `${protocol}//${host}/ws/packing?token=${token}`;

    console.log(`[WS Packing] Conectando a ${wsUrl}...`);
    ws.current = new WebSocket(wsUrl);

    ws.current.onopen = () => {
      console.log('[WS Packing] Conectado.');
      setStatus('connected');
    };

    ws.current.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (onMessage) onMessage(data);
      } catch (err) {
        console.error('[WS Packing] Erro ao parsear mensagem:', err);
      }
    };

    ws.current.onclose = (e) => {
      console.log(`[WS Packing] Desconectado: ${e.code} ${e.reason}`);
      setStatus('disconnected');
      
      if (e.code === 4001 || e.code === 1008) {
        setStatus('unauthorized');
        return;
      }

      // Reconnect after 3 seconds
      reconnectTimeout.current = setTimeout(connect, 3000);
    };

    ws.current.onerror = (err) => {
      console.error('[WS Packing] Erro:', err);
      ws.current.close();
    };
  }, [onMessage]);

  useEffect(() => {
    connect();
    return () => {
      if (ws.current) ws.current.close();
      if (reconnectTimeout.current) clearTimeout(reconnectTimeout.current);
    };
  }, [connect]);

  return { status };
}
