@echo off
setlocal
cd /d "%~dp0"

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\configure-google-oauth.ps1" -Source "%~1"
if errorlevel 1 (
  echo.
  echo Google OAuth setup failed.
  pause
  exit /b 1
)

echo.
echo Google OAuth client configured. You can return to Orbita and sign in.
pause
