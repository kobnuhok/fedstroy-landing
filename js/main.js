// Application entry point.
import { initNavigation } from './modules/navigation.js';
import { initCalculator } from './modules/calculator.js';
import { initQuiz } from './modules/quiz.js';
import { initPortfolio } from './modules/portfolio.js';
import { initLightbox } from './modules/lightbox.js';
import { initFloatingDock } from './modules/floating-dock.js';
import { initUploader } from './modules/uploader.js';
import { initForms } from './modules/forms.js';

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initCalculator();
  initQuiz();
  initPortfolio();
  initLightbox();
  initFloatingDock();
  initUploader();
  initForms();
});
