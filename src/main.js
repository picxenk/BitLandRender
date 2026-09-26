import { createPostFX, PALETTES } from './postfx.js';
import { PLAYER, PLAYER_PRONE } from './sprites.js';
import { TILE } from './tiles.js';
import { loadMap, drawObject, drawShadow } from './map.js';
import { FILTERS, createFilterState } from './filters.js';
import { mountFilterPanel, FILTER_KEYS } from './ui.js';
import { spawnAnimals, updateAnimals, drawAnimal, drawAnimalShadow, isHigh } from './animals.js';

// ── 설정 ───────────────────────────────────────────────────────
const W = 160, H = 144;         // 게임보이 해상도
const SPEED = 36;               // px/s
const PRONE_SPEED = 0.5;        // 엎드렸을 때 속도 배율
const DAY_LENGTH = 40;          // 하루 길이(s)

const q = new URLSearchParams(location.search);
const MAP_URL = `./maps/${q.get('map') || 'field'}.txt`;

// ── 1단계 버퍼: Canvas2D (명도 + 강조 마스크) ─────────────────────
const scene = document.createElement('canvas');
scene.width = W;
scene.height = H;
const ctx = scene.getContext('2d');
ctx.imageSmoothingEnabled = false;

// ── 2·3단계: WebGL 후처리 (디더/팔레트 → 필름) ─────────────────────
const screen = document.getElementById('screen');
const fx = createPostFX(screen, W, H);

// 필터 상태: ?fx=flood | clean | cel | oldfilm | all | grain,fog,...
const filters = createFilterState(q.get('fx') || 'flood');
mountFilterPanel(document.getElementById('fx'), filters);

// 캔버스를 "정수배 CSS 크기 × devicePixelRatio" 실제 픽셀로 만든다.
// 필름 패스는 이 해상도에서 돌기 때문에 그레인/색수차가 픽셀보다 섬세해진다.
let pixelRatio = 1;
function fit() {
  const panel = 270;
  const s = Math.max(1, Math.floor(Math.min((innerWidth - panel - 40) / W, (innerHeight - 110) / H)));
  pixelRatio = Math.min(2, window.devicePixelRatio || 1);
  screen.style.width = W * s + 'px';
  screen.style.height = H * s + 'px';
  fx.resize(Math.round(W * s * pixelRatio), Math.round(H * s * pixelRatio));
}
addEventListener('resize', fit);
fit();

// ── 상태 ───────────────────────────────────────────────────────
const player = { x: 0, y: 0, dir: 'down', anim: 0, moving: false, prone: q.has('prone') };
const state = {
  time: parseFloat(q.get('time')) || 0,          // ?time=0.5 → 자정에서 시작
  cycle: false,
  mode: parseInt(q.get('mode')) || 0,            // ?mode=2 → 원본 버퍼
  palette: parseInt(q.get('palette')) || 0,
  collision: q.has('collision'),                 // ?collision → 충돌 영역 표시
};
let map = null;
let clock = 0;
let animals = [];
// 동물 배치 시드: 매번 랜덤. ?seed=123 으로 고정하면 같은 배치가 재현된다
const SEED = q.has('seed') ? parseInt(q.get('seed')) >>> 0 : (Math.random() * 2 ** 32) >>> 0;

async function reloadMap(keepPosition) {
  try {
    const m = await loadMap(MAP_URL);
    map = m;
    const [tx, ty] = map.tileAtPx(player.x, player.y);
    if (!keepPosition || !map.canOccupy(player.x, player.y, map.heightAt(tx, ty))) {
      player.x = map.spawn.x;
      player.y = map.spawn.y;
      const at = q.get('at')?.split(',').map(Number);   // ?at=38,33 → 해당 타일에서 시작
      if (!keepPosition && at?.length === 2) {
        player.x = at[0] * TILE + 4;
        player.y = at[1] * TILE + 6;
      }
    }
    if (map.warnings.length) console.warn('map warnings:\n' + map.warnings.join('\n'));
    animals = spawnAnimals(map, player, SEED);
    hudText = '';
  } catch (e) {
    console.error(e);
    document.getElementById('hud').textContent = String(e.message || e);
  }
}

