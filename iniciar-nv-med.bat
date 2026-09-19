@echo off
setlocal

cd /d "%~dp0"

echo ========================================
echo          NV Med - Ambiente local
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERRO] Node.js nao foi encontrado.
  echo Instale o Node.js e execute este arquivo novamente.
  pause
  exit /b 1
)

where npm >nul 2>&1
if errorlevel 1 (
  echo [ERRO] npm nao foi encontrado.
  echo Reinstale o Node.js com o npm habilitado.
  pause
  exit /b 1
)

if not exist "node_modules" (
  echo Instalando dependencias...
  call npm install
  if errorlevel 1 (
    echo.
    echo [ERRO] Nao foi possivel instalar as dependencias.
    pause
    exit /b 1
  )
)

echo Iniciando o NV Med em http://localhost:3000
echo Para desligar o servidor, pressione Ctrl+C.
echo.

call npm run dev

if errorlevel 1 (
  echo.
  echo [ERRO] O servidor foi encerrado com falha.
  pause
  exit /b 1
)

endlocal
