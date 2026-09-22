// =========================================================================
// ООО «ФЕДСТРОЙ» — Главный модуль инициализации (Entry Point)
// Каждый модуль полностью изолирован и отказоустойчив:
// Если любой блок удален из HTML, соответствующий модуль безопасно завершается,
// а все остальные модули продолжают работать без сбоев и ошибок в консоли.
// =========================================================================

import { initNavigation } from './modules/navigation.js';
import { initCalculator } from './modules/calculator.js';
import { initQuiz } from './modules/quiz.js';
import { initPortfolio } from './modules/portfolio.js';
import { initLightbox } from './modules/lightbox.js';
import { initFloatingDock } from './modules/floating-dock.js';
import { initForms } from './modules/forms.js';

document.addEventListener('DOMContentLoaded', () => {
  const modules = [
    { name: 'Навигация', init: initNavigation },
    { name: 'Калькулятор сметы', init: initCalculator },
    { name: 'Квиз-опросник', init: initQuiz },
    { name: 'Портфолио', init: initPortfolio },
    { name: 'Фото-лайтбокс', init: initLightbox },
    { name: 'Плавающий док связи', init: initFloatingDock },
    { name: 'Обработка форм', init: initForms },
  ];

  modules.forEach(m => {
    try {
      m.init();
    } catch (err) {
      console.warn(`[ООО «ФЕДСТРОЙ»] Модуль «${m.name}» пропущен при инициализации:`, err);
    }
  });
});
