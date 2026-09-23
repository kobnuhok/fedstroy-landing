// Quiz state and preliminary estimate calculation.

export function initQuiz() {
  const quizSection = document.getElementById('quiz');
  if (!quizSection) return;

  const quizState = {
    step: 1,
    maxStep: 5,
    type: 'facade',
    typeName: 'Вентфасад (НВФ)',
    building: 'shopping',
    buildingName: 'ТРЦ / Торговый центр',
    area: 650,
    services: ['project', 'geodesy'],
    draftEstimateNumber: 'ПР-' + Math.floor(1000 + Math.random() * 9000)
  };

  const quizProgressBar = document.getElementById('quiz-progress-bar');
  const quizStepLabel = document.getElementById('quiz-step-label');
  const quizStepTitle = document.getElementById('quiz-step-title');
  const quizStepSubtitle = document.getElementById('quiz-step-subtitle');
  const quizPrevBtn = document.getElementById('quiz-prev-btn');
  const quizNextBtn = document.getElementById('quiz-next-btn');

  const stepTitles = {
    1: { title: 'Какого плана работы необходимо организовать?', subtitle: 'Выберите основную категорию конструкции' },
    2: { title: 'Какое назначение у вашего объекта?', subtitle: 'Тип объекта для предварительного подбора параметров' },
    3: { title: 'Ориентировочная площадь поверхности (м²)', subtitle: 'Укажите метраж для расчета объема материалов' },
    4: { title: 'Какие сопутствующие работы требуются?', subtitle: 'Отметьте необходимые сопутствующие услуги' },
    5: { title: 'Предварительный расчет сформирован', subtitle: 'Ориентировочная стоимость материалов и монтажа' }
  };

  function updateQuizUI() {
    for (let i = 1; i <= quizState.maxStep; i++) {
      const stepEl = document.getElementById(`quiz-step-${i}`);
      if (stepEl) {
        stepEl.classList.toggle('hidden', i !== quizState.step);
      }
    }

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

    if (quizPrevBtn) {
      quizPrevBtn.classList.toggle('invisible', quizState.step === 1);
    }
    if (quizNextBtn) {
      quizNextBtn.classList.toggle('hidden', quizState.step === quizState.maxStep);
    }

    if (quizState.step === quizState.maxStep) {
      calculateQuizEstimate();
    }
  }

  function calculateQuizEstimate() {
    let baseRateMin = 2200;
    let baseRateMax = 3800;

    if (quizState.type === 'composite') {
      baseRateMin = 2600;
      baseRateMax = 4400;
    } else if (quizState.type === 'cassette') {
      baseRateMin = 2900;
      baseRateMax = 4900;
    } else if (quizState.type === 'terracotta') {
      baseRateMin = 3400;
      baseRateMax = 5800;
    } else if (quizState.type === 'raised-floor') {
      baseRateMin = 3200;
      baseRateMax = 5500;
    } else if (quizState.type === 'subsystem-only') {
      baseRateMin = 650;
      baseRateMax = 1400;
    }

    let servicesAddon = 0;
    if (quizState.services.includes('project')) servicesAddon += 150;
    if (quizState.services.includes('geodesy')) servicesAddon += 80;
    if (quizState.services.includes('warm')) servicesAddon += 550;
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

    if (codeEl) codeEl.textContent = `Черновик сметы ${quizState.draftEstimateNumber}`;
    if (totalEl) totalEl.textContent = totalMin.toLocaleString('ru-RU') + ' ₽';
    if (rangeEl) rangeEl.textContent = `до ${totalMax.toLocaleString('ru-RU')} ₽`;
    if (meterEl) meterEl.textContent = `от ${perMeter.toLocaleString('ru-RU')} ₽/м²`;
    if (durationEl) durationEl.textContent = `${daysMin}–${daysMax} раб. дней`;

    if (tagsEl) {
      tagsEl.innerHTML = `
        <span class="bg-slate-800 text-brand-400 px-3 py-1 rounded-lg border border-slate-700 text-xs font-semibold">${quizState.typeName}</span>
        <span class="bg-slate-800 text-slate-300 px-3 py-1 rounded-lg border border-slate-700 text-xs font-semibold">${quizState.buildingName}</span>
        <span class="bg-slate-800 text-slate-300 px-3 py-1 rounded-lg border border-slate-700 text-xs font-semibold">${quizState.area.toLocaleString('ru-RU')} м²</span>
        <span class="bg-slate-800 text-emerald-400 px-3 py-1 rounded-lg border border-slate-700 text-xs font-semibold">Скидка до 5% при заказе под ключ*</span>
      `;
    }

    if (hiddenSourceEl) {
      hiddenSourceEl.value = `Квиз: ${quizState.typeName}, ${quizState.buildingName}, ${quizState.area} м², Черновик ${quizState.draftEstimateNumber}`;
    }
  }

  quizSection.querySelectorAll('.js-quiz-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      quizSection.querySelectorAll('.js-quiz-type-btn').forEach(b => b.classList.remove('quiz-card-selected'));
      btn.classList.add('quiz-card-selected');
      quizState.type = btn.getAttribute('data-type');
      quizState.typeName = btn.getAttribute('data-name');
    });
  });

  quizSection.querySelectorAll('.js-quiz-building-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      quizSection.querySelectorAll('.js-quiz-building-btn').forEach(b => b.classList.remove('quiz-card-selected'));
      btn.classList.add('quiz-card-selected');
      quizState.building = btn.getAttribute('data-building');
      quizState.buildingName = btn.getAttribute('data-name');
    });
  });

  const quizAreaInput = document.getElementById('quiz-exact-area');
  quizSection.querySelectorAll('.js-quiz-area-card').forEach(btn => {
    btn.addEventListener('click', () => {
      quizSection.querySelectorAll('.js-quiz-area-card').forEach(b => b.classList.remove('quiz-card-selected'));
      btn.classList.add('quiz-card-selected');
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
        quizSection.querySelectorAll('.js-quiz-area-card').forEach(b => b.classList.remove('quiz-card-selected'));
      }
    });
  }

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
