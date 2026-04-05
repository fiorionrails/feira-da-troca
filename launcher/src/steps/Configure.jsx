import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";

function generateToken(len = 32) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  return Array.from({ length: len }, () => chars[Math.floor(Math.random() * chars.length)]).join("");
}

export default function Configure({ initial, onBack, onNext }) {
  const [eventName, setEventName] = useState(initial?.event_name ?? "Feira da Troca");
  const [adminToken, setAdminToken] = useState(initial?.admin_token ?? generateToken());
  const [port, setPort] = useState(String(initial?.port ?? 8000));
  const [showToken, setShowToken] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function handleNext() {
    setError("");
    if (!adminToken.trim()) { setError("O token admin não pode ser vazio."); return; }
    if (!eventName.trim()) { setError("O nome do evento não pode ser vazio."); return; }
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1024 || portNum > 65535) {
      setError("Porta inválida. Use um valor entre 1024 e 65535.");
      return;
    }
    setSaving(true);
    try {
      const cfg = { admin_token: adminToken.trim(), event_name: eventName.trim(), port: portNum };
      await invoke("write_config", { config: cfg });
      onNext(cfg);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Configuração do sistema</h2>
      <p className="text-muted" style={{ marginBottom: 24 }}>
        Estas configurações ficam salvas e são usadas em cada inicialização.
      </p>

      <div className="form-group">
        <label className="form-label">Nome do evento</label>
        <input
          className="form-input"
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
          placeholder="Ex: Feira da Troca 2025"
        />
      </div>

      <div className="form-group">
        <label className="form-label">Token admin</label>
        <div className="form-input-row">
          <input
            className="form-input"
            type={showToken ? "text" : "password"}
            value={adminToken}
            onChange={(e) => setAdminToken(e.target.value)}
            style={{ fontFamily: "var(--mono)", fontSize: 12 }}
          />
          <button
            className="btn btn-ghost"
            style={{ padding: "9px 12px", flexShrink: 0 }}
            onClick={() => setShowToken((v) => !v)}
            title={showToken ? "Ocultar" : "Mostrar"}
          >
            {showToken ? "🙈" : "👁"}
          </button>
          <button
            className="btn btn-ghost"
            style={{ padding: "9px 12px", flexShrink: 0 }}
            onClick={() => setAdminToken(generateToken())}
            title="Gerar novo token"
          >
            🔄
          </button>
        </div>
        <p className="text-muted mt-2">
          Usado para autenticar o Terminal Banco. Guarde em local seguro.
        </p>
      </div>

      <div className="form-group">
        <label className="form-label">Porta do servidor</label>
        <input
          className="form-input"
          type="number"
          value={port}
          onChange={(e) => setPort(e.target.value)}
          min={1024}
          max={65535}
          style={{ maxWidth: 120 }}
        />
      </div>

      {error && (
        <div style={{ color: "var(--red)", fontSize: 13, marginBottom: 12 }}>
          ⚠ {error}
        </div>
      )}

      <div className="row-end">
        <button className="btn btn-ghost" onClick={onBack}>← Voltar</button>
        <button className="btn btn-primary" onClick={handleNext} disabled={saving}>
          {saving ? "Salvando..." : "Continuar →"}
        </button>
      </div>
    </div>
  );
}
