@echo off
chcp 65001 >nul
color 0B
title Sistema Ouroboros - Inicializador Automatico (Docker)

echo ==========================================================
echo          BEM-VINDO AO SISTEMA DA FEIRA DA TROCA
echo ==========================================================
echo.
echo Pressione uma opcao para escolher qual backend usar:
echo.
echo [1] Backend Python (FastAPI)
echo [2] Backend Node.js
echo.
set /p opcao="Digite 1 ou 2 e pressione ENTER: "

echo.
echo ==========================================================
echo Preparando o Ambiente (Docker)... Isso pode demorar na 1a vez!
echo ==========================================================

if "%opcao%"=="1" (
    echo [OK] Ligando Servidor Docker com Python...
    docker compose --profile python up --build -d
) else if "%opcao%"=="2" (
    echo [OK] Ligando Servidor Docker com Node.js...
    docker compose --profile node up --build -d
) else (
    echo Opcao Invalida! O sistema vai fechar.
    pause
    exit
)

echo.
echo Tudo Pronto! O sistema esta rodando em segundo plano.
echo Redirecionando para o seu navegador...
timeout /t 5 >nul
start http://localhost:5173

exit
