import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const STEPS = [
  { id: "start", label: "Iniciando o servidor backend..." },
  { id: "wait", label: "Aguardando resposta do servidor..." },
  { id: "done", label: "Sistema online!" },
];

export default function Starting({ config, lanIp, onDone }) {
  const [currentStep, setCurrentStep] = useState(0); // índice em STEPS
  const [progress, setProgress] = useState(10);
  const [error, setError] = useState("");
  const unlistenRef = useRef(null);

  useEffect(() => {
    let cancelled = false;

    async function run() {
      // Ouve logs para saber quando o servidor está pronto
      unlistenRef.current = await listen("backend-log", (event) => {
        if (typeof event.payload === "string" && event.payload.includes("listening")) {
          if (!cancelled) {
            setCurrentStep(2);
            setProgress(100);
            setTimeout(onDone, 800);
          }
        }
      });

      // Inicia o servidor
      try {
        await invoke("start_server");
      } catch (e) {
        if (!cancelled) setError(String(e));
        return;
      }

      if (cancelled) return;
      setCurrentStep(1);
      setProgress(50);

      // Timeout de espera — confirma via ping HTTP
      const url = `http://127.0.0.1:${config.port}/api/health`;
      for (let i = 0; i < 20; i++) {
        if (cancelled) return;
        await new Promise((r) => setTimeout(r, 500));
        try {
          const res = await fetch(url);
          if (res.ok) {
            if (!cancelled) {
              setCurrentStep(2);
              setProgress(100);
              setTimeout(onDone, 800);
            }
            return;
          }
        } catch {
          // ainda não respondeu, tenta novamente
        }
        setProgress(50 + Math.min(i * 2.5, 45));
      }

      if (!cancelled) {
        setError(
          "O servidor não respondeu em 10 segundos. Verifique a aba de logs para mais detalhes."
        );
      }
    }

    run();

    return () => {
      cancelled = true;
      unlistenRef.current?.();
    };
  }, []);

  return (
    <div style={{ maxWidth: 480, margin: "0 auto" }}>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 6 }}>Iniciando o sistema</h2>
      <p className="text-muted" style={{ marginBottom: 24 }}>
        Aguarde enquanto o servidor é preparado...
      </p>

      <ul className="step-list">
        {STEPS.map((s, i) => {
          const state = i < currentStep ? "done" : i === currentStep ? "active" : "";
          return (
            <li key={s.id} className={state}>
              <span className="step-icon">
                {i < currentStep ? "✓" : i === currentStep ? "⟳" : "○"}
              </span>
              {s.label}
            </li>
          );
        })}
      </ul>

      <div className="progress-bar-wrap">
        <div className="progress-bar" style={{ width: `${progress}%` }} />
      </div>

      {error && (
        <div style={{ marginTop: 20, color: "var(--red)", fontSize: 13, lineHeight: 1.6 }}>
          ⚠ {error}
        </div>
      )}
    </div>
  );
}
