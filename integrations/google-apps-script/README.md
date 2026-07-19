# Google Apps Script bridge

`Code.gs` превращает одну Google Таблицу в центральный реестр «Орбиты».

1. Создайте Google Таблицу или импортируйте шаблон `Orbita-Google-Sheets-Template.xlsx`.
2. Откройте **Расширения → Apps Script**.
3. Замените содержимое `Code.gs` кодом из этого каталога.
4. Запустите функцию `setupOrbita` и разрешите доступ к таблице.
5. Скопируйте показанный секрет синхронизации.
6. Нажмите **Deploy → New deployment → Web app**.
7. Выберите **Execute as: Me**, **Who has access: Anyone** и скопируйте URL `/exec`.
8. На Windows запустите `configure-google-sheets.cmd` и вставьте URL и секрет.

Доступ к веб-приложению защищён случайным секретом. Не добавляйте секрет в Git и не публикуйте его в общих инструкциях ChatGPT.
