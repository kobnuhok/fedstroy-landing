// =========================================================================
// Модуль интерактивного 5-шагового квиз-сметчика
// Автономен: если блок #quiz удален, модуль мягко выходит без ошибок
// =========================================================================

export function initQuiz() {
  const quizSection = document.getElementById('quiz');
  if (!quizSection) return; // Безопасный выход, если квиз не на странице

  const quizState = {
    step: 1,
    maxStep: 5,
    type: 'facade',
    typeName: 'Вентфасад (НВФ)',
    building: 'shopping',
    buildingName: 'ТРЦ / Торговый центр',
    area: 650,
    services: ['project', 'geodesy'],
    calcNumber: 'ФС-' + Math.floor(1000 + Math.random() * 9000)
  };

  const quizProgressBar = document.getElementById('quiz-progress-bar');
  const quizStepLabel = document.getElementById('quiz-step-label');
  const quizStepTitle = document.getElementById('quiz-step-title');
  const quizStepSubtitle = document.getElementById('quiz-step-subtitle');
  const quizPrevBtn = document.getElementById('quiz-prev-btn');
  const quizNextBtn = document.getElementById('quiz-next-btn');

  const stepTitles = {
    1: { title: 'Какого плана работы необходимо организовать?', subtitle: 'Выберите основную категорию конструкции' },
    2: { title: 'Какое назначение у вашего объекта?', subtitle: 'Определяет ветровые нагрузки и класс пожаробезопасности' },
    3: { title: 'Ориентировочная площадь поверхности (м²)', subtitle: 'Укажите метраж для расчета объема материалов' },
    4: { title: 'Какие сопутствующие работы требуются?', subtitle: 'Отметьте необходимые инженерные услуги' },
    5: { title: 'Смета сформирована! Ваши условия зафиксированы', subtitle: 'Ознакомьтесь с предварительным расчетом стоимости' }
  };

  function updateQuizUI() {
    // Показываем текущий шаг, скрываем остальные
    for (let i = 1; i <= quizState.maxStep; i++) {
      const stepEl = document.getElementById(`quiz-step-${i}`);
      if (stepEl) {
        if (i === quizState.step) {
          stepEl.classList.remove('hidden');
        } else {
          stepEl.classList.add('hidden');
        }
      }
    }

    // Прогресс
    if (quizProgressBar) {
      const pct = (quizState.step / quizState.maxStep) * 100;
      quizProgressBar.style.width = `${pct}%`;
    }
    if (quizStepLabel) {
      quizStepLabel.textContent = `Шаг ${quizState.step} из ${quizState.maxStep}`;
    }
    if (quizStepTitle && stepTitles[quizState.step]) {
      quizStepTitle.textContent = stepTitles[quizState.step].title;
    }
    if (quizStepSubtitle && stepTitles[quizState.step]) {
      quizStepSubtitle.textContent = stepTitles[quizState.step].subtitle;
    }

    // Кнопка назад
    if (quizPrevBtn) {
      if (quizState.step === 1) {
        quizPrevBtn.classList.add('opacity-40', 'pointer-events-none');
      } else {
        quizPrevBtn.classList.remove('opacity-40', 'pointer-events-none');
      }
    }

    // Кнопка вперед / завершение
    if (quizNextBtn) {
      if (quizState.step === quizState.maxStep) {
        quizNextBtn.classList.add('hidden');
      } else {
        quizNextBtn.classList.remove('hidden');
      }
    }

    // Если 5 шаг — пересчитываем финальную смету
    if (quizState.step === 5) {
      calculateQuizEstimate();
    }
  }

  function calculateQuizEstimate() {
    let baseRateMin = 2400;
    let baseRateMax = 3300;

    if (quizState.type === 'facade') {
      baseRateMin = 2500;
      baseRateMax = 3700;
    } else if (quizState.type === 'falshpol') {
      baseRateMin = 2900;
      baseRateMax = 4400;
    } else if (quizState.type === 'complex') {
      baseRateMin = 5200;
      baseRateMax = 7800;
    } else if (quizState.type === 'supply') {
      baseRateMin = 1100;
      baseRateMax = 1800;
    }

    let servicesAddon = 0;
    if (quizState.services.includes('project')) servicesAddon += 150;
    if (quizState.services.includes('geodesy')) servicesAddon += 80;
    if (quizState.services.includes('dismantle')) servicesAddon += 350;

    const perMeter = baseRateMin + servicesAddon;
    const totalMin = (baseRateMin + servicesAddon) * quizState.area;
    const totalMax = (baseRateMax + servicesAddon) * quizState.area;
    const daysMin = Math.max(7, Math.round(quizState.area / 65));
    const daysMax = Math.max(10, Math.round(quizState.area / 45));

    const codeEl = document.getElementById('quiz-result-code');
    const totalEl = document.getElementById('quiz-result-total');
    const rangeEl = document.getElementById('quiz-result-range');
    const meterEl = document.getElementById('quiz-result-meter');
    const durationEl = document.getElementById('quiz-result-duration');
    const tagsEl = document.getElementById('quiz-result-tags');
    const hiddenSourceEl = document.getElementById('quiz-source-input');

    if (codeEl) codeEl.textContent = `Расчет ${quizState.calcNumber}`;
    if (totalEl) totalEl.textContent = totalMin.toLocaleString('ru-RU') + ' ₽';
    if (rangeEl) rangeEl.textContent = `до ${totalMax.toLocaleString('ru-RU')} ₽`;
    if (meterEl) meterEl.textContent = `от ${perMeter.toLocaleString('ru-RU')} ₽/м²`;
    if (durationEl) durationEl.textContent = `${daysMin}–${daysMax} раб. дней`;

    if (tagsEl) {
      tagsEl.innerHTML = `
        <span class="bg-slate-800 text-brand-400 px-3 py-1 rounded-lg border border-slate-700 text-xs font-semibold">${quizState.typeName}</span>
        <span class="bg-slate-800 text-slate-300 px-3 py-1 rounded-lg border border-slate-700 text-xs font-semibold">${quizState.buildingName}</span>
        <span class="bg-slate-800 text-slate-300 px-3 py-1 rounded-lg border border-slate-700 text-xs font-semibold">${quizState.area.toLocaleString('ru-RU')} м²</span>
        <span class="bg-slate-800 text-emerald-400 px-3 py-1 rounded-lg border border-slate-700 text-xs font-semibold">Скидка 5% зафиксирована</span>
      `;
    }

    if (hiddenSourceEl) {
      hiddenSourceEl.value = `Квиз: ${quizState.typeName}, ${quizState.buildingName}, ${quizState.area} м², Номер ${quizState.calcNumber}`;
    }
  }

  // Шаг 1: Выбор типа
  quizSection.querySelectorAll('.js-quiz-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      quizSection.querySelectorAll('.js-quiz-type-btn').forEach(b => b.classList.remove('quiz-card-selected', 'border-brand-600', 'bg-brand-50/50'));
      btn.classList.add('quiz-card-selected', 'border-brand-600', 'bg-brand-50/50');
      quizState.type = btn.getAttribute('data-type');
      quizState.typeName = btn.getAttribute('data-name');
    });
  });

  // Шаг 2: Назначение здания
  quizSection.querySelectorAll('.js-quiz-building-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      quizSection.querySelectorAll('.js-quiz-building-btn').forEach(b => b.classList.remove('quiz-card-selected', 'border-brand-600', 'bg-brand-50/50'));
      btn.classList.add('quiz-card-selected', 'border-brand-600', 'bg-brand-50/50');
      quizState.building = btn.getAttribute('data-building');
      quizState.buildingName = btn.getAttribute('data-name');
    });
  });

  // Шаг 3: Площадь пресеты и инпут
  const quizAreaInput = document.getElementById('quiz-exact-area');
  quizSection.querySelectorAll('.js-quiz-area-card').forEach(btn => {
    btn.addEventListener('click', () => {
      quizSection.querySelectorAll('.js-quiz-area-card').forEach(b => b.classList.remove('quiz-card-selected', 'border-brand-600', 'bg-brand-50/50'));
      btn.classList.add('quiz-card-selected', 'border-brand-600', 'bg-brand-50/50');
      const val = parseInt(btn.getAttribute('data-area'), 10);
      quizState.area = val;
      if (quizAreaInput) quizAreaInput.value = val;
    });
  });

  if (quizAreaInput) {
    quizAreaInput.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      if (val && val > 0) {
        quizState.area = val;
        quizSection.querySelectorAll('.js-quiz-area-card').forEach(b => b.classList.remove('quiz-card-selected', 'border-brand-600', 'bg-brand-50/50'));
      }
    });
  }

  // Шаг 4: Чекбоксы услуг
  quizSection.querySelectorAll('.js-quiz-service-check').forEach(chk => {
    chk.addEventListener('change', () => {
      const srv = chk.value;
      if (chk.checked) {
        if (!quizState.services.includes(srv)) quizState.services.push(srv);
      } else {
        quizState.services = quizState.services.filter(s => s !== srv);
      }
    });
  });

  // Кнопки навигации шагов
  if (quizNextBtn) {
    quizNextBtn.addEventListener('click', () => {
      if (quizState.step < quizState.maxStep) {
        quizState.step++;
        updateQuizUI();
      }
    });
  }

  if (quizPrevBtn) {
    quizPrevBtn.addEventListener('click', () => {
      if (quizState.step > 1) {
        quizState.step--;
        updateQuizUI();
      }
    });
  }

  updateQuizUI();
}
