// Cost estimator logic based on material, subsystem and area.
export function initCalculator() {
  const calcSection = document.getElementById('calculator');
  if (!calcSection) return;

  const areaSlider = document.getElementById('calc-area');
  const areaValue = document.getElementById('calc-area-val');
  const systemTypeRadios = document.querySelectorAll('input[name="system-type"]');

  const facadeGroup = document.getElementById('calc-facade-group');
  const materialSelect = document.getElementById('calc-material');
  const metalRadios = document.querySelectorAll('input[name="subsystem-metal"]');

  const falshpolGroup = document.getElementById('calc-falshpol-group');
  const falshpolSelect = document.getElementById('calc-falshpol-material');
  const falshpolSubsystemRadios = document.querySelectorAll('input[name="falshpol-subsystem"]');

  const installCheckbox = document.getElementById('calc-install');
  const insulationCheckbox = document.getElementById('calc-insulation');
  const insulationWrap = document.getElementById('calc-insulation-wrap');

  const totalMinEl = document.getElementById('calc-total-min');
  const totalMaxEl = document.getElementById('calc-total-max');
  const perMeterEl = document.getElementById('calc-per-meter');
  const durationEl = document.getElementById('calc-duration');
  const breakdownSubsystemEl = document.getElementById('calc-breakdown-subsystem');
  const breakdownCladdingEl = document.getElementById('calc-breakdown-cladding');

  const facadeCladdingPricing = {
    keramogranit: { baseMin: 1800, baseMax: 2600, label: 'Керамогранит 600×600' },
    composite: { baseMin: 2400, baseMax: 3500, label: 'Алюминиевый композит (АКП)' },
    metalkassety: { baseMin: 2100, baseMax: 3000, label: 'Металлокассеты' },
    fibrocement: { baseMin: 2700, baseMax: 3900, label: 'Фиброцементные плиты' },
    hpl: { baseMin: 3800, baseMax: 5600, label: 'HPL-панели' }
  };

  const facadeSubsystemPricing = {
    galvanized: { min: 850, max: 1150, name: 'Оцинкованная сталь 1.2 мм' },
    aluminum: { min: 1250, max: 1650, name: 'Алюминиевый профиль АД31Т1' },
    stainless: { min: 1850, max: 2450, name: 'Нержавеющая сталь AISI 430/304' }
  };

  const falshpolSlabPricing = {
    falshpol_chipboard: { baseMin: 1900, baseMax: 2700, label: 'Фальшпол ДСП 38 мм' },
    falshpol_sulfate: { baseMin: 2600, baseMax: 3700, label: 'Фальшпол Сульфат кальция' }
  };

  const falshpolSubsystemPricing = {
    standard: { min: 600, max: 900, name: 'Стойки стандарт' },
    reinforced: { min: 950, max: 1400, name: 'Усиленная подсистема ЦОД' }
  };

  function getSelectedRadio(radios, fallback) {
    let val = fallback;
    radios.forEach(r => { if (r.checked) val = r.value; });
    return val;
  }

  function updateCalculator() {
    if (!areaSlider) return;

    const area = parseInt(areaSlider.value, 10);
    if (areaValue) areaValue.textContent = area.toLocaleString('ru-RU');

    const selectedSystem = getSelectedRadio(systemTypeRadios, 'facade');
    const includeFacade = selectedSystem === 'facade' || selectedSystem === 'complex';
    const includeFalshpol = selectedSystem === 'falshpol' || selectedSystem === 'complex';

    if (facadeGroup) facadeGroup.classList.toggle('hidden', !includeFacade);
    if (falshpolGroup) falshpolGroup.classList.toggle('hidden', !includeFalshpol);
    if (insulationWrap) insulationWrap.classList.toggle('hidden', !includeFacade);

    const facadeMat = facadeCladdingPricing[materialSelect ? materialSelect.value : 'keramogranit'] || facadeCladdingPricing.keramogranit;
    const facadeSub = facadeSubsystemPricing[getSelectedRadio(metalRadios, 'galvanized')] || facadeSubsystemPricing.galvanized;

    const floorMat = falshpolSlabPricing[falshpolSelect ? falshpolSelect.value : 'falshpol_chipboard'] || falshpolSlabPricing.falshpol_chipboard;
    const floorSub = falshpolSubsystemPricing[getSelectedRadio(falshpolSubsystemRadios, 'standard')] || falshpolSubsystemPricing.standard;

    const insulationCost = (includeFacade && insulationCheckbox && insulationCheckbox.checked) ? 550 : 0;
    const installPerSystem = (installCheckbox && installCheckbox.checked) ? 1450 : 0;

    let subMin = 0;
    let subMax = 0;
    let matMin = 0;
    let matMax = 0;
    let installCost = 0;
    const subNames = [];
    const matNames = [];

    if (includeFacade) {
      subMin += facadeSub.min;
      subMax += facadeSub.max;
      matMin += facadeMat.baseMin;
      matMax += facadeMat.baseMax;
      installCost += installPerSystem;
      subNames.push(facadeSub.name);
      matNames.push(facadeMat.label);
    }

    if (includeFalshpol) {
      subMin += floorSub.min;
      subMax += floorSub.max;
      matMin += floorMat.baseMin;
      matMax += floorMat.baseMax;
      installCost += installPerSystem;
      subNames.push(floorSub.name);
      matNames.push(floorMat.label);
    }

    const perMeterMin = subMin + matMin + insulationCost + installCost;
    const perMeterMax = subMax + matMax + insulationCost + installCost;

    const totalMin = perMeterMin * area;
    const totalMax = perMeterMax * area;

    const daysFactor = selectedSystem === 'complex' ? 1.35 : 1;
    const workDaysMin = Math.max(7, Math.round((area / 65) * daysFactor));
    const workDaysMax = Math.max(10, Math.round((area / 45) * daysFactor));

    if (totalMinEl) totalMinEl.textContent = totalMin.toLocaleString('ru-RU') + ' ₽';
    if (totalMaxEl) totalMaxEl.textContent = totalMax.toLocaleString('ru-RU') + ' ₽';
    if (perMeterEl) perMeterEl.textContent = `от ${perMeterMin.toLocaleString('ru-RU')} ₽/м²`;
    if (durationEl) durationEl.textContent = `${workDaysMin}–${workDaysMax} раб. дней`;

    if (breakdownSubsystemEl) {
      breakdownSubsystemEl.textContent = `от ${(subMin * area).toLocaleString('ru-RU')} ₽ (${subNames.join(' + ')})`;
    }
    if (breakdownCladdingEl) {
      breakdownCladdingEl.textContent = `от ${(matMin * area).toLocaleString('ru-RU')} ₽ (${matNames.join(' + ')})`;
    }
  }

  areaSlider.addEventListener('input', updateCalculator);
  if (materialSelect) materialSelect.addEventListener('change', updateCalculator);
  if (falshpolSelect) falshpolSelect.addEventListener('change', updateCalculator);

  systemTypeRadios.forEach(r => r.addEventListener('change', updateCalculator));
  metalRadios.forEach(r => r.addEventListener('change', updateCalculator));
  falshpolSubsystemRadios.forEach(r => r.addEventListener('change', updateCalculator));
  if (installCheckbox) installCheckbox.addEventListener('change', updateCalculator);
  if (insulationCheckbox) insulationCheckbox.addEventListener('change', updateCalculator);

  document.querySelectorAll('.js-area-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetVal = parseInt(btn.getAttribute('data-area'), 10);
      if (areaSlider && targetVal) {
        areaSlider.value = targetVal;
        updateCalculator();
        document.querySelectorAll('.js-area-preset').forEach(b => {
          b.classList.remove('bg-brand-600', 'text-white', 'border-brand-600');
          b.classList.add('bg-white', 'text-slate-700', 'border-slate-200');
        });
        btn.classList.remove('bg-white', 'text-slate-700', 'border-slate-200');
        btn.classList.add('bg-brand-600', 'text-white', 'border-brand-600');
      }
    });
  });

  updateCalculator();
}
