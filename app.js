// ООО «ФЕДСТРОЙ» — Interactive B2B Controller & Conversion Engine

document.addEventListener('DOMContentLoaded', () => {
  // Mobile Navigation Toggle
  const mobileMenuBtn = document.getElementById('mobile-menu-btn');
  const mobileMenu = document.getElementById('mobile-menu');

  if (mobileMenuBtn && mobileMenu) {
    mobileMenuBtn.addEventListener('click', () => {
      const isExpanded = mobileMenuBtn.getAttribute('aria-expanded') === 'true';
      mobileMenuBtn.setAttribute('aria-expanded', !isExpanded);
      mobileMenu.classList.toggle('hidden');
    });

    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.add('hidden');
        mobileMenuBtn.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // =========================================================================
  // 1. Interactive B2B Cost Calculator
  // =========================================================================
  const areaSlider = document.getElementById('calc-area');
  const areaValue = document.getElementById('calc-area-val');
  const systemTypeRadios = document.querySelectorAll('input[name="system-type"]');
  const materialSelect = document.getElementById('calc-material');
  const metalRadios = document.querySelectorAll('input[name="subsystem-metal"]');
  const installCheckbox = document.getElementById('calc-install');

  const totalMinEl = document.getElementById('calc-total-min');
  const totalMaxEl = document.getElementById('calc-total-max');
  const perMeterEl = document.getElementById('calc-per-meter');
  const durationEl = document.getElementById('calc-duration');

  const materialPricing = {
    keramogranit: { baseMin: 2200, baseMax: 3100, label: 'Керамогранит' },
    composite: { baseMin: 2800, baseMax: 3900, label: 'Алюминиевый композит' },
    metalkassety: { baseMin: 2500, baseMax: 3400, label: 'Металлокассеты' },
    fibrocement: { baseMin: 3100, baseMax: 4400, label: 'Фиброцементные плиты' },
    hpl: { baseMin: 4200, baseMax: 6100, label: 'HPL-панели' },
    falshpol_chipboard: { baseMin: 2900, baseMax: 4200, label: 'Фальшпол ДСП 38мм' },
    falshpol_sulfate: { baseMin: 3900, baseMax: 5600, label: 'Фальшпол Сульфат кальция' },
  };

  const metalMultipliers = {
    galvanized: 1.0,     // Оцинкованная сталь
    aluminum: 1.22,      // Алюминиевая подсистема
    stainless: 1.48      // Нержавеющая сталь
  };

  function updateCalculator() {
    if (!areaSlider) return;

    const area = parseInt(areaSlider.value, 10);
    if (areaValue) areaValue.textContent = area.toLocaleString('ru-RU');

    let selectedSystem = 'facade';
    systemTypeRadios.forEach(r => { if (r.checked) selectedSystem = r.value; });

    let selectedMetal = 'galvanized';
    metalRadios.forEach(r => { if (r.checked) selectedMetal = r.value; });

    const materialKey = materialSelect ? materialSelect.value : 'keramogranit';
    const materialData = materialPricing[materialKey] || materialPricing.keramogranit;
    const metalMult = metalMultipliers[selectedMetal] || 1.0;

    const installCost = (installCheckbox && installCheckbox.checked) ? 1450 : 0;

    const perMeterMin = Math.round((materialData.baseMin * metalMult) + installCost);
    const perMeterMax = Math.round((materialData.baseMax * metalMult) + installCost);

    const totalMin = perMeterMin * area;
    const totalMax = perMeterMax * area;

    const workDaysMin = Math.max(7, Math.round(area / 65));
    const workDaysMax = Math.max(10, Math.round(area / 45));

    if (totalMinEl) totalMinEl.textContent = totalMin.toLocaleString('ru-RU') + ' ₽';
    if (totalMaxEl) totalMaxEl.textContent = totalMax.toLocaleString('ru-RU') + ' ₽';
    if (perMeterEl) perMeterEl.textContent = `от ${perMeterMin.toLocaleString('ru-RU')} ₽/м²`;
    if (durationEl) durationEl.textContent = `${workDaysMin}–${workDaysMax} раб. дней`;
  }

  if (areaSlider) areaSlider.addEventListener('input', updateCalculator);
  if (materialSelect) materialSelect.addEventListener('change', updateCalculator);
  systemTypeRadios.forEach(r => r.addEventListener('change', (e) => {
    if (materialSelect) {
      if (e.target.value === 'falshpol') {
        materialSelect.innerHTML = `
          <option value="falshpol_chipboard">Фальшпол: плиты ДСП 38 мм (для офисов и БЦ)</option>
          <option value="falshpol_sulfate">Фальшпол: сульфат кальция (для серверных и ЦОД)</option>
        `;
      } else {
        materialSelect.innerHTML = `
          <option value="keramogranit">Керамогранит (600×600, 1200×600 мм)</option>
          <option value="composite">Алюминиевые композитные панели (АКП)</option>
          <option value="metalkassety">Металлокассеты открытого/закрытого типа</option>
          <option value="fibrocement">Фиброцементные плиты (окрашенные в массе)</option>
          <option value="hpl">HPL-панели (ламинат высокого давления)</option>
        `;
      }
    }
    updateCalculator();
  }));
  metalRadios.forEach(r => r.addEventListener('change', updateCalculator));
  if (installCheckbox) installCheckbox.addEventListener('change', updateCalculator);

  // Area Preset Buttons
  const areaPresetBtns = document.querySelectorAll('.js-area-preset');
  areaPresetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const targetVal = parseInt(btn.getAttribute('data-area'), 10);
      if (areaSlider && targetVal) {
        areaSlider.value = targetVal;
        updateCalculator();
        areaPresetBtns.forEach(b => b.classList.remove('bg-brand-600', 'text-white', 'border-brand-600'));
        btn.classList.add('bg-brand-600', 'text-white', 'border-brand-600');
      }
    });
  });

  updateCalculator();

  // =========================================================================
  // 2. Interactive Multi-Step Quiz Estimator
  // =========================================================================
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
    // Show current step container, hide others
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

    // Update Progress
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

    // Prev Button
    if (quizPrevBtn) {
      if (quizState.step === 1) {
        quizPrevBtn.classList.add('opacity-40', 'pointer-events-none');
      } else {
        quizPrevBtn.classList.remove('opacity-40', 'pointer-events-none');
      }
    }

    // Next Button vs Finish
    if (quizNextBtn) {
      if (quizState.step === quizState.maxStep) {
        quizNextBtn.classList.add('hidden');
      } else {
        quizNextBtn.classList.remove('hidden');
      }
    }

    // If reaching Step 5, calculate and populate final summary
    if (quizState.step === 5) {
      calculateQuizEstimate();
    }
  }

  function calculateQuizEstimate() {
    // Base unit rates per m2 based on type
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

    // Add extra services cost
    let servicesAddon = 0;
    if (quizState.services.includes('project')) servicesAddon += 150;
    if (quizState.services.includes('geodesy')) servicesAddon += 80;
    if (quizState.services.includes('dismantle')) servicesAddon += 350;

    const perMeter = baseRateMin + servicesAddon;
    const totalMin = (baseRateMin + servicesAddon) * quizState.area;
    const totalMax = (baseRateMax + servicesAddon) * quizState.area;
    const daysMin = Math.max(7, Math.round(quizState.area / 65));
    const daysMax = Math.max(10, Math.round(quizState.area / 45));

    // Fill in elements
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

  // Quiz step 1 option click
  document.querySelectorAll('.js-quiz-type-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.js-quiz-type-btn').forEach(b => b.classList.remove('quiz-card-selected', 'border-brand-600', 'bg-brand-50/50'));
      btn.classList.add('quiz-card-selected', 'border-brand-600', 'bg-brand-50/50');
      quizState.type = btn.getAttribute('data-type');
      quizState.typeName = btn.getAttribute('data-name');
    });
  });

  // Quiz step 2 option click
  document.querySelectorAll('.js-quiz-building-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.js-quiz-building-btn').forEach(b => b.classList.remove('quiz-card-selected', 'border-brand-600', 'bg-brand-50/50'));
      btn.classList.add('quiz-card-selected', 'border-brand-600', 'bg-brand-50/50');
      quizState.building = btn.getAttribute('data-building');
      quizState.buildingName = btn.getAttribute('data-name');
    });
  });

  // Quiz step 3 area cards & input
  const quizAreaInput = document.getElementById('quiz-exact-area');
  document.querySelectorAll('.js-quiz-area-card').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.js-quiz-area-card').forEach(b => b.classList.remove('quiz-card-selected', 'border-brand-600', 'bg-brand-50/50'));
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
        document.querySelectorAll('.js-quiz-area-card').forEach(b => b.classList.remove('quiz-card-selected', 'border-brand-600', 'bg-brand-50/50'));
      }
    });
  }

  // Quiz step 4 service checkboxes
  document.querySelectorAll('.js-quiz-service-check').forEach(chk => {
    chk.addEventListener('change', () => {
      const srv = chk.value;
      if (chk.checked) {
        if (!quizState.services.includes(srv)) quizState.services.push(srv);
      } else {
        quizState.services = quizState.services.filter(s => s !== srv);
      }
    });
  });

  // Navigation listeners
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

  // =========================================================================
  // 3. Floating Quick Contact Dock & Scroll to Top
  // =========================================================================
  const dockTrigger = document.getElementById('dock-trigger');
  const dockMenu = document.getElementById('dock-menu');
  const scrollToTopBtn = document.getElementById('scroll-to-top');

  if (dockTrigger && dockMenu) {
    dockTrigger.addEventListener('click', (e) => {
      e.stopPropagation();
      const isVisible = dockMenu.classList.contains('visible-menu');
      if (isVisible) {
        dockMenu.classList.remove('visible-menu');
        dockMenu.classList.add('hidden-menu');
      } else {
        dockMenu.classList.remove('hidden-menu');
        dockMenu.classList.add('visible-menu');
      }
    });

    document.addEventListener('click', (e) => {
      if (!dockMenu.contains(e.target) && !dockTrigger.contains(e.target)) {
        dockMenu.classList.remove('visible-menu');
        dockMenu.classList.add('hidden-menu');
      }
    });
  }

  // Scroll to Top Button Visibility
  if (scrollToTopBtn) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 400) {
        scrollToTopBtn.classList.remove('opacity-0', 'pointer-events-none', 'translate-y-4');
        scrollToTopBtn.classList.add('opacity-100', 'translate-y-0');
      } else {
        scrollToTopBtn.classList.remove('opacity-100', 'translate-y-0');
        scrollToTopBtn.classList.add('opacity-0', 'pointer-events-none', 'translate-y-4');
      }
    });

    scrollToTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // Express 25-minute Callback Modal
  const callbackModal = document.getElementById('callback-modal');
  document.querySelectorAll('.js-open-callback').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      if (callbackModal) {
        callbackModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
      }
      if (dockMenu) {
        dockMenu.classList.remove('visible-menu');
        dockMenu.classList.add('hidden-menu');
      }
    });
  });

  document.querySelectorAll('.js-close-callback').forEach(btn => {
    btn.addEventListener('click', () => {
      if (callbackModal) {
        callbackModal.classList.add('hidden');
        document.body.style.overflow = '';
      }
    });
  });

  if (callbackModal) {
    callbackModal.addEventListener('click', (e) => {
      if (e.target === callbackModal) {
        callbackModal.classList.add('hidden');
        document.body.style.overflow = '';
      }
    });
  }

  // =========================================================================
  // 4. Modal System (General Lead Modal)
  // =========================================================================
  const modal = document.getElementById('lead-modal');
  const openModalBtns = document.querySelectorAll('.js-open-modal');
  const closeModalBtns = document.querySelectorAll('.js-close-modal');
  const modalServiceTitle = document.getElementById('modal-service-title');

  openModalBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const service = btn.getAttribute('data-service');
      if (service && modalServiceTitle) {
        modalServiceTitle.textContent = `Выбранное направление: ${service}`;
      } else if (modalServiceTitle) {
        modalServiceTitle.textContent = 'Оставьте контактные данные — инженер свяжется для уточнения техзадания';
      }
      if (modal) {
        modal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
      }
    });
  });

  closeModalBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (modal) {
        modal.classList.add('hidden');
        document.body.style.overflow = '';
      }
    });
  });

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.classList.add('hidden');
        document.body.style.overflow = '';
      }
    });
  }

  // Global Escape Key Listener for Modals
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (modal && !modal.classList.contains('hidden')) {
        modal.classList.add('hidden');
        document.body.style.overflow = '';
      }
      if (callbackModal && !callbackModal.classList.contains('hidden')) {
        callbackModal.classList.add('hidden');
        document.body.style.overflow = '';
      }
      if (dockMenu) {
        dockMenu.classList.remove('visible-menu');
        dockMenu.classList.add('hidden-menu');
      }
    }
  });

  // =========================================================================
  // 5. 8-State Form Validation & Submission Handler
  // =========================================================================
  const leadForms = document.querySelectorAll('.js-lead-form');

  leadForms.forEach(form => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      form.querySelectorAll('.error-msg').forEach(el => el.classList.add('hidden'));

      let hasError = false;
      const nameInput = form.querySelector('input[name="name"]');
      const phoneInput = form.querySelector('input[name="phone"]');
      const agreeInput = form.querySelector('input[name="agreement"]');
      const submitBtn = form.querySelector('button[type="submit"]');

      if (nameInput && !nameInput.value.trim()) {
        const err = form.querySelector(`#error-${nameInput.id}`) || form.querySelector(`#error-${nameInput.name}`);
        if (err) err.classList.remove('hidden');
        hasError = true;
      }

      if (phoneInput) {
        const phoneVal = phoneInput.value.trim().replace(/\D/g, '');
        if (phoneVal.length < 10) {
          const err = form.querySelector(`#error-${phoneInput.id}`) || form.querySelector(`#error-${phoneInput.name}`);
          if (err) err.classList.remove('hidden');
          hasError = true;
        }
      }

      if (agreeInput && !agreeInput.checked) {
        const err = form.querySelector(`#error-${agreeInput.id}`) || form.querySelector(`#error-${agreeInput.name}`);
        if (err) err.classList.remove('hidden');
        hasError = true;
      }

      if (hasError) return;

      const originalText = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.classList.add('opacity-75', 'cursor-not-allowed');
      submitBtn.innerHTML = `
        <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Формируем спецификацию...
      `;

      setTimeout(() => {
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-75', 'cursor-not-allowed');
        submitBtn.innerHTML = originalText;

        const formContainer = form.closest('.form-container') || form;
        formContainer.innerHTML = `
          <div class="p-8 text-center bg-white rounded-3xl border border-slate-200 shadow-xl animate-in fade-in duration-300">
            <div class="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
              </svg>
            </div>
            <span class="text-xs font-bold text-emerald-600 uppercase tracking-wider block mb-1">Заявка успешно зарегистрирована</span>
            <h3 class="text-2xl font-bold font-heading text-slate-900 mb-2">Спецификация передана в ПТО</h3>
            <p class="text-slate-600 mb-6 max-w-md mx-auto text-sm leading-relaxed">
              Главный инженер ООО «ФЕДСТРОЙ» подготовит расчет коммерческого предложения и свяжется с вами в течение 25 минут в рабочее время.
            </p>
            <div class="inline-flex items-center gap-3 text-xs sm:text-sm text-slate-600 bg-slate-50 px-5 py-3 rounded-xl border border-slate-200">
              <span>Срочный вопрос?</span>
              <a href="tel:+78007000223" class="font-bold text-brand-600 hover:text-brand-700">8 (800) 700-02-23</a>
            </div>
          </div>
        `;
      }, 700);
    });
  });

  // =========================================================================
  // 6. Portfolio Filter Tabs
  // =========================================================================
  const filterBtns = document.querySelectorAll('.js-portfolio-filter');
  const portfolioItems = document.querySelectorAll('.js-portfolio-item');

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const category = btn.getAttribute('data-filter');

      filterBtns.forEach(b => {
        b.classList.remove('bg-slate-900', 'text-white', 'shadow-sm');
        b.classList.add('bg-white', 'text-slate-700', 'hover:bg-slate-100');
      });
      btn.classList.remove('bg-white', 'text-slate-700', 'hover:bg-slate-100');
      btn.classList.add('bg-slate-900', 'text-white', 'shadow-sm');

      portfolioItems.forEach(item => {
        if (category === 'all' || item.getAttribute('data-category') === category) {
          item.classList.remove('hidden');
        } else {
          item.classList.add('hidden');
        }
      });
    });
  });

  // =========================================================================
  // 7. Photo Lightbox Viewer
  // =========================================================================
  const lightboxModal = document.getElementById('lightbox-modal');
  const lightboxImg = document.getElementById('lightbox-img');
  const lightboxTitle = document.getElementById('lightbox-title');
  const lightboxDesc = document.getElementById('lightbox-desc');
  const lightboxClose = document.querySelectorAll('.js-close-lightbox');

  document.querySelectorAll('.js-lightbox-trigger').forEach(trigger => {
    trigger.addEventListener('click', (e) => {
      e.preventDefault();
      const src = trigger.getAttribute('data-img') || trigger.querySelector('img')?.src;
      const title = trigger.getAttribute('data-title') || 'Объект ООО «ФЕДСТРОЙ»';
      const desc = trigger.getAttribute('data-desc') || '';

      if (lightboxModal && lightboxImg && src) {
        lightboxImg.src = src;
        if (lightboxTitle) lightboxTitle.textContent = title;
        if (lightboxDesc) lightboxDesc.textContent = desc;
        lightboxModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
      }
    });
  });

  if (lightboxModal) {
    lightboxClose.forEach(btn => {
      btn.addEventListener('click', () => {
        lightboxModal.classList.add('hidden');
        document.body.style.overflow = '';
      });
    });

    lightboxModal.addEventListener('click', (e) => {
      if (e.target === lightboxModal) {
        lightboxModal.classList.add('hidden');
        document.body.style.overflow = '';
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !lightboxModal.classList.contains('hidden')) {
        lightboxModal.classList.add('hidden');
        document.body.style.overflow = '';
      }
    });
  }
});
