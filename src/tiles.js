// ══════════════════════════════════════════════════════════════════
//  타일 / 오브젝트 레지스트리
//  맵 파일(maps/*.txt)의 글자 하나가 여기의 항목 하나에 대응한다.
//  새 지형이나 아이템을 추가하려면 이 파일에 항목만 추가하면 된다.
//
//  씬 버퍼 규칙(postfx.js 참고): 색 대신 "명도(회색)" + "강조(빨강)"만 쓴다.
//    #000 어두움 · #808080 중간 · #fff 밝음 · 그 사이 값/그라데이션은 디더가 된다.
// ══════════════════════════════════════════════════════════════════

import { makeSprite } from './sprites.js';
import { hash, rng } from './util.js';

export const TILE = 8;

// ─────────────────────────────────────────────────────────────────
//  지형 (terrain 레이어)
//    walk  : 이동 가능 여부
//    h     : 높이 단계. null = 계단(위아래 지형에서 자동 계산)
//    speed : 이동 속도 배율 (기본 1)
//    water : 물 계열 (캐릭터 발이 잠기고 그림자 없음)
//    base(ctx, x, y, c)    : 정적 1차 채색 (타일 안쪽만)
//    overlay(ctx, x, y, c) : 정적 2차 장식 (이웃 타일로 번져도 됨)
//    anim(ctx, x, y, c, t) : 매 프레임 그리는 애니메이션
//  c = { tx, ty, map }
//
//  언덕 규칙: 높이가 낮은 타일과 남쪽으로 맞닿은 줄이 자동으로 "절벽면"이 된다.
//             (높이 차 1당 1줄. 절벽면은 이동 불가)
//             높이 차가 1 이상이면 옆으로도 오를 수 없다 → 계단 '^'으로만 오르내린다.
// ─────────────────────────────────────────────────────────────────
export const TERRAIN = {
  '.': { name: 'grass',   walk: true,  h: 0, base: grass },
  ',': { name: 'meadow',  walk: true,  h: 0, base: grass, overlay: meadow },
  ':': { name: 'dirt',    walk: true,  h: 0, base: dirt },
  '-': { name: 'shallow', walk: true,  h: 0, base: shallow, anim: shallowAnim, speed: 0.55, water: true },
  '~': { name: 'water',   walk: false, h: 0, base: water, anim: waterAnim, water: true },
  '1': { name: 'hill 1',  walk: true,  h: 1, base: grass },
  '2': { name: 'hill 2',  walk: true,  h: 2, base: grass },
  '^': { name: 'stairs',  walk: true,  h: null, base: stairs },
};

