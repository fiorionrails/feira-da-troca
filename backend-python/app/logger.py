"""
CLI logger for the Ouroboros backend (Python).
Pure ANSI escape codes — zero extra dependencies.
Mirrors the interface and output format of backend-node/src/logger.js.
"""

import sys
import socket
from datetime import datetime

# ---------------------------------------------------------------------------
# ANSI palette
# ---------------------------------------------------------------------------
_C = {
    "reset":    "\x1b[0m",
    "bold":     "\x1b[1m",
    "dim":      "\x1b[2m",
    "red":      "\x1b[31m",
    "green":    "\x1b[32m",
    "yellow":   "\x1b[33m",
    "blue":     "\x1b[34m",
    "magenta":  "\x1b[35m",
    "cyan":     "\x1b[36m",
    "gray":     "\x1b[90m",
    "bRed":     "\x1b[91m",
    "bGreen":   "\x1b[92m",
    "bYellow":  "\x1b[93m",
    "bBlue":    "\x1b[94m",
    "bMagenta": "\x1b[95m",
    "bCyan":    "\x1b[96m",
    "bWhite":   "\x1b[97m",
}
C = type("C", (), _C)()

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _ts() -> str:
    return datetime.now().strftime("%H:%M:%S")

def _pad(s, n: int) -> str:
    return str(s).ljust(n)

def _rpad(s, n: int) -> str:
    return str(s).rjust(n)

def _emit(tag: str, tag_color: str, *parts: str) -> None:
    line = (
        f"{C.gray}{_ts()}{C.reset}  "
        f"{tag_color}{_pad(tag, 9)}{C.reset}  "
        + "".join(parts)
        + "\n"
    )
    sys.stdout.write(line)
    sys.stdout.flush()

def _get_lan_ips() -> list:
    ips = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None):
            addr = info[4][0]
            if ":" not in addr and addr != "127.0.0.1":
                if addr not in ips:
                    ips.append(addr)
    except Exception:
        pass
    return ips

# ---------------------------------------------------------------------------
# Banner
# ---------------------------------------------------------------------------
def banner(config: dict) -> None:
    """Prints the startup banner.
    config keys: port, database_url, admin_token, max_comandas, event_name
    """
    W = 56
    def bar(ch, l, r): return f"{l}{ch * (W - 2)}{r}"
    def row(s=""): return f"│  {(s + C.reset):<{W + 30}}│"

    ips = _get_lan_ips()
    token = config.get("admin_token", "")
    mask = token[:3] + "•" * min(len(token) - 3, 5) if len(token) > 3 else "••••••"

    lines = [
        bar("─", "┌", "┐"),
        row(),
        row(f"   {C.bold}{C.bYellow}◆  OUROBOROS{C.reset}   {C.dim}{config.get('event_name', '')}"),
        row(),
        bar("─", "├", "┤"),
        row(f"   {C.cyan}Porta    {C.reset}{C.bold}{config.get('port', 8000)}{C.reset}"),
        row(f"   {C.cyan}Banco    {C.reset}{config.get('database_url', '')}"),
        row(f"   {C.cyan}Token    {C.reset}{mask}"),
        row(f"   {C.cyan}Limite   {C.reset}{config.get('max_comandas', 1000)} comandas"),
    ]
    if ips:
        lines.append(bar("─", "├", "┤"))
        for ip in ips:
            lines.append(row(f"   {C.bGreen}↗  rede  {C.reset}{C.bold}http://{ip}:{config.get('port', 8000)}{C.reset}"))
    lines += [row(), bar("─", "└", "┘")]

    sys.stdout.write("\n" + "\n".join(lines) + "\n\n")
    _emit("PRONTO", C.bGreen, f"{C.bGreen}servidor ouvindo em todas as interfaces{C.reset}")
    sys.stdout.write("\n")
    sys.stdout.flush()

# ---------------------------------------------------------------------------
# REST
# ---------------------------------------------------------------------------
def rest(method: str, path: str, status: int, ms: float) -> None:
    m_colors = {"GET": C.bBlue, "POST": C.bGreen, "PUT": C.bYellow, "DELETE": C.bRed}
    m_color = m_colors.get(method, C.reset)
    s_color = C.bGreen if status < 300 else C.bYellow if status < 400 else C.bRed
    _emit(
        "REST", C.blue,
        f"{m_color}{_pad(method, 7)}{C.reset}",
        f"{C.dim}{_pad(path, 34)}{C.reset}",
        f"{s_color}{status}{C.reset}",
        f"  {C.gray}{ms}ms{C.reset}",
    )

