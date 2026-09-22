// ООО «ФЕДСТРОЙ» — Interactive B2B Controller

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

    // Close mobile menu on link click
    mobileMenu.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        mobileMenu.classList.add('hidden');
        mobileMenuBtn.setAttribute('aria-expanded', 'false');
      });
    });
  }

  // --- Interactive B2B Cost Calculator ---
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

  // Base pricing matrix (RUB per m²)
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

    // Installation labor cost
    const installCost = (installCheckbox && installCheckbox.checked) ? 1450 : 0;

    // Calculate per m2
    const perMeterMin = Math.round((materialData.baseMin * metalMult) + installCost);
    const perMeterMax = Math.round((materialData.baseMax * metalMult) + installCost);

    // Total cost
    const totalMin = perMeterMin * area;
    const totalMax = perMeterMax * area;

    // Estimated duration (approx 45-60 m2 per day for standard team)
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
    // Dynamically adjust material options if raised floor is picked
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

  // Initial calculation
  updateCalculator();

  // --- Modal System ---
  const modal = document.getElementById('lead-modal');
  const openModalBtns = document.querySelectorAll('.js-open-modal');
  const closeModalBtns = document.querySelectorAll('.js-close-modal');

  function openModal(serviceTitle = '') {
    if (!modal) return;
    const titleEl = modal.querySelector('#modal-service-title');
    if (titleEl && serviceTitle) {
      titleEl.textContent = `по направлению: ${serviceTitle}`;
    }
    modal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    const firstInput = modal.querySelector('input:not([type="hidden"])');
    if (firstInput) setTimeout(() => firstInput.focus(), 50);
  }

  function closeModal() {
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.style.overflow = '';
  }

  openModalBtns.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const service = btn.getAttribute('data-service') || '';
      openModal(service);
    });
  });

  closeModalBtns.forEach(btn => {
    btn.addEventListener('click', closeModal);
  });

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) closeModal();
    });
  }

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && !modal.classList.contains('hidden')) {
      closeModal();
    }
  });

  // --- Form Validation & Submission Handling (8 States Contract) ---
  const forms = document.querySelectorAll('.js-lead-form');

  forms.forEach(form => {
    form.addEventListener('submit', (e) => {
      e.preventDefault();

      const nameInput = form.querySelector('input[name="name"]');
      const phoneInput = form.querySelector('input[name="phone"]');
      const agreeInput = form.querySelector('input[name="agreement"]');
      const submitBtn = form.querySelector('button[type="submit"]');

      let hasError = false;

      // Reset previous error states
      form.querySelectorAll('.input-error').forEach(el => el.classList.remove('input-error', 'border-red-500'));
      form.querySelectorAll('.error-msg').forEach(el => el.classList.add('hidden'));

      // Validate Name
      if (nameInput && !nameInput.value.trim()) {
        nameInput.classList.add('border-red-500', 'input-error');
        const err = form.querySelector(`#error-${nameInput.name}`);
        if (err) err.classList.remove('hidden');
        hasError = true;
      }

      // Validate Phone (at least 10 digits)
      const phoneDigits = phoneInput ? phoneInput.value.replace(/\D/g, '') : '';
      if (phoneDigits.length < 10) {
        if (phoneInput) phoneInput.classList.add('border-red-500', 'input-error');
        const err = form.querySelector(`#error-${phoneInput.name}`);
        if (err) err.classList.remove('hidden');
        hasError = true;
      }

      // Validate Agreement
      if (agreeInput && !agreeInput.checked) {
        const err = form.querySelector(`#error-${agreeInput.name}`);
        if (err) err.classList.remove('hidden');
        hasError = true;
      }

      if (hasError) return;

      // Loading state
      const originalText = submitBtn.innerHTML;
      submitBtn.disabled = true;
      submitBtn.classList.add('opacity-75', 'cursor-not-allowed');
      submitBtn.innerHTML = `
        <svg class="animate-spin -ml-1 mr-3 h-5 w-5 text-white inline-block" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
        </svg>
        Формируем расчет...
      `;

      // Simulate API submission
      setTimeout(() => {
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-75', 'cursor-not-allowed');
        submitBtn.innerHTML = originalText;

        // Show Success View
        const formContainer = form.closest('.form-container') || form;
        formContainer.innerHTML = `
          <div class="p-8 text-center bg-white rounded-xl border border-slate-200">
            <div class="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
              </svg>
            </div>
            <h3 class="text-2xl font-bold text-slate-900 mb-2">Заявка принята в работу</h3>
            <p class="text-slate-600 mb-6 max-w-md mx-auto">
              Инженер ПТО ООО «ФЕДСТРОЙ» подготовит ориентировочную смету и свяжется с вами в течение 25 минут в рабочее время.
            </p>
            <div class="inline-flex items-center gap-2 text-sm text-slate-500 bg-slate-50 px-4 py-2 rounded-lg border border-slate-200">
              <span>Срочный вопрос? Звоните:</span>
              <a href="tel:+78007000223" class="font-semibold text-slate-900 hover:text-orange-600">8 (800) 700-02-23</a>
            </div>
          </div>
        `;
      }, 700);
    });
  });

  // --- Portfolio Filter Tabs ---
  const filterBtns = document.querySelectorAll('.js-portfolio-filter');
  const portfolioItems = document.querySelectorAll('.js-portfolio-item');

  filterBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const category = btn.getAttribute('data-filter');

      filterBtns.forEach(b => {
        b.classList.remove('bg-slate-900', 'text-white', 'shadow-sm');
        b.classList.add('bg-white', 'text-slate-600', 'hover:bg-slate-100');
      });
      btn.classList.remove('bg-white', 'text-slate-600', 'hover:bg-slate-100');
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

  // --- Photo Lightbox Viewer ---
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
