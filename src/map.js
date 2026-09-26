// 아스키 맵 → 게임 데이터
//   1) 파싱: [terrain] / [objects] 두 레이어
//   2) 파생: 높이(계단 자동 계산), 절벽면, 이동 가능 여부
//   3) 정적 배경 미리 그리기 (지형 + 절벽 + 그림자 + 납작한 장식)
//   4) 충돌 판정

import {
  TILE, TERRAIN, OBJECTS, drawFaceRun, drawCliffShadow, drawRim, objectImage, variantCount,
} from './tiles.js';
import { hash } from './util.js';

export async function loadMap(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`맵을 불러올 수 없습니다: ${url} (${res.status})`);
  return buildMap(parseMap(await res.text()));
}

// ── 1) 파싱 ─────────────────────────────────────────────────────
// 규칙: "//"로 시작하는 줄은 주석, 빈 줄은 무시, [이름] 으로 레이어 시작
export function parseMap(text) {
  const layers = {};
  let cur = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line || line.startsWith('//')) continue;
    const m = line.match(/^\[(\w+)\]$/);
    if (m) { cur = layers[m[1]] = []; continue; }
    if (cur) cur.push(line);
  }
  if (!layers.terrain) throw new Error('[terrain] 섹션이 없습니다.');
  return { terrain: layers.terrain, objects: layers.objects || [] };
}

// ── 2) 파생 데이터 + 3) 배경 ──────────────────────────────────────
export function buildMap({ terrain, objects: objRows }) {
  const H = terrain.length;
  const W = Math.max(...terrain.map((r) => r.length));
  const N = W * H;
  const warnings = [];

  const tiles = new Array(N);
  const height = new Float32Array(N);
  const face = new Uint8Array(N);
  const solid = new Uint8Array(N);
  const walk = new Uint8Array(N);
  const idx = (x, y) => y * W + x;
  const inBounds = (x, y) => x >= 0 && y >= 0 && x < W && y < H;

  // 지형
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const ch = terrain[y][x] ?? '.';
      let def = TERRAIN[ch];
      if (!def) { warnings.push(`terrain '${ch}' @${x},${y}`); def = TERRAIN['.']; }
      tiles[idx(x, y)] = def;
      height[idx(x, y)] = def.h ?? NaN;
    }
  }

  // 계단 높이: 같은 열에서 위/아래로 이어진 계단 묶음을 찾아 양 끝 높이 사이를 보간
  for (let x = 0; x < W; x++) {
    for (let y = 0; y < H; y++) {
      if (tiles[idx(x, y)].h !== null) continue;
      let y1 = y;
      while (y1 < H && tiles[idx(x, y1)].h === null) y1++;
      const hN = y > 0 ? height[idx(x, y - 1)] : NaN;
      const hS = y1 < H ? height[idx(x, y1)] : NaN;
      const top = isNaN(hN) ? hS : hN;
      const bot = isNaN(hS) ? hN : hS;
      const n = y1 - y;
      for (let k = 0; k < n; k++) {
        const i = n - k;                                   // 아래에서 몇 번째인지
        height[idx(x, y + k)] = (bot || 0) + ((top || 0) - (bot || 0)) * i / (n + 1);
      }
      y = y1;
    }
  }

  // 절벽면: 남쪽 k칸 아래가 k 이상 낮으면 절벽면 (높이차 1당 1줄)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = idx(x, y);
      if (tiles[i].h === null) continue;
      const h = height[i];
      for (let k = 1; k <= Math.ceil(h); k++) {
        if (inBounds(x, y + k) && height[idx(x, y + k)] <= h - k) { face[i] = 1; break; }
      }
    }
  }

  // 오브젝트
  const objects = [];   // y정렬 대상
  const flats = [];     // 바닥에 구울 것
  let spawn = null;
  for (let y = 0; y < Math.min(H, objRows.length); y++) {
    const row = objRows[y];
    for (let x = 0; x < Math.min(W, row.length); x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      if (ch === '@') { spawn = { x: x * TILE + 4, y: y * TILE + 6 }; continue; }
      const def = OBJECTS[ch];
      if (!def) { warnings.push(`object '${ch}' @${x},${y}`); continue; }
      if (face[idx(x, y)]) warnings.push(`'${ch}' on cliff face @${x},${y}`);
      const o = {
        ch, def, tx: x, ty: y,
        x: x * TILE + 4 + Math.round((hash(x, y, 50) - 0.5) * 3),
        y: y * TILE + 7,
        v: Math.floor(hash(x, y, 51) * variantCount(def)),
      };
      if (def.solid) solid[idx(x, y)] = 1;
      (def.flat ? flats : objects).push(o);
    }
  }
  objects.sort((a, b) => a.y - b.y);

  for (let i = 0; i < N; i++) walk[i] = tiles[i].walk && !face[i] && !solid[i] ? 1 : 0;

  const map = {
    W, H, pxW: W * TILE, pxH: H * TILE, spawn, objects, warnings,
    inBounds,
    terrainAt: (x, y) => (inBounds(x, y) ? tiles[idx(x, y)] : null),
    heightAt: (x, y) => (inBounds(x, y) ? height[idx(x, y)] : 0),
    isFace: (x, y) => inBounds(x, y) && face[idx(x, y)] === 1,
    walkable: (x, y) => inBounds(x, y) && walk[idx(x, y)] === 1,
    tileAtPx: (px, py) => [Math.floor(px / TILE), Math.floor(py / TILE)],
  };

  // 발 박스(6x3px)가 걸치는 모든 타일이 이동 가능 + 현재 높이와 차이가 1 미만이어야 한다.
  // 이 규칙 하나로 "언덕 옆으로는 못 오르고 계단으로만 오르내리기"가 된다.
  map.canOccupy = (px, py, hc) => {
    const x0 = Math.floor((px - 3) / TILE), x1 = Math.floor((px + 2) / TILE);
    const y0 = Math.floor((py - 2) / TILE), y1 = Math.floor(py / TILE);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!map.walkable(tx, ty)) return false;
        if (Math.abs(map.heightAt(tx, ty) - hc) >= 1) return false;
      }
    }
    return true;
  };

  if (!spawn) {
    const i = walk.indexOf(1);
    map.spawn = { x: (i % W) * TILE + 4, y: Math.floor(i / W) * TILE + 6 };
  }

  map.ground = renderGround(map, face, flats);
  // 3D 카메라 뷰용 바닥: 절벽면을 그리지 않는다 (3D에서는 절벽이 실제 벽으로 선다)
  map.floor = renderGround(map, face, flats, { floor: true });
  return map;
}

