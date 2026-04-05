from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    admin_token: str = "admin_token_change_me"
    secret_key: str = "secret_key_change_me"
    database_url: str = "sqlite:///./ouroboros.db"

    # Firebase
    firebase_project_id: str | None = None
    firebase_private_key: str | None = None
    firebase_client_email: str | None = None

    # Evento
    event_name: str = "Feira da Troca"
    max_comandas: int = 1000
    port: int = 8000

    class Config:
        env_file = ".env"

settings = Settings()
