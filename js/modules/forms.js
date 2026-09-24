// Обработка форм заявок и отправка данных в API.
import { CONFIG } from '../config.js';

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function initForms() {
  const leadModal = document.getElementById('lead-modal');
  const callbackModal = document.getElementById('callback-modal');
  const modalServiceTitle = document.getElementById('modal-service-title');

  function resetFormAndClose(form, modal = null) {
    if (!form) return;

    // 1. Очищаем все текстовые поля и чекбоксы
    form.reset();

    // 2. Скрываем сообщения об ошибках
    form.querySelectorAll('.error-msg').forEach(el => el.classList.add('hidden'));
    const errBox = form.querySelector('.js-form-global-error');
    if (errBox) errBox.classList.add('hidden');

    // 3. Сбрасываем превью загрузчика файлов
    const fileInput = form.querySelector('input[type="file"]');
    if (fileInput) fileInput.value = '';
    const dropzone = form.querySelector('.js-file-dropzone');
    if (dropzone) {
      const promptEl = dropzone.querySelector('.js-dropzone-prompt');
      const previewEl = dropzone.querySelector('.js-dropzone-preview');
      const errorEl = dropzone.querySelector('.js-file-error');
      if (promptEl) promptEl.classList.remove('hidden');
      if (previewEl) previewEl.classList.add('hidden');
      if (errorEl) { errorEl.textContent = ''; errorEl.classList.add('hidden'); }
    }

    // 4. Восстанавливаем кнопку отправки
    const submitBtn = form.querySelector('button[type="submit"]');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.classList.remove('opacity-75', 'cursor-not-allowed');
    }

    // 5. Удаляем экран успеха и возвращаем видимость формы и заголовка
    const container = form.parentElement;
    if (container) {
      container.querySelectorAll('.js-success-view').forEach(el => el.remove());
      container.querySelectorAll('.js-modal-header').forEach(el => el.classList.remove('hidden'));
    }
    form.classList.remove('hidden');

    // 6. Если это модальное окно — закрываем его и разблокируем скролл страницы
    if (modal) {
      modal.classList.add('hidden');
      document.body.style.overflow = '';
    }
  }

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
        const form = leadModal.querySelector('form.js-lead-form');
        resetFormAndClose(form, leadModal);
      });
    });

    leadModal.addEventListener('click', (e) => {
      if (e.target === leadModal) {
        const form = leadModal.querySelector('form.js-lead-form');
        resetFormAndClose(form, leadModal);
      }
    });
  }

  if (callbackModal) {
    document.querySelectorAll('.js-close-callback').forEach(btn => {
      btn.addEventListener('click', () => {
        const form = callbackModal.querySelector('form.js-lead-form');
        resetFormAndClose(form, callbackModal);
      });
    });

    callbackModal.addEventListener('click', (e) => {
      if (e.target === callbackModal) {
        const form = callbackModal.querySelector('form.js-lead-form');
        resetFormAndClose(form, callbackModal);
      }
    });
  }

  // Закрытие модальных окон по Escape
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' || e.key === 'Esc') {
      if (leadModal && !leadModal.classList.contains('hidden')) {
        const form = leadModal.querySelector('form.js-lead-form');
        resetFormAndClose(form, leadModal);
      }
      if (callbackModal && !callbackModal.classList.contains('hidden')) {
        const form = callbackModal.querySelector('form.js-lead-form');
        resetFormAndClose(form, callbackModal);
      }
    }
  });

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
          if (response.status === 413) {
            throw new Error('Размер файла превышает лимит сервера (на Vercel максимум 4.5 МБ). Пожалуйста, укажите ссылку на облачный диск или уменьшите размер файла.');
          }
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

        const modal = form.closest('#lead-modal, #callback-modal');
        const container = form.parentElement;
        if (container) {
          container.querySelectorAll('.js-modal-header').forEach(el => el.classList.add('hidden'));
        }

        // Скрываем форму и восстанавливаем кнопку
        form.classList.add('hidden');
        submitBtn.disabled = false;
        submitBtn.classList.remove('opacity-75', 'cursor-not-allowed');
        submitBtn.innerHTML = originalBtnHtml;

        const attachedFile = form.querySelector('input[type="file"]')?.files[0];
        const attachedFileName = attachedFile ? attachedFile.name : null;

        // Создаем карточку успеха
        const successView = document.createElement('div');
        successView.className = 'js-success-view text-center animate-in fade-in duration-300 relative py-2';
        successView.innerHTML = `
          <div class="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-2xl flex items-center justify-center mx-auto mb-4 mt-2">
            <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
            </svg>
          </div>
          <span class="text-xs font-bold text-emerald-600 uppercase tracking-wider block mb-1">
            Заявка принята
          </span>
          <h3 class="text-2xl font-bold font-heading text-slate-900 mb-1 js-success-lead-id">Номер заявки: ${escapeHtml(result.leadId)}</h3>
          <p class="text-slate-600 mb-5 max-w-md mx-auto text-sm leading-relaxed">
            Заявка зарегистрирована в системе ООО «ФЕДСТРОЙ». Мы свяжемся с вами в рабочее время (пн–пт, 9:00–18:00 МСК) для уточнения деталей и расчёта сметы.
          </p>
          ${attachedFileName ? `
            <div class="inline-flex items-center gap-2 text-xs text-slate-700 bg-slate-100 px-3.5 py-2 rounded-xl mb-5">
              <svg class="w-4 h-4 text-brand-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13"/></svg>
              <span>Файл ТЗ принят: <strong>${escapeHtml(attachedFileName)}</strong></span>
            </div>
          ` : ''}
          <div class="pt-4 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-center gap-3 text-xs sm:text-sm mb-4">
            <span class="text-slate-500">Срочный вопрос?</span>
            <a href="tel:+78007000223" class="font-bold text-brand-600 hover:text-brand-700">8 (800) 700-02-23</a>
            <span class="text-slate-300 hidden sm:inline">•</span>
            <a href="${CONFIG.TELEGRAM_URL}" target="_blank" rel="noopener noreferrer" class="text-slate-600 hover:text-[#229ED9] font-semibold">Telegram @Lexus2026</a>
          </div>

          <button type="button" class="js-action-close-success w-full py-3.5 bg-brand-600 hover:bg-brand-700 active:scale-[0.98] text-white font-bold rounded-xl text-sm uppercase tracking-wider transition-all shadow-md cursor-pointer">
            ${modal ? 'Закрыть окно' : 'Отправить ещё одну заявку'}
          </button>
        `;

        form.insertAdjacentElement('afterend', successView);

        // Кнопки закрытия и сброса
        successView.querySelectorAll('.js-action-close-success').forEach(btn => {
          btn.addEventListener('click', () => {
            resetFormAndClose(form, modal);
          });
        });

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