// ── 입력 ───────────────────────────────────────────────────────
const keys = new Set();
const MOVE = {
  ArrowLeft: [-1, 0], KeyA: [-1, 0],
  ArrowRight: [1, 0], KeyD: [1, 0],
  ArrowUp: [0, -1], KeyW: [0, -1],
  ArrowDown: [0, 1], KeyS: [0, 1],
};
addEventListener('keydown', (e) => {
  if (MOVE[e.code]) { keys.add(e.code); e.preventDefault(); }
  if (e.repeat) return;
  if (e.code === 'KeyT') state.cycle = !state.cycle;
  if (e.code === 'KeyB') state.mode = state.mode === 1 ? 0 : 1;
  if (e.code === 'KeyR') state.mode = state.mode === 2 ? 0 : 2;
  if (e.code === 'KeyP') state.palette = (state.palette + 1) % PALETTES.length;
  if (e.code === 'KeyC') state.collision = !state.collision;
  if (e.code === 'KeyL') reloadMap(true);
  if (e.code === 'KeyF') filters.cyclePreset();
  if (e.code === 'KeyX') { player.prone = !player.prone; player.anim = 0; }
  const fi = FILTER_KEYS.indexOf(e.key);
  if (fi >= 0 && FILTERS[fi] && e.code.startsWith('Digit')) filters.toggle(FILTERS[fi].id);
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// ── 업데이트 ───────────────────────────────────────────────────
function tileUnder() {
  const [tx, ty] = map.tileAtPx(player.x, player.y);
  return { tx, ty, t: map.terrainAt(tx, ty), h: map.heightAt(tx, ty) };
}

function update(dt) {
  clock += dt;
  let dx = 0, dy = 0;
  for (const k of keys) { dx += MOVE[k][0]; dy += MOVE[k][1]; }
  dx = Math.sign(dx); dy = Math.sign(dy);
  player.moving = dx !== 0 || dy !== 0;

  if (player.moving) {
    const under = tileUnder();
    const len = Math.hypot(dx, dy);
    const d = SPEED * (under.t?.speed ?? 1) * (player.prone ? PRONE_SPEED : 1) * dt;
    const hc = under.h;
    // 이미 끼어 있는 상태면(맵 수정 직후 등) 자유롭게 빠져나오게 한다
    const stuck = !map.canOccupy(player.x, player.y, hc);
    // 축별로 따로 판정 → 벽을 따라 미끄러지듯 이동
    const nx = player.x + (dx / len) * d;
    if (stuck || map.canOccupy(nx, player.y, hc)) player.x = nx;
    const ny = player.y + (dy / len) * d;
    if (stuck || map.canOccupy(player.x, ny, hc)) player.y = ny;

    player.dir = dx ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
    player.anim += dt;
  } else {
    player.anim = 0;
  }

  updateAnimals(animals, dt, map, player);
  if (state.cycle) state.time = (state.time + dt / DAY_LENGTH) % 1;
}

// ── 렌더 ───────────────────────────────────────────────────────
function camAxis(p, view, size) {
  if (size <= view) return -Math.round((view - size) / 2);
  return Math.max(0, Math.min(size - view, p - view / 2));
}

// 씬 그리기 + 패스 1(디더). '투로 찍기'가 켜져 있으면 지정 fps로만 호출된다.
function renderScene() {
  // 카메라는 정수 픽셀에 스냅 — 서브픽셀 이동은 디더 지글거림의 원인
  const px = Math.round(player.x), py = Math.round(player.y);
  const cam = { x: camAxis(px, W, map.pxW), y: camAxis(py - 6, H, map.pxH) };
  const x0 = cam.x, y0 = cam.y, x1 = cam.x + W, y1 = cam.y + H;

  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.setTransform(1, 0, 0, 1, -cam.x, -cam.y);

  // 정적 배경 (지형 + 절벽 + 그림자 + 납작한 장식)
  ctx.drawImage(map.ground, 0, 0);

  // 보이는 타일만 애니메이션
  const tx0 = Math.max(0, Math.floor(x0 / TILE)), tx1 = Math.min(map.W - 1, Math.floor(x1 / TILE));
  const ty0 = Math.max(0, Math.floor(y0 / TILE)), ty1 = Math.min(map.H - 1, Math.floor(y1 / TILE));
  for (let ty = ty0; ty <= ty1; ty++) {
    for (let tx = tx0; tx <= tx1; tx++) {
      const t = map.terrainAt(tx, ty);
      if (t.anim) t.anim(ctx, tx * TILE, ty * TILE, { tx, ty, map }, clock);
    }
  }

  // 오브젝트 + 플레이어 y정렬
  const inWater = tileUnder().t?.water;
  if (!inWater) {
    const side = player.dir === 'left' || player.dir === 'right';
    if (!player.prone) drawShadow(ctx, px, py, 5, 2, 0.5);
    else if (side) drawShadow(ctx, px, py, 8, 2, 0.5);
    else drawShadow(ctx, px, py - 2, 5, 4, 0.5);
  }
  // 동물: 그림자는 바닥에, 본체는 y정렬 / 높이 나는 새는 맨 위에
  const visible = (x, y) => x > x0 - 24 && x < x1 + 24 && y > y0 - 8 && y < y1 + 40;
  const seen = animals.filter((a) => visible(a.x, a.y));
  for (const a of seen) drawAnimalShadow(ctx, a, drawShadow, map);

  const drawList = map.objects.filter((o) => o.x > x0 - 40 && o.x < x1 + 40 && o.y > y0 && o.y < y1 + 64);
  drawList.push({ player: true, y: py });
  for (const a of seen) if (!isHigh(a)) drawList.push({ animal: a, y: a.y });
  drawList.sort((a, b) => a.y - b.y);
  for (const o of drawList) {
    if (o.player) drawPlayer(px, py, inWater);
    else if (o.animal) drawAnimal(ctx, o.animal, map, clock);
    else drawObject(ctx, o);
  }
  for (const a of seen) if (isHigh(a)) drawAnimal(ctx, a, map, clock);

  // 디버그: 이동 불가 타일을 강조색 50% 디더로 표시
  if (state.collision) {
    ctx.fillStyle = 'rgba(255,0,0,0.5)';
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        if (!map.walkable(tx, ty)) ctx.fillRect(tx * TILE, ty * TILE, TILE, TILE);
      }
    }
  }

  // 낮/밤: time 0 = 정오, 0.5 = 자정
  const light = 0.3 + 0.7 * (0.5 + 0.5 * Math.cos(state.time * Math.PI * 2));
  lastLight = light;

  fx.renderScene({
    source: scene,
    cam,
    light,
    lightPos: { x: px - cam.x, y: py - cam.y - (player.prone ? 2 : 5) },
    mode: state.mode,
    palette: PALETTES[state.palette],
    time: clock,
    uniforms: filters.uniforms('dither'),
  });
}
let lastLight = 1;

