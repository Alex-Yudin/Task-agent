@echo off
chcp 65001 >nul
net session >nul 2>nul
if errorlevel 1 (
  echo Запустите этот файл от имени администратора.
  echo Нажмите правой кнопкой мыши и выберите "Запуск от имени администратора".
  pause
  exit /b 1
)

netsh advfirewall firewall delete rule name="Orbita Android Sync" >nul 2>nul
netsh advfirewall firewall add rule name="Orbita Android Sync" dir=in action=allow protocol=TCP localport=3766 profile=private
echo.
echo Порт 3766 открыт только для частной сети Windows.
pause