// ─────────────────────────────────────────────────────────────────
//  오브젝트 (objects 레이어). '.' = 비어 있음, '@' = 시작 위치
//    solid  : 캐릭터가 통과할 수 없음 (해당 타일 차단)
//    flat   : 바닥에 붙은 장식 → 배경에 구워지고 y정렬하지 않음
//    shadow : [가로반경, 세로반경, 진하기] 바닥에 구워지는 그림자
//    sprite / sprites : 아스키 픽셀아트 (k m l r .)  — 가장 쉬운 추가 방법
//    draw(ctx, x, y, r)  : 절차적 그리기. (x,y) = 발 위치, r() = 난수
//    variants : draw 방식일 때 미리 만들어 둘 변형 개수 (기본 4)
// ─────────────────────────────────────────────────────────────────
export const OBJECTS = {
  'T': { name: 'big tree 1',    solid: true, shadow: [16, 5, 0.5],   draw: bigTree },
  'Y': { name: 'big tree 2',    solid: true, shadow: [12, 4, 0.5],   draw: bigPine },
  't': { name: 'small tree 1',  solid: true, shadow: [8, 3, 0.45],   draw: smallTree },
  'y': { name: 'small tree 2',  solid: true, shadow: [7, 2.5, 0.45], draw: smallPine },
  'd': { name: 'dead tree',     solid: true, shadow: [7, 2.5, 0.4],  sprite: [
    'k.........k',
    '.k...k...k.',
    '..k..k..k..',
    '...k.k.k...',
    'k...kkk...k',
    '.k...k...k.',
    '..kk.k.kk..',
    '....kkk....',
    '.....k.....',
    '.....k.....',
    '.....kk....',
    '....kk.....',
    '.....k.....',
    '....kkk....',
    '...kk.kk...',
  ] },
  'b': { name: 'bush',          solid: true, shadow: [7, 2.5, 0.45], draw: bush },
  'o': { name: 'rock',          solid: true, shadow: [6, 2, 0.4],    draw: rock(3) },
  'O': { name: 'boulder',       solid: true, shadow: [10, 3.5, 0.45], draw: rock(7) },
  's': { name: 'stump',         solid: true, shadow: [5, 2, 0.4],    sprite: [
    '.mmmm.',
    'mllllm',
    'kmmmmk',
    'kmkmmk',
    'kkmkmk',
    'kkkkkk',
  ] },
  '=': { name: 'log',           solid: true, shadow: [9, 2, 0.4],    sprite: [
    '.kkkkkkkkkk.',
    'kmmmmmmmmmlk',
    'kmkmmmmkmmlk',
    'kmmmmmmmmmlk',
    '.kkkkkkkkkk.',
  ] },
  '+': { name: 'grave',         solid: true, shadow: [4, 1.5, 0.35], sprite: [
    '..r..',
    'rrrrr',
    '..r..',
    '..r..',
    '..r..',
    '..r..',
  ] },
  '|': { name: 'reeds',         solid: false, sprites: [
    ['..m..', 'k.m..', 'k.m.m', 'k.mkm', '.kmkm', '.kmk.'],
    ['m...k', 'm.k.k', 'mkk.k', 'mk.mk', '.kkm.'],
  ] },
  '"': { name: 'grass tuft',    solid: false, flat: true, sprites: [
    ['m...m', '.m.m.', '.mmm.'],
    ['.m.', 'm.m', '.m.'],
    ['m.m.m', 'mmmmm'],
  ] },
  '*': { name: 'flowers',       solid: false, flat: true, draw: flowers },
  'p': { name: 'lily pad',      solid: false, flat: true, draw: lily },
};

// ══════════════════════════════════════════════════════════════════
//  지형 그리기
// ══════════════════════════════════════════════════════════════════
function px(ctx, color, x, y, w = 1, h = 1) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

function grass(ctx, x, y, c) {
  px(ctx, '#ffffff', x, y, TILE, TILE);
  px(ctx, '#808080', x + (c.ty & 1 ? 4 : 0), y);   // 엇갈린 점 격자
}

