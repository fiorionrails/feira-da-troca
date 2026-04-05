// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::net::UdpSocket;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_shell::process::CommandChild;
use tauri_plugin_shell::ShellExt;

// ---------- Estado global ----------

struct BackendChild(Mutex<Option<CommandChild>>);

// ---------- Tipos ----------

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Config {
    pub admin_token: String,
    pub event_name: String,
    pub port: u16,
}

// ---------- Helpers ----------

fn app_data(app: &AppHandle) -> PathBuf {
    app.path()
        .app_data_dir()
        .expect("Não foi possível obter o diretório de dados do app")
}

fn resource_dir(app: &AppHandle) -> PathBuf {
    app.path()
        .resource_dir()
        .expect("Não foi possível obter o diretório de recursos")
}

// ---------- Comandos Tauri ----------

/// Retorna o IP LAN da máquina (detectado via UDP sem enviar dados).
#[tauri::command]
fn get_lan_ip() -> String {
    let socket = match UdpSocket::bind("0.0.0.0:0") {
        Ok(s) => s,
        Err(_) => return "127.0.0.1".to_string(),
    };
    let _ = socket.connect("8.8.8.8:80");
    match socket.local_addr() {
        Ok(addr) => addr.ip().to_string(),
        Err(_) => "127.0.0.1".to_string(),
    }
}

/// Lê a configuração do arquivo .env no diretório de dados do app.
/// Retorna None se ainda não foi configurado.
#[tauri::command]
fn read_config(app: AppHandle) -> Result<Option<Config>, String> {
    let env_path = app_data(&app).join(".env");
    if !env_path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&env_path).map_err(|e| e.to_string())?;
    let mut cfg = Config {
        admin_token: String::new(),
        event_name: "Feira da Troca".to_string(),
        port: 8000,
    };
    for line in content.lines() {
        if let Some((key, val)) = line.split_once('=') {
            match key.trim() {
                "ADMIN_TOKEN" => cfg.admin_token = val.trim().to_string(),
                "EVENT_NAME" => cfg.event_name = val.trim().to_string(),
                "PORT" => cfg.port = val.trim().parse().unwrap_or(8000),
                _ => {}
            }
        }
    }
    if cfg.admin_token.is_empty() {
        return Ok(None);
    }
    Ok(Some(cfg))
}

/// Salva a configuração no arquivo .env no diretório de dados do app.
#[tauri::command]
fn write_config(app: AppHandle, config: Config) -> Result<(), String> {
    let dir = app_data(&app);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let content = format!(
        "ADMIN_TOKEN={}\nEVENT_NAME={}\nPORT={}\nDATABASE_URL=ouroboros.db\n",
        config.admin_token, config.event_name, config.port
    );
    std::fs::write(dir.join(".env"), content).map_err(|e| e.to_string())
}

/// Inicia o backend como sidecar e transmite os logs via evento "backend-log".
#[tauri::command]
async fn start_server(
    app: AppHandle,
    state: State<'_, BackendChild>,
) -> Result<(), String> {
    {
        let guard = state.0.lock().map_err(|e| e.to_string())?;
        if guard.is_some() {
            return Err("Servidor já está em execução".to_string());
        }
    }

    let data_dir = app_data(&app);
    let res_dir = resource_dir(&app);

    let binding_path = res_dir.join("better_sqlite3.node");
    let frontend_dist = res_dir.join("frontend-dist");

    let mut cmd = app
        .shell()
        .sidecar("ouroboros-backend")
        .map_err(|e| e.to_string())?
        .env("OUROBOROS_DATA_DIR", data_dir.to_str().unwrap_or(""))
        .env(
            "BETTER_SQLITE3_BINDING",
            binding_path.to_str().unwrap_or(""),
        );

    if frontend_dist.exists() {
        cmd = cmd.env("FRONTEND_DIST", frontend_dist.to_str().unwrap_or(""));
    }

    let (mut rx, child) = cmd.spawn().map_err(|e| {
        format!("Falha ao iniciar o backend: {}", e)
    })?;

    {
        let mut guard = state.0.lock().map_err(|e| e.to_string())?;
        *guard = Some(child);
    }

    // Lê stdout/stderr e emite eventos de log para o frontend
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        use tauri_plugin_shell::process::CommandEvent;
        while let Some(event) = rx.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).trim_end().to_string();
                    let _ = app_handle.emit("backend-log", line);
                }
                CommandEvent::Stderr(bytes) => {
                    let line = String::from_utf8_lossy(&bytes).trim_end().to_string();
                    let _ = app_handle.emit("backend-log", format!("[ERR] {}", line));
                }
                CommandEvent::Terminated(status) => {
                    let _ = app_handle.emit("backend-stopped", status.code);
                    break;
                }
                _ => {}
            }
        }
    });

    Ok(())
}

/// Para o servidor backend.
#[tauri::command]
fn stop_server(state: State<'_, BackendChild>) -> Result<(), String> {
    let mut guard = state.0.lock().map_err(|e| e.to_string())?;
    if let Some(child) = guard.take() {
        child.kill().map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Abre uma URL no navegador padrão do sistema.
#[tauri::command]
fn open_browser(app: AppHandle, url: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(&url, None::<&str>)
        .map_err(|e| e.to_string())
}

// ---------- Entry point ----------

fn main() {
    tauri::Builder::default()
        .manage(BackendChild(Mutex::new(None)))
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_opener::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.try_state::<BackendChild>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(child) = guard.take() {
                            let _ = child.kill();
                        }
                    }
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            get_lan_ip,
            read_config,
            write_config,
            start_server,
            stop_server,
            open_browser,
        ])
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar o Ouroboros Launcher");
}
