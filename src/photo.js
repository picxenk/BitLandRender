// ══════════════════════════════════════════════════════════════════
//  카메라 모드 조작 + 뷰파인더 UI + 앨범
//
//  조작 (카메라 모드)
//    W / S       줌 인 / 줌 아웃 (1x ~ 8x)
//    A / D, ← →  좌우 패닝 (바라보던 방향 ±90°). 줌이 클수록 느리게
//    ↑ / ↓       상하 기울이기
//    Space       촬영 (필름 36장)
//  손떨림: 줌이 클수록 커지고, 조작을 멈추고 기다리면 줄어든다. 엎드리면 더 안정적.
// ══════════════════════════════════════════════════════════════════

import { TILE } from './tiles.js';
import { LEVEL } from './camera3d.js';

const DEG = Math.PI / 180;
export const ZOOM_MIN = 1, ZOOM_MAX = 8;
const BASE_FOV = 60 * DEG;
const PAN_LIMIT = 90 * DEG;
const TILT_MIN = -30 * DEG, TILT_MAX = 40 * DEG;
const EYE_STAND = 9, EYE_PRONE = 3;
export const ROLL = 36;                 // 필름 한 롤

const DIR_YAW = { right: 0, down: Math.PI / 2, left: Math.PI, up: -Math.PI / 2 };
const YAW_DIR = ['right', 'down', 'left', 'up'];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ── 3x5 픽셀 폰트 ────────────────────────────────────────────────
const FONT = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111',
  4: '101101111001001', 5: '111100111001111', 6: '111100111101111', 7: '111001001001001',
  8: '111101111101111', 9: '111101111001111', x: '000101010101000', '.': '000000000000010',
  '/': '001001010100100', F: '111100110100100', U: '101101101101111', L: '100100100100111',
  ' ': '000000000000000',
};

function glyphs(ctx, str, x, y, color) {
  ctx.fillStyle = color;
  for (const ch of str) {
    const g = FONT[ch] || FONT[' '];
    for (let i = 0; i < 15; i++) if (g[i] === '1') ctx.fillRect(x + (i % 3), y + Math.floor(i / 3), 1, 1);
    x += 4;
  }
}
// 흰 테두리 + 검은 글자 → 밝은 하늘/어두운 땅 어디서나 보인다
function text(ctx, str, x, y) {
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) glyphs(ctx, str, x + dx, y + dy, '#fff');
  glyphs(ctx, str, x, y, '#000');
}
const textWidth = (s) => s.length * 4 - 1;

function outlined(ctx, x, y, w, h) {
  ctx.fillStyle = '#fff';
  ctx.fillRect(x - 1, y - 1, w + 2, h + 2);
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, w, h);
}

