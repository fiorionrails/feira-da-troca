import os
import sys
import secrets
from dotenv import load_dotenv

def run_setup():
    print("\n" + "="*50)
    print(" BEM-VINDO À INSTALAÇÃO DO OUROBOROS (BACKEND PYTHON)")
    print("="*50)
    
    # 1. Obter Admin Token
    admin_token = ""
    while not admin_token:
        admin_token = input("\nEscolha uma Senha (Token) para a Área Admin (ex: ADMIN123): ").strip()
    
    # 2. Gerar arquivo .env
    secret_key = secrets.token_hex(32)
    porta_str = input("Qual porta deseja usar [Padrao: 8000]? ").strip()
    porta = porta_str if porta_str else "8000"
    
    if getattr(sys, 'frozen', False):
        base_dir = os.path.dirname(sys.executable)
    else:
        base_dir = os.getcwd()

    env_path = os.path.join(base_dir, ".env")
    
    # IMPORTANTE: Criamos o .env no diretório onde o usuário abriu o .exe!
    with open(env_path, "w", encoding="utf-8") as f:
        f.write(f"ADMIN_TOKEN={admin_token}\n")
        f.write(f"SECRET_KEY={secret_key}\n")
        f.write(f"PORT={porta}\n")
        f.write(f"DATABASE_URL=sqlite:///./ouroboros.db\n")
        f.write("EVENT_NAME=Feira da Troca\n")
        f.write("MAX_COMANDAS=1000\n")
    
    print("\nArquivo de configuracao ['.env'] criado com sucesso!")
    print(f"Token Administrativo salvo: {admin_token}")
    print("Iniciando o servidor...")

def get_base_dir():
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.getcwd()

if __name__ == "__main__":
    base_dir = get_base_dir()
    env_path = os.path.join(base_dir, ".env")
    
    if not os.path.exists(env_path):
        run_setup()

    # Temos que carregar o .env da pasta corrente real (onde o exe está)
    # antes das configurações do Pydantic subirem.
    load_dotenv(env_path)

    # Inicializar Tabelas no banco de dados
    try:
        from manage import init_db
        init_db()
    except Exception as e:
        print(f"Erro ao inicializar SQLite: {e}")

    # Inicializar o Uvicorn com o aplicativo FastAPI programaticamente
    # No Pyinstaller, precisamos passar o objeto `app` diretamente.
    import uvicorn
    from app.main import app

    port = int(os.environ.get("PORT", "8000"))
    print("\n" + "="*50)
    print(f" Servidor ON! Porta: {port} ")
    print(" Pare o terminal (feche a tela) para encerrar o sistema.")
    print("="*50 + "\n")
    
    uvicorn.run(app, host="0.0.0.0", port=port)
