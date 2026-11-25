# Приём заявок через Yandex Cloud Functions + GitHub Pages

## 1. Включение GitHub Pages
В репозитории уже добавлен workflow [`.github/workflows/pages.yml`](../.github/workflows/pages.yml):
1. Откройте на GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. После ближайшего пуша в `main` сайт автоматически соберётся и откроется по адресу:
   `https://kobnuhok.github.io/fedstroy-landing/`

## 2. Создание Yandex Cloud Function (бесплатный лимит до 1 млн вызовов/мес)
1. В консоли [Yandex Cloud Functions](https://console.cloud.yandex.ru/) создайте функцию (например, `fedstroy-lead`).
2. Среда выполнения: **Node.js 20** (или **Node.js 18**).
3. Точка входа: `index.handler`.
4. Загрузите файлы из папки `yandex-cloud/` (`index.js` и `package.json`).
5. Задайте переменные окружения функции:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_CHAT_ID`
   - `SMTP_USER` (опционально)
   - `SMTP_PASS` (опционально)
   - `EMAIL_TO` (опционально, по умолчанию `kobnuhok@yandex.ru`)
6. Сделайте функцию **публичной** (включите переключатель «Публичная функция») и скопируйте её HTTP URL вида:
   `https://functions.yandexcloud.net/<FUNCTION_ID>`

## 3. Подключение URL функции на фронтенд
Откройте [`js/config.js`](../js/config.js) и вставьте ваш URL функции в `YANDEX_FUNCTION_URL`, затем выполните `npm run build` и запушьте в `main`.