// ══════════════════════════════════════════════════════════════════
export function createCameraController() {
  const c = {
    base: 0, pan: 0, tilt: 0, zoom: 1, zoomT: 1,
    steady: 1, still: 0, eye: EYE_STAND, prone: false,
    t: 0, shutterT: 1, fullT: 0,
  };

  c.enter = (player) => {
    Object.assign(c, { base: DIR_YAW[player.dir], pan: 0, tilt: 0, zoom: 1, zoomT: 1, steady: 1, still: 0 });
    c.prone = player.prone;
    c.eye = player.prone ? EYE_PRONE : EYE_STAND;
    c.shutterT = 0;   // 들어올 때 셔터가 열리는 연출
  };

  // 카메라를 내릴 때 캐릭터가 바라볼 방향 (가장 가까운 4방향)
  c.facing = () => {
    const a = (((c.base + c.pan) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    return YAW_DIR[Math.round(a / (Math.PI / 2)) % 4];
  };

  c.update = (dt, keys, player) => {
    c.t += dt;
    const k = (...codes) => codes.some((x) => keys.has(x));
    let input = false;

    // 줌: 로그 스케일로 부드럽게
    if (k('KeyW')) { c.zoomT *= Math.exp(1.1 * dt); input = true; }
    if (k('KeyS')) { c.zoomT *= Math.exp(-1.1 * dt); input = true; }
    c.zoomT = clamp(c.zoomT, ZOOM_MIN, ZOOM_MAX);
    c.zoom = Math.exp(Math.log(c.zoom) + (Math.log(c.zoomT) - Math.log(c.zoom)) * Math.min(1, dt * 10));

    // 패닝/기울이기: 줌이 클수록 느리게
    const rate = (80 * DEG) / Math.pow(c.zoom, 0.75);
    const h = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0);
    const v = (k('ArrowUp') ? 1 : 0) - (k('ArrowDown') ? 1 : 0);
    if (h) { c.pan = clamp(c.pan + h * rate * dt, -PAN_LIMIT, PAN_LIMIT); input = true; }
    if (v) { c.tilt = clamp(c.tilt + v * rate * dt, TILT_MIN, TILT_MAX); input = true; }

    // 안정도: 조작을 멈추면 서서히 손떨림이 줄어든다 (최저 0.3)
    c.still = input ? 0 : c.still + dt;
    const target = input ? 1 : Math.max(0.3, 1 - c.still * 0.35);
    c.steady += (target - c.steady) * Math.min(1, dt * 3);

    c.prone = player.prone;
    c.eye += ((player.prone ? EYE_PRONE : EYE_STAND) - c.eye) * Math.min(1, dt * 6);
    c.shutterT += dt;
    c.fullT = Math.max(0, c.fullT - dt);
  };

  c.shake = () => {
    const amp = 0.0018 * c.zoom * c.steady * (c.prone ? 0.45 : 1);
    const t = c.t;
    return [
      amp * (Math.sin(t * 1.3 + 0.4) * 0.6 + Math.sin(t * 2.9 + 1.7) * 0.3 + Math.sin(t * 6.1 + 2.2) * 0.1),
      amp * (Math.sin(t * 1.1 + 2.5) * 0.6 + Math.sin(t * 3.7 + 0.3) * 0.3 + Math.sin(t * 7.3 + 1.1) * 0.1),
    ];
  };

  c.view = (player, map) => {
    const tx = Math.floor(player.x / TILE), ty = Math.floor(player.y / TILE);
    const ground = map.heightAt(tx, ty) * LEVEL;
    const [sx, sy] = c.shake();
    return {
      eye: [player.x, ground + c.eye, player.y],
      yaw: c.base + c.pan + sx,
      pitch: c.tilt + sy,
      fov: 2 * Math.atan(Math.tan(BASE_FOV / 2) / c.zoom),
    };
  };

  c.shutter = () => { c.shutterT = 0; };
  c.rollFull = () => { c.fullT = 1.2; };

  // 뷰파인더 UI (씬 버퍼 인코딩: 검정/흰색/강조 빨강)
  c.drawOverlay = (ctx, W, H, { count }) => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const m = 5, L = 10;

    // 네 모서리 브래킷
    for (const [x, y, sx, sy] of [[m, m, 1, 1], [W - m - 1, m, -1, 1], [m, H - m - 1, 1, -1], [W - m - 1, H - m - 1, -1, -1]]) {
      outlined(ctx, sx > 0 ? x : x - L + 1, y, L, 1);
      outlined(ctx, x, sy > 0 ? y : y - L + 1, 1, L);
    }
    // 중앙 조준점
    ctx.fillStyle = '#ff0000';
    const cx = W >> 1, cy = H >> 1;
    ctx.fillRect(cx - 3, cy, 2, 1); ctx.fillRect(cx + 2, cy, 2, 1);
    ctx.fillRect(cx, cy - 3, 1, 2); ctx.fillRect(cx, cy + 2, 1, 2);

    // 줌 배율 / 남은 필름
    text(ctx, 'x' + c.zoom.toFixed(1), m + 3, H - m - 9);
    const cnt = `${count}/${ROLL}`;
    text(ctx, cnt, W - m - 3 - textWidth(cnt), H - m - 9);

    // 안정도 표시 (3칸, 안정적일수록 많이 참)
    const bars = c.steady < 0.45 ? 3 : c.steady < 0.75 ? 2 : 1;
    for (let i = 0; i < 3; i++) {
      if (i < bars) outlined(ctx, m + 3 + i * 4, m + 3, 3, 3);
      else { ctx.fillStyle = '#fff'; ctx.fillRect(m + 3 + i * 4, m + 3, 3, 3); }
    }

    if (c.fullT > 0 && Math.floor(c.fullT * 6) & 1) text(ctx, 'FULL', cx - 7, H - m - 9);

    // 셔터 막: 위아래에서 닫혔다가 열린다
    const p = c.shutterT / 0.2;
    if (p < 1) {
      const cover = Math.round(Math.sin(p * Math.PI) * (H / 2 + 1));
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, cover);
      ctx.fillRect(0, H - cover, W, cover);
    }
  };

  return c;
}

// ══════════════════════════════════════════════════════════════════
//  앨범: 찍은 사진(디더가 끝난 160x144 4색 프레임)을 localStorage에 PNG로 보관
// ══════════════════════════════════════════════════════════════════
export function createAlbum(W, H) {
  const KEY = 'bitrender.photos';
  const list = [];   // { canvas, url, t, zoom }

  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(list.map(({ url, t, zoom }) => ({ url, t, zoom }))));
    } catch (e) {
      console.warn('앨범 저장 실패', e);
    }
  };

  const toCanvas = (src) => {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const x = cv.getContext('2d');
    if (src instanceof ImageData) x.putImageData(src, 0, 0);
    else x.drawImage(src, 0, 0);
    return cv;
  };

  return {
    get count() { return list.length; },
    get full() { return list.length >= ROLL; },
    get: (i) => list[i],

    async load() {
      let saved = [];
      try { saved = JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { saved = []; }
      for (const p of saved) {
        const img = new Image();
        img.src = p.url;
        try { await img.decode(); } catch { continue; }
        list.push({ ...p, canvas: toCanvas(img) });
      }
    },

    add(imageData, meta) {
      if (list.length >= ROLL) return false;
      const canvas = toCanvas(imageData);
      list.push({ canvas, url: canvas.toDataURL('image/png'), t: Date.now(), ...meta });
      save();
      return true;
    },

    remove(i) {
      list.splice(i, 1);
      save();
    },

    // PNG 다운로드
    //   filmed: 필름 필터가 입혀진 ImageData (postfx.renderFilm) → 그대로 저장
    //   없으면: 원본 4색 프레임을 scale 배 확대(nearest)해서 저장
    download(i, filmed = null, scale = 4) {
      const p = list[i];
      if (!p) return;
      const cv = document.createElement('canvas');
      const x = cv.getContext('2d');
      if (filmed) {
        cv.width = filmed.width;
        cv.height = filmed.height;
        x.putImageData(filmed, 0, 0);
      } else {
        cv.width = W * scale;
        cv.height = H * scale;
        x.imageSmoothingEnabled = false;
        x.drawImage(p.canvas, 0, 0, cv.width, cv.height);
      }
      const a = document.createElement('a');
      a.href = cv.toDataURL('image/png');
      const stamp = new Date(p.t).toISOString().replace(/[:.]/g, '-');
      a.download = `bitrender-${stamp}${filmed ? '' : '-raw'}.png`;
      a.click();
    },
  };
}
