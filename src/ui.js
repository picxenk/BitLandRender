// 필터 패널: 프리셋 버튼 + 필터별 [체크박스 · 단축키 · 이름 · 세기 슬라이더]
// FILTERS 배열에서 자동 생성되므로 필터를 추가하면 패널에도 자동으로 나타난다.

import { FILTERS, PRESETS } from './filters.js';

export const FILTER_KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'];

const PASS_LABEL = { frame: '프레임', dither: '디더 (4색 유지)', film: '필름 (화면 해상도)' };

export function mountFilterPanel(root, fs) {
  root.innerHTML = '';

  const head = el('div', 'fx-head');
  head.append(el('span', 'fx-title', '필터'), el('span', 'fx-preset'));
  root.append(head);

  const presets = el('div', 'fx-presets');
  for (const name of Object.keys(PRESETS)) {
    const b = el('button', '', name);
    b.dataset.preset = name;
    b.onclick = () => { fs.applyPreset(name); b.blur(); };
    presets.append(b);
  }
  root.append(presets);

  const rows = {};
  let lastPass = null;
  FILTERS.forEach((f, i) => {
    if (f.pass !== lastPass) {
      root.append(el('div', 'fx-group', PASS_LABEL[f.pass] || f.pass));
      lastPass = f.pass;
    }
    const row = el('label', 'fx-row');
    const cb = el('input');
    cb.type = 'checkbox';
    cb.onchange = () => { fs.set(f.id, cb.checked); cb.blur(); };
    const key = el('kbd', '', FILTER_KEYS[i] ?? '');
    const name = el('span', 'fx-name', f.label);
    const range = el('input');
    Object.assign(range, { type: 'range', min: f.min, max: f.max, step: f.step, value: fs.raw(f.id) });
    range.oninput = () => fs.setValue(f.id, parseFloat(range.value));
    range.onchange = () => range.blur();
    const val = el('span', 'fx-val');
    row.append(cb, key, name, range, val);
    root.append(row);
    rows[f.id] = { row, cb, range, val, f };
  });

  root.append(el('div', 'fx-hint', '1–0 필터 토글 · F 프리셋 순환'));

  function sync() {
    head.querySelector('.fx-preset').textContent = fs.preset;
    presets.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.preset === fs.preset));
    for (const { row, cb, range, val, f } of Object.values(rows)) {
      const on = fs.isOn(f.id);
      cb.checked = on;
      row.classList.toggle('off', !on);
      const v = fs.raw(f.id);
      if (document.activeElement !== range) range.value = v;
      val.textContent = f.step >= 1 ? String(v) : v.toFixed(2);
    }
  }
  fs.onChange(sync);
  sync();
}

function el(tag, cls = '', text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}
