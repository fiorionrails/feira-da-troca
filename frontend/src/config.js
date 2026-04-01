/**
 * Centralized backend connection config.
 *
 * For event deployment, set these in a frontend/.env file:
 *   VITE_BACKEND_URL=http://192.168.1.10:8000
 *   VITE_WS_URL=ws://192.168.1.10:8000
 */
export const BACKEND_HTTP = import.meta.env.VITE_BACKEND_URL ?? 'http://localhost:8000'
export const BACKEND_WS = import.meta.env.VITE_WS_URL ?? 'ws://localhost:8000'
