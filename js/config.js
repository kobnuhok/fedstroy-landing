// Client API and contact configuration.

const YANDEX_FUNCTION_URL = 'https://functions.yandexcloud.net/d4eiforlt08mehk999fq';

export const CONFIG = {
  // На GitHub Pages используем Yandex Cloud Function (стабильно работает в РФ),
  // локально и на собственном домене — относительный маршрут /api/lead.
  API_URL: window.location.origin.includes('github.io')
    ? YANDEX_FUNCTION_URL
    : '/api/lead',

  // Прямые каналы оперативной связи
  PHONE_PRIMARY: '8 (800) 700-02-23',
  PHONE_MOBILE: '+7 (960) 744-09-91',
  TELEGRAM_URL: 'https://t.me/Lexus2026',
  WHATSAPP_URL: 'https://wa.me/79607440991',
  EMAIL_OFFICIAL: 'ooofedstroy@mail.ru'
};
