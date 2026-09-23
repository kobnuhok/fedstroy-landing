// Клиентский бандл для браузеров с поддержкой nomodule
(() => {
  // config
  // Client API and contact configuration.
  
  const CONFIG = {
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
  

  // navigation.js
  // Mobile menu and smooth scroll navigation.
  function initNavigation() {
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
  
    // Плавный скролл для якорных ссылок с защитой от отсутствующих целей
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function (e) {
        const targetId = this.getAttribute('href');
        if (!targetId || targetId === '#') return;
  
        const targetEl = document.querySelector(targetId);
        if (targetEl) {
          e.preventDefault();
          targetEl.scrollIntoView({ behavior: 'smooth' });
        }
      });
    });
  }
  

  // calculator.js
  // Cost estimator logic based on material, subsystem and area.
  function initCalculator() {
    const calcSection = document.getElementById('calculator');
    if (!calcSection) return;
  
    const areaSlider = document.getElementById('calc-area');
    const areaValue = document.getElementById('calc-area-val');
    const systemTypeRadios = document.querySelectorAll('input[name="system-type"]');
    const materialSelect = document.getElementById('calc-material');
    const metalRadios = document.querySelectorAll('input[name="subsystem-metal"]');
    const installCheckbox = document.getElementById('calc-install');
    const insulationCheckbox = document.getElementById('calc-insulation');
  
    const totalMinEl = document.getElementById('calc-total-min');
    const totalMaxEl = document.getElementById('calc-total-max');
    const perMeterEl = document.getElementById('calc-per-meter');
    const durationEl = document.getElementById('calc-duration');
    const breakdownSubsystemEl = document.getElementById('calc-breakdown-subsystem');
    const breakdownCladdingEl = document.getElementById('calc-breakdown-cladding');
  
    // Базовые диапазоны цен на облицовку и плиты (руб/м²)
    const materialPricing = {
      keramogranit: { baseMin: 1800, baseMax: 2600, label: 'Керамогранит 600×600' },
      composite: { baseMin: 2400, baseMax: 3500, label: 'Алюминиевый композит (АКП)' },
      metalkassety: { baseMin: 2100, baseMax: 3000, label: 'Металлокассеты' },
      fibrocement: { baseMin: 2700, baseMax: 3900, label: 'Фиброцементные плиты' },
      hpl: { baseMin: 3800, baseMax: 5600, label: 'HPL-панели' },
      falshpol_chipboard: { baseMin: 2500, baseMax: 3600, label: 'Фальшпол ДСП 38 мм' },
      falshpol_sulfate: { baseMin: 3400, baseMax: 4900, label: 'Фальшпол Сульфат кальция' }
    };
  
    // Базовая стоимость металлической подсистемы (кронштейны, профили, кляммеры, термопрокладки)
    const subsystemBasePerMeter = {
      galvanized: { min: 850, max: 1150, name: 'Оцинкованная сталь 1.2 мм' },
      aluminum: { min: 1250, max: 1650, name: 'Алюминиевый профиль АД31Т1' },
      stainless: { min: 1850, max: 2450, name: 'Нержавеющая сталь AISI 430/304' }
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
      const subData = subsystemBasePerMeter[selectedMetal] || subsystemBasePerMeter.galvanized;
  
      // Дополнительные опции
      const insulationCost = (insulationCheckbox && insulationCheckbox.checked) ? 550 : 0;
      const installCost = (installCheckbox && installCheckbox.checked) ? 1450 : 0;
  
      // Расчет стоимости за 1 м²
      const perMeterMin = subData.min + materialData.baseMin + insulationCost + installCost;
      const perMeterMax = subData.max + materialData.baseMax + insulationCost + installCost;
  
      // Общий ориентировочный бюджет
      const totalMin = perMeterMin * area;
      const totalMax = perMeterMax * area;
  
      // Сроки поставки и монтажа по нормам ПТО
      const workDaysMin = Math.max(7, Math.round(area / 65));
      const workDaysMax = Math.max(10, Math.round(area / 45));
  
      if (totalMinEl) totalMinEl.textContent = totalMin.toLocaleString('ru-RU') + ' ₽';
      if (totalMaxEl) totalMaxEl.textContent = totalMax.toLocaleString('ru-RU') + ' ₽';
      if (perMeterEl) perMeterEl.textContent = `от ${perMeterMin.toLocaleString('ru-RU')} ₽/м²`;
      if (durationEl) durationEl.textContent = `${workDaysMin}–${workDaysMax} раб. дней`;
  
      if (breakdownSubsystemEl) {
        breakdownSubsystemEl.textContent = `от ${(subData.min * area).toLocaleString('ru-RU')} ₽ (${subData.name})`;
      }
      if (breakdownCladdingEl) {
        breakdownCladdingEl.textContent = `от ${(materialData.baseMin * area).toLocaleString('ru-RU')} ₽ (${materialData.label})`;
      }
    }
  
    areaSlider.addEventListener('input', updateCalculator);
    if (materialSelect) materialSelect.addEventListener('change', updateCalculator);
  
    systemTypeRadios.forEach(r => r.addEventListener('change', (e) => {
      if (materialSelect) {
        if (e.target.value === 'falshpol') {
          materialSelect.innerHTML = `
            <option value="falshpol_chipboard">Фальшпол: плиты ДСП 38 мм (БЦ и офисы)</option>
            <option value="falshpol_sulfate">Фальшпол: сульфат кальция 30–36 мм (ЦОД и серверные)</option>
          `;
        } else {
          materialSelect.innerHTML = `
            <option value="keramogranit">Керамогранит (600×600, 1200×600 мм)</option>
            <option value="composite">Алюминиевый композит (АКП 4 мм / 0.4)</option>
            <option value="metalkassety">Металлокассеты открытого/закрытого типа</option>
            <option value="fibrocement">Фиброцементные панели (окрашенные в массе)</option>
            <option value="hpl">HPL-панели (ламинат высокого давления)</option>
          `;
        }
      }
      updateCalculator();
    }));
  
    metalRadios.forEach(r => r.addEventListener('change', updateCalculator));
    if (installCheckbox) installCheckbox.addEventListener('change', updateCalculator);
    if (insulationCheckbox) insulationCheckbox.addEventListener('change', updateCalculator);
  
    // Кнопки типовых площадей
    document.querySelectorAll('.js-area-preset').forEach(btn => {
      btn.addEventListener('click', () => {
        const targetVal = parseInt(btn.getAttribute('data-area'), 10);
        if (areaSlider && targetVal) {
          areaSlider.value = targetVal;
          updateCalculator();
          document.querySelectorAll('.js-area-preset').forEach(b => b.classList.remove('bg-brand-600', 'text-white', 'border-brand-600'));
          btn.classList.add('bg-brand-600', 'text-white', 'border-brand-600');
        }
      });
    });
  
    updateCalculator();
  }
  

  // quiz.js
  // Quiz state and preliminary estimate calculation.
  
  function initQuiz() {
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
  

  // portfolio.js
  // Portfolio category filter.
  function initPortfolio() {
    const filterBtns = document.querySelectorAll('.js-portfolio-filter');
    const portfolioItems = document.querySelectorAll('.js-portfolio-item');
  
    if (!filterBtns.length || !portfolioItems.length) return;
  
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
  }
  

  // lightbox.js
  // Fullscreen image lightbox modal.
  function initLightbox() {
    const lightboxModal = document.getElementById('lightbox-modal');
    if (!lightboxModal) return;
  
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
  
        if (lightboxImg && src) {
          lightboxImg.src = src;
          if (lightboxTitle) lightboxTitle.textContent = title;
          if (lightboxDesc) lightboxDesc.textContent = desc;
          lightboxModal.classList.remove('hidden');
          document.body.style.overflow = 'hidden';
        }
      });
    });
  
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
  

  // floating-dock.js
  // Floating contact widget and scroll-to-top button.
  function initFloatingDock() {
    const dockTrigger = document.getElementById('dock-trigger');
    const dockMenu = document.getElementById('dock-menu');
    const scrollToTopBtn = document.getElementById('scroll-to-top');
    const callbackModal = document.getElementById('callback-modal');
  
    // Плавающее меню
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
  
    // Кнопка возврата наверх (скролл > 400px)
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
  
    // Экспресс-модалка «Звонок за 25 минут»
    if (callbackModal) {
      document.querySelectorAll('.js-open-callback').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          callbackModal.classList.remove('hidden');
          document.body.style.overflow = 'hidden';
          if (dockMenu) {
            dockMenu.classList.remove('visible-menu');
            dockMenu.classList.add('hidden-menu');
          }
        });
      });
  
      document.querySelectorAll('.js-close-callback').forEach(btn => {
        btn.addEventListener('click', () => {
          callbackModal.classList.add('hidden');
          document.body.style.overflow = '';
        });
      });
  
      callbackModal.addEventListener('click', (e) => {
        if (e.target === callbackModal) {
          callbackModal.classList.add('hidden');
          document.body.style.overflow = '';
        }
      });
    }
  }
  

  // uploader.js
  // File input and drag-and-drop handling.
  function initUploader() {
    const dropzones = document.querySelectorAll('.js-file-dropzone');
    if (!dropzones.length) return;
  
    const MAX_SIZE_MB = 35;
    const ALLOWED_EXTS = ['.dwg', '.pdf', '.zip', '.rar', '.7z', '.doc', '.docx', '.xls', '.xlsx', '.png', '.jpg', '.jpeg'];
  
    function formatBytes(bytes) {
      if (bytes < 1024) return bytes + ' Б';
      if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' КБ';
      return (bytes / (1024 * 1024)).toFixed(1) + ' МБ';
    }
  
    dropzones.forEach(zone => {
      const input = zone.querySelector('input[type="file"]');
      const promptEl = zone.querySelector('.js-dropzone-prompt');
      const previewEl = zone.querySelector('.js-dropzone-preview');
      const fileNameEl = zone.querySelector('.js-file-name');
      const fileSizeEl = zone.querySelector('.js-file-size');
      const removeBtn = zone.querySelector('.js-file-remove');
      const errorEl = zone.querySelector('.js-file-error');
  
      if (!input) return;
  
      function showError(msg) {
        if (errorEl) {
          errorEl.textContent = msg;
          errorEl.classList.remove('hidden');
        }
      }
  
      function clearError() {
        if (errorEl) {
          errorEl.textContent = '';
          errorEl.classList.add('hidden');
        }
      }
  
      function handleFile(file) {
        clearError();
        if (!file) return;
  
        const ext = '.' + file.name.split('.').pop().toLowerCase();
        if (!ALLOWED_EXTS.includes(ext)) {
          showError(`Формат ${ext} не поддерживается. Разрешены: ${ALLOWED_EXTS.join(', ')}`);
          input.value = '';
          return;
        }
  
        if (file.size > MAX_SIZE_MB * 1024 * 1024) {
          showError(`Файл слишком большой (${formatBytes(file.size)}). Максимальный размер: ${MAX_SIZE_MB} МБ`);
          input.value = '';
          return;
        }
  
        // Отображаем превью выбранного файла
        if (fileNameEl) fileNameEl.textContent = file.name;
        if (fileSizeEl) fileSizeEl.textContent = formatBytes(file.size);
        if (promptEl) promptEl.classList.add('hidden');
        if (previewEl) previewEl.classList.remove('hidden');
      }
  
      function resetFile() {
        input.value = '';
        clearError();
        if (promptEl) promptEl.classList.remove('hidden');
        if (previewEl) previewEl.classList.add('hidden');
      }
  
      // Событие выбора через системный диалог
      input.addEventListener('change', () => {
        if (input.files && input.files[0]) {
          handleFile(input.files[0]);
        }
      });
  
      // Кнопка удаления файла
      if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          resetFile();
        });
      }
  
      // Drag and drop события
      zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('border-brand-500', 'bg-brand-50/50');
      });
  
      zone.addEventListener('dragleave', (e) => {
        e.preventDefault();
        zone.classList.remove('border-brand-500', 'bg-brand-50/50');
      });
  
      zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('border-brand-500', 'bg-brand-50/50');
        if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]) {
          const file = e.dataTransfer.files[0];
          // Устанавливаем файл в input через DataTransfer
          const dt = new DataTransfer();
          dt.items.add(file);
          input.files = dt.files;
          handleFile(file);
        }
      });
    });
  }
  

  // forms.js
  // Обработка форм заявок и отправка данных в API.
  
  
  function initForms() {
    const leadModal = document.getElementById('lead-modal');
    const modalServiceTitle = document.getElementById('modal-service-title');
  
    if (leadModal) {
      document.querySelectorAll('.js-open-modal').forEach(btn => {
        btn.addEventListener('click', () => {
          const service = btn.getAttribute('data-service') || 'Вентилируемые фасады и подсистемы';
          if (modalServiceTitle) modalServiceTitle.textContent = `Услуга: ${service}`;
          const serviceInput = leadModal.querySelector('input[name="service"]');
          if (serviceInput) serviceInput.value = service;
          leadModal.classList.remove('hidden');
          document.body.style.overflow = 'hidden';
        });
      });
  
      document.querySelectorAll('.js-close-modal').forEach(btn => {
        btn.addEventListener('click', () => {
          leadModal.classList.add('hidden');
          document.body.style.overflow = '';
        });
      });
  
      leadModal.addEventListener('click', (e) => {
        if (e.target === leadModal) {
          leadModal.classList.add('hidden');
          document.body.style.overflow = '';
        }
      });
    }
  
    const leadForms = document.querySelectorAll('.js-lead-form');
    leadForms.forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
  
        form.querySelectorAll('.error-msg').forEach(el => el.classList.add('hidden'));
        const globalErrorEl = form.querySelector('.js-form-global-error');
        if (globalErrorEl) globalErrorEl.classList.add('hidden');
  
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
          const digits = phoneInput.value.trim().replace(/\D/g, '');
          const isValidPhone = (digits.length === 11 && (digits.startsWith('7') || digits.startsWith('8'))) ||
                               (digits.length === 10 && digits.startsWith('9'));
          if (!isValidPhone) {
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
  
        const formData = new FormData(form);
  
        const originalBtnHtml = submitBtn.innerHTML;
        submitBtn.disabled = true;
        submitBtn.classList.add('opacity-75', 'cursor-not-allowed');
        submitBtn.innerHTML = `
          <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
            <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          Отправка...
        `;
  
        try {
          const response = await fetch(CONFIG.API_URL, {
            method: 'POST',
            body: formData
          });
  
          if (!response.ok) {
            let errorMsg = `Сервер вернул ошибку (${response.status})`;
            try {
              const errData = await response.json();
              if (errData && errData.error) errorMsg = errData.error;
            } catch (_) {}
            throw new Error(errorMsg);
          }
  
          const result = await response.json();
          if (!result.success || !result.leadId) {
            throw new Error(result.error || 'Сервер не вернул подтверждение или номер заявки');
          }
  
          const formContainer = form.closest('.form-container') || form;
          formContainer.innerHTML = `
            <div class="p-8 text-center bg-white rounded-3xl border border-slate-200 shadow-xl animate-in fade-in duration-300">
              <div class="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4">
                <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
                </svg>
              </div>
              <span class="text-xs font-bold text-emerald-600 uppercase tracking-wider block mb-1">
                Заявка принята
              </span>
              <h3 class="text-2xl font-bold font-heading text-slate-900 mb-1 js-success-lead-id"></h3>
              <p class="text-slate-600 mb-5 max-w-md mx-auto text-sm leading-relaxed">
                Заявка зарегистрирована в системе ООО «ФЕДСТРОЙ». Инженер ПТО получит уведомление и свяжется с вами в рабочее время (пн–пт, 9:00–18:00 МСК).
              </p>
              <div class="js-attached-file-badge hidden inline-flex items-center gap-2 text-xs text-slate-700 bg-slate-100 px-3.5 py-2 rounded-xl mb-5">
                <svg class="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
                <span>Файл ТЗ принят: <strong class="js-attached-file-name"></strong></span>
              </div>
              <div class="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-center gap-3 text-xs sm:text-sm">
                <span class="text-slate-500">Срочный вопрос?</span>
                <a href="tel:+78007000223" class="font-bold text-brand-600 hover:text-brand-700">8 (800) 700-02-23</a>
                <span class="text-slate-300 hidden sm:inline">•</span>
                <a href="${CONFIG.TELEGRAM_URL}" target="_blank" rel="noopener noreferrer" class="text-slate-600 hover:text-[#229ED9] font-semibold">Telegram @Lexus2026</a>
              </div>
            </div>
          `;
  
          const leadIdEl = formContainer.querySelector('.js-success-lead-id');
          if (leadIdEl) leadIdEl.textContent = `Номер заявки: ${result.leadId}`;
  
          const attachedFile = form.querySelector('input[type="file"]')?.files[0];
          if (attachedFile) {
            const badge = formContainer.querySelector('.js-attached-file-badge');
            const nameSpan = formContainer.querySelector('.js-attached-file-name');
            if (badge && nameSpan) {
              nameSpan.textContent = attachedFile.name;
              badge.classList.remove('hidden');
            }
          }
  
        } catch (err) {
          console.error('[forms] Ошибка отправки:', err);
  
          submitBtn.disabled = false;
          submitBtn.classList.remove('opacity-75', 'cursor-not-allowed');
          submitBtn.innerHTML = originalBtnHtml;
  
          let errBox = form.querySelector('.js-form-global-error');
          if (!errBox) {
            errBox = document.createElement('div');
            errBox.className = 'js-form-global-error p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs sm:text-sm mt-4 text-left';
            submitBtn.insertAdjacentElement('afterend', errBox);
          }
  
          errBox.innerHTML = `
            <div class="flex items-start gap-2.5">
              <svg class="w-5 h-5 text-red-500 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
              <div>
                <p class="font-bold mb-1">Не удалось отправить заявку</p>
                <p class="text-xs text-red-600 mb-2 leading-relaxed js-error-text"></p>
                <div class="flex flex-wrap items-center gap-3 pt-1 border-t border-red-200/60 text-xs">
                  <span>Прямая связь с ПТО:</span>
                  <a href="tel:+78007000223" class="font-bold underline text-red-800 hover:text-red-900">8 (800) 700-02-23</a>
                  <a href="${CONFIG.TELEGRAM_URL}" target="_blank" rel="noopener noreferrer" class="font-semibold text-[#229ED9] underline">Telegram</a>
                </div>
              </div>
            </div>
          `;
          const errTextEl = errBox.querySelector('.js-error-text');
          if (errTextEl) {
            errTextEl.textContent = err.message || 'Проверьте соединение с интернетом или повторите попытку.';
          }
          errBox.classList.remove('hidden');
        }
      });
    });
  }
  

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
})();
