/*
 * particleReveal(img, opts) — ASCII particle intro for a transparent PNG.
 * Glyph particles are sampled from the PNG's own pixels (so colors + silhouette match),
 * fly in on a rising wave, lock onto their grid cell, then crossfade to the real <img>.
 *
 * Markup: the <img> must sit inside a positioned wrapper. The canvas is created
 * OVER-SIZED (padding) so glow / flying particles are never clipped.
 */
export function particleReveal(img, opts = {}) {
  const o = Object.assign({
    cell: 9,            // grid size in source pixels (smaller = denser, heavier)
    duration: 3800,     // ms for the whole wave
    fade: 700,          // ms crossfade to the real image
    pad: 0.35,          // canvas padding as fraction of image size (prevents clipping)
    glyphs: ['›', '>', '»', '+', '·'],
    from: 'below',      // 'below' | 'scatter' | 'burst'
    onDone: () => {},
  }, opts);

  const wrap = img.parentElement;
  if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';

  const nw = img.naturalWidth, nh = img.naturalHeight;
  const src = document.createElement('canvas');
  src.width = nw; src.height = nh;
  const sctx = src.getContext('2d', { willReadFrequently: true });
  sctx.drawImage(img, 0, 0);
  const data = sctx.getImageData(0, 0, nw, nh).data;

  // ---- sample the PNG on a grid -> particles --------------------------------
  const P = [];
  const c = o.cell;
  for (let y = 0; y < nh; y += c) {
    for (let x = 0; x < nw; x += c) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y; yy < Math.min(y + c, nh); yy += 2)
        for (let xx = x; xx < Math.min(x + c, nw); xx += 2) {
          const i = (yy * nw + xx) * 4, al = data[i + 3];
          r += data[i] * al; g += data[i + 1] * al; b += data[i + 2] * al; a += al; n++;
        }
      if (a / n < 40) continue;                       // transparent cell
      r = r / a; g = g / a; b = b / a; a = a / n / 255;
      const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255;
      const cx = x + c / 2, cy = y + c / 2;
      const rnd = Math.random();
      // wave front: bottom -> top, with noise so it feels like a stream, not a wipe
      const delay = (1 - cy / nh) * 0.55 + rnd * 0.25;
      let sx, sy;
      if (o.from === 'scatter') { sx = cx + (Math.random() - .5) * nw * .9; sy = cy + (Math.random() - .5) * nh * .6; }
      else if (o.from === 'burst') { const ang = Math.random() * 6.283, d = 250 + Math.random() * 500; sx = nw / 2 + Math.cos(ang) * d; sy = nh / 2 + Math.sin(ang) * d; }
      else { sx = cx + (Math.random() - .5) * 160; sy = cy + 260 + Math.random() * 420; }
      P.push({
        cx, cy, sx, sy, delay,
        life: 0.28 + Math.random() * 0.12,
        col: [r | 0, g | 0, b | 0], lum, a,
        glyph: lum > 0.75 ? 0 : (rnd < .12 ? 3 : rnd < .5 ? 1 : 0),
        swirl: (Math.random() - .5) * 90,
      });
    }
  }

  // ---- over-sized canvas so nothing clips -----------------------------------
  const cv = document.createElement('canvas');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = img.clientWidth, H = img.clientHeight;
  const padX = W * o.pad, padY = H * o.pad;
  cv.width = (W + padX * 2) * dpr; cv.height = (H + padY * 2) * dpr;
  Object.assign(cv.style, {
    position: 'absolute', pointerEvents: 'none',
    left: (img.offsetLeft - padX) + 'px', top: (img.offsetTop - padY) + 'px',
    width: (W + padX * 2) + 'px', height: (H + padY * 2) + 'px',
    mixBlendMode: 'screen', zIndex: 2,
  });
  wrap.appendChild(cv);
  const ctx = cv.getContext('2d');
  ctx.scale(dpr, dpr);
  const k = W / nw;                        // source -> display scale

  // ---- glyph sprite cache (tinted glyphs pre-rendered, keeps 10k+ particles fast)
  const sprites = new Map();
  const fs = Math.max(6, c * k * 1.25);
  function sprite(gi, col) {
    const key = gi + '|' + (col[0] >> 5) + (col[1] >> 5) + (col[2] >> 5);
    let s = sprites.get(key);
    if (!s) {
      s = document.createElement('canvas');
      const sz = Math.ceil(fs * 1.6) * dpr; s.width = s.height = sz;
      const g = s.getContext('2d');
      g.scale(dpr, dpr);
      g.font = `700 ${fs}px "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      const css = `rgb(${col[0]},${col[1]},${col[2]})`;
      g.shadowColor = css; g.shadowBlur = fs * 0.5;       // neon halo
      g.fillStyle = css;
      g.fillText(o.glyphs[gi], sz / dpr / 2, sz / dpr / 2);
      s.cssSize = sz / dpr;
      sprites.set(key, s);
    }
    return s;
  }

  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const t0 = performance.now();
  img.style.opacity = 0;
  img.style.transition = `opacity ${o.fade}ms ease`;
  let raf;

  function render(t) {
    ctx.clearRect(0, 0, cv.width, cv.height);
    let settled = 0;
    for (const p of P) {
      let u = (t - p.delay) / p.life;
      if (u <= 0) continue;
      let alpha, x, y;
      if (u >= 1) { u = 1; settled++; }
      const e = easeOut(u);
      x = p.sx + (p.cx - p.sx) * e + Math.sin(u * 3.14159) * p.swirl;
      y = p.sy + (p.cy - p.sy) * e;
      alpha = Math.min(1, u * 3) * p.a;
      // brief white-hot flash as a particle locks in
      const flash = u > 0.85 && u < 1 ? (1 - Math.abs(u - 0.92) / 0.08) : 0;
      const s = sprite(p.glyph, flash > 0.3 ? [255, 255, 255] : p.col);
      ctx.globalAlpha = alpha;
      ctx.drawImage(s, padX + x * k - s.cssSize / 2, padY + y * k - s.cssSize / 2, s.cssSize, s.cssSize);
    }
    ctx.globalAlpha = 1;
    return settled;
  }

  function frame(now) {
    const t = (now - t0) / o.duration;       // 0..1+ over the wave
    const settled = render(t);
    if (settled >= P.length * 0.995 || t > 1.6) {
      // Frame throttling can jump past the last eased frame. Paint the fully
      // settled particle positions before beginning the crossfade.
      render(1.6);
      return finish();
    }
    raf = requestAnimationFrame(frame);
  }

  function finish() {
    img.style.opacity = 1;                    // real PNG fades in under the glyphs
    cv.style.transition = `opacity ${o.fade}ms ease`;
    requestAnimationFrame(() => (cv.style.opacity = 0));
    setTimeout(() => { cv.remove(); o.onDone(); }, o.fade + 50);
  }

  raf = requestAnimationFrame(frame);
  return { cancel() { cancelAnimationFrame(raf); cv.remove(); img.style.opacity = 1; } };
}
