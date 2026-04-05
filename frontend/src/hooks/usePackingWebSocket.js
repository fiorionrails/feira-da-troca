import { useState, useEffect, useCallback, useRef } from 'react';
import { BACKEND_WS } from '../config';

export function usePackingWebSocket(onMessage) {
  const [status, setStatus] = useState('connecting');
  const ws = useRef(null);
  const reconnectTimeout = useRef(null);
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  }, [onMessage]);

  const connect = useCallback(() => {
    if (reconnectTimeout.current) {
      clearTimeout(reconnectTimeout.current);
      reconnectTimeout.current = null;
    }

    const token = sessionStorage.getItem('ouroboros_token');
    if (!token) {
      setStatus('unauthorized');
      return;
    }

    const wsUrl = `${BACKEND_WS}/ws/packing?token=${token}`;
    const socket = new WebSocket(wsUrl);
    ws.current = socket;

    socket.onopen = () => {
      if (ws.current !== socket) return;
      setStatus('connected');
    };

    socket.onmessage = (event) => {
      if (ws.current !== socket) return;
      try {
        const data = JSON.parse(event.data);
        if (onMessageRef.current) onMessageRef.current(data);
      } catch (err) {
        console.error('[WS Packing] Erro ao parsear mensagem:', err);
      }
    };

    socket.onclose = (e) => {
      if (ws.current !== socket) return;
      setStatus('disconnected');

      if (e.code === 4001 || e.code === 1008) {
        setStatus('unauthorized');
        return;
      }

      reconnectTimeout.current = setTimeout(connect, 3000);
    };

    socket.onerror = () => {
      if (ws.current !== socket) return;
      socket.close();
    };
  }, []);

  useEffect(() => {
    connect();
    return () => {
      const socket = ws.current;
      ws.current = null;
      if (socket) socket.close();
      if (reconnectTimeout.current) {
        clearTimeout(reconnectTimeout.current);
        reconnectTimeout.current = null;
      }
    };
  }, [connect]);

  return { status };
}
