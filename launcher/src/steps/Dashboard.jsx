import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export default function Dashboard({ config, lanIp, onStop }) {
  const [logs, setLogs] = useState([]);
  const [online, setOnline] = useState(true);
  const logEndRef = useRef(null);
  const unlistenLog = useRef(null);
  const unlistenStop = useRef(null);

  const url = `http://${lanIp}:${config.port}`;

  useEffect(() => {
    async function setup() {
      unlistenLog.current = await listen("backend-log", (event) => {
        const line = String(event.payload);
        setLogs((prev) => [
          ...prev.slice(-500), // mantém no máximo 500 linhas
          { text: line, ts: new Date().toLocaleTimeString("pt-BR"), err: line.startsWith("[ERR]") },
        ]);
      });

      unlistenStop.current = await listen("backend-stopped", () => {
        setOnline(false);
        setLogs((prev) => [
          ...prev,
          { text: "— Servidor encerrado —", ts: new Date().toLocaleTimeString("pt-BR"), err: true },
        ]);
      });
    }

    setup();

    return () => {
      unlistenLog.current?.();
      unlistenStop.current?.();
    };
  }, []);

  // Auto-scroll para o final dos logs
  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  async function handleStop() {
    try {
      await invoke("stop_server");
    } catch {
      // pode já ter parado
    }
    onStop();
  }

  function openBrowser() {
    invoke("open_browser", { url }).catch(console.error);
  }

  function copy() {
    navigator.clipboard.writeText(url).catch(() => {});
  }

  function clearLogs() {
    setLogs([]);
  }

  return (
    <div>
      {/* Barra de status */}
      <div
        className="card"
        style={{ marginBottom: 14, padding: "12px 16px", display: "flex", alignItems: "center", justifyContent: "space-between" }}
      >
        <div className="row" style={{ gap: 10 }}>
          <span className={`status-dot ${online ? "online" : "offline"}`} />
          <span style={{ fontSize: 13, fontWeight: 500 }}>
            {online ? "Servidor online" : "Servidor parado"}
          </span>
          <span
            style={{
              fontFamily: "var(--mono)",
              fontSize: 12,
              color: "var(--accent)",
              background: "rgba(139,92,246,0.12)",
              padding: "2px 8px",
              borderRadius: 6,
            }}
          >
            {url}
          </span>
        </div>

        <div className="row">
          <button className="btn btn-ghost" style={{ padding: "6px 12px" }} onClick={openBrowser}>
            🌐 Abrir
          </button>
          <button className="btn btn-ghost" style={{ padding: "6px 12px" }} onClick={copy}>
            📋 Copiar
          </button>
          <button className="btn btn-danger" style={{ padding: "6px 12px" }} onClick={handleStop}>
            ⏹ Parar
          </button>
        </div>
      </div>

      {/* Logs */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
        <div className="section-title" style={{ margin: 0 }}>Logs do servidor</div>
        <button
          className="btn btn-ghost"
          style={{ padding: "3px 10px", fontSize: 11 }}
          onClick={clearLogs}
        >
          Limpar
        </button>
      </div>

      <div className="log-box">
        {logs.length === 0 ? (
          <span style={{ color: "var(--border)" }}>Aguardando logs...</span>
        ) : (
          logs.map((l, i) => (
            <div key={i} className={`log-line ${l.err ? "err" : ""}`}>
              <span style={{ color: "var(--border)", marginRight: 8 }}>{l.ts}</span>
              {l.text}
            </div>
          ))
        )}
        <div ref={logEndRef} />
      </div>

      <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="text-muted">Evento: {config.event_name}</span>
        <span className="text-muted">{logs.length} linha(s)</span>
      </div>
    </div>
  );
}
