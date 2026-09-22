// =========================================================================
// Модуль форм, валидации (8 состояний) и стандартных модалок
// Автономен: работает с любыми формами с классом .js-lead-form на странице
// =========================================================================

export function initForms() {
  const leadModal = document.getElementById('lead-modal');
  const modalServiceTitle = document.getElementById('modal-service-title');

  // Модальные окна с кнопками .js-open-modal
  if (leadModal) {
    document.querySelectorAll('.js-open-modal').forEach(btn => {
      btn.addEventListener('click', () => {
        const service = btn.getAttribute('data-service') || 'Вентилируемые фасады и подсистемы';
        if (modalServiceTitle) modalServiceTitle.textContent = `Услуга: ${service}`;
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

  // Обработка всех форм .js-lead-form
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
}
