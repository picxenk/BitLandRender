// ══════════════════════════════════════════════════════════════════
//  디더 설정
//  - 패턴 = 임계값 행렬. 모든 패턴은 "순위(rank) 배열"로 만들고 0..1 임계값으로 바꾼다.
//    순위가 낮은 칸일수록 어두워질 때 먼저 어두운 색이 된다.
//  - 새 패턴 추가: PATTERNS 에 { label, make: () => ({ size, rank }) } 한 줄
//  - 옵션은 DITHER_OPTIONS 에서 패널/URL(?dither=...)로 자동 연결된다
// ══════════════════════════════════════════════════════════════════

import { rng } from './util.js';

// ── 패턴 생성기 ─────────────────────────────────────────────────
// Bayer: M(2n) = [4M+0, 4M+2; 4M+3, 4M+1]
function bayerRank(N) {
  let m = [0], n = 1;
  while (n < N) {
    const n2 = n * 2, out = new Int32Array(n2 * n2);
    for (let y = 0; y < n2; y++) {
      for (let x = 0; x < n2; x++) {
        const off = [0, 2, 3, 1][(y >= n ? 2 : 0) + (x >= n ? 1 : 0)];
        out[y * n2 + x] = 4 * m[(y % n) * n + (x % n)] + off;
      }
    }
    m = out;
    n = n2;
  }
  return Int32Array.from(m);
}

// "스팟 함수" 값이 작은 칸부터 순위를 매긴다. 같은 값은 Bayer 순서로 나눈다.
function spotRank(N, spot) {
  const tie = bayerRank(8);
  const idx = [...Array(N * N).keys()];
  const s = idx.map((i) => {
    const x = i % N, y = Math.floor(i / N);
    return spot(x, y) + (tie[(y % 8) * 8 + (x % 8)] / 64) * 1e-3;
  });
  idx.sort((a, b) => s[a] - s[b]);
  const rank = new Int32Array(N * N);
  idx.forEach((p, r) => { rank[p] = r; });
  return rank;
}
const td = (a, b, n) => { const d = Math.abs(a - b) % n; return Math.min(d, n - d); };

// 블루 노이즈: void-and-cluster (Ulichney 1993). 64x64, 가우시안 에너지(토러스)
function blueNoiseRank(N = 64, sigma = 1.5, seed = 7) {
  const total = N * N, R = 5;
  const K = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    K.push([dx, dy, Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma))]);
  }
  const E = new Float64Array(total), bin = new Uint8Array(total);
  const splat = (p, s) => {
    const px = p % N, py = (p / N) | 0;
    for (const [dx, dy, k] of K) E[((py + dy + N) % N) * N + ((px + dx + N) % N)] += s * k;
  };
  const tightest = () => { let b = -1, v = -Infinity; for (let i = 0; i < total; i++) if (bin[i] && E[i] > v) { v = E[i]; b = i; } return b; };
  const voidest = () => { let b = -1, v = Infinity; for (let i = 0; i < total; i++) if (!bin[i] && E[i] < v) { v = E[i]; b = i; } return b; };

  const r = rng(seed);
  const ones0 = Math.floor(total * 0.1);
  for (let n = 0; n < ones0;) {
    const p = Math.floor(r() * total);
    if (!bin[p]) { bin[p] = 1; splat(p, 1); n++; }
  }
  // 초기 패턴을 고르게 펴기: 가장 뭉친 점을 가장 빈 곳으로 옮기기를 수렴할 때까지
  for (let it = 0; it < total; it++) {
    const c = tightest();
    bin[c] = 0; splat(c, -1);
    const v = voidest();
    if (v === c) { bin[c] = 1; splat(c, 1); break; }
    bin[v] = 1; splat(v, 1);
  }
  const proto = bin.slice(), protoE = E.slice();
  const rank = new Int32Array(total);
  let ones = ones0;
  while (ones > 0) { const c = tightest(); bin[c] = 0; splat(c, -1); rank[c] = --ones; }
  bin.set(proto); E.set(protoE); ones = ones0;
  while (ones < total) { const v = voidest(); bin[v] = 1; splat(v, 1); rank[v] = ones++; }
  return rank;
}

function whiteNoiseRank(N = 64, seed = 3) {
  const r = rng(seed);
  const a = [...Array(N * N).keys()];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return Int32Array.from(a);
}

