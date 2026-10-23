(() => {
'use strict';

/* ───────────────────────── setup ───────────────────────── */
const canvas = document.getElementById('c');
const ctx = canvas.getContext('2d', { alpha: false });
const page = document.querySelector('main');
const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
let reduced = mq.matches;
const IS_MOBILE = matchMedia('(pointer: coarse)').matches || innerWidth < 768;
const MOBILE_FRAME_MS = 1000 / 30;   // idle frame cap on touch devices
let CVH = 0;                         // canvas (viewport-sized) CSS height
let lastScrollAt = 0;
function computeDPR(w, h) {
  // Backing store is now viewport-sized, so the cap is about fill cost, not page height.
  return Math.min(window.devicePixelRatio || 1, IS_MOBILE ? 2 : 3, Math.sqrt(8000000 / (w * h)));
}

const FONT = 'ui-monospace, "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", "Liberation Mono", monospace';
const CHARS = '.:;,+-~=/*\\|()[]{}<>^_#%';
const CI = {}; for (let i = 0; i < CHARS.length; i++) CI[CHARS[i]] = i;
const pool = s => Uint8Array.from(s, c => CI[c]);
const POOL_CORE = pool('##%%*+=#%/');
const POOL_EDGE = pool('..,,::;;-~+');
const POOL_MISC = pool('+*:;=~/\\<>^*+');
const POOL_HORIZ = pool('--~=_-~-');
const C_PIPE = CI['|'], C_BSL = CI['\\'], C_SL = CI['/'];
const POOL_VL = pool('|(|{[|('), POOL_VR = pool('|)|}]|)');

const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ───────────────────────── noise ───────────────────────── */
function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(0x0DBA7A);
const PERM = new Uint8Array(512), VAL = new Float32Array(256);
{
  const p = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) { const j = (rnd() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; }
  for (let i = 0; i < 512; i++) PERM[i] = p[i & 255];
  for (let i = 0; i < 256; i++) VAL[i] = rnd();
}
function n2(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const X = xi & 255, Y = yi & 255;
  const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
  const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
  const a = VAL[PERM[PERM[X] + Y]], b = VAL[PERM[PERM[X + 1] + Y]];
  const c = VAL[PERM[PERM[X] + Y + 1]], d = VAL[PERM[PERM[X + 1] + Y + 1]];
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, oct) {
  let s = 0, amp = 0.5, norm = 0;
  for (let o = 0; o < oct; o++) {
    s += amp * n2(x, y); norm += amp;
    x = x * 2.03 + 17.1; y = y * 2.03 + 9.7; amp *= 0.5;
  }
  return s / norm;
}
const fbm1 = (x, seed) => fbm(x, seed, 3);
const n1 = (x, seed) => n2(x, seed);
function hashf(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul((b + 0x7f4a7c15) | 0, 0xc2b2ae35);
  h ^= h >>> 15; h = Math.imul(h, 0x2c1b3c6d); h ^= h >>> 12; h = Math.imul(h, 0x297a2d39); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/* ───────────────────────── palette ───────────────────────── */
const WARM = [
  [0.00, [23, 16, 68]],     // deep indigo  #171044
  [0.30, [78, 38, 205]],
  [0.44, [112, 40, 255]],   // electric violet #7028FF
  [0.62, [166, 107, 255]],  // luminous purple #A66BFF
  [0.84, [218, 212, 255]],  // pale lavender #DAD4FF
  [1.00, [255, 255, 255]]   // white
];
const BLUE = [
  [0.00, [23, 16, 68]],
  [0.30, [42, 62, 196]],
  [0.46, [62, 112, 238]],
  [0.64, [117, 175, 255]],  // icy blue #75AFFF
  [0.84, [218, 224, 255]],
  [1.00, [255, 255, 255]]
];
function ramp(stops, h) {
  for (let i = 1; i < stops.length; i++) {
    if (h <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i];
      const u = (h - t0) / (t1 - t0);
      return [c0[0] + (c1[0] - c0[0]) * u, c0[1] + (c1[1] - c0[1]) * u, c0[2] + (c1[2] - c0[2]) * u];
    }
  }
  return stops[stops.length - 1][1];
}
const HQ = 24, BQN = 4;
function colorAt(h, b) {
  const w = ramp(WARM, h), c = ramp(BLUE, h);
  return `rgb(${Math.round(lerp(w[0], c[0], b))},${Math.round(lerp(w[1], c[1], b))},${Math.round(lerp(w[2], c[2], b))})`;
}

/* ───────────────────────── world state ───────────────────────── */
let W, VH, viewH, DPR, fpx, cellW, cellH, cols, rows, H, N, invIgn;
let investigationStartY = 2.35, investigationSpanY = 1;
let investigationFocusX = 0.6, investigationFocusProgress = 0.48;
let investigationTitleBounds = null;
let investigationBounds = null, investigationSegments = [];
let investigationHubX = null, investigationHubY = null, investigationFocusFired = false;
let robotStartY = 4.2, robotBounds = null;
let robotTrackReadyFired = false;
let shockBounds = null;
let bikeStuntBounds = null;
let bikeStuntReadyFired = false;
let soccerBounds = null;
let soccerNebulaReadyFired = false;
let paattoholicBounds = null;
let paattoholicMaterializationStartedAt = null;
let paattoholicMaterializationComplete = false;
let GX, GY, S, A0, HH, CH, BQa, SC, PH, SP, FIL, CORE, FLR, STRG, rowStart;
let MATL, MATX, MATT, MATLGrid, MATXGrid, MATTGrid;
let atlas, SW, SH, pulses = [];

window.addEventListener('udbhava:paattoholic-materialization-start', () => {
  if (paattoholicMaterializationStartedAt === null) paattoholicMaterializationStartedAt = performance.now();
}, { once: true });

function buildAtlas() {
  SW = Math.ceil(cellW * DPR) + 4;
  SH = Math.ceil(cellH * DPR) + 4;
  atlas = document.createElement('canvas');
  atlas.width = SW * HQ * BQN;
  atlas.height = SH * CHARS.length;
  const a = atlas.getContext('2d');
  a.font = `${fpx * DPR}px ${FONT}`;
  a.textAlign = 'center';
  a.textBaseline = 'middle';
  for (let bi = 0; bi < BQN; bi++) {
    for (let hi = 0; hi < HQ; hi++) {
      a.fillStyle = colorAt(hi / (HQ - 1), bi / (BQN - 1));
      const col = bi * HQ + hi;
      for (let ch = 0; ch < CHARS.length; ch++) a.fillText(CHARS[ch], col * SW + SW / 2, ch * SH + SH / 2);
    }
  }
}

function build() {
  W = innerWidth; VH = innerHeight; viewH = VH;
  const investigationSection = document.querySelector('.investigation-section');
  const robotSection = document.querySelector('.robot-section');
  if (robotSection) {
    const robotRect = robotSection.getBoundingClientRect();
    const scrollY = window.scrollY || 0;
    const robotTop = robotRect.top + scrollY;
    robotStartY = robotTop / VH;
    // The robot section has a denser, straighter field shape, but it is generated
    // and scrolled by this same page-wide glyph canvas.
    robotBounds = { topY: robotTop, bottom: robotRect.bottom + scrollY };
  }
  const shockSection = document.querySelector('.shock-section');
  if (shockSection) {
    const rect = shockSection.getBoundingClientRect();
    const stage = shockSection.querySelector('.shock-stage');
    const scrollY = window.scrollY || 0;
    const terminal = shockSection.querySelector('.shock-terminal');
    const terminalRect = terminal?.getBoundingClientRect();
    const stageRect = stage?.getBoundingClientRect();
    shockBounds = {
      topY: rect.top + scrollY,
      bottom: rect.bottom + scrollY,
      focusX: terminalRect && stageRect ? terminalRect.left - stageRect.left + terminalRect.width * .5 : W * .68,
      focusY: rect.top + scrollY + (terminalRect && stageRect ? terminalRect.top - stageRect.top + terminalRect.height * .5 : VH * .58)
    };
  }
  const bikeStuntSection = document.querySelector('.bike-stunt-section');
  if (bikeStuntSection) {
    const rect = bikeStuntSection.getBoundingClientRect();
    const scrollY = window.scrollY || 0;
    bikeStuntBounds = { topY: rect.top + scrollY, bottom: rect.bottom + scrollY };
  }
  const soccerSection = document.querySelector('.soccer-section');
  if (soccerSection) {
    const rect = soccerSection.getBoundingClientRect();
    const scrollY = window.scrollY || 0;
    const arena = soccerSection.querySelector('.soccer-arena');
    const arenaRect = arena?.getBoundingClientRect();
    const arenaLeft = arenaRect ? arenaRect.left : rect.left;
    const arenaTop = arenaRect ? arenaRect.top + scrollY : rect.top + scrollY + rect.height * .5;
    const arenaWidth = arenaRect ? arenaRect.width : rect.width;
    const arenaHeight = arenaRect ? arenaRect.height : 1;
    const fieldWidth = arenaWidth * .9;
    const fieldHeight = arenaHeight * .9;
    soccerBounds = {
      playfieldY: arenaTop + arenaHeight * .5,
      bottomY: rect.bottom + scrollY,
      centerX: arenaLeft + arenaWidth * .5,
      fieldLeft: arenaLeft + (arenaWidth - fieldWidth) * .5,
      fieldTop: arenaTop + (arenaHeight - fieldHeight) * .5,
      fieldWidth,
      fieldHeight
    };
  }
  const paattoholicSection = document.querySelector('.paattoholic-section');
  if (paattoholicSection) {
    const sectionRect = paattoholicSection.getBoundingClientRect();
    const performer = paattoholicSection.querySelector('.paattoholic-performer');
    const performerRect = performer?.getBoundingClientRect();
    const scrollY = window.scrollY || 0;
    const performerStyle = performer ? getComputedStyle(performer) : null;
    const handX = parseFloat(performerStyle?.getPropertyValue('--hand-x')) / 100 || .087;
    const handY = parseFloat(performerStyle?.getPropertyValue('--hand-y')) / 100 || .249;
    const targetX = performerRect ? performerRect.left + performerRect.width * handX : W * .42;
    const targetY = performerRect ? performerRect.top + scrollY + performerRect.height * handY : sectionRect.top + scrollY + VH * .16;
    const sourceX = soccerBounds ? soccerBounds.centerX : W * .5;
    const sectionTop = sectionRect.top + scrollY;
    const sourceY = soccerBounds ? Math.max(soccerBounds.playfieldY, soccerBounds.bottomY - VH * .32) : sectionTop - VH * .32;
    paattoholicBounds = { topY: sectionTop, bottomY: sectionRect.bottom + scrollY, sourceX, sourceY, targetX, targetY };
  }
  if (investigationSection) {
    const sectionRect = investigationSection.getBoundingClientRect();
    const scrollY = window.scrollY || 0;
    investigationStartY = (sectionRect.top + scrollY) / VH;
    investigationSpanY = Math.max(1, investigationSection.offsetHeight / VH);
    const transitionLength = VH * .42;
    const transitionTop = Math.max(0, sectionRect.top + scrollY - transitionLength);
    investigationBounds = { top: transitionTop, bottom: sectionRect.bottom + scrollY };
    const investigationTitle = investigationSection.querySelector('.investigation-intro h2');
    if (investigationTitle) {
      const rect = investigationTitle.getBoundingClientRect();
      investigationTitleBounds = {
        left: rect.left, right: rect.right,
        top: rect.top + scrollY, bottom: rect.bottom + scrollY
      };
    }
    const board = investigationSection.querySelector('.evidence-board');
    const svg = investigationSection.querySelector('.evidence-connections');
    const marker = investigationSection.querySelector('.evidence-focus-marker');
    if (board && svg && marker) {
      const boardRect = board.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      const markerRect = marker.getBoundingClientRect();
      const hub = [markerRect.left + markerRect.width / 2, markerRect.top + markerRect.height / 2 + scrollY];
      investigationHubX = hub[0];
      investigationHubY = hub[1];
      const node = (x, y) => [svgRect.left + x * svgRect.width / 1000, svgRect.top + y * svgRect.height / 700 + scrollY];
      const segments = [];
      const addLine = (from, to, width) => segments.push({ x1: from[0], y1: from[1], x2: to[0], y2: to[1], width });
      const addPolyline = (points, width) => { for (let i = 1; i < points.length; i++) addLine(points[i - 1], points[i], width); };
      // Pick up the existing Explore stream where it already sits, then bend it
      // into the evidence hub while its wide ribbon tapers into clue tendrils.
      const transitionY = transitionTop / VH;
      const transitionSweep = smooth(1.0, Math.max(1.05, investigationStartY), transitionY);
      const transitionDrift = .025 * Math.sin((transitionY - 1.0) * 1.15) * smooth(1.0, 1.35, transitionY);
      const incomingCenter = clamp(.895 - .8 * transitionSweep + transitionDrift, .045, .97);
      const incomingStart = [sectionRect.left + sectionRect.width * incomingCenter, transitionTop];
      const control1 = [sectionRect.left + sectionRect.width * Math.max(incomingCenter, .24), transitionTop + transitionLength * .52];
      const control2 = [hub[0] + sectionRect.width * .22, hub[1] - sectionRect.height * .13];
      let prior = incomingStart;
      const incomingWidth = W * .12;
      for (let i = 1; i <= 48; i++) {
        const t = i / 48, u = 1 - t;
        const next = [u*u*u*incomingStart[0] + 3*u*u*t*control1[0] + 3*u*t*t*control2[0] + t*t*t*hub[0],
          u*u*u*incomingStart[1] + 3*u*u*t*control1[1] + 3*u*t*t*control2[1] + t*t*t*hub[1]];
        addLine(prior, next, incomingWidth * (1 - t) + W * .025);
        prior = next;
      }
      addPolyline([hub, node(356,226), node(155,117)], W * .052);
      addPolyline([hub, node(782,123)], W * .05);
      addPolyline([hub, node(833,421), node(646,574)], W * .052);
      addPolyline([node(356,226), node(152,435)], W * .045);
      investigationSegments = segments;
      investigationBounds = { top: transitionTop, bottom: sectionRect.bottom + scrollY };
    }
    const focusNode = investigationSection.querySelector('.node-focus');
    if (focusNode) {
      const rect = focusNode.getBoundingClientRect();
      // Use the measured marker point for both the evidence hub and the stream
      // bridge so the section handoff cannot pick up a horizontal offset.
      investigationFocusX = investigationHubX == null
        ? clamp((rect.left + rect.width / 2) / W, 0.04, 0.96)
        : clamp(investigationHubX / W, 0.04, 0.96);
      investigationFocusProgress = clamp(
        (rect.top + rect.height / 2 + (window.scrollY || 0)) / VH - investigationStartY,
        0.08,
        investigationSpanY - 0.08
      ) / investigationSpanY;
    }
  }
  if (robotBounds) {
    // Carry the evidence hub's stream into the robot track. This short bridge
    // overlaps the tail of Investigation, so the next field grows from its endpoint.
    robotBounds.bridgeTopY = investigationHubY ?? (robotBounds.topY - VH * 0.38);
    robotBounds.branchTopY = robotBounds.bridgeTopY;
  }
  // Determine the world bounds before sizing the document-height canvas.
  H = Math.max(VH, page?.scrollHeight || VH);
  // This canvas spans the document and is repainted continuously. Keep its
  // backing store within practical dimension and memory limits on long pages.
  // Canvas is fixed to the viewport (with headroom on mobile for the iOS toolbar
  // collapsing), not the whole document.
  CVH = IS_MOBILE ? Math.ceil(innerHeight * 1.2) : innerHeight;
  DPR = computeDPR(W, CVH);

  fpx = clamp(W / 165, 7, 10.5);
  const probe = document.createElement('canvas').getContext('2d');
  let tries = 0;
  for (;;) {
    probe.font = `${fpx}px ${FONT}`;
    cellW = probe.measureText('M').width || fpx * 0.6;
    cellH = fpx * 1.28;
    cols = Math.ceil(W / cellW) + 1;
    // Match the generated world to the actual document. Rounding this up and
    // adding a spacer created a scrollable black tail beyond the final section.
    rows = Math.ceil(H / cellH) + 1;
    if (cols * rows <= 230000 || tries++ > 12) break;
    fpx *= 1.07;
  }
  invIgn = 1 / (0.055 * VH);

  // responsive proportions
  const aspect = W / VH;
  const m = clamp((1.3 - aspect) / 0.9, 0, 1);       // 0 desktop → 1 portrait phone
  const AMPX = lerp(0.85, 1, m);                      // path lateral amplitude
  const PSG = lerp(0.125, 0.19, m);                    // cloud sigma (fraction of width)
  const Lc = Math.max(W, VH * 0.7) * 0.27;             // noise length scale (isotropic, px)

  /* ── per-row path data (the underlying trajectory) ── */
  const CXP = new Float32Array(rows), SGP = new Float32Array(rows), AMP = new Float32Array(rows);
  const SINP = new Float32Array(rows), COSP = new Float32Array(rows), GATE = new Float32Array(rows);
  const K = 4, FC = [], FP = [];
  // peripheral structures: faint satellite streams + long thin wisps
  const MS = 4, PL = 8, LW = Math.max(1.4 * cellW, 3);
  const SCr = [], SSr = [], SPr = [], LCr = [], LPr = [];
  for (let k = 0; k < MS; k++) { SCr.push(new Float32Array(rows)); SSr.push(new Float32Array(rows)); SPr.push(new Float32Array(rows)); }
  for (let j = 0; j < PL; j++) { LCr.push(new Float32Array(rows)); LPr.push(new Float32Array(rows)); }
  let PD = 0, PF = 0;
  const periph = (xw, r, nx, ny) => {
    let d = 0, f = 0;
    for (let k = 0; k < MS; k++) {
      const pr = SPr[k][r]; if (pr < 0.01) continue;
      const dd = (xw - SCr[k][r]) / SSr[k][r];
      if (dd > -3 && dd < 3) {
        const md = fbm(nx * 1.8 + k * 31 + 5, ny * 1.8 + k * 7, 3);
        d += Math.exp(-dd * dd) * pr * (0.10 + 1.44 * md * md) * 0.8;
      }
    }
    for (let j = 0; j < PL; j++) {
      const pr = LPr[j][r]; if (pr < 0.01) continue;
      const dk = (xw - LCr[j][r]) / LW;
      if (dk > -3 && dk < 3) { const v = Math.exp(-dk * dk) * pr; if (v > f) f = v; }
    }
    PD = d + f * 0.55; PF = f;
  };
  for (let k = 0; k < K; k++) { FC.push(new Float32Array(rows)); FP.push(new Float32Array(rows)); }

  // Path control points traced from the reference flow (fractions of one tile)
  const BX = [0.55, 0.57, 0.58, 0.50, 0.34, 0.46, 0.70, 0.77, 0.66, 0.42, 0.46, 0.58, 0.58];
  const BY = [0, 0.06, 0.12, 0.18, 0.25, 0.32, 0.41, 0.48, 0.57, 0.645, 0.71, 0.83, 0.92];
  const Ltile = clamp(3.0 * W, 1.5 * VH, 2.6 * VH);
  const nTiles = Math.ceil(H / Ltile) + 2;
  const PX = [], PY = [];
  for (let k = -1; k < nTiles; k++) {
    for (let i = 0; i < BX.length; i++) {
      const jit = k <= 0 ? 0 : (n1(k * 7.1 + i * 1.37 + 3, 5.5) - 0.5) * 0.10;
      PX.push(0.5 + (BX[i] + jit - 0.5) * AMPX);
      PY.push((k + BY[i]) * Ltile);
    }
  }
  const PM = PX.map((x, i) => (i === 0 || i === PX.length - 1) ? 0 : (PX[i + 1] - PX[i - 1]) / (PY[i + 1] - PY[i - 1]));
  // Keep the hero's original sweep. Explore bends that stream diagonally left;
  // in Investigation the side streams gather around the fingerprint focal point.
  const cxf = yv => {
    const heroSweep = smooth(0, 0.92, yv);
    const heroDrift = 0.045 * Math.sin(Math.max(0, yv - 0.82) * 1.05) * smooth(0.82, 1.2, yv);
    const sectionSweep = smooth(1.0, Math.max(1.05, investigationStartY), yv);
    const sectionDrift = 0.025 * Math.sin((yv - 1.0) * 1.15) * smooth(1.0, 1.35, yv);
    const organic = (fbm1(yv * 1.3 + 11, 13.37) - 0.5) * 0.035;
    const exploreCenter = 0.895 - 0.80 * sectionSweep + sectionDrift;
    const investigationProgress = clamp((yv - investigationStartY) / investigationSpanY, 0, 1);
    const gather = smooth(0, Math.max(0.3, investigationFocusProgress), investigationProgress);
    const center = yv <= 1.0
      ? 0.055 + 0.84 * heroSweep + heroDrift
      : yv < investigationStartY
        ? exploreCenter
        : lerp(0.095, investigationFocusX, gather);
    if (yv >= robotStartY) {
      const pageY = yv * VH;
      if (shockBounds && pageY >= shockBounds.topY && pageY <= shockBounds.bottom) {
        const progress = clamp((pageY - shockBounds.topY) / Math.max(1, shockBounds.bottom - shockBounds.topY), 0, 1);
        const focusProgress = clamp((shockBounds.focusY - shockBounds.topY) / Math.max(1, shockBounds.bottom - shockBounds.topY), .08, .92);
        const x = progress <= focusProgress
          ? lerp(.5, shockBounds.focusX / W, smooth(0, focusProgress, progress))
          : lerp(shockBounds.focusX / W, .5, smooth(focusProgress, 1, progress));
        return clamp(x, .04, .96);
      }
      return 0.5;
    }
    const robotConvergence = smooth(robotStartY - 0.52, robotStartY, yv);
    return clamp(lerp(center, 0.5, robotConvergence) + organic, 0.045, 0.97);
  };
  const robotBranches = [
    { side: -1, start: 0.00, end: 0.62, reach: 0.31, phase: 0.4, weight: 0.94 },
    { side: 1, start: 0.00, end: 0.64, reach: 0.31, phase: 2.1, weight: 0.94 },
    { side: -1, start: 0.06, end: 0.78, reach: 0.22, phase: 1.5, weight: 0.78 },
    { side: 1, start: 0.14, end: 0.90, reach: 0.25, phase: 2.8, weight: 0.78 }
  ];
  // Carry the four robot-side branches across the section seam. Their ports
  // are calculated from the same progress/sway formula used to draw the robot
  // lanes, so each new shock-room inlet starts exactly where its old lane ends.
  const shockEntryPorts = robotBranches.map(branch => {
    const spread = smooth(branch.start, branch.end, 1);
    const sway = Math.sin((1 - branch.start) * Math.PI * 5 + branch.phase) * 0.018 * spread;
    return clamp(0.5 + branch.side * branch.reach * spread + sway, 0.04, 0.96);
  });
  // Share the exact boundary profile so the investigation bridge's final rows
  // match the robot track's first rows without a width, alignment, or texture seam.
  const robotTrackWidth = Math.max(cellW * 4.5, W * 0.064);
  const robotTrackTexture = (nx, ny) => 0.62 + 0.38 * fbm(nx * 2.1 + 91, ny * 1.8 + 27, 4);
  const withRobotBranches = (field, xw, y) => {
    if (y < robotBounds.branchTopY) return field;
    const progress = clamp((y - robotBounds.branchTopY) / Math.max(1, robotBounds.bottom - robotBounds.branchTopY), 0, 1);
    const trackProgress = clamp((y - robotBounds.topY) / Math.max(1, robotBounds.bottom - robotBounds.topY), 0, 1);
    const trackEnergy = Math.max(.82, smooth(0, .18, trackProgress));
    const width = Math.max(cellW * 3.2, W * 0.04);
    for (const branch of robotBranches) {
      if (progress < branch.start) continue;
      const spread = smooth(branch.start, branch.end, progress);
      const sway = Math.sin((progress - branch.start) * Math.PI * 5 + branch.phase) * 0.018 * spread;
      const branchX = W * (0.5 + branch.side * branch.reach * spread + sway);
      const distance = (xw - branchX) / width;
      field = Math.max(field, branch.weight * trackEnergy * spread * Math.exp(-1.85 * distance * distance));
    }
    return field;
  };
  for (let r = 0; r < rows; r++) {
    const yv = ((r + 0.5) * cellH) / VH;
    CXP[r] = cxf(yv) * W;
    const investigationProgress = clamp((yv - investigationStartY) / investigationSpanY, 0, 1);
    // The investigation's convergence/fade is local to that section. Carrying
    // its near-zero tail into every later world row starved the shared stream
    // behind robot, shock, and any sections added after them.
    const withinInvestigation = yv >= investigationStartY && yv <= investigationStartY + investigationSpanY;
    let postFocusStrength = withinInvestigation
      ? 1 - 0.98 * smooth(investigationFocusProgress + 0.015, investigationFocusProgress + 0.22, investigationProgress)
      : 1;
    const focus = withinInvestigation
      ? Math.exp(-0.5 * Math.pow((investigationProgress - investigationFocusProgress) / 0.045, 2))
      : 0;
    const spread = 1 - 0.995 * focus;
    const incomingSpread = yv >= investigationStartY
      ? 1 + 0.72 * (1 - smooth(0, investigationFocusProgress, investigationProgress))
      : 1;
    const sg = PSG * W * (0.45 + 1.6 * Math.pow(fbm(yv * 0.65 + 5, 7.7, 3), 1.4) * 1.15) * spread * incomingSpread;
    SGP[r] = sg;
    // Keep the two filament lanes nearly coincident so the stream does not split and reconverge.
    AMP[r] = sg * (0.012 + 0.012 * n1(yv * 0.9 + 60, 3.3));
    const ph = yv * 6.5 + (n1(yv * 0.6 + 80, 1.1) - 0.5) * 4;
    SINP[r] = Math.sin(ph); COSP[r] = Math.cos(ph);
    GATE[r] = 0.15 + 0.85 * smooth(0.28, 0.5, fbm(yv * 0.55 + 30, 4.4, 2));
    for (let k = 0; k < K; k++) {
      FC[k][r] = (n1(yv * 0.8 + k * 17.3 + 100, k * 3.1 + 0.5) - 0.5) * 2 * 1.5 * sg + 0.4 * sg * Math.sin(yv * 2.7 + k * 1.9);
      FP[k][r] = smooth(0.4, 0.65, n1(yv * 0.55 + k * 9.1 + 200, k * 5.7 + 0.9));
    }
    for (let k = 0; k < MS; k++) {
      const side = k % 2 === 0 ? -1 : 1;
      const off = (side * (0.2 + 0.16 * n1(yv * 0.5 + k * 13 + 300, k * 2.2 + 0.7)) * W + 0.08 * W * Math.sin(yv * 2.1 + k * 2.3)) * spread;
      SCr[k][r] = clamp(CXP[r] + off, 0.07 * W, 0.93 * W);
      SSr[k][r] = sg * (0.4 + 0.45 * n1(yv * 0.6 + k * 7 + 350, k * 1.9 + 0.3));
      SPr[k][r] = smooth(0.38, 0.62, n1(yv * 0.42 + k * 11 + 600, k * 2.7 + 1.1));
    }
    for (let j = 0; j < PL; j++) {
      const off = ((n1(yv * 0.45 + j * 19 + 500, j * 4.1 + 0.2) - 0.5) * 2 * 0.45 * W + 0.2 * sg * Math.sin(yv * 3.1 + j * 1.7)) * spread;
      LCr[j][r] = clamp(CXP[r] + off, 0.04 * W, 0.96 * W);
      LPr[j][r] = smooth(0.46, 0.7, n1(yv * 0.38 + j * 11 + 700, j * 3.3 + 1.4));
    }
  }

  const paattoholicStrandAt = (px, py, nx, ny) => {
    if (!paattoholicBounds) return null;
    const { sourceX, sourceY, targetX, targetY } = paattoholicBounds;
    if (py < sourceY - cellH * 2 || py > targetY + cellH * 2 || targetY <= sourceY) return null;
    const t = clamp((py - sourceY) / (targetY - sourceY), 0, 1);
    const deltaX = targetX - sourceX;
    const control1 = sourceX + deltaX * .12;
    const control2 = targetX - deltaX * .08;
    const oneMinusT = 1 - t;
    const pathX = oneMinusT ** 3 * sourceX
      + 3 * oneMinusT ** 2 * t * control1
      + 3 * oneMinusT * t ** 2 * control2
      + t ** 3 * targetX
      + Math.sin(t * Math.PI * 2.2) * W * .008 * Math.sin(Math.PI * t);
    const spread = W * .024 * smooth(.12, .72, t) * Math.sin(Math.PI * t);
    const width = Math.max(cellW * 1.35, W * lerp(.0075, .0052, t));
    const filament = center => Math.exp(-1.55 * ((px - center) / width) ** 2);
    const line = Math.max(filament(pathX), filament(pathX - spread) * .66, filament(pathX + spread) * .66);
    if (line < .008) return null;
    const texture = .7 + .3 * fbm(nx * 2.2 + 91, ny * 2.2 + 137, 3);
    const strength = clamp(line * texture, 0, 1);
    return {
      t,
      strength,
      density: strength * .9,
      signal: strength * .94,
      flare: strength * .72
    };
  };

  const soccerNebulaAt = (px, py, nx, ny) => {
    if (!soccerBounds) return null;
    const width = soccerBounds.fieldWidth;
    const height = soccerBounds.fieldHeight;
    const u = (px - soccerBounds.fieldLeft) / width;
    const v = (py - soccerBounds.fieldTop) / height;
    if (u < -.08 || u > 1.08 || v < -.08 || v > 1.08) return null;

    const centerX = soccerBounds.fieldLeft + width * .5;
    const centerY = soccerBounds.fieldTop + height * .5;
    const scale = Math.min(width, height);
    const lineWidth = Math.max(cellW * 1.65, scale * .01);
    let sharp = 0;
    let halo = 0;
    let nearest = Infinity;
    const segment = (x1, y1, x2, y2) => {
      const dx = x2 - x1, dy = y2 - y1;
      const length2 = dx * dx + dy * dy || 1;
      const t = clamp(((px - x1) * dx + (py - y1) * dy) / length2, 0, 1);
      const distance = Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
      nearest = Math.min(nearest, distance);
      sharp = Math.max(sharp, Math.exp(-1.8 * (distance / lineWidth) ** 2));
      halo = Math.max(halo, Math.exp(-1.25 * (distance / (lineWidth * 3.5)) ** 2));
    };

    // A dense strand curves from the upper-right into the left side of the
    // pitch. The field markings meet its midfield crossing, so the pitch grows
    // out of the same continuous nebula instead of sitting over it separately.
    const flow = [
      [centerX + width * .38, soccerBounds.fieldTop + height * .02],
      [centerX + width * .32, centerY - height * .16],
      [centerX - width * .32, centerY + height * .16],
      [centerX - width * .38, soccerBounds.fieldTop + height * .98]
    ];
    const pointOnFlow = t => {
      const inverse = 1 - t;
      return {
        x: inverse ** 3 * flow[0][0] + 3 * inverse ** 2 * t * flow[1][0] + 3 * inverse * t ** 2 * flow[2][0] + t ** 3 * flow[3][0],
        y: inverse ** 3 * flow[0][1] + 3 * inverse ** 2 * t * flow[1][1] + 3 * inverse * t ** 2 * flow[2][1] + t ** 3 * flow[3][1]
      };
    };
    let previousFlow = pointOnFlow(0);
    for (let step = 1; step <= 36; step += 1) {
      const nextFlow = pointOnFlow(step / 36);
      segment(previousFlow.x, previousFlow.y, nextFlow.x, nextFlow.y);
      previousFlow = nextFlow;
    }

    // The vertical halfway line branches from the nebula where it crosses
    // midfield, continuing both above and below the junction.
    segment(centerX, soccerBounds.fieldTop + height * .11, centerX, centerY);
    segment(centerX, centerY, centerX, soccerBounds.fieldTop + height * .89);
    const centerRadius = scale * .11;
    const ringDistance = Math.abs(Math.hypot(px - centerX, py - centerY) - centerRadius);
    nearest = Math.min(nearest, ringDistance);
    sharp = Math.max(sharp, Math.exp(-1.8 * (ringDistance / lineWidth) ** 2));
    halo = Math.max(halo, Math.exp(-1.25 * (ringDistance / (lineWidth * 3.5)) ** 2));
    const texture = .58 + .42 * fbm(nx * 2.1 + 73, ny * 2.1 + 119, 4);
    const density = clamp(Math.max(sharp * .94, halo * .6) * texture, 0, .98);
    const envelope = smooth(.04, .42, halo);
    return {
      density,
      signal: Math.max(sharp * .94, halo * .28) * texture,
      flare: Math.max(sharp, halo * .24) * texture,
      distance: nearest / Math.max(scale * .04, 1),
      envelope
    };
  };

  /* ── pass 1: continuous density field ── */
  const total = cols * rows;
  const D = new Float32Array(total), STR = new Float32Array(total), FLA = new Float32Array(total), DNA = new Float32Array(total), SOCCER = new Float32Array(total);
  MATLGrid = new Float32Array(total);
  MATXGrid = new Float32Array(total);
  MATTGrid = new Float32Array(total);
  for (let r = 0; r < rows; r++) {
    const y = (r + 0.5) * cellH, ny = y / Lc;
    const sg = SGP[r], cx = CXP[r], a = AMP[r], sinp = SINP[r], cosp = COSP[r], gate = GATE[r];
    const yv = y / VH;
    const investigationProgress = clamp((yv - investigationStartY) / investigationSpanY, 0, 1);
    const withinInvestigation = yv >= investigationStartY && yv <= investigationStartY + investigationSpanY;
    let postFocusStrength = withinInvestigation
      ? 1 - 0.98 * smooth(investigationFocusProgress + 0.015, investigationFocusProgress + 0.22, investigationProgress)
      : 1;
    const wS = Math.max(0.15 * sg, 2.4 * cellW), wF = Math.max(0.12 * sg, 1.7 * cellW);
    const base = r * cols;
    for (let c = 0; c < cols; c++) {
      const x = (c + 0.5) * cellW, nx = x / Lc;
      // Soft, noisy oval clearance around the title; density tapers naturally rather than cutting a box.
      const titleX = (x - W * 0.5) / (W * 0.22);
      const titleY = (y - VH * 0.5) / (VH * 0.17);
      const titleZone = Math.exp(-0.5 * (titleX * titleX + titleY * titleY));
      const titleNoise = 0.88 + 0.12 * fbm(nx * 1.7 + 47, ny * 1.7 + 31, 2);
      const titleKeep = 1 - 0.72 * titleZone * titleNoise;
      let investigationTitleKeep = 1;
      if (investigationTitleBounds) {
        const titleCenterX = (investigationTitleBounds.left + investigationTitleBounds.right) * .5;
        const titleCenterY = (investigationTitleBounds.top + investigationTitleBounds.bottom) * .5;
        const titleRadiusX = Math.max(W * .18, (investigationTitleBounds.right - investigationTitleBounds.left) * .62);
        const titleRadiusY = Math.max(VH * .075, (investigationTitleBounds.bottom - investigationTitleBounds.top) * .85);
        const clearance = Math.exp(-.5 * (((x - titleCenterX) / titleRadiusX) ** 2 + ((y - titleCenterY) / titleRadiusY) ** 2));
        investigationTitleKeep = 1 - .9 * clearance;
      }
      const wxo = (fbm(nx * 0.8 + 3.1, ny * 0.8 + 1.7, 3) - 0.5) * 1.5 * sg + (n2(nx * 2.4 + 9.2, ny * 2.4 + 4.4) - 0.5) * 0.5 * sg;
      const xw = x + wxo;
      const soccerField = soccerNebulaAt(x, y, nx, ny);
      const materialStrand = paattoholicStrandAt(x, y, nx, ny);
      if (shockBounds && y >= shockBounds.topY && y <= shockBounds.bottom) {
        const sectionProgress = clamp((y - shockBounds.topY) / Math.max(1, shockBounds.bottom - shockBounds.topY), 0, 1);
        const focusProgress = clamp((shockBounds.focusY - shockBounds.topY) / Math.max(1, shockBounds.bottom - shockBounds.topY), .08, .92);
        const pathProgress = sectionProgress <= focusProgress
          ? smooth(0, focusProgress, sectionProgress)
          : 1 - smooth(focusProgress, 1, sectionProgress);
        const pathX = lerp(W * .5, shockBounds.focusX, pathProgress);
        // Match Robot's finished center-lane width at the section seam; then
        // hold that profile through Shock so the incoming line cannot pinch.
        const trackWidth = Math.max(W * .055, cellW * 4.2);
        const trackDistance = (x - pathX) / trackWidth;
        const track = .92 * Math.exp(-1.85 * trackDistance * trackDistance);
        let incomingBranches = 0;
        if (sectionProgress <= focusProgress) {
          const convergence = smooth(0, focusProgress, sectionProgress);
          for (let k = 0; k < shockEntryPorts.length; k++) {
            const port = shockEntryPorts[k];
            const side = port < shockBounds.focusX / W ? -1 : 1;
            const curve = side * W * .018 * Math.sin(Math.PI * convergence);
            const branchX = lerp(port * W, shockBounds.focusX, convergence) + curve;
            const width = Math.max(cellW * 3.2, lerp(W * .04, W * .042, convergence));
            const distance = (xw - branchX) / width;
            const branchDensity = robotBranches[k].weight * Math.exp(-1.8 * distance * distance);
            incomingBranches = Math.max(incomingBranches, branchDensity);
          }
        }
        const dx = (xw - shockBounds.focusX) / (W * .47);
        const dy = (y - shockBounds.focusY) / (VH * .65);
        const radius = Math.hypot(dx, dy);
        let arcs = 0, tendrils = 0;
        const angle = Math.atan2(dy, dx);
        const radiusPx = radius * Math.min(W * .47, VH * .65);
        for (let k = 0; k < 8; k++) {
          const travel = clamp(radius / .92, 0, 1);
          // Slightly jagged angle drift along each branch turns the glyph filament
          // into a lightning discharge instead of a clean radial spoke.
          const boltAngle = (Math.PI * 2 * k) / 8
            + .035 * Math.sin(travel * 31 + k * 4.7)
            + .014 * Math.sin(travel * 79 + k * 9.1)
            + .007 * Math.sin(travel * 151 + k * 2.3);
          const delta = Math.atan2(Math.sin(angle - boltAngle), Math.cos(angle - boltAngle));
          const dist = Math.abs(delta) * radiusPx;
          arcs = Math.max(arcs, .96 * Math.exp(-Math.pow(dist / Math.max(cellW * 2.3, W * .014), 2)));
        }
        // Wider, curved tendrils branch from the same contact point beneath
        // the bright lightning. Both use the shared glyph-density renderer.
        for (let k = 0; k < 10; k++) {
          const travel = clamp(radius / .92, 0, 1);
          const streamAngle = (Math.PI * 2 * k) / 10
            + .105 * Math.sin(travel * 10 + k * 2.9)
            + .042 * Math.sin(travel * 27 + k * 6.1);
          const delta = Math.atan2(Math.sin(angle - streamAngle), Math.cos(angle - streamAngle));
          const dist = Math.abs(delta) * radiusPx;
          tendrils = Math.max(tendrils, .44 * Math.exp(-Math.pow(dist / Math.max(cellW * 4.5, W * .032), 2)));
        }
        const texture = .58 + .42 * fbm(nx * 2.0 + 55, ny * 2.0 + 87, 4);
        // Keep the shock-room particles on the incoming stream and its actual
        // discharge branches. A diffuse cloud/ring filled the gaps and hid the
        // branching shape, so the stream now stays legible against black.
        let density = clamp(Math.max(track, incomingBranches, arcs, tendrils) * texture, 0, .98);
        let signal = Math.max(track, incomingBranches, arcs, tendrils * .84) * texture;
        let flare = density * .86;
        let distanceField = Math.abs(trackDistance);

        // The shock-room field used to stop at its section boundary, where the
        // generic nebula formula took over in one row. Blend the same canvas
        // field back to that formula over the last 18% of a viewport so strands
        // and their texture flow naturally into Bike Stunt without a new layer.
        const blendStart = shockBounds.bottom - VH * .18;
        if (y > blendStart) {
          periph(xw, r, nx, ny);
          const dxn = (xw - cx) / sg;
          const cloud = Math.exp(-0.9 * dxn * dxn);
          const mod = fbm(nx * 1.6 + 20, ny * 1.6 + 8, 4);
          const sm = clamp((mod - 0.25) * 1.8, 0, 1.2);
          const rn = n2(nx * 2.7 + 40 + (wxo / Lc) * 0.5, ny * 2.7);
          let ridge = 1 - Math.abs(2 * rn - 1); ridge = ridge * ridge * ridge;
          const cloudT = cloud * (0.2 + 0.8 * sm);
          const core = Math.exp(-(dxn * dxn) / 0.18) * mod * mod * 1.6;
          const veins = ridge * cloud * 0.75;
          const d1 = (xw - (cx + a * sinp)) / wS, d2 = (xw - (cx - a * sinp)) / wS;
          const strand = (Math.exp(-d1 * d1) * (0.55 + 0.45 * cosp) + Math.exp(-d2 * d2) * (0.55 - 0.45 * cosp)) * gate;
          let fil = 0;
          for (let k = 0; k < K; k++) {
            const dk = (xw - (cx + FC[k][r])) / wF;
            const v = Math.exp(-dk * dk) * FP[k][r];
            if (v > fil) fil = v;
          }
          const regular = Math.pow(Math.min(cloudT * .8 + core * .55 + veins + strand * .95 + fil * .75 + PD, 1.25), 1.08);
          const mix = smooth(blendStart, shockBounds.bottom, y);
          density = lerp(density, regular * titleKeep * postFocusStrength * investigationTitleKeep, mix);
          signal = lerp(signal, strand * titleKeep * postFocusStrength * investigationTitleKeep, mix);
          flare = lerp(flare, Math.max(fil, PF) * titleKeep * postFocusStrength * investigationTitleKeep, mix);
          distanceField = lerp(distanceField, Math.abs(dxn), mix);
        }
        const idx = base + c;
        DNA[idx] = distanceField;
        D[idx] = density;
        STR[idx] = signal;
        FLA[idx] = flare;
        continue;
      }
      if (robotBounds && y >= robotBounds.topY && y <= robotBounds.bottom) {
        const progress = clamp((y - robotBounds.topY) / Math.max(1, robotBounds.bottom - robotBounds.topY), 0, 1);
        // Let the incoming nebula narrow into the race track over the first
        // quarter of the section so it remains a continuous page-space stream.
        // Start at the same visible width and energy as the incoming bridge,
        // then tighten quickly into the robot's straight competition track.
        // A weak/narrow start here looked like a seam (and a paused stream).
        const trackSettle = smooth(0, .18, progress);
        const mainWidth = lerp(robotTrackWidth, Math.max(cellW * 4.2, W * .055), trackSettle);
        const mainDistance = (x - W * 0.5) / mainWidth;
        let strands = lerp(.86, 1, trackSettle) * Math.exp(-1.55 * mainDistance * mainDistance);
        strands = withRobotBranches(strands, xw, y);
        const texture = robotTrackTexture(nx, ny);
        const density = clamp(strands * texture, 0, 0.92);
        const idx = base + c;
        DNA[idx] = Math.abs(mainDistance);
        D[idx] = density;
        STR[idx] = density * 0.88;
        FLA[idx] = density * 0.92;
        continue;
      }
      if (investigationBounds && y >= investigationBounds.top && y <= investigationBounds.bottom && investigationSegments.length) {
        periph(xw, r, nx, ny);
        let mapped = 0, nearest = Infinity;
        for (const segment of investigationSegments) {
          const dx = segment.x2 - segment.x1, dy = segment.y2 - segment.y1;
          const length2 = dx * dx + dy * dy || 1;
          const t = clamp(((x - segment.x1) * dx + (y - segment.y1) * dy) / length2, 0, 1);
          const dist = Math.hypot(x - (segment.x1 + dx * t), y - (segment.y1 + dy * t));
          if (dist < nearest) nearest = dist;
          const width = segment.width;
          const lane = Math.exp(-2.15 * (dist / width) ** 2);
          if (lane > mapped) mapped = lane;
        }
        const textureNoise = .48 + .68 * fbm(nx * 2.2 + 11, ny * 2.2 + 37, 4);
        const d = Math.min(.94, mapped * textureNoise);
        const idx = base + c;
        DNA[idx] = nearest / Math.max(W * .05, 1);
        let link = 0;
        if (robotBounds?.bridgeTopY != null && y >= robotBounds.bridgeTopY && y < robotBounds.topY) {
          const bridgeProgress = clamp((y - robotBounds.bridgeTopY) / Math.max(1, robotBounds.topY - robotBounds.bridgeTopY), 0, 1);
          const bridgeX = lerp(investigationHubX ?? investigationFocusX * W, W * 0.5, smooth(0, 1, bridgeProgress));
          const bridgeDistance = (x - bridgeX) / robotTrackWidth;
          const bridgeFade = smooth(robotBounds.bridgeTopY, robotBounds.bridgeTopY + VH * 0.025, y);
          link = withRobotBranches(0.86 * bridgeFade * Math.exp(-1.55 * bridgeDistance * bridgeDistance), xw, y)
            * robotTrackTexture(nx, ny);
        }
        D[idx] = Math.max(d, link) * titleKeep * investigationTitleKeep;
        STR[idx] = Math.max(d, link) * titleKeep * investigationTitleKeep;
        FLA[idx] = Math.max(d * .76, link * .9, PF) * titleKeep * investigationTitleKeep;
        continue;
      }
      if (robotBounds?.bridgeTopY != null && y >= robotBounds.bridgeTopY && y < robotBounds.topY) {
        const bridgeProgress = clamp((y - robotBounds.bridgeTopY) / Math.max(1, robotBounds.topY - robotBounds.bridgeTopY), 0, 1);
        const bridgeX = lerp(investigationHubX ?? investigationFocusX * W, W * 0.5, smooth(0, 1, bridgeProgress));
        const bridgeDistance = (x - bridgeX) / robotTrackWidth;
        const bridgeFade = smooth(robotBounds.bridgeTopY, robotBounds.bridgeTopY + VH * 0.025, y);
        const link = withRobotBranches(0.86 * bridgeFade * Math.exp(-1.55 * bridgeDistance * bridgeDistance), xw, y)
          * robotTrackTexture(nx, ny);
        const idx = base + c;
        DNA[idx] = Math.abs(bridgeDistance);
        D[idx] = link;
        STR[idx] = link;
        FLA[idx] = link * 0.9;
        continue;
      }
      const dxn = (xw - cx) / sg;
      DNA[base + c] = Math.abs(dxn);
      periph(xw, r, nx, ny);
      if (Math.abs(dxn) > 3.8) {
        const mask = titleKeep * postFocusStrength * investigationTitleKeep;
        const backgroundDensity = PD * mask;
        if (soccerField) {
          const pitchDensity = soccerField.density * mask;
          const pitchBlend = soccerField.envelope;
          const pitchValue = lerp(backgroundDensity, Math.max(backgroundDensity * .36, pitchDensity), pitchBlend);
          const pitchSignal = soccerField.signal * mask * pitchBlend;
          const pitchFlare = lerp(PF * mask, soccerField.flare * mask, pitchBlend);
          const strandDensity = materialStrand ? materialStrand.density * mask : 0;
          D[base + c] = Math.max(pitchValue, strandDensity);
          STR[base + c] = Math.max(pitchSignal, materialStrand ? materialStrand.signal * mask : 0);
          FLA[base + c] = Math.max(pitchFlare, materialStrand ? materialStrand.flare * mask : 0);
          if (materialStrand) {
            MATLGrid[base + c] = materialStrand.strength * mask;
            MATTGrid[base + c] = materialStrand.t;
            MATXGrid[base + c] = clamp((strandDensity - pitchValue) / Math.max(strandDensity, .001), 0, 1);
          }
          DNA[base + c] = lerp(Math.abs(dxn), soccerField.distance, pitchBlend);
          SOCCER[base + c] = Math.max(soccerField.signal, soccerField.flare) * mask * pitchBlend;
        } else {
          const strandDensity = materialStrand ? materialStrand.density * mask : 0;
          D[base + c] = Math.max(backgroundDensity, strandDensity);
          STR[base + c] = materialStrand ? materialStrand.signal * mask : 0;
          FLA[base + c] = Math.max(PF * mask, materialStrand ? materialStrand.flare * mask : 0);
          if (materialStrand) {
            MATLGrid[base + c] = materialStrand.strength * mask;
            MATTGrid[base + c] = materialStrand.t;
            MATXGrid[base + c] = clamp((strandDensity - backgroundDensity) / Math.max(strandDensity, .001), 0, 1);
          }
        }
        continue;
      }
      const cloud = Math.exp(-0.9 * dxn * dxn);
      const mod = fbm(nx * 1.6 + 20, ny * 1.6 + 8, 4);
      const sm = clamp((mod - 0.25) * 1.8, 0, 1.2);
      const rn = n2(nx * 2.7 + 40 + (wxo / Lc) * 0.5, ny * 2.7);
      let ridge = 1 - Math.abs(2 * rn - 1); ridge = ridge * ridge * ridge;
      const cloudT = cloud * (0.2 + 0.8 * sm);
      const core = Math.exp(-(dxn * dxn) / 0.18) * mod * mod * 1.6;
      const veins = ridge * cloud * 0.75;
      const d1 = (xw - (cx + a * sinp)) / wS, d2 = (xw - (cx - a * sinp)) / wS;
      const strand = (Math.exp(-d1 * d1) * (0.55 + 0.45 * cosp) + Math.exp(-d2 * d2) * (0.55 - 0.45 * cosp)) * gate;
      let fil = 0;
      for (let k = 0; k < K; k++) {
        const dk = (xw - (cx + FC[k][r])) / wF;
        const v = Math.exp(-dk * dk) * FP[k][r];
        if (v > fil) fil = v;
      }
      let d = cloudT * 0.8 + core * 0.55 + veins + strand * 0.95 + fil * 0.75 + PD;
      d = Math.pow(Math.min(d, 1.25), 1.08);
      const mask = titleKeep * postFocusStrength * investigationTitleKeep;
      const genericDensity = d * mask;
      const genericSignal = strand * mask;
      const genericFlare = Math.max(fil, PF) * mask;
      if (soccerField) {
        const pitchBlend = soccerField.envelope;
        const pitchDensity = soccerField.density * mask;
        const pitchValue = lerp(genericDensity, Math.max(genericDensity * .36, pitchDensity), pitchBlend);
        const pitchSignal = lerp(genericSignal, soccerField.signal * mask, pitchBlend);
        const pitchFlare = lerp(genericFlare, soccerField.flare * mask, pitchBlend);
        const strandDensity = materialStrand ? materialStrand.density * mask : 0;
        D[base + c] = Math.max(pitchValue, strandDensity);
        STR[base + c] = Math.max(pitchSignal, materialStrand ? materialStrand.signal * mask : 0);
        FLA[base + c] = Math.max(pitchFlare, materialStrand ? materialStrand.flare * mask : 0);
        if (materialStrand) {
          MATLGrid[base + c] = materialStrand.strength * mask;
          MATTGrid[base + c] = materialStrand.t;
          MATXGrid[base + c] = clamp((strandDensity - pitchValue) / Math.max(strandDensity, .001), 0, 1);
        }
        DNA[base + c] = lerp(Math.abs(dxn), soccerField.distance, pitchBlend);
        SOCCER[base + c] = Math.max(soccerField.signal, soccerField.flare) * mask * pitchBlend;
      } else {
        const strandDensity = materialStrand ? materialStrand.density * mask : 0;
        D[base + c] = Math.max(genericDensity, strandDensity);
        STR[base + c] = Math.max(genericSignal, materialStrand ? materialStrand.signal * mask : 0);
        FLA[base + c] = Math.max(genericFlare, materialStrand ? materialStrand.flare * mask : 0);
        if (materialStrand) {
          MATLGrid[base + c] = materialStrand.strength * mask;
          MATTGrid[base + c] = materialStrand.t;
          MATXGrid[base + c] = clamp((strandDensity - genericDensity) / Math.max(strandDensity, .001), 0, 1);
        }
      }
    }
  }

  /* ── pass 2: glyph placement, contour-following selection ── */
  const cap = total;
  GX = new Float32Array(cap); GY = new Float32Array(cap); S = new Float32Array(cap);
  A0 = new Float32Array(cap); HH = new Float32Array(cap); SC = new Float32Array(cap);
  PH = new Float32Array(cap); SP = new Float32Array(cap); FLR = new Float32Array(cap);
  STRG = new Float32Array(cap);
  MATL = new Float32Array(cap); MATX = new Float32Array(cap); MATT = new Float32Array(cap);
  CH = new Uint8Array(cap); BQa = new Uint8Array(cap); FIL = new Uint8Array(cap); CORE = new Uint8Array(cap);
  rowStart = new Int32Array(rows + 2);
  N = 0;

  const at = (r, c) => D[clamp(r, 0, rows - 1) * cols + clamp(c, 0, cols - 1)];
  for (let r = 0; r < rows; r++) {
    rowStart[r] = N;
    const yc = (r + 0.5) * cellH;
    const dxdy = (CXP[Math.min(rows - 1, r + 2)] - CXP[Math.max(0, r - 2)]) / (4 * cellH);
    for (let c = 0; c < cols; c++) {
      const idx = r * cols + c;
      const d = D[idx];
      if (d < 0.02) continue;
      const pr = Math.pow(smooth(0.02, 0.6, d), 0.75);
      if (hashf(idx, 1) > pr) continue;

      const rv = hashf(idx, 2), rv2 = hashf(idx, 3), rv3 = hashf(idx, 4);
      const x = (c + 0.5) * cellW + (hashf(idx, 5) - 0.5) * cellW * 0.45;
      const y = yc + (hashf(idx, 6) - 0.5) * cellH * 0.4;
      const nx = x / Lc, ny = y / Lc;

      // contour tangent from density gradient
      const gxp = (at(r, c + 2) - at(r, c - 2)) / (4 * cellW);
      const gyp = (at(r + 2, c) - at(r - 2, c)) / (4 * cellH);
      const gm = Math.hypot(gxp, gyp);
      let tx, ty;
      if (gm * cellH > 0.012) { tx = -gyp; ty = gxp; } else { tx = dxdy; ty = 1; }
      let ang = Math.atan2(ty, tx);
      if (ang < 0) ang += Math.PI;
      ang += (rv2 - 0.5) * 0.45;
      if (ang < 0) ang += Math.PI; else if (ang >= Math.PI) ang -= Math.PI;
      const left = (c + 0.5) * cellW < CXP[r];

      let ch;
      if (d > 0.8) {
        ch = rv < 0.78 ? POOL_CORE[(rv2 * POOL_CORE.length) | 0] : orient(ang, rv2, left);
      } else if (d > 0.32) {
        ch = rv < 0.68 ? orient(ang, rv2, left) : POOL_MISC[(rv2 * POOL_MISC.length) | 0];
      } else {
        ch = rv < 0.42 ? POOL_EDGE[(rv2 * POOL_EDGE.length) | 0] : (rv < 0.7 ? orient(ang, rv2, left) : POOL_EDGE[(rv3 * POOL_EDGE.length) | 0]);
      }

      const z = n2(nx * 1.1 + 60, ny * 1.1 + 20);
      const hot = smooth(0.45, 0.72, fbm(nx * 0.7 + 50, ny * 0.7 + 50, 3));
      const blueReg = smooth(0.56, 0.8, fbm(nx * 0.55 + 120, ny * 0.55 + 70, 2));
      const str = STR[idx], fil = FLA[idx];

      let h = 0.10 + 0.40 * smooth(0, 0.9, d) + 0.55 * hot * smooth(0.55, 1.0, d) + 0.30 * str * (0.4 + 0.6 * hot) + (rv3 - 0.5) * 0.10;
      h = clamp(h, 0.05, 1);
      let b = clamp(fil * 1.15 * (1 - 0.7 * hot * smooth(0.6, 1, d)) + 0.75 * blueReg * (1 - smooth(0.45, 0.9, d)), 0, 1);
      // Carry the robot track's brighter core into the final part of the
      // Investigation bridge so the incoming glyph stream does not change
      // colour abruptly at the section boundary.
      const robotMix = robotBounds
        ? smooth(robotBounds.topY - VH * 0.28, robotBounds.topY + VH * 0.06, y)
        : 0;
      if (robotMix > 0) {
        const core = Math.exp(-2 * ((x - W * 0.5) / Math.max(W * 0.035, cellW * 2)) ** 2);
        h = lerp(h, 1, core * 0.96 * robotMix);
        b = lerp(b, 0, core * 0.94 * robotMix);
      }
      const sc = clamp(0.74 + 0.28 * z + 0.12 * rv3 + 0.1 * d, 0.7, 1.2);
      let a0 = clamp((0.28 + 0.72 * smooth(0.02, 0.75, d)) * (0.68 + 0.42 * z) * (0.88 + 0.24 * rv), 0.12, 1);
      const pitchMark = smooth(0.12, 0.55, SOCCER[idx]);
      h = lerp(h, Math.max(h, .92), pitchMark * .92);
      a0 = lerp(a0, Math.max(a0, .92), pitchMark * .82);
      if (robotMix > 0) {
        const core = Math.exp(-2 * ((x - W * 0.5) / Math.max(W * 0.035, cellW * 2)) ** 2);
        a0 = lerp(a0, Math.max(a0, 0.9), core * robotMix);
      }

      // reveal parameter: burn front irregularity, filament lead, lateral lag
      const irr = (fbm(x / (Lc * 0.6) + 70, y / (Lc * 0.6) + 30, 3) - 0.5) * 2 * 0.10 * VH;
      const fine = (n2(x / (Lc * 0.12) + 5, y / (Lc * 0.12)) - 0.5) * 0.03 * VH;
      const s = y + irr + fine - Math.min(1, fil) * 0.09 * VH + Math.min(DNA[idx], 2) * 0.05 * VH + hashf(idx, 7) * 0.012 * VH;

      const i = N++;
      GX[i] = x; GY[i] = y; S[i] = s; A0[i] = a0; HH[i] = h; CH[i] = ch;
      BQa[i] = Math.round(b * (BQN - 1)); SC[i] = sc;
      PH[i] = hashf(idx, 8) * 6.2832; SP[i] = 0.3 + hashf(idx, 9) * 0.8;
      FIL[i] = Math.round(clamp(fil, 0, 1) * 255);
      STRG[i] = clamp(str, 0, 1);
      MATL[i] = MATLGrid[idx];
      MATX[i] = MATXGrid[idx];
      MATT[i] = MATTGrid[idx];
      CORE[i] = d > 0.8 ? 1 : 0;
      FLR[i] = 0.35 + 0.65 * hashf(idx, 10);
    }
  }
  rowStart[rows] = N; rowStart[rows + 1] = N;

  // occasional localized pulses within the brightest core
  pulses = [];
  const prn = mulberry32(777);
  for (let k = 0; k < 12; k++) {
    const y = (0.45 + k * 0.62 + prn() * 0.3) * VH;
    const r = clamp(Math.floor(y / cellH), 0, rows - 1);
    const R = (0.16 + prn() * 0.1) * VH;
    pulses.push({ x: CXP[r] + (prn() - 0.5) * SGP[r] * 0.8, y, R2: R * R, per: 6 + prn() * 7, off: prn() });
  }

  buildAtlas();
  sizeCanvas();
}

function orient(ang, rv, left) {
  if (ang < 0.3927 || ang >= 2.7489) return POOL_HORIZ[(rv * POOL_HORIZ.length) | 0];
  if (ang < 1.1781) return C_BSL;
  if (ang < 1.9635) { const p = left ? POOL_VL : POOL_VR; return p[(rv * p.length) | 0]; }
  return C_SL;
}

function sizeCanvas() {
  viewH = innerHeight;
  CVH = IS_MOBILE ? Math.ceil(innerHeight * 1.2) : innerHeight;
  const bw = Math.max(1, Math.round(W * DPR)), bh = Math.max(1, Math.round(CVH * DPR));
  // Reassigning width/height reallocates and clears the canvas; only do it on a real change.
  if (canvas.width !== bw) canvas.width = bw;
  if (canvas.height !== bh) canvas.height = bh;
  canvas.style.position = 'fixed';
  canvas.style.top = '0';
  canvas.style.left = '0';
  canvas.style.width = `${W}px`;
  canvas.style.height = `${CVH}px`;
}

/* ───────────────────────── reveal front ───────────────────────── */
let autoStart = 0, autoSkip = false, autoRevealComplete = false, scrollRevealStarted = false, scrollIntent = false;
const AUTO_DELAY = 1750, AUTO_DUR = 3800;
function targetFront(cam, nowMs) {
  if (reduced) return Infinity;
  const F0 = viewH * 1.36;          // front position once the hero is filled
  // 1) hero fills itself, top to bottom, with no scrolling needed
  const u = autoSkip ? 1 : clamp((nowMs - autoStart - AUTO_DELAY) / AUTO_DUR, 0, 1);
  const e = 1 - Math.pow(1 - u, 2.2);
  const auto = -0.06 * viewH + (F0 + 0.06 * viewH) * e;
  // Once scrolling begins, the same front follows the camera through every
  // section. No per-section lead ramps or terminal/outro easing are applied.
  return scrollRevealStarted ? Math.max(auto, cam + viewH * 0.92) : auto;
}

/* ───────────────────────── render ───────────────────────── */
const PI_ = new Float32Array(12);
function paattoholicMaterializationAt(nowMs) {
  if (paattoholicMaterializationStartedAt === null || !paattoholicBounds) return null;
  const progress = clamp((nowMs - paattoholicMaterializationStartedAt) / 5200, 0, 1);
  return {
    progress,
    reach: .015 + .985 * smooth(0, .29, progress),
    contact: Math.exp(-.5 * ((progress - .335) / .028) ** 2),
    pulse: smooth(.29, .33, progress) * (1 - smooth(.42, .49, progress)),
    // `t` runs from the soccer nebula (0) down to the performer's hand (1),
    // so the contact pulse must travel in that same direction.
    pulseTravel: smooth(.31, .49, progress),
    imageProgress: smooth(.37, .94, progress),
    strandFade: 1 - smooth(.9, 1, progress)
  };
}

function render(cam, front, T, nowMs, materialization = null) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#000';
  // The canvas scrolls with the document. Clear only the world-space slice
  // visible through the viewport, leaving the rest ready to move with the page.
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.globalCompositeOperation = 'lighter';

  const r0 = Math.max(0, Math.floor((cam - cellH * 2) / cellH));
  const r1 = Math.min(rows - 1, Math.ceil((cam + CVH) / cellH + 2));
  const i0 = rowStart[r0], i1 = rowStart[r1 + 1];

  let pulseOn = false;
  if (T > 0) {
    for (let k = 0; k < pulses.length; k++) {
      const u = ((T / pulses[k].per) + pulses[k].off) % 1;
      const v = u < 0.2 ? Math.sin(Math.PI * u / 0.2) : 0;
      PI_[k] = v * v;
      if (PI_[k] > 0.01) pulseOn = true;
    }
  }
  const step = Math.floor(nowMs / 70);
  const atl = atlas, dpr = DPR, sw = SW, sh = SH, hq1 = HQ - 1;

  for (let i = i0; i < i1; i++) {
    const sI = S[i];
    let t = (front - sI) * invIgn;
    const pageY = GY[i];
    const inShockSection = shockBounds && pageY >= shockBounds.topY && pageY <= shockBounds.bottom;
    if (t <= 0) continue;
    let a = A0[i], h = HH[i], bi = BQa[i];

    if (t < 1) {
      // ignition region: blue/violet first, then white/lavender flash, settle to final colour
      const f = Math.sin(Math.PI * clamp((t - 0.3) / 0.7, 0, 1));
      h = h + (1 - h) * f * FLR[i];
      if (t < 0.45) { bi = 3; if (h > 0.5) h = 0.5; }
      a *= t * t * (3 - 2 * t) * (0.72 + 0.28 * hashf(i, step));
    } else if (T > 0) {
      const amb = Math.sin(T * SP[i] + PH[i]);
      a *= 0.9 + 0.1 * amb; h += 0.035 * amb;
      const fl = FIL[i];
      if (fl > 0) {
        const w = Math.sin(sI * 0.011 + GX[i] * 0.004 - T * 0.8);
        if (w > 0.82) { const k = (w - 0.82) / 0.18; h += 0.35 * k * fl / 255; a += 0.25 * k * fl / 255; }
      }
      if (pulseOn && CORE[i]) {
        for (let k = 0; k < pulses.length; k++) {
          const pk = PI_[k];
          if (pk > 0.01) {
            const dx = GX[i] - pulses[k].x, dy = GY[i] - pulses[k].y, d2 = dx * dx + dy * dy;
            if (d2 < pulses[k].R2) { const g = pk * Math.exp(-d2 / pulses[k].R2 * 3.2); h += 0.35 * g; a += 0.2 * g; }
          }
        }
      }
    }
    if (inShockSection) {
      const surge = window.__udbhavaShockSurge || 0;
      const heartbeat = .62 + .38 * (.5 + .5 * Math.sin(nowMs * .009 + PH[i]));
      const distance = Math.hypot((GX[i] - shockBounds.focusX) / (W * .46), (pageY - shockBounds.focusY) / (VH * .58));
      const terminalFlash = Math.exp(-distance * distance * 3.5);
      const tendril = STRG[i];
      a *= heartbeat * (1 + surge * (.25 + .95 * tendril + .55 * terminalFlash));
      h = lerp(h, 1, surge * (.18 + .66 * terminalFlash + .28 * tendril));
    }
    if (MATL[i] > .01) {
      let strandVisibility = 0;
      let pulseGlow = 0;
      if (materialization) {
        const behindFront = 1 - smooth(materialization.reach - .018, materialization.reach + .018, MATT[i]);
        strandVisibility = behindFront * materialization.strandFade;
        const travelingWave = Math.exp(-.5 * ((MATT[i] - materialization.pulseTravel) / .052) ** 2) * materialization.pulse;
        const handDistance = Math.hypot(
          (GX[i] - paattoholicBounds.targetX) / Math.max(1, W * .06),
          (GY[i] - paattoholicBounds.targetY) / Math.max(1, VH * .06)
        );
        const contactGlow = materialization.contact * Math.exp(-.5 * handDistance * handDistance);
        pulseGlow = Math.max(travelingWave * .7, contactGlow);
        h = lerp(h, 1, MATL[i] * strandVisibility * .88 + pulseGlow * MATL[i] * .7);
        a = Math.min(1, a * (1 + MATL[i] * strandVisibility * .2 + pulseGlow * MATL[i] * .45));
      }
      // Extra cells introduced to continue the strand are dormant before the
      // transition and settle back into the ambient field after it completes.
      a *= 1 - MATX[i] * (1 - strandVisibility);
    }
    if (a < 0.015) continue;
    if (a > 1) a = 1;
    const hi = h <= 0 ? 0 : h >= 1 ? hq1 : (h * hq1 + 0.5) | 0;
    const sc = SC[i], dw = sw * sc, dh = sh * sc;
    const x = Math.round(GX[i] * dpr - dw * 0.5);
    const y = Math.round((GY[i] + viewH * 0.025 - cam) * dpr - dh * 0.5);
    ctx.globalAlpha = a;
    ctx.drawImage(atl, (bi * HQ + hi) * sw, CH[i] * sh, sw, sh, x, y, dw, dh);
  }
  ctx.globalAlpha = 1;

  if (materialization && window.__udbhavaPaattoholicFrame) {
    window.__udbhavaPaattoholicFrame(materialization.imageProgress, materialization.contact, nowMs);
    if (materialization.progress >= 1 && !paattoholicMaterializationComplete) {
      paattoholicMaterializationComplete = true;
      window.dispatchEvent(new Event('udbhava:paattoholic-materialization-complete'));
    }
  }
}

/* ───────────────────────── loop ───────────────────────── */
let raf = 0, lastFrameAt = 0;
function loop(now) {
  raf = requestAnimationFrame(loop);
  // Touch devices: cap to ~30fps when the page is idle. While scrolling, render every
  // frame so the fixed canvas stays in step with the content.
  if (IS_MOBILE && now - lastScrollAt > 150 && now - lastFrameAt < MOBILE_FRAME_MS - 2) return;
  lastFrameAt = now;
  const cam = window.scrollY || window.pageYOffset || 0;
  // The visible hero is filled well before the reveal front reaches its offscreen tail.
  if (!autoRevealComplete && (autoSkip || now >= autoStart + AUTO_DELAY + AUTO_DUR * 0.54)) {
    autoRevealComplete = true;
    window.dispatchEvent(new Event('udbhava:nebula-reveal-complete'));
  }
  const front = targetFront(cam, now);
  if (!investigationFocusFired && investigationHubY !== null && front >= investigationHubY) {
    investigationFocusFired = true;
    window.__udbhavaInvestigationFocusReached = true;
    window.dispatchEvent(new CustomEvent('udbhava:investigation-focus', { detail: { y: investigationHubY } }));
  }
  // Trigger the robot as the shared front reaches its track, not from a second
  // section observer or a separate animation clock.
  const robotReadyY = robotBounds ? robotBounds.topY + viewH * 0.35 : Infinity;
  if (robotBounds && !robotTrackReadyFired && front >= robotReadyY) {
    robotTrackReadyFired = true;
    window.__udbhavaRobotTrackReady = true;
    window.dispatchEvent(new Event('udbhava:robot-track-ready'));
  }
  // The bike entrance waits for the same continuous page-wide reveal front to
  // draw into the stunt section. It does not create or advance a local nebula.
  const bikeStuntReadyY = bikeStuntBounds
    ? bikeStuntBounds.topY + Math.min(viewH * 0.58, (bikeStuntBounds.bottom - bikeStuntBounds.topY) * 0.30)
    : Infinity;
  if (bikeStuntBounds && !bikeStuntReadyFired && front >= bikeStuntReadyY) {
    bikeStuntReadyFired = true;
    window.__udbhavaBikeStuntNebulaReady = true;
    window.dispatchEvent(new Event('udbhava:bike-stunt-nebula-ready'));
  }
  // Robot Soccer waits for the same document-wide reveal front to reach its
  // play area. The background remains the one shared canvas field.
  const soccerReadyY = soccerBounds ? soccerBounds.playfieldY : Infinity;
  if (soccerBounds && !soccerNebulaReadyFired && front >= soccerReadyY) {
    soccerNebulaReadyFired = true;
    window.__udbhavaSoccerNebulaReady = true;
    window.dispatchEvent(new Event('udbhava:soccer-nebula-ready'));
  }
  render(cam, front, now / 1000, now, paattoholicMaterializationAt(now));
}
function drawStatic() {
  const cam = window.scrollY || 0;
  render(cam, Infinity, 0, performance.now());
}
function start() {
  cancelAnimationFrame(raf);
  autoStart = performance.now();
  autoRevealComplete = false;
  // An explicit home load always gets the intro, even if the browser restores
  // a prior scroll position before the #home anchor settles at the top.
  autoSkip = location.hash !== '#home' && (window.scrollY || 0) > innerHeight * 0.32;
  scrollRevealStarted = autoSkip;
  scrollIntent = false;
  if (reduced) drawStatic();
  else raf = requestAnimationFrame(loop);
}

/* ───────────────────────── events ───────────────────────── */
let rt = 0;
function scheduleWorldRebuild() {
  clearTimeout(rt);
  rt = setTimeout(() => {
    const dprNow = computeDPR(W, CVH || innerHeight);
    // All world-space positions, section bounds, and glyph rows are measured
    // from the same viewport dimensions. Updating only the fixed canvas height
    // left the robot/shock bounds in the old coordinate system after small
    // viewport changes (notably mobile browser chrome expanding/collapsing).
    // On touch devices innerHeight changes by ~60-90px every time Safari's toolbar
    // collapses while scrolling. That must NOT trigger a full world rebuild, so only
    // rebuild on width change or a large height change (rotation, keyboard excluded).
    const heightDelta = Math.abs(innerHeight - VH);
    const viewportChanged = Math.abs(innerWidth - W) > 1 ||
      (IS_MOBILE ? heightDelta > VH * 0.3 : heightDelta > 1);
    const pixelRatioChanged = dprNow !== DPR;
    if (viewportChanged || pixelRatioChanged) build();
    else sizeCanvas();
    if (reduced) drawStatic();
  }, 200);
}
addEventListener('resize', scheduleWorldRebuild, { passive: true });
if (window.visualViewport) window.visualViewport.addEventListener('resize', scheduleWorldRebuild, { passive: true });
// Font and image loading can shift measured section positions without a window
// resize. Rebuild once the final layout is available; ResizeObserver handles
// later content-size changes through the same debounced path.
addEventListener('load', scheduleWorldRebuild, { once: true });
if (document.fonts?.ready) document.fonts.ready.then(scheduleWorldRebuild);
if ('ResizeObserver' in window && page) {
  const layoutObserver = new ResizeObserver(scheduleWorldRebuild);
  layoutObserver.observe(page);
}
function noteScrollIntent() { scrollIntent = true; }
addEventListener('wheel', noteScrollIntent, { passive: true });
addEventListener('touchmove', noteScrollIntent, { passive: true });
addEventListener('pointerdown', noteScrollIntent, { passive: true });
addEventListener('keydown', event => {
  if (['ArrowDown', 'PageDown', ' ', 'End'].includes(event.key)) noteScrollIntent();
});
addEventListener('hashchange', () => {
  if (location.hash && location.hash !== '#home') scrollRevealStarted = true;
});
addEventListener('scroll', () => {
  lastScrollAt = performance.now();
  const cam = window.scrollY || window.pageYOffset || 0;
  // Ignore browser anchor/restoration scroll events during the home intro.
  if (cam > 0 && (scrollIntent || (location.hash && location.hash !== '#home'))) scrollRevealStarted = true;
  if (reduced) requestAnimationFrame(drawStatic);
}, { passive: true });
const onMQ = () => { reduced = mq.matches; start(); };
if (mq.addEventListener) mq.addEventListener('change', onMQ); else if (mq.addListener) mq.addListener(onMQ);

build();
start();
})();
