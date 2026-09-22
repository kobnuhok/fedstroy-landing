// =========================================================================
// Модуль инженерного онлайн-калькулятора стоимости
// Автономен: если блок #calculator удален, функция мягко выходит без ошибок
// =========================================================================

export function initCalculator() {
  const calcSection = document.getElementById('calculator');
  if (!calcSection) return; // Безопасный выход, если блок отсутствует

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

  // Первоначальный расчет
  updateCalculator();
}