# ---------------------------------------------------------------------------
# WebSocket — conexões
# ---------------------------------------------------------------------------
def ws_connect(role: str, name: str, active_count: int) -> None:
    cfgs = {
        "admin":   ("ADMIN ↑", C.bMagenta),
        "store":   ("LOJA ↑",  C.bCyan),
        "packing": ("PACK ↑",  C.bCyan),
    }
    tag, color = cfgs.get(role, ("WS ↑", C.cyan))
    plural = "" if active_count == 1 else "s"
    _emit(tag, color,
          f"{C.bold}{name}{C.reset}",
          f"  {C.gray}({active_count} ativa{plural}){C.reset}")

def ws_disconnect(role: str, name: str, active_count: int) -> None:
    cfgs = {
        "admin":   ("ADMIN ↓", C.magenta),
        "store":   ("LOJA ↓",  C.cyan),
        "packing": ("PACK ↓",  C.cyan),
    }
    tag, color = cfgs.get(role, ("WS ↓", C.gray))
    plural = "" if active_count == 1 else "s"
    _emit(tag, color,
          f"{C.dim}{name}{C.reset}",
          f"  {C.gray}({active_count} ativa{plural}){C.reset}")

def ws_auth_fail(role: str) -> None:
    _emit("AUTH ✗", C.bRed,
          f"{C.bRed}tentativa sem token válido{C.reset}  {C.gray}({role}){C.reset}")

# ---------------------------------------------------------------------------
# Transações
# ---------------------------------------------------------------------------
def comanda_criada(code: str, holder_name: str, balance: int) -> None:
    if balance > 0:
        detail = (f"{C.bGreen}+{_rpad(balance, 4)} ETC{C.reset}"
                  f"  {C.gray}saldo: {balance}{C.reset}")
    else:
        detail = f"{C.gray}sem saldo inicial{C.reset}"
    _emit("COMANDA", C.bYellow,
          f"{C.bold}{_pad(code, 6)}{C.reset}  {C.bWhite}{_pad(holder_name, 18)}{C.reset}",
          detail)

def debito_confirmado(code: str, holder_name: str, amount: int, new_balance: int, store_name: str) -> None:
    _emit("DÉBITO ✔", C.bGreen,
          f"{C.bold}{_pad(code, 6)}{C.reset}  {_pad(holder_name, 18)}",
          f"{C.bRed}-{_rpad(amount, 4)} ETC{C.reset}",
          f"  {C.gray}→ {_rpad(new_balance, 5)} ETC  {store_name}{C.reset}")

def debito_rejeitado(code: str, reason: str, requested, current_balance, store_name: str) -> None:
    if reason == "insufficient_balance":
        detail = (f"saldo insuficiente  req:{C.bold}{requested}{C.reset}"
                  f"{C.yellow}  atual:{current_balance}")
    elif reason == "invalid_amount":
        detail = f"valor inválido ({requested})"
    elif reason == "comanda_not_found":
        detail = f"comanda não encontrada ({code})"
    else:
        detail = reason
    _emit("DÉBITO ✗", C.bYellow,
          f"{C.bold}{_pad(code or '?', 6)}{C.reset}  ",
          f"{C.yellow}{detail}{C.reset}",
          f"  {C.gray}{store_name}{C.reset}")

def credito_confirmado(code: str, holder_name: str, amount: int, new_balance: int) -> None:
    _emit("CRÉDITO", C.bGreen,
          f"{C.bold}{_pad(code, 6)}{C.reset}  {_pad(holder_name, 18)}",
          f"{C.bGreen}+{_rpad(amount, 4)} ETC{C.reset}",
          f"  {C.gray}→ {_rpad(new_balance, 5)} ETC{C.reset}")

# ---------------------------------------------------------------------------
# Outros eventos
# ---------------------------------------------------------------------------
def broadcast(msg_type: str, count: int) -> None:
    _emit("BROAD.", C.gray,
          f"{C.dim}{_pad(msg_type, 30)}→ {count} conexão(ões){C.reset}")

def rate_limited(role: str, name: str = None) -> None:
    extra = f" ({name})" if name else ""
    _emit("RATE ✗", C.yellow,
          f"{C.yellow}limite atingido{C.reset}  {C.gray}{role}{extra}{C.reset}")

def db_connect(db_path: str) -> None:
    _emit("DB", C.cyan, f"{C.dim}conectado → {db_path}{C.reset}")

def server_error(context: str, message: str) -> None:
    _emit("ERRO", C.bRed,
          f"{C.bRed}[{context}]{C.reset}  {C.red}{message}{C.reset}")
