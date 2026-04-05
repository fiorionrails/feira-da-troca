import { invoke } from "@tauri-apps/api/core";

export default function Ready({ config, lanIp, onViewLogs }) {
  const url = `http://${lanIp}:${config.port}`;

  function copy() {
    navigator.clipboard.writeText(url).catch(() => {});
  }

  function openBrowser() {
    invoke("open_browser", { url }).catch(console.error);
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", textAlign: "center" }}>
      <div style={{ fontSize: 48, marginBottom: 10 }}>✅</div>
      <h2 style={{ fontSize: 22, fontWeight: 700, marginBottom: 6 }}>Sistema online!</h2>
      <p className="text-muted" style={{ marginBottom: 20 }}>
        Compartilhe o endereço abaixo com todos os terminais da feira.
      </p>

      <div className="ip-box">
        <div className="ip-text">{url}</div>
        <div className="ip-hint">IP da rede local · porta {config.port}</div>
      </div>

      <div style={{ display: "flex", gap: 10, justifyContent: "center", marginBottom: 24 }}>
        <button className="btn btn-success" onClick={openBrowser}>
          🌐 Abrir no navegador
        </button>
        <button className="btn btn-ghost" onClick={copy}>
          📋 Copiar endereço
        </button>
      </div>

      <div className="card" style={{ textAlign: "left" }}>
        <div className="section-title">Detalhes da sessão</div>
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <InfoRow label="Evento" value={config.event_name} />
          <InfoRow label="Backend" value={`127.0.0.1:${config.port}`} />
          <InfoRow label="Rede local" value={`${lanIp}:${config.port}`} />
        </div>
      </div>

      <button
        className="btn btn-ghost"
        style={{ marginTop: 20, width: "100%", justifyContent: "center" }}
        onClick={onViewLogs}
      >
        Ver logs e controles →
      </button>
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
      <span style={{ color: "var(--subtext)" }}>{label}</span>
      <span style={{ fontFamily: "var(--mono)", color: "var(--text)" }}>{value}</span>
    </div>
  );
}