export const PATTERNS = {
  bayer4:    { label: 'Bayer 4×4',     make: () => ({ size: 4, rank: bayerRank(4) }) },
  bayer2:    { label: 'Bayer 2×2',     make: () => ({ size: 2, rank: bayerRank(2) }) },
  bayer8:    { label: 'Bayer 8×8',     make: () => ({ size: 8, rank: bayerRank(8) }) },
  cluster:   { label: '망점 (halftone)', make: () => ({ size: 8, rank: spotRank(8, (x, y) =>
    Math.min(td(x, 0, 8) ** 2 + td(y, 0, 8) ** 2, td(x, 4, 8) ** 2 + td(y, 4, 8) ** 2)) }) },
  lines:     { label: '가로줄',        make: () => ({ size: 8, rank: spotRank(8, (x, y) => td(y, 0, 4)) }) },
  diagonal:  { label: '사선',          make: () => ({ size: 8, rank: spotRank(8, (x, y) => td((x + y) % 4, 0, 4)) }) },
  bluenoise: { label: '블루 노이즈',   make: () => ({ size: 64, rank: blueNoiseRank(64) }) },
  noise:     { label: '화이트 노이즈', make: () => ({ size: 64, rank: whiteNoiseRank(64) }) },
};

// 패턴 → RGBA 바이트 (R = 임계값 × 256). 처음 쓸 때 한 번만 만든다
const cache = new Map();
export function getPattern(name) {
  if (!cache.has(name)) {
    const { size, rank } = (PATTERNS[name] || PATTERNS.bayer4).make();
    const total = size * size;
    const data = new Uint8Array(total * 4);
    for (let i = 0; i < total; i++) {
      const b = Math.min(255, Math.floor(((rank[i] + 0.5) / total) * 256));
      data.set([b, b, b, 255], i * 4);
    }
    cache.set(name, { name, size, data });
  }
  return cache.get(name);
}

// ══════════════════════════════════════════════════════════════════
//  옵션
// ══════════════════════════════════════════════════════════════════
export const DITHER_OPTIONS = [
  { id: 'pattern', label: '패턴', type: 'select', value: 'bayer4',
    options: Object.entries(PATTERNS).map(([k, p]) => [k, p.label]) },
  { id: 'scale', label: '패턴 크기', type: 'range', min: 1, max: 4, step: 1, value: 1 },
  { id: 'levels', label: '단계', type: 'select', value: '3', options: [['3', '3단계'], ['2', '1-bit']] },
  { id: 'contrast', label: '대비', type: 'range', min: 0.5, max: 2, step: 0.05, value: 1 },
  { id: 'gamma', label: '감마', type: 'range', min: 0.5, max: 2, step: 0.05, value: 1 },
  { id: 'band', label: '디더 폭', type: 'range', min: 0.05, max: 1, step: 0.05, value: 1 },
  { id: 'accent', label: '강조색', type: 'select', value: 'dither', options: [['dither', '디더'], ['hard', '단색']] },
  { id: 'anchor', label: '고정 기준', type: 'select', value: 'auto',
    options: [['auto', '자동 (탑뷰 월드 · 카메라 구면)'], ['screen', '화면']] },
  { id: 'animate', label: '패턴 움직임', type: 'toggle', value: false },
];
const BY_ID = Object.fromEntries(DITHER_OPTIONS.map((o) => [o.id, o]));

// initial: URL ?dither= 값. 예) "bluenoise" / "cluster,scale:2,levels:2,accent:hard"
export function createDitherState(initial = '') {
  const values = Object.fromEntries(DITHER_OPTIONS.map((o) => [o.id, o.value]));
  const listeners = [];
  const emit = () => listeners.forEach((fn) => fn());

  const coerce = (o, v) => {
    if (o.type === 'range') return Math.min(o.max, Math.max(o.min, parseFloat(v)));
    if (o.type === 'toggle') return v === true || v === '1' || v === 'true' || v === 'on';
    return o.options.some(([k]) => k === String(v)) ? String(v) : o.value;
  };

  for (const tok of initial.split(',').map((t) => t.trim()).filter(Boolean)) {
    if (PATTERNS[tok]) { values.pattern = tok; continue; }
    const [id, v] = tok.split(':');
    if (BY_ID[id] && v !== undefined) values[id] = coerce(BY_ID[id], v);
  }

  const s = {
    get: (id) => values[id],
    set(id, v) { if (BY_ID[id]) { values[id] = coerce(BY_ID[id], v); emit(); } },
    cyclePattern(dir = 1) {
      const names = Object.keys(PATTERNS);
      s.set('pattern', names[(names.indexOf(values.pattern) + dir + names.length) % names.length]);
    },
    onChange(fn) { listeners.push(fn); },
    get label() { return PATTERNS[values.pattern].label + (values.levels === '2' ? ' · 1-bit' : ''); },

    // postfx.renderScene 에 넘길 값. camera=true 이고 anchor 가 auto 면 구면 고정
    params(camera) {
      return {
        pattern: getPattern(values.pattern),
        scale: values.scale,
        levels: +values.levels,
        contrast: values.contrast,
        gamma: values.gamma,
        band: values.band,
        accentHard: values.accent === 'hard',
        animate: values.animate,
        anchor: values.anchor === 'screen' ? 1 : camera ? 2 : 0,   // 0 월드 · 1 화면 · 2 구면
      };
    },
  };
  return s;
}
