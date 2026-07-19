@echo off
cd /d "%~dp0"
echo Computer IPv4 addresses on the local network:
ipconfig | findstr /i "IPv4"
echo.
if exist "data\sync-token.txt" (
  echo Sync token:
  type "data\sync-token.txt"
) else (
  echo Sync token was not found. Run start-windows.cmd first.
)
echo.
echo Android server address: http://COMPUTER-IP:3766
pause
