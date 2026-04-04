@echo off
echo ===========================================
echo   Preparando Empacotamento Python (PyInstaller)
echo ===========================================

echo Instalando PyInstaller e dependencias...
pip install pyinstaller

echo.
echo Iniciando compilacao do Ouroboros (OneFile)...
echo Isso pode levar alguns minutos...

pyinstaller --name ouroboros-python --onefile --clean ^
  --hidden-import uvicorn.logging ^
  --hidden-import uvicorn.loops ^
  --hidden-import uvicorn.loops.auto ^
  --hidden-import uvicorn.protocols ^
  --hidden-import uvicorn.protocols.http ^
  --hidden-import uvicorn.protocols.http.auto ^
  --hidden-import uvicorn.protocols.websockets ^
  --hidden-import uvicorn.protocols.websockets.auto ^
  --hidden-import uvicorn.protocols.websockets.websockets_impl ^
  --hidden-import websockets.legacy.server ^
  --hidden-import anyio ^
  --copy-metadata fastapi ^
  --copy-metadata pydantic ^
  --copy-metadata uvicorn ^
  bootstrap.py

echo.
echo ===========================================
echo   COMPILACAO CONCLUIDA!
echo   O seu executavel .exe esta em: /dist/ouroboros-python.exe
echo ===========================================
pause