// 패스 2(필름). 그레인/먼지가 살아 있도록 매 프레임 호출
function present() {
  fx.present({
    time: clock,
    palette: PALETTES[state.palette],
    pixelRatio,
    uniforms: filters.uniforms('film'),
  });
}

function drawPlayer(px, py, inWater) {
  const frames = (player.prone ? PLAYER_PRONE : PLAYER)[player.dir];
  const rate = player.prone ? 5 : 8;   // 포복은 동작이 느리다
  const f = player.moving ? frames[Math.floor(player.anim * rate) % frames.length] : frames[0];
  const top = py - f.height + 1;
  const left = px - (f.width >> 1);
  if (inWater) {
    // 얕은 물: 아랫부분을 자르고 물결 표시 (엎드리면 1줄만)
    const cut = player.prone ? 1 : 2;
    ctx.drawImage(f, 0, 0, f.width, f.height - cut, left, top, f.width, f.height - cut);
    const w = Math.floor(clock * 4) & 1;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(left - 1 - w, py - cut, 2, 1);
    ctx.fillRect(left + f.width - 1 + w, py - cut, 2, 1);
  } else {
    ctx.drawImage(f, left, top);
  }
}

const hud = document.getElementById('hud');
let hudText = '';
function updateHud(light) {
  const modes = ['dither', 'quantize only', 'raw buffer'];
  const u = tileUnder();
  const t =
    `mode: ${modes[state.mode]}  |  palette: ${PALETTES[state.palette].name}  |  ` +
    `light: ${light.toFixed(2)}${state.cycle ? ' (cycling)' : ''}  |  fx: ${filters.preset}\n` +
    `tile ${u.tx},${u.ty}: ${u.t?.name ?? '-'} (h ${u.h.toFixed(2)})  |  ${player.prone ? 'prone' : 'standing'}  |  animals ${animals.length} (seed ${SEED})` +
    (map.warnings.length ? `  |  map warnings: ${map.warnings.length} (console)` : '');
  if (t !== hudText) hud.textContent = hudText = t;
}

// ── 루프 ───────────────────────────────────────────────────────
let last = performance.now();
let sceneStep = -1;
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  update(dt);   // 게임 로직은 항상 모니터 주사율로

  // 투로 찍기: 화면(씬)은 N fps로만 갱신 → 셀 애니메이션처럼 뚝뚝 끊기는 움직임
  const twos = filters.value('twos');
  const step = twos ? Math.floor(clock * twos) : -2;
  if (step !== sceneStep || step === -2) {
    sceneStep = step;
    renderScene();
  }
  present();
  updateHud(lastLight);
  requestAnimationFrame(frame);
}

await reloadMap(false);
if (map) requestAnimationFrame(frame);

// 디버그/스크린샷용
window.__bitrender = { player, state, filters, SEED, get map() { return map; }, get animals() { return animals; } };
