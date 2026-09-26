// ══════════════════════════════════════════════════════════════════
//  필터 레지스트리
//  pass:
//    'frame'  : JS 루프에서 처리 (셰이더 아님)
//    'dither' : 1패스(디더/팔레트) 안에서 처리 → 결과는 여전히 4색
//    'film'   : 2패스(화면 해상도) 에서 처리 → 팔레트 밖의 중간색이 생김
//  uniform: 셰이더 유니폼 이름. 꺼져 있으면 0이 전달되고, 셰이더는 0이면 건너뛴다.
//  value/min/max/step: 세기 슬라이더
//
//  새 필터 추가 = 여기 한 줄 + postfx.js 셰이더에 `if (uXxx > 0.0) { ... }` 블록
// ══════════════════════════════════════════════════════════════════

export const FILTERS = [
  { id: 'twos',     label: '투로 찍기 (fps)', pass: 'frame',
    value: 12, min: 4, max: 24, step: 1 },
  { id: 'boil',     label: '라인 보일',       pass: 'dither', uniform: 'uBoil',
    value: 1, min: 0.3, max: 2, step: 0.1 },
  { id: 'fog',      label: '안개',            pass: 'dither', uniform: 'uFog',
    value: 0.5, min: 0, max: 1, step: 0.05 },
  { id: 'vignette', label: '비네팅',          pass: 'dither', uniform: 'uVignette',
    value: 0.35, min: 0, max: 3, step: 0.05 },
  { id: 'grain',    label: '필름 그레인',     pass: 'film', uniform: 'uGrain',
    value: 0.1, min: 0, max: 0.4, step: 0.01 },
  { id: 'chroma',   label: '색수차',          pass: 'film', uniform: 'uChroma',
    value: 0.6, min: 0, max: 2, step: 0.05 },
  { id: 'soften',   label: '소프트닝',        pass: 'film', uniform: 'uSoften',
    value: 0.5, min: 0, max: 1, step: 0.05 },
  { id: 'halation', label: '할레이션',        pass: 'film', uniform: 'uHalation',
    value: 0.3, min: 0, max: 1, step: 0.05 },
  { id: 'weave',    label: '게이트 위브',     pass: 'film', uniform: 'uWeave',
    value: 0.5, min: 0, max: 2, step: 0.05 },
  { id: 'dust',     label: '먼지 / 스크래치', pass: 'film', uniform: 'uDust',
    value: 1, min: 0, max: 3, step: 0.1 },
];

export const PRESETS = {
  clean:   [],
  flood:   ['fog', 'vignette', 'grain', 'chroma', 'soften', 'halation', 'weave'],
  cel:     ['twos', 'boil', 'vignette'],
  oldfilm: ['twos', 'vignette', 'grain', 'soften', 'halation', 'weave', 'dust'],
  all:     FILTERS.map((f) => f.id),
};

const BY_ID = Object.fromEntries(FILTERS.map((f) => [f.id, f]));

// initial: URL ?fx=... 값
export function createFilterState(initial = 'flood') {
  const enabled = new Set();
  const values = Object.fromEntries(FILTERS.map((f) => [f.id, f.value]));
  const listeners = [];
  let preset = 'custom';

  const emit = () => listeners.forEach((fn) => fn());

  const s = {
    get preset() { return preset; },
    isOn: (id) => enabled.has(id),
    raw: (id) => values[id],
    // 꺼져 있으면 0
    value: (id) => (enabled.has(id) ? values[id] : 0),

    set(id, on) {
      if (!BY_ID[id]) return;
      on ? enabled.add(id) : enabled.delete(id);
      preset = 'custom';
      emit();
    },
    toggle(id) { s.set(id, !enabled.has(id)); },
    setValue(id, v) { values[id] = v; emit(); },

    applyPreset(name) {
      if (!PRESETS[name]) return;
      enabled.clear();
      PRESETS[name].forEach((id) => enabled.add(id));
      preset = name;
      emit();
    },
    cyclePreset() {
      const names = Object.keys(PRESETS);
      s.applyPreset(names[(names.indexOf(preset) + 1) % names.length]);
    },

    // { uGrain: 0.12, uChroma: 0, ... } — 해당 패스의 모든 유니폼
    uniforms(pass) {
      const out = {};
      for (const f of FILTERS) if (f.pass === pass) out[f.uniform] = s.value(f.id);
      return out;
    },
    onChange(fn) { listeners.push(fn); },
  };

  // "flood" | "grain,fog" | "flood,dust:3,grain:0.2" (프리셋 + 개별 필터:세기 조합 가능)
  for (const tok of initial.split(',').map((x) => x.trim()).filter(Boolean)) {
    if (PRESETS[tok]) { s.applyPreset(tok); continue; }
    const [id, v] = tok.split(':');
    if (!BY_ID[id]) continue;
    enabled.add(id);
    if (v !== undefined && !isNaN(parseFloat(v))) values[id] = parseFloat(v);
    preset = 'custom';
  }
  return s;
}
