(() => {
  const section = document.querySelector('.explore-section');
  if (!section) return;

  const cards = [...section.querySelectorAll('.explore-card')];
  cards.forEach((card, index) => card.style.setProperty('--card-order', index));

  const reveal = () => section.classList.add('is-visible');
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || !('IntersectionObserver' in window)) {
    reveal();
    return;
  }

  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      reveal();
      observer.disconnect();
    }
  }, { threshold: 0.12 });

  observer.observe(section);
})();
