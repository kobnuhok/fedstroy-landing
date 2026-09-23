// =========================================================================
// Модуль загрузки файлов ТЗ и проектной документации
// Поддерживает drag-and-drop, валидацию формата и размера (до 35 МБ)
// =========================================================================

export function initUploader() {
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
