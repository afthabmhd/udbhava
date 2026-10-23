import { particleReveal } from './paattoholic-particles.js';

(() => {
  'use strict';

  const section = document.querySelector('.paattoholic-section');
  const windowElement = section?.querySelector('.paattoholic-performer-window');
  const image = windowElement?.querySelector('.paattoholic-performer');
  if (!section || !image) return;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let triggered = false;
  let finished = false;
  let cancelReveal = null;

  function showFinalFrame() {
    if (finished) return;
    finished = true;
    section.classList.remove('is-particle-revealing');
    section.classList.add('is-materialized', 'is-revealed');
    if (!reducedMotion) {
      image.style.transition = 'opacity 180ms ease';
      image.style.opacity = '0.88';
      requestAnimationFrame(() => { image.style.opacity = '1'; });
    }
  }

  if (reducedMotion) {
    section.classList.add('is-materialized', 'is-revealed');
    image.style.opacity = '1';
    return;
  }

  function startWhenReady() {
    if (triggered || finished) return;
    triggered = true;
    const start = () => {
      if (finished) return;
      if (!image.naturalWidth) {
        showFinalFrame();
        return;
      }
      section.classList.add('is-particle-revealing');
      const reveal = particleReveal(image, {
        from: 'below',
        duration: 3800,
        cell: 9,
        onDone: showFinalFrame,
      });
      cancelReveal = reveal.cancel;
      // particleReveal has now sampled the PNG and built its arrival map. Start the
      // matching nebula clock only after that preparation has completed.
      window.dispatchEvent(new Event('udbhava:paattoholic-materialization-start'));
    };

    if (image.complete) {
      start();
    } else {
      image.addEventListener('load', start, { once: true });
      image.addEventListener('error', showFinalFrame, { once: true });
    }
  }

  if (!('IntersectionObserver' in window)) {
    startWhenReady();
  } else {
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      observer.disconnect();
      startWhenReady();
    }, { threshold: 0.4 });
    observer.observe(section);
  }

  window.addEventListener('resize', () => {
    if (!triggered || finished) return;
    cancelReveal?.();
    showFinalFrame();
  }, { passive: true });
})();
