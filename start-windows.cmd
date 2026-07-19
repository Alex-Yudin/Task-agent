@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 24 or newer is required.
  echo Download it from https://nodejs.org and run this file again.
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODE_MAJOR=%%v
if %NODE_MAJOR% LSS 24 (
  echo Node.js 24 or newer is required. Installed version:
  node --version
  pause
  exit /b 1
)

start "Orbita" http://127.0.0.1:3765
node --disable-warning=ExperimentalWarning src/server.js
if errorlevel 1 pause
