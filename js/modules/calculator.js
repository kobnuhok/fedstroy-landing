// =========================================================================
// Модуль ориентировочного расчета стоимости подсистемы и материалов
// Расчет носит ознакомительный характер на основе средних норм расхода.
// =========================================================================

export function initCalculator() {
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
