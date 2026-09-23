// Floating contact widget and scroll-to-top button.
export function initFloatingDock() {
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
