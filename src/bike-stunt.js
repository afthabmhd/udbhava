(() => {
  const section = document.querySelector('.bike-stunt-section');
  const rider = section?.querySelector('.bike-stunt-rider');
  if (!section || !rider) return;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let sectionEntered = false;
  let jumpStarted = false;

  function revealCopy() {
    section.classList.add('text-ready');
  }

  function startJump() {
    if (jumpStarted) return;
    jumpStarted = true;
    if (reducedMotion) {
      section.classList.add('jump-ready');
      revealCopy();
      return;
    }

    const finishJump = event => {
      if (event && event.animationName !== 'bike-stunt-jump') return;
      rider.removeEventListener('animationend', finishJump);
      clearTimeout(fallback);
      section.classList.remove('jump-animating');
      revealCopy();
    };
    section.classList.add('jump-animating');
    const fallback = window.setTimeout(() => finishJump(), 1150);
    rider.addEventListener('animationend', finishJump);
    requestAnimationFrame(() => requestAnimationFrame(() => section.classList.add('jump-ready')));
  }

  function waitForNebula() {
    if (reducedMotion || window.__udbhavaBikeStuntNebulaReady) {
      startJump();
      return;
    }
    window.addEventListener('udbhava:bike-stunt-nebula-ready', startJump, { once: true });
  }

  function enterSection() {
    if (sectionEntered) return;
    sectionEntered = true;
    section.classList.add('scene-ready');
    if (reducedMotion) {
      section.classList.add('jump-ready');
      revealCopy();
      return;
    }
    waitForNebula();
  }

  const observer = new IntersectionObserver(entries => {
    if (entries.some(entry => entry.isIntersecting)) {
      observer.disconnect();
      enterSection();
    }
  }, { threshold: 0.06, rootMargin: '0px 0px -8% 0px' });
  observer.observe(section);
})();
