(() => {
  const section = document.querySelector('.robot-section');
  const vehicle = section?.querySelector('.robot-vehicle');
  if (!section || !vehicle) return;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let started = false;
  let robotStarted = false;

  function revealText() {
    section.classList.add('text-ready');
  }

  function startRobot() {
    if (robotStarted) return;
    robotStarted = true;
    section.classList.add('track-complete');
    if (reducedMotion) {
      section.classList.add('robot-running');
      revealText();
      return;
    }
    requestAnimationFrame(() => requestAnimationFrame(() => {
      section.classList.add('robot-running');
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        revealText();
      };
      vehicle.addEventListener('transitionend', (event) => {
        if (event.propertyName === 'transform') finish();
      }, { once: true });
      window.setTimeout(finish, 1500);
    }));
  }

  function startSequence() {
    if (started) return;
    started = true;
    section.classList.add('sequence-started');
    if (reducedMotion) {
      startRobot();
      return;
    }
    if (window.__udbhavaRobotTrackReady) {
      startRobot();
      return;
    }
    window.addEventListener('udbhava:robot-track-ready', startRobot, { once: true });
  }

  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) {
      observer.disconnect();
      startSequence();
    }
  }, { threshold: 0.12, rootMargin: '0px 0px -12% 0px' });
  observer.observe(section);
})();
