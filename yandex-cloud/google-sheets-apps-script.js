// Google Apps Script для приёма заявок из Yandex Cloud Function в Google Таблицу.
// Как подключить:
// 1. Создайте новую Google Таблицу (sheets.new).
// 2. Откройте: Расширения -> Apps Script.
// 3. Вставьте этот код и нажмите: Начать развертывание -> Новое развертывание -> Веб-приложение.
//    Доступ: "Все" (Anyone), Запуск от имени: "Меня".
// 4. Скопируйте URL веб-приложения (https://script.google.com/macros/s/.../exec)
//    и добавьте его в переменную GOOGLE_SHEETS_WEBHOOK_URL в Yandex Cloud Function.

function doPost(e) {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  if (sheet.getLastRow() === 0) {
    sheet.appendRow([
      'Дата (МСК)',
      'Номер заявки',
      'Имя / Компания',
      'Телефон',
      'Услуга',
      'Площадь',
      'Тип объекта',
      'Комментарий',
      'Источник',
      'Файл ТЗ'
    ]);
    sheet.getRange(1, 1, 1, 10).setFontWeight('bold');
  }

  var data = JSON.parse(e.postData.contents || '{}');
  sheet.appendRow([
    data.createdAtMsk || new Date().toLocaleString('ru-RU'),
    data.leadId || '',
    data.name || '',
    data.phone || '',
    data.service || '',
    data.area || '',
    data.building || '',
    data.comment || '',
    data.source || '',
    data.fileInfo || ''
  ]);

  return ContentService
    .createTextOutput(JSON.stringify({ ok: true }))
    .setMimeType(ContentService.MimeType.JSON);
}
