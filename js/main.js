// =========================================================================
// Главная точка входа приложения ООО «ФЕДСТРОЙ»
// Инициализирует изолированные модули интерфейса
// =========================================================================

import { initNavigation } from './modules/navigation.js';
import { initCalculator } from './modules/calculator.js';
import { initQuiz } from './modules/quiz.js';
import { initPortfolio } from './modules/portfolio.js';
import { initLightbox } from './modules/lightbox.js';
import { initFloatingDock } from './modules/floating-dock.js';
import { initUploader } from './modules/uploader.js';
import { initForms } from './modules/forms.js';

document.addEventListener('DOMContentLoaded', () => {
  const modules = [
    { name: 'navigation', init: initNavigation },
    { name: 'calculator', init: initCalculator },
    { name: 'quiz', init: initQuiz },
    { name: 'portfolio', init: initPortfolio },
    { name: 'lightbox', init: initLightbox },
    { name: 'floating-dock', init: initFloatingDock },
    { name: 'uploader', init: initUploader },
    { name: 'forms', init: initForms }
  ];

  modules.forEach(m => {
    try {
      m.init();
    } catch (err) {
      console.warn(`[FedStroy] Модуль ${m.name} пропущен:`, err);
    }
  });
});
