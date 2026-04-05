import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import Welcome from "./steps/Welcome";
import Configure from "./steps/Configure";
import Starting from "./steps/Starting";
import Ready from "./steps/Ready";
import Dashboard from "./steps/Dashboard";

// Passos: 0=Welcome 1=Configure 2=Starting 3=Ready 4=Dashboard
const STEP_LABELS = ["Início", "Configurar", "Iniciando", "Pronto", "Painel"];

export default function App() {
  const [step, setStep] = useState(0);
  const [config, setConfig] = useState(null);
  const [lanIp, setLanIp] = useState("127.0.0.1");

  async function goToConfigure(existingConfig) {
    const ip = await invoke("get_lan_ip").catch(() => "127.0.0.1");
    setLanIp(ip);
    setConfig(existingConfig ?? { admin_token: "", event_name: "Feira da Troca", port: 8000 });
    setStep(1);
  }

  async function goToStart(cfg) {
    setConfig(cfg);
    setStep(2);
  }

  function goToReady() {
    setStep(3);
  }

  function goToDashboard() {
    setStep(4);
  }

  function goToWelcome() {
    setStep(0);
  }

  const stepsAboveIndex = step > 1 ? step - 1 : -1;

  return (
    <div className="layout">
      <div className="header">
        <span className="header-logo">🐍</span>
        <h1>Ouroboros <span>Launcher</span></h1>
      </div>

      <div className="content">
        {step > 0 && step < 4 && (
          <Stepper current={step} />
        )}

        {step === 0 && <Welcome onConfigure={goToConfigure} />}
        {step === 1 && <Configure initial={config} onBack={goToWelcome} onNext={goToStart} />}
        {step === 2 && <Starting config={config} lanIp={lanIp} onDone={goToReady} />}
        {step === 3 && <Ready config={config} lanIp={lanIp} onViewLogs={goToDashboard} />}
        {step === 4 && <Dashboard config={config} lanIp={lanIp} onStop={goToWelcome} />}
      </div>
    </div>
  );
}

function Stepper({ current }) {
  // current: 1=Configure, 2=Starting, 3=Ready
  const steps = ["Configurar", "Iniciando", "Pronto!"];
  const idx = current - 1; // 0-based

  return (
    <div className="stepper">
      {steps.map((label, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? 1 : 0 }}>
          <div className={`step-item ${i === idx ? "active" : i < idx ? "done" : ""}`}>
            <div className="step-dot">
              {i < idx ? "✓" : i + 1}
            </div>
            <span>{label}</span>
          </div>
          {i < steps.length - 1 && (
            <div className={`step-line ${i < idx ? "done" : ""}`} />
          )}
        </div>
      ))}
    </div>
  );
}
