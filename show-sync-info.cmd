@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Адреса компьютера в локальной сети:
ipconfig | findstr /i "IPv4"
echo.
if exist "data\sync-token.txt" (
  echo Токен синхронизации:
  type "data\sync-token.txt"
) else (
  echo Токен ещё не создан. Сначала запустите start-windows.cmd.
)
echo.
echo В Android укажите адрес: http://IP-КОМПЬЮТЕРА:3766
pause
