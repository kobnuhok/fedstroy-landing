// Portfolio category filter.
export function initPortfolio() {
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
