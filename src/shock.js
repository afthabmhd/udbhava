(() => {
  const section = document.querySelector('.shock-section');
  if (!section) return;
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let frame = 0;
  let visible = false;

  const update = () => {
    frame = 0;
    const time = performance.now();
    const surge = reducedMotion ? .72 : .58 + .42 * (0.5 + 0.5 * Math.sin(time / 190 + .8));

    window.__udbhavaShockSurge = surge;

    if (!reducedMotion && visible) frame = requestAnimationFrame(update);
  };

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };

  const observer = new IntersectionObserver(entries => {
    visible = entries.some(entry => entry.isIntersecting);
    section.classList.toggle('shock-active', visible);
    if (visible) {
      schedule();
    } else if (frame) {
      cancelAnimationFrame(frame);
      frame = 0;
      window.__udbhavaShockSurge = 0;
    }
  }, { threshold: 0 });
  observer.observe(section);
  update();

})();
