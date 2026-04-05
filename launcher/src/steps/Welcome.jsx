import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export default function Welcome({ onConfigure }) {
  const [loading, setLoading] = useState(true);
  const [existing, setExisting] = useState(null);

  useEffect(() => {
    invoke("read_config")
      .then((cfg) => {
        setExisting(cfg);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div style={{ textAlign: "center", paddingTop: 60, color: "var(--subtext)" }}>
        Carregando...
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto", textAlign: "center", paddingTop: 20 }}>
      <div style={{ fontSize: 56, marginBottom: 16 }}>🐍</div>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Ouroboros</h2>
      <p style={{ color: "var(--subtext)", marginBottom: 32, lineHeight: 1.6 }}>
        Sistema de economia digital para feiras escolares.<br />
        Funciona 100% offline na sua rede local.
      </p>

      {existing ? (
        <div>
          <div className="card" style={{ textAlign: "left", marginBottom: 16 }}>
            <div className="section-title">Configuração encontrada</div>
            <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 6 }}>
              <ConfigRow label="Evento" value={existing.event_name} />
              <ConfigRow label="Porta" value={existing.port} />
              <ConfigRow label="Token Admin" value={"●".repeat(10)} />
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button className="btn btn-primary" onClick={() => onConfigure(existing)}>
              ▶ Iniciar servidor
            </button>
            <button className="btn btn-ghost" onClick={() => onConfigure(existing)}>
              ✏ Editar config
            </button>
          </div>
        </div>
      ) : (
        <div>
          <p className="text-muted" style={{ marginBottom: 20 }}>
            Nenhuma configuração encontrada. Vamos configurar o sistema agora.
          </p>
          <button className="btn btn-primary" onClick={() => onConfigure(null)}>
            Começar configuração →
          </button>
        </div>
      )}
    </div>
  );
}

function ConfigRow({ label, value }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", fontSize: 13 }}>
      <span style={{ color: "var(--subtext)" }}>{label}</span>
      <span style={{ color: "var(--text)", fontFamily: "var(--mono)" }}>{value}</span>
    </div>
  );
}
