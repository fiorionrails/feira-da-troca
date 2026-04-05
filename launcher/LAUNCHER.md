# Ouroboros Launcher

Interface gráfica para iniciar e configurar o sistema Ouroboros sem usar linha de comando.
Construída com **Tauri 2** (Rust + React) e empacotada como `.exe` (Windows) e `.AppImage` (Linux).

## Como funciona

O launcher é uma janela de 700×540px que guia o operador em 5 passos:

1. **Boas-vindas** — detecta se já existe configuração salva
2. **Configurar** — nome do evento, token admin (com gerador automático), porta
3. **Iniciando** — barra de progresso + ping HTTP para confirmar que o backend subiu
4. **Pronto!** — exibe o IP LAN detectado automaticamente, botão "Abrir no navegador"
5. **Painel** — logs em tempo real, botões Abrir / Copiar / Parar servidor

Ao fechar a janela, o backend é encerrado automaticamente.

## Arquitetura interna

```
launcher/
├── src/                        # React (wizard UI)
│   ├── App.jsx                 # Roteador de passos + stepper visual
│   ├── App.css                 # Tema escuro, sem bibliotecas externas
│   └── steps/
│       ├── Welcome.jsx
│       ├── Configure.jsx
│       ├── Starting.jsx
│       ├── Ready.jsx
│       └── Dashboard.jsx
├── src-tauri/
│   ├── src/main.rs             # Comandos Rust (ver abaixo)
│   ├── Cargo.toml
│   ├── tauri.conf.json         # Config do app (janela, bundle, sidecar)
│   ├── capabilities/
│   │   └── default.json        # Permissões Tauri 2
│   ├── binaries/               # Backend compilado pelo pkg (gerado no CI)
│   └── resources/              # frontend-dist/ e better_sqlite3.node (gerado no CI)
├── package.json
├── vite.config.js
└── index.html
```

### Comandos Rust expostos ao React

| Comando | Descrição |
|---|---|
| `get_lan_ip()` | Detecta o IP LAN via UDP (sem enviar dados) |
| `read_config()` | Lê o `.env` do diretório de dados do app |
| `write_config(config)` | Salva o `.env` no diretório de dados do app |
| `start_server()` | Inicia o backend como sidecar; emite eventos `backend-log` e `backend-stopped` |
| `stop_server()` | Mata o processo do backend |
| `open_browser(url)` | Abre URL no navegador padrão do sistema |

### Onde ficam os dados em runtime

O launcher usa o diretório de dados padrão do sistema operacional (via `app.path().app_data_dir()`):

- **Windows:** `%APPDATA%\com.feiradatroca.launcher\`
- **Linux:** `~/.local/share/com.feiradatroca.launcher/`

O `.env` e o `ouroboros.db` ficam nesse diretório, passados ao backend via `OUROBOROS_DATA_DIR`.

### Como o backend é embutido

O `backend-node/src/app.js` é compilado com `pkg` em um único executável sem dependências externas, exceto pelo módulo nativo `better_sqlite3.node` que fica nos recursos do Tauri. O launcher passa o caminho via `BETTER_SQLITE3_BINDING`.

O frontend React compilado fica em `resources/frontend-dist/` e o backend o serve via `FRONTEND_DIST` — tudo na mesma porta 8000.

## Modificações no backend-node

Três variáveis de ambiente novas (todas opcionais, backward-compatible):

| Variável | Uso |
|---|---|
| `OUROBOROS_DATA_DIR` | Diretório onde ficam `.env` e `ouroboros.db` |
| `BETTER_SQLITE3_BINDING` | Caminho para o `.node` nativo do SQLite |
| `FRONTEND_DIST` | Diretório com os estáticos do frontend para servir |

Novo endpoint sempre disponível: `GET /api/health` — retorna `{ status, mode, event }`.

## Build e Release

### Requisitos de desenvolvimento

- Rust + Cargo (instalar via https://rustup.rs)
- Node.js 18+

### Rodar em modo dev

```bash
cd launcher
npm install
npm run tauri dev
```

> Requer que o backend esteja rodando ou que o sidecar compilado esteja em `src-tauri/binaries/`.

### Publicar release no GitHub

Apenas crie uma tag semântica:

```bash
git tag v1.0.0
git push origin v1.0.0
```

O workflow `.github/workflows/release.yml` cuida do resto:

1. Faz `npm run build` no frontend
2. Compila `backend-node` com `pkg` para Windows e Linux
3. Copia `better_sqlite3.node` e `frontend/dist` para os recursos do Tauri
4. Executa `tauri build` em cada plataforma
5. Publica os artefatos como **GitHub Release draft** (para você revisar antes de publicar)

### Artefatos gerados por plataforma

| Plataforma | Artefato | Tamanho estimado |
|---|---|---|
| Windows | `Ouroboros.Launcher_x.x.x_x64-setup.exe` | ~20 MB |
| Linux | `ouroboros-launcher_x.x.x_amd64.AppImage` | ~15 MB |

## Ícone do app

O workflow tenta gerar ícones automaticamente a partir de `docs/assets/icon.png`.  
Requisito: imagem PNG quadrada de pelo menos **1024×1024px**.

Se preferir gerar manualmente:

```bash
cd launcher
npx tauri icon ../docs/assets/icon.png
```

Isso cria todos os tamanhos necessários em `src-tauri/icons/`.

## TODO

- [ ] Adicionar ícone em `docs/assets/icon.png`
- [ ] Testar build no Windows (verificar caminho do `better_sqlite3.node`)
- [ ] Testar build no Linux (verificar permissão de execução no AppImage)
- [ ] Considerar auto-update via `tauri-plugin-updater` em versões futuras