function renderGround(map, face, flats, { floor = false } = {}) {
  const cv = document.createElement('canvas');
  cv.width = map.pxW;
  cv.height = map.pxH;
  const ctx = cv.getContext('2d');
  const each = (fn) => {
    for (let ty = 0; ty < map.H; ty++) for (let tx = 0; tx < map.W; tx++) fn(tx, ty);
  };
  const c = (tx, ty) => ({ tx, ty, map });

  // 1차 채색 → 2차 장식 → 언덕 가장자리
  each((tx, ty) => map.terrainAt(tx, ty).base(ctx, tx * TILE, ty * TILE, c(tx, ty)));
  each((tx, ty) => map.terrainAt(tx, ty).overlay?.(ctx, tx * TILE, ty * TILE, c(tx, ty)));
  each((tx, ty) => { if (floor || !map.isFace(tx, ty)) drawRim(ctx, tx, ty, map); });

  // 절벽면(세로 run 단위) + 그 아래 그림자
  for (let tx = 0; tx < map.W; tx++) {
    for (let ty = 0; ty < map.H; ty++) {
      if (!face[ty * map.W + tx]) continue;
      let t1 = ty;
      while (t1 < map.H && face[t1 * map.W + tx]) t1++;
      if (!floor) drawFaceRun(ctx, tx, ty, t1 - ty, map);
      if (t1 < map.H) drawCliffShadow(ctx, tx, t1);
      ty = t1;
    }
  }

  // 오브젝트 그림자 + 납작한 장식
  for (const o of map.objects) {
    if (o.def.shadow) shadow(ctx, o.x + 1, o.y, ...o.def.shadow);
  }
  for (const o of flats) drawObject(ctx, o);
  return cv;
}

function shadow(ctx, x, y, rx, ry, a) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(1, ry / rx);
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
  g.addColorStop(0, `rgba(0,0,0,${a})`);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, rx, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

export function drawObject(ctx, o) {
  const img = objectImage(o.ch, o.v);
  ctx.drawImage(img.canvas, o.x - img.ax, o.y - img.ay);
}

export { shadow as drawShadow };
