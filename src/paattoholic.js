(() => {
  'use strict';

  const section = document.querySelector('.paattoholic-section');
  const windowElement = section?.querySelector('.paattoholic-performer-window');
  const image = windowElement?.querySelector('.paattoholic-performer');
  const revealCanvas = windowElement?.querySelector('.paattoholic-reveal');
  if (!section || !image || !revealCanvas) return;

  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let arrivalMap = null;
  let sourcePixels = null;
  let framePixels = null;
  let context = null;
  let sourcePixels32 = null;
  let framePixels32 = null;
  let lastProgressStep = -1;
  let lastContactStep = -1;
  let lastPutImageDataAt = -Infinity;
  let completed = false;
  const touchDevice = matchMedia('(pointer: coarse)').matches;
  const minFrameInterval = 36;
  const littleEndian = new Uint8Array(new Uint32Array([0x01020304]).buffer)[0] === 4;
  const rgbMask = littleEndian ? 0x00ffffff : 0xffffff00;
  const alphaMask = littleEndian ? 0xff000000 : 0x000000ff;
  const alphaShift = littleEndian ? 24 : 0;
  const hand = { x: .087, y: .44 };

  function smoothstep(value) {
    const t = Math.max(0, Math.min(1, value));
    return t * t * (3 - 2 * t);
  }

  function createArrivalMap(width, height) {
    const px = (x, y) => [x * width, y * height];
    const segment = (from, to, start, end, radius) => {
      const [x1, y1] = px(...from);
      const [x2, y2] = px(...to);
      return { x1, y1, x2, y2, start, end, radius };
    };
    const routes = [
      segment([.087, .249], [.24, .34], 0, .105, width * .055),
      segment([.24, .34], [.40, .39], .105, .23, width * .085),
      segment([.40, .39], [.49, .51], .23, .37, width * .12),
      segment([.49, .51], [.50, .40], .36, .44, width * .08),
      segment([.50, .40], [.49, .205], .44, .57, width * .075),
      segment([.40, .39], [.62, .36], .53, .62, width * .075),
      segment([.62, .36], [.78, .23], .62, .69, width * .07),
      segment([.78, .23], [.91, .07], .69, .77, width * .055),
      segment([.49, .51], [.51, .68], .55, .70, width * .13),
      segment([.51, .68], [.39, .82], .69, .82, width * .105),
      segment([.39, .82], [.27, .93], .82, .91, width * .075),
      segment([.51, .68], [.63, .82], .75, .89, width * .11),
      segment([.63, .82], [.76, .93], .89, .99, width * .075)
    ];

    const arrivals = new Float32Array(width * height);
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = y * width + x;
        let arrival = 1.02;
        for (const line of routes) {
          const dx = line.x2 - line.x1;
          const dy = line.y2 - line.y1;
          const lengthSquared = dx * dx + dy * dy || 1;
          const along = Math.max(0, Math.min(1, ((x - line.x1) * dx + (y - line.y1) * dy) / lengthSquared));
          const distance = Math.hypot(x - (line.x1 + dx * along), y - (line.y1 + dy * along));
          if (distance > line.radius * 2.3) continue;
          const lateralDelay = Math.min(.11, distance / line.radius * .045);
          arrival = Math.min(arrival, line.start + (line.end - line.start) * along + lateralDelay);
        }
        // Stable, fine-grained irregularity keeps the growing edge in the same
        // glyph-nebula language without adding an unrelated particle texture.
        let noise = Math.imul(index ^ 0x6d2b79f5, 0x1b873593);
        noise ^= noise >>> 13;
        const edgeVariation = ((noise >>> 0) / 4294967295 - .5) * .045;
        if (arrival > 1) arrival = .965 + ((noise >>> 7) & 255) / 255 * .035;
        arrivals[index] = Math.max(0, Math.min(1, arrival + edgeVariation));
      }
    }
    return arrivals;
  }

  function prepareReveal() {
    if (arrivalMap || !image.complete || !image.naturalWidth) return;
    const maxWidth = touchDevice ? 384 : 768;
    const width = Math.min(image.naturalWidth, maxWidth);
    const height = Math.round(width * image.naturalHeight / image.naturalWidth);
    revealCanvas.width = width;
    revealCanvas.height = height;
    context = revealCanvas.getContext('2d', { alpha: true, willReadFrequently: true });
    if (!context) return;
    context.drawImage(image, 0, 0, width, height);
    sourcePixels = context.getImageData(0, 0, width, height);
    framePixels = context.createImageData(width, height);
    sourcePixels32 = new Uint32Array(sourcePixels.data.buffer);
    framePixels32 = new Uint32Array(framePixels.data.buffer);
    arrivalMap = createArrivalMap(width, height);
    const handX = getComputedStyle(image).getPropertyValue('--hand-x').trim();
    const handY = getComputedStyle(image).getPropertyValue('--hand-y').trim();
    if (handX.endsWith('%')) hand.x = parseFloat(handX) / 100;
    if (handY.endsWith('%')) hand.y = parseFloat(handY) / 100;
    section.dataset.materializerReady = 'true';
  }

  function drawMaterialization(progress, contactPulse, nowMs) {
    if (!arrivalMap) prepareReveal();
    if (!context || !sourcePixels32 || !framePixels32 || !arrivalMap) return;
    const progressStep = Math.floor(progress * 180);
    const contactStep = Math.floor(contactPulse * 24);
    if (progressStep === lastProgressStep && contactStep === lastContactStep) return;
    const isFinalFrame = progress >= 1 && !completed;
    if (!isFinalFrame && nowMs - lastPutImageDataAt < minFrameInterval) return;
    lastProgressStep = progressStep;
    lastContactStep = contactStep;
    lastPutImageDataAt = nowMs;

    const { width, height } = sourcePixels;
    const source = sourcePixels32;
    const output = framePixels32;
    const handX = hand.x * width;
    const handY = hand.y * height;
    const pulseRadius = width * .085;
    for (let index = 0; index < arrivalMap.length; index += 1) {
      const reveal = smoothstep((progress - arrivalMap[index] + .035) / .075);
      let pulseReveal = 0;
      if (contactPulse > .002) {
        const x = index % width;
        const y = (index / width) | 0;
        const dx = x - handX;
        const dy = y - handY;
        pulseReveal = contactPulse * Math.exp(-(dx * dx + dy * dy) / (pulseRadius * pulseRadius * 1.5)) * .82;
      }
      // Preserve the source cutout alpha throughout the materialization sweep
      // so the artist stays transparent outside the actual silhouette.
      const sourcePixel = source[index];
      const sourceAlpha = littleEndian ? sourcePixel >>> 24 : sourcePixel & 0xff;
      const alpha = Math.round(sourceAlpha * Math.max(reveal, pulseReveal));
      output[index] = (sourcePixel & rgbMask) | ((alpha << alphaShift) & alphaMask);
    }
    context.putImageData(framePixels, 0, 0);
    if (progress >= 1 && !completed) {
      completed = true;
      section.classList.add('is-materialized', 'is-revealed');
      section.classList.remove('is-materializing');
    }
  }

  if (reducedMotion) {
    section.classList.add('is-materialized', 'is-revealed');
    return;
  }

  window.__udbhavaPaattoholicFrame = drawMaterialization;
  let triggered = false;
  const trigger = () => {
    if (triggered) return;
    triggered = true;
    section.classList.add('is-materializing');
    window.dispatchEvent(new Event('udbhava:paattoholic-materialization-start'));
  };

  if (!('IntersectionObserver' in window)) {
    trigger();
    return;
  }
  const observer = new IntersectionObserver(entries => {
    if (!entries.some(entry => entry.isIntersecting)) return;
    trigger();
    observer.disconnect();
    if (image.complete) prepareReveal();
    else if (typeof image.decode === 'function') image.decode().then(prepareReveal).catch(() => {});
  }, { threshold: .08, rootMargin: '100% 0px 100% 0px' });
  observer.observe(section);
  window.addEventListener('udbhava:paattoholic-materialization-complete', () => {
    section.classList.add('is-materialized', 'is-revealed');
    section.classList.remove('is-materializing');
  }, { once: true });
})();
