// Fullscreen image lightbox modal.
export function initLightbox() {
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
