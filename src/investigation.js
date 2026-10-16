(() => {
  const section = document.querySelector('.investigation-section');
  if (!section) return;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const titleLines = [...section.querySelectorAll('#investigation-title > span')];
  const clues = [...section.querySelectorAll('.evidence-item')];
  const connections = [...section.querySelectorAll('.connection')];
  const nodes = [...section.querySelectorAll('.evidence-node:not(.node-focus)')];
  const scrambleChars = '.:;,+-~=/*\\|()[]{}<>^_#%';
  let started = false;

  const scrambleLine = (line, lineIndex) => {
    const text = line.textContent.trim();
    const titleStyle = getComputedStyle(line.parentElement);
    const fontSize = parseFloat(titleStyle.fontSize) || 16;
    const measure = document.createElement('canvas').getContext('2d');
    measure.font = `${titleStyle.fontWeight} ${titleStyle.fontSize} ${titleStyle.fontFamily}`;
    const fragment = document.createDocumentFragment();
    const slots = [...text].map(character => {
      const slot = document.createElement('span');
      slot.className = 'investigation-letter';
      slot.style.width = `${measure.measureText(character).width / fontSize}em`;
      slot.style.letterSpacing = '0';
      slot.textContent = scrambleChars[Math.floor(Math.random() * scrambleChars.length)];
      fragment.appendChild(slot);
      return slot;
    });
    line.replaceChildren(fragment);
    line.setAttribute('aria-hidden', 'true');
    return { text, slots, lineIndex };
  };

  const drawConnections = () => {
    section.classList.add('connections-drawing');
    connections.forEach((path, index) => {
      const length = path.getTotalLength();
      path.style.strokeDasharray = `${length}`;
      path.style.strokeDashoffset = `${length}`;
      path.style.transitionDelay = `${index * 115}ms`;
      if (path.classList.contains('connection-red')) {
        path.addEventListener('transitionend', event => {
          if (event.propertyName === 'stroke-dashoffset') path.style.strokeDasharray = '';
        }, { once: true });
      }
      requestAnimationFrame(() => { path.style.strokeDashoffset = '0'; });
    });
    nodes.forEach((node, index) => {
      node.style.transitionDelay = `${460 + index * 100}ms`;
    });
  };

  const beginFocusSequence = () => {
    if (started) return;
    started = true;
    section.classList.add('is-visible', 'focus-arrived');
    if (reducedMotion) {
      clues.forEach(clue => clue.classList.add('is-decoded'));
      drawConnections();
      return;
    }

    const runs = titleLines.map(scrambleLine);
    const start = performance.now();
    const duration = 760;
    const tick = now => {
      const elapsed = now - start;
      for (const run of runs) {
        const progress = Math.max(0, Math.min(1, (elapsed - run.lineIndex * 80) / duration));
        const resolved = Math.floor(progress * run.text.length);
        run.slots.forEach((slot, index) => {
          slot.textContent = index < resolved
            ? run.text[index]
            : scrambleChars[Math.floor(Math.random() * scrambleChars.length)];
        });
      }
      if (elapsed < duration + 160) requestAnimationFrame(tick);
      else runs.forEach(run => run.slots.forEach((slot, index) => { slot.textContent = run.text[index]; }));
    };
    requestAnimationFrame(tick);

    // The fingerprint marker is the arrival point; clues unfold from it before
    // any evidence thread is allowed to draw across the board.
    const revealOrder = [
      '.evidence-fingerprint', '.evidence-surveillance', '.evidence-document',
      '.evidence-key', '.evidence-photo', '.evidence-map'
    ];
    revealOrder.forEach((selector, index) => {
      const clue = section.querySelector(selector);
      if (!clue) return;
      clue.style.setProperty('--clue-order', index);
      clue.classList.add('is-decoded');
    });
    const clueOpenTime = 760 + (revealOrder.length - 1) * 105 + 100;
    window.setTimeout(drawConnections, clueOpenTime);
  };

  connections.forEach(path => {
    const length = path.getTotalLength();
    path.style.strokeDasharray = `${length}`;
    path.style.strokeDashoffset = `${length}`;
  });
  window.addEventListener('udbhava:investigation-focus', beginFocusSequence, { once: true });
  if (reducedMotion || window.__udbhavaInvestigationFocusReached) requestAnimationFrame(beginFocusSequence);
})();