function meadow(ctx, x, y, c) {
  const jx = (hash(c.tx, c.ty, 7) - 0.5) * 3;
  const jy = (hash(c.tx, c.ty, 8) - 0.5) * 3;
  const g = ctx.createRadialGradient(x + 4 + jx, y + 4 + jy, 0, x + 4 + jx, y + 4 + jy, 7.5);
  g.addColorStop(0, 'rgba(0,0,0,0.26)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - 4, y - 4, 16, 16);
  if (hash(c.tx, c.ty, 9) < 0.6) {                 // 작은 'v' 풀 자국
    const vx = x + 1 + Math.floor(hash(c.tx, c.ty, 10) * 5);
    const vy = y + 2 + Math.floor(hash(c.tx, c.ty, 11) * 4);
    px(ctx, '#808080', vx, vy); px(ctx, '#808080', vx + 2, vy); px(ctx, '#808080', vx + 1, vy + 1);
  }
}

function dirt(ctx, x, y) {
  // 0.92 명도 → Bayer 디더가 고르고 성긴 점무늬를 만든다 + 드문 자갈
  px(ctx, '#ebebeb', x, y, TILE, TILE);
  for (let j = 0; j < TILE; j++) {
    for (let i = 0; i < TILE; i++) {
      const h = hash(x + i, y + j, 21);
      if (h < 0.035) px(ctx, '#808080', x + i, y + j);
      else if (h > 0.992) px(ctx, '#303030', x + i, y + j);
    }
  }
}

function isWater(c, dx, dy) {
  const t = c.map.terrainAt(c.tx + dx, c.ty + dy);
  return !t || t.water;
}

function waterEdges(ctx, x, y, c, bank, rim) {
  if (!isWater(c, 0, -1)) px(ctx, bank, x, y, TILE, 2);         // 북쪽 둑 (3/4 시점의 흙벽)
  if (!isWater(c, -1, 0)) px(ctx, rim, x, y, 1, TILE);
  if (!isWater(c, 1, 0))  px(ctx, rim, x + TILE - 1, y, 1, TILE);
  if (!isWater(c, 0, 1))  px(ctx, rim, x, y + TILE - 1, TILE, 1);
}

function water(ctx, x, y, c) {
  px(ctx, '#666666', x, y, TILE, TILE);
  waterEdges(ctx, x, y, c, '#1a1a1a', '#b0b0b0');
}

function shallow(ctx, x, y, c) {
  px(ctx, '#cfcfcf', x, y, TILE, TILE);
  waterEdges(ctx, x, y, c, '#707070', '#ffffff');
}

function waterAnim(ctx, x, y, c, t) {
  const ph = hash(c.tx, c.ty, 31);
  if ((t * 0.45 + ph) % 1 > 0.4) return;
  const ox = Math.floor(t * 2 + ph * 8) % 6;
  const oy = 2 + Math.floor(hash(c.tx, c.ty, 32) * 5);
  px(ctx, '#ffffff', x + ox, y + oy, 3, 1);
}

function shallowAnim(ctx, x, y, c, t) {
  const ph = hash(c.tx, c.ty, 33);
  if ((t * 0.6 + ph) % 1 > 0.5) return;
  const ox = 1 + Math.floor(ph * 5);
  const oy = 2 + Math.floor(hash(c.tx, c.ty, 34) * 5);
  px(ctx, '#8a8a8a', x + ox, y + oy, 2, 1);
}

function stairs(ctx, x, y) {
  px(ctx, '#a0a0a0', x, y, TILE, TILE);
  for (let i = 0; i < TILE; i += 2) {
    px(ctx, '#f0f0f0', x, y + i, TILE, 1);
    px(ctx, '#505050', x, y + i + 1, TILE, 1);
  }
  px(ctx, '#303030', x, y, 1, TILE);
  px(ctx, '#303030', x + TILE - 1, y, 1, TILE);
}

// ── 높이에서 파생되는 장식 (map.js가 호출) ────────────────────────
// 절벽면: 세로로 이어진 run 전체에 하나의 그라데이션 → 2단 절벽도 자연스럽게
export function drawFaceRun(ctx, tx, ty0, n, map) {
  const x = tx * TILE, y0 = ty0 * TILE, hgt = n * TILE;
  const g = ctx.createLinearGradient(0, y0, 0, y0 + hgt);
  g.addColorStop(0, '#d8d8d8');
  g.addColorStop(0.5, '#8a8a8a');
  g.addColorStop(1, '#2a2a2a');
  ctx.fillStyle = g;
  ctx.fillRect(x, y0, TILE, hgt);
  px(ctx, '#ffffff', x, y0, TILE, 1);                        // 윗 모서리
  px(ctx, '#101010', x, y0 + hgt - 1, TILE, 1);              // 밑동
  for (let k = 0; k < n; k++) {                              // 균열
    const r = rng(tx * 7919 + (ty0 + k) * 104729);
    for (let i = 0; i < 2; i++) {
      const cx = x + 1 + Math.floor(r() * 6);
      const cy = y0 + k * TILE + 1 + Math.floor(r() * 3);
      px(ctx, '#303030', cx, cy, 1, 2 + Math.floor(r() * 4));
    }
  }
  const side = (dx) => {
    for (let k = 0; k < n; k++) if (!map.isFace(tx + dx, ty0 + k)) return true;
    return false;
  };
  if (side(-1)) px(ctx, '#202020', x, y0, 1, hgt);
  if (side(1))  px(ctx, '#202020', x + TILE - 1, y0, 1, hgt);
}

// 절벽 아래 바닥에 떨어지는 그림자
export function drawCliffShadow(ctx, tx, ty) {
  const x = tx * TILE, y = ty * TILE;
  const g = ctx.createLinearGradient(0, y, 0, y + 6);
  g.addColorStop(0, 'rgba(0,0,0,0.45)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x, y, TILE, 6);
}

// 언덕 윗면 가장자리(북/서/동쪽이 더 낮을 때)
export function drawRim(ctx, tx, ty, map) {
  const h = map.heightAt(tx, ty);
  const lower = (dx, dy) => {
    if (!map.inBounds(tx + dx, ty + dy)) return false;
    const t = map.terrainAt(tx + dx, ty + dy);
    return t.h !== null && map.heightAt(tx + dx, ty + dy) <= h - 1;
  };
  const x = tx * TILE, y = ty * TILE;
  if (lower(0, -1)) px(ctx, '#808080', x, y, TILE, 1);
  if (lower(-1, 0)) px(ctx, '#808080', x, y, 1, TILE);
  if (lower(1, 0)) {
    px(ctx, '#404040', x + TILE - 1, y, 1, TILE);
    // 빛이 왼쪽 위에서 온다고 보고, 동쪽 낮은 땅에 옆그림자
    const g = ctx.createLinearGradient(x + TILE, 0, x + TILE + 5, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(x + TILE, y, 5, TILE);
  }
}

// ══════════════════════════════════════════════════════════════════
//  오브젝트 그리기
// ══════════════════════════════════════════════════════════════════
// 방사형 그라데이션 원 여러 개 = 잎 덩어리. 아래쪽 원이 앞에 오도록 정렬.
function blobs(ctx, r, cx, cy, sx, sy, n, rmin, rmax) {
  const list = [];
  for (let i = 0; i < n; i++) {
    list.push({ x: cx + (r() - 0.5) * sx, y: cy + (r() - 0.5) * sy, rad: rmin + r() * (rmax - rmin) });
  }
  list.sort((a, b) => a.y - b.y);
  for (const b of list) {
    const g = ctx.createRadialGradient(b.x - b.rad * 0.4, b.y - b.rad * 0.5, 0, b.x, b.y, b.rad);
    g.addColorStop(0, '#f0f0f0');
    g.addColorStop(0.55, '#909090');
    g.addColorStop(1, '#383838');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.rad, 0, Math.PI * 2);
    ctx.fill();
  }
  return list;
}

function berries(ctx, r, cx, cy, sx, sy, n) {
  for (let i = 0; i < n; i++) {
    px(ctx, '#ff0000', Math.round(cx + (r() - 0.5) * sx), Math.round(cy + (r() - 0.5) * sy));
  }
}

function bigTree(ctx, x, y, r) {
  px(ctx, '#000', x - 1, y - 14, 2, 15);
  px(ctx, '#000', x - 2, y, 4, 1);
  px(ctx, '#000', x - 4, y - 18, 1, 4);
  px(ctx, '#000', x - 3, y - 15, 2, 1);
  px(ctx, '#000', x + 2, y - 20, 1, 6);
  blobs(ctx, r, x, y - 25, 18, 12, 6 + Math.floor(r() * 2), 6, 10);
  if (r() < 0.5) berries(ctx, r, x, y - 25, 18, 12, 4);
}

function pine(ctx, r, x, y, tiers) {
  for (const t of tiers) {
    const w = t.w + (r() - 0.5) * 2;
    const g = ctx.createLinearGradient(x - w / 2, 0, x + w / 2, 0);
    g.addColorStop(0, '#f0f0f0');
    g.addColorStop(0.5, '#8a8a8a');
    g.addColorStop(1, '#262626');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(x, y - t.b - t.h);
    ctx.lineTo(x + w / 2, y - t.b);
    ctx.lineTo(x - w / 2, y - t.b);
    ctx.closePath();
    ctx.fill();
  }
}

function bigPine(ctx, x, y, r) {
  px(ctx, '#000', x - 1, y - 6, 2, 7);
  pine(ctx, r, x, y, [{ b: 4, h: 16, w: 20 }, { b: 13, h: 14, w: 16 }, { b: 21, h: 12, w: 11 }]);
}

function smallTree(ctx, x, y, r) {
  px(ctx, '#000', x, y - 7, 1, 8);
  blobs(ctx, r, x, y - 11, 8, 5, 3, 3, 5);
}

function smallPine(ctx, x, y, r) {
  px(ctx, '#000', x, y - 3, 1, 4);
  pine(ctx, r, x, y, [{ b: 2, h: 9, w: 10 }, { b: 7, h: 8, w: 7 }]);
}

function bush(ctx, x, y, r) {
  blobs(ctx, r, x, y - 4, 10, 3, 4, 3, 4.5);
  if (r() < 0.5) berries(ctx, r, x, y - 4, 9, 4, 3);
}

function rock(size) {
  return (ctx, x, y, r) => {
    const s = size + r() * 1.5;
    ctx.save();
    ctx.translate(x, y - s * 0.6);
    ctx.scale(1, 0.7);
    const g = ctx.createLinearGradient(-s, -s, s * 0.5, s);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(1, '#202020');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, s, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };
}

function flowers(ctx, x, y, r) {
  const n = 1 + Math.floor(r() * 3);
  for (let i = 0; i < n; i++) {
    const fx = x - 3 + Math.floor(r() * 6), fy = y - 5 + Math.floor(r() * 4);
    px(ctx, '#ff0000', fx, fy, 2, 1);
    px(ctx, '#ff0000', fx, fy - 1);
    px(ctx, '#808080', fx + 1, fy + 1);
  }
}

function lily(ctx, x, y, r) {
  ctx.fillStyle = '#e0e0e0';
  ctx.beginPath();
  ctx.ellipse(x, y - 3, 3, 1.6, 0, 0, Math.PI * 2);
  ctx.fill();
  px(ctx, '#666666', x, y - 4, 1, 1);
  if (r() < 0.35) px(ctx, '#ff0000', x - 1, y - 4, 1, 1);
}

// ══════════════════════════════════════════════════════════════════
//  오브젝트 이미지 캐시: 종류 × 변형마다 한 번만 그린다
// ══════════════════════════════════════════════════════════════════
const CANVAS = 72, AX = 36, AY = 64;   // 캐시 캔버스 크기와 발 위치
const cache = new Map();

for (const def of Object.values(OBJECTS)) {
  if (def.sprite) def.images = [spriteImage(def.sprite)];
  else if (def.sprites) def.images = def.sprites.map(spriteImage);
}

function spriteImage(rows) {
  const c = makeSprite(rows);
  return { canvas: c, ax: c.width >> 1, ay: c.height };
}

export function variantCount(def) {
  return def.images ? def.images.length : def.variants || 4;
}

export function objectImage(ch, v) {
  const def = OBJECTS[ch];
  if (def.images) return def.images[v % def.images.length];
  const key = ch + v;
  let img = cache.get(key);
  if (!img) {
    const c = document.createElement('canvas');
    c.width = c.height = CANVAS;
    def.draw(c.getContext('2d'), AX, AY, rng(ch.charCodeAt(0) * 131 + v * 7919 + 1));
    img = { canvas: c, ax: AX, ay: AY };
    cache.set(key, img);
  }
  return img;
}
