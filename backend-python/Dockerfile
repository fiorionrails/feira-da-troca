FROM python:3.11-slim
WORKDIR /app

# Otimizacao do cache de dependencias do python
COPY requirements.txt ./
# Instalando as libs
RUN pip install --no-cache-dir -r requirements.txt

# Copiando todo o codigo
COPY . .

# Porta padrao do uvicorn
EXPOSE 8000

# Iniciando via Uvicorn (FastAPI) em modo producao (sem hot-reload)
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
