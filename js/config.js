// =========================================================================
// Конфигурация клиентского API ООО «ФЕДСТРОЙ»
// =========================================================================

export const CONFIG = {
  // Основной эндпоинт отправки заявок:
  // Если сайт открыт с локального сервера или своего домена — используется относительный путь /api/lead.
  // При деплое на сторонний бэкенд укажите полный URL (например, https://api.ooofedstroy.ru/api/lead).
  API_URL: window.location.origin.includes('github.io')
    ? 'https://ooofedstroy-api.onrender.com/api/lead' // URL продакшн-сервера или fallback
    : '/api/lead',

  // Прямые каналы оперативной связи
  PHONE_PRIMARY: '8 (800) 700-02-23',
  PHONE_MOBILE: '+7 (960) 744-09-91',
  TELEGRAM_URL: 'https://t.me/Lexus2026',
  WHATSAPP_URL: 'https://wa.me/79607440991',
  EMAIL_OFFICIAL: 'ooofedstroy@mail.ru'
};
