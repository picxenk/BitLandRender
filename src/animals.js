// ══════════════════════════════════════════════════════════════════
//  동물
//  - SPECIES: 종별 설정 (수, 무리, 속도, 예민도, 서식지, 스프라이트)
//  - spawnAnimals: 시작할 때 서식지에 맞춰 랜덤 배치 (seed 로 재현 가능)
//  - updateAnimals: 종별 행동 (배회/풀뜯기/경계/도망/비행/따라오기)
//  - drawAnimal / drawAnimalShadow: 렌더링
//
//  예민도 = 두 개의 반경
//    alert : 이 안에 들어오면 멈춰서 캐릭터를 바라본다 (경계)
//    flee  : 이 안에 들어오면 도망친다 (날 수 있는 종은 날아간다)
//  herd  : 한 마리가 놀라면 이 반경 안의 같은 종도 같이 도망친다
// ══════════════════════════════════════════════════════════════════

import { makeSprite } from './sprites.js';
import { TILE } from './tiles.js';
import { rng as makeRng } from './util.js';

// ── 스프라이트 (오른쪽을 보는 모습. 왼쪽은 자동 좌우반전) ────────────
//   k 어두움 · m 중간 · l 밝음 · r 강조색 · . 투명 — 맨 아래 행이 발
const SPARROW = {
  stand: ['...kk', '.mmmk', 'kmmm.', '..k..'],
  peck:  ['.....', '.mmk.', 'kmmmk', '..k.k'],
  flyA:  ['kk...kk', '..kmk..', '..mmmk.', '.......'],
  flyB:  ['.......', '..mmmk.', '.kkmkk.', 'k.....k'],
};

// 몸통을 밝게 → 회색 물 위에서도 보이도록 (헤엄칠 때 아래 2줄은 잠김)
const DUCK_TOP = ['.....kk.', '.....kkr', 'k....l..', 'klllllm.', '.mmmmmm.'];
const MALLARD = {
  stand: [...DUCK_TOP, '..k..k..'],
  walkA: [...DUCK_TOP, '...k.k..'],
  walkB: [...DUCK_TOP, '..k...k.'],
  flyA:  ['..k.k....', '...kk..kk', 'klllllmkr', '.........'],
  flyB:  ['.......kk', 'klllllmkr', '...kk....', '..k.k....'],
};

const RABBIT = {
  sit: ['....mm.', '....mm.', '...mkmm', 'lmmmmm.', 'mmmmmm.', '.kk.kk.'],
  hop: ['.....mm', '....mm.', '.lmmmkm', 'mmmmmm.', 'k.....k', '.......'],
};

function dogRows(tailUp, legs) {
  return [
    '.......k..',
    (tailUp ? 'k' : '.') + '.....kmmk',
    (tailUp ? '.' : 'k') + '.....mmm.',
    '.mmmmmmm..',
    '.mmmmmmm..',
    ...legs,
  ];
}
const DOG_LEGS = {
  stand: ['.k.k..k.k.', '.k.k..k.k.'],
  walkA: ['.k.k..k.k.', 'k...k.k..k'],
  walkB: ['..kk...kk.', '..kk...kk.'],
};
const DOG = {
  sit: ['.......k..', '......kmmk', '......mmm.', '...mmmmm..', '..mmmmmm..', 'kmmmmmk.k.', '.kk...k.k.'],
};
for (const [k, legs] of Object.entries(DOG_LEGS)) {
  DOG[k + '_u'] = dogRows(true, legs);    // 꼬리 위
  DOG[k + '_d'] = dogRows(false, legs);   // 꼬리 아래 (흔들기)
}

const DEER_TOP = ['.......k.k..', '........kk..', '........mmmk', '........mm..', '.......mm...'];
const DEER_BODY = ['lmmmmmmmm...', '.mmmmmmmm...', '.mmmmmmm....'];
const DEER = {
  stand: [...DEER_TOP, ...DEER_BODY, '.k.k...k.k..', '.k.k...k.k..', '.k.k...k.k..'],
  runA:  [...DEER_TOP, ...DEER_BODY, '.kk.....kk..', 'k..k...k..k.', 'k...k.k....k'],
  runB:  [...DEER_TOP, ...DEER_BODY, '..kk...kk...', '..kk...kk...', '...k....k...'],
  graze: [
    '............', '............', '............', '............', '............',
    'lmmmmmmmm...', '.mmmmmmmmm..', '.mmmmmmm.mm.',
    '.k.k...k.kmk', '.k.k...k.k.k', '.k.k...k.k..',
  ],
};

const BEAR_TOP = [
  '..........k.k.',
  '.........kkkl.',
  '...kkk...kkkkm',
  '..kkkkkkkkkkk.',
  '.kkkkkkkkkkk..',
  'kkkkkkkkkkkk..',
  'kkkkkkkkkkkk..',
];
const BEAR = {
  stand: [...BEAR_TOP, '.kk.kk..kk.kk.', '.kk.kk..kk.kk.'],
  walkA: [...BEAR_TOP, 'kk..kk.kk..kk.', 'kk...kk.kk..kk'],
  walkB: [...BEAR_TOP, '..kkkk...kkkk.', '..kk.kk..kk.kk'],
};

const mirror = (rows) => rows.map((r) => [...r].reverse().join(''));
function sheet(src) {
  const out = {};
  for (const [k, rows0] of Object.entries(src)) {
    const w = Math.max(...rows0.map((r) => r.length));
    const rows = rows0.map((r) => r.padEnd(w, '.'));   // 줄 길이가 달라도 안전하게
    out[k] = { right: makeSprite(rows), left: makeSprite(mirror(rows)) };
  }
  return out;
}

// ── 종 정의 ─────────────────────────────────────────────────────
//  groups × group[min,max] 마리 / spread: 무리 퍼짐(px) / walk·run: px/s
//  habitat: land | grass | water / radius: 몸 반폭(충돌) / minDist: 시작점과 최소 거리
export const SPECIES = {
  sparrow: {
    label: '참새', groups: 3, group: [3, 5], spread: 12,
    walk: 10, flee: 26, herd: 32,
    fly: { speed: 48, cruise: 12, dist: [50, 110] },
    flyChance: 0.08,              // 초당 이유 없이 날아오를 확률 (자주 날아다님)
    habitat: 'land', radius: 0, shadow: [2.5, 1, 0.35], sprites: sheet(SPARROW),
  },
  mallard: {
    label: '청둥오리', groups: 3, group: [2, 3], spread: 10,
    walk: 6, flee: 44, herd: 36,
    fly: { speed: 54, cruise: 18, dist: [90, 260] },
    habitat: 'water', radius: 0, shadow: [4.5, 1.5, 0.4], sprites: sheet(MALLARD),
  },
  rabbit: {
    label: '토끼', groups: 5, group: [1, 1],
    walk: 12, run: 56, alert: 52, flee: 34,
    hop: true, graze: true,
    habitat: 'grass', radius: 1, shadow: [4, 1.5, 0.4], sprites: sheet(RABBIT),
  },
  dog: {
    label: '들개', groups: 1, group: [1, 1],   // 딱 1마리
    walk: 14, run: 44,
    friendly: { notice: 72, heel: 15 },   // notice 안에 들어오면 다가와서 heel 거리에서 따라다님
    habitat: 'land', radius: 2, shadow: [6, 2, 0.45], sprites: sheet(DOG),
  },
  deer: {
    label: '사슴', groups: 2, group: [2, 3], spread: 16,
    walk: 9, run: 62, alert: 84, flee: 58, herd: 48,
    graze: true,
    habitat: 'land', radius: 3, shadow: [7, 2.5, 0.45], sprites: sheet(DEER),
  },
  bear: {
    label: '곰', groups: 1, group: [1, 1],   // 딱 1마리
    walk: 6, run: 24, alert: 34, flee: 20,
    habitat: 'land', radius: 4, minDist: 110, shadow: [9, 3, 0.5], sprites: sheet(BEAR),
  },
};

// ══════════════════════════════════════════════════════════════════
//  서식지 / 이동 가능 판정
// ══════════════════════════════════════════════════════════════════
const GRASSY = new Set(['grass', 'meadow', 'hill 1', 'hill 2']);
const tileOf = (v) => Math.floor(v / TILE);

function nearWater(map, tx, ty) {
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) if (map.terrainAt(tx + i, ty + j)?.water) return true;
  }
  return false;
}

// 서식지(스폰/착지 위치) 판정
function habitatOk(map, sp, x, y) {
  const tx = tileOf(x), ty = tileOf(y);
  if (!map.inBounds(tx, ty)) return false;
  const t = map.terrainAt(tx, ty);
  if (sp.habitat === 'water') return !!t.water;
  if (!map.walkable(tx, ty) || t.water) return false;
  if (sp.habitat === 'grass') return GRASSY.has(t.name);
  return true;
}

// 걸어서 설 수 있는지: 몸 폭(radius)만큼 좌우도 검사, 높이 차 1 미만 (플레이어와 같은 규칙)
function canStand(map, a, x, y) {
  const r = a.sp.radius;
  const ty = tileOf(y);
  for (const ox of r ? [-r, 0, r] : [0]) {
    const tx = tileOf(x + ox);
    if (!map.inBounds(tx, ty)) return false;
    const t = map.terrainAt(tx, ty);
    if (a.sp.habitat === 'water') {
      // 오리: 물 위 + 물가 한 칸까지
      if (!t.water && !(map.walkable(tx, ty) && nearWater(map, tx, ty))) return false;
    } else if (!map.walkable(tx, ty) || t.water) {
      return false;
    }
    if (Math.abs(map.heightAt(tx, ty) - a.h) >= 1) return false;
  }
  return true;
}

// ══════════════════════════════════════════════════════════════════
//  스폰
// ══════════════════════════════════════════════════════════════════
function makeAnimal(kind, sp, p, map, r) {
  return {
    kind, sp, x: p.x, y: p.y, z: 0,
    h: map.heightAt(tileOf(p.x), tileOf(p.y)),
    face: r() < 0.5 ? 'left' : 'right',
    state: 'idle', t: r() * 2, anim: r() * 10,
    ang: r() * Math.PI * 2, moving: false, think: 0, jitter: 0, wag: false,
  };
}

function validSpot(map, sp, x, y) {
  if (!habitatOk(map, sp, x, y)) return false;
  const probe = { sp, h: map.heightAt(tileOf(x), tileOf(y)) };
  return canStand(map, probe, x, y);
}

function findSpot(map, sp, r, player, minDist) {
  for (let i = 0; i < 600; i++) {
    const x = (Math.floor(r() * map.W) + 0.5) * TILE;
    const y = (Math.floor(r() * map.H) + 0.6) * TILE;
    if (Math.hypot(x - player.x, y - player.y) < minDist) continue;
    if (validSpot(map, sp, x, y)) return { x, y };
  }
  return null;
}

export function spawnAnimals(map, player, seed) {
  const r = makeRng(seed);
  const out = [];
  for (const [kind, sp] of Object.entries(SPECIES)) {
    for (let g = 0; g < sp.groups; g++) {
      const c = findSpot(map, sp, r, player, sp.minDist ?? 56);
      if (!c) continue;
      const n = sp.group[0] + Math.floor(r() * (sp.group[1] - sp.group[0] + 1));
      for (let i = 0; i < n; i++) {
        let p = c;
        for (let k = 0; i > 0 && k < 30; k++) {
          const s = sp.spread || 8;
          const q = { x: c.x + (r() - 0.5) * 2 * s, y: c.y + (r() - 0.5) * 2 * s };
          if (validSpot(map, sp, q.x, q.y)) { p = q; break; }
        }
        out.push(makeAnimal(kind, sp, p, map, r));
      }
    }
  }
  return out;
}

// ══════════════════════════════════════════════════════════════════
//  행동
// ══════════════════════════════════════════════════════════════════
const rand = Math.random;

function setState(a, s, t) { a.state = s; a.t = t; }

// 한 프레임 이동 (축별 판정 → 벽을 따라 미끄러짐). 막혔으면 true
function step(map, a, vx, vy, dt) {
  const stuck = !canStand(map, a, a.x, a.y);   // 끼어 있으면 자유롭게 빠져나오게
  const nx = a.x + vx * dt, ny = a.y + vy * dt;
  const okX = stuck || canStand(map, a, nx, a.y);
  if (okX) a.x = nx;
  const okY = stuck || canStand(map, a, a.x, ny);
  if (okY) a.y = ny;
  a.moving = okX || okY;
  if (a.moving) a.h = map.heightAt(tileOf(a.x), tileOf(a.y));
  if (Math.abs(vx) > 0.5) a.face = vx > 0 ? 'right' : 'left';
  return !(okX && okY);
}

function moveAng(map, a, speed, dt) {
  return step(map, a, Math.cos(a.ang) * speed, Math.sin(a.ang) * speed, dt);
}

// 토끼: 깡충깡충. 이동은 뛰는 순간에만, z는 점프 높이
function hopFactor(a, rate) {
  const p = Math.max(0, Math.sin(a.anim * Math.PI * 2 * rate));
  a.z = p * 3;
  return p * 3;
}

// 막히지 않은 쪽으로 방향 찾기 (기준 각도에서 좌우로 넓혀가며)
function clearAngle(map, a, base) {
  for (const off of [0, 0.5, -0.5, 1.0, -1.0, 1.6, -1.6, 2.3, -2.3, 3.1]) {
    const ang = base + off;
    if (canStand(map, a, a.x + Math.cos(ang) * 8, a.y + Math.sin(ang) * 8)) return ang;
  }
  return base;
}

// ── 비행 ──
function pickFlightTarget(map, a, player) {
  const sp = a.sp;
  const [dmin, dmax] = sp.fly.dist;
  const away = Math.atan2(a.y - player.y, a.x - player.x);
  const scared = Math.hypot(a.x - player.x, a.y - player.y) < sp.flee * 1.5;
  let best = null, bestScore = -1;
  for (let i = 0; i < 40; i++) {
    let x, y;
    if (sp.habitat === 'water') {
      // 오리: 맵 전체에서 물 타일을 골라, 캐릭터에게서 먼 곳을 선호
      x = (Math.floor(rand() * map.W) + 0.5) * TILE;
      y = (Math.floor(rand() * map.H) + 0.6) * TILE;
      const d = Math.hypot(x - a.x, y - a.y);
      if (d < dmin * 0.5 || d > dmax) continue;
    } else {
      const ang = scared ? away + (rand() - 0.5) * 1.6 : rand() * Math.PI * 2;
      const dist = dmin + rand() * (dmax - dmin);
      x = a.x + Math.cos(ang) * dist;
      y = a.y + Math.sin(ang) * dist;
    }
    if (!validSpot(map, sp, x, y)) continue;
    const score = Math.hypot(x - player.x, y - player.y) + rand() * 40;
    if (!scared) return { x, y };
    if (score > bestScore) { best = { x, y }; bestScore = score; }
  }
  return best;
}

function takeOff(map, a, player) {
  const tgt = pickFlightTarget(map, a, player);
  if (!tgt) return false;
  a.state = 'fly';
  a.fx = tgt.x;
  a.fy = tgt.y;
  a.moving = true;
  return true;
}

function flyUpdate(a, dt, map) {
  const sp = a.sp;
  const dx = a.fx - a.x, dy = a.fy - a.y;
  const dist = Math.hypot(dx, dy);
  const speed = Math.min(sp.fly.speed, 6 + dist * 2.5);
  if (dist > 0.5) {
    a.x += (dx / dist) * speed * dt;
    a.y += (dy / dist) * speed * dt;
    if (Math.abs(dx) > 0.5) a.face = dx > 0 ? 'right' : 'left';
  }
  const zt = Math.min(sp.fly.cruise, dist * 0.45);
  a.z += (zt - a.z) * Math.min(1, dt * 4);
  if (dist < 1.2 && a.z < 0.4) {       // 착지 — 정확히 목표(검증된 위치)에 내린다
    a.x = a.fx;
    a.y = a.fy;
    a.z = 0;
    a.h = map.heightAt(tileOf(a.x), tileOf(a.y));
    a.moving = false;
    setState(a, 'idle', 1 + rand() * 2);
  }
}

// ── 놀람 전파 (무리) ──
function panic(a, list, map, player) {
  if (!a.sp.herd) return;
  for (const b of list) {
    if (b === a || b.kind !== a.kind || b.state === 'flee' || b.state === 'fly') continue;
    if (Math.hypot(b.x - a.x, b.y - a.y) > a.sp.herd) continue;
    if (b.sp.fly) takeOff(map, b, player);
    else startFlee(b);
  }
}

function startFlee(a) {
  setState(a, 'flee', 1.2);
  a.think = 0;
  a.jitter = (rand() - 0.5) * 0.9;
}

// ── 평상시: 쉬기 / 배회 / 풀뜯기 ──
function wander(a, dt, map) {
  const sp = a.sp;
  if (a.t <= 0) {
    const r = rand();
    if (r < 0.4) { setState(a, 'wander', 1 + rand() * 2.5); a.ang = rand() * Math.PI * 2; }
    else if (sp.graze && r < 0.75) setState(a, 'graze', 2 + rand() * 3);
    else setState(a, 'idle', 1 + rand() * 3);
  }
  a.moving = false;
  a.z = 0;
  if (a.state === 'wander') {
    const v = sp.hop ? sp.walk * hopFactor(a, 2.2) : sp.walk;
    if (moveAng(map, a, v, dt)) a.ang += Math.PI * (0.5 + rand());
    if (a.kind === 'sparrow') a.z = Math.abs(Math.sin(a.anim * 11)) * 1.5;   // 종종걸음
  }
}

export function updateAnimals(list, dt, map, player) {
  for (const a of list) {
    const sp = a.sp;
    a.t -= dt;
    a.anim += dt;
    const dx = a.x - player.x, dy = a.y - player.y;
    const d = Math.hypot(dx, dy);

    // 비행 중
    if (a.state === 'fly') { flyUpdate(a, dt, map); continue; }

    // 들개: 친근함 — 다가와서 따라다니고, 멈추면 옆에 앉는다
    if (sp.friendly) {
      const f = sp.friendly;
      a.wag = d < f.notice;
      if (d < f.notice && d > f.heel + 4) {
        a.state = 'follow';
        a.ang = clearAngle(map, a, Math.atan2(-dy, -dx));
        moveAng(map, a, d > 40 ? sp.run : sp.walk, dt);
      } else if (d <= f.heel + 4) {
        a.moving = false;
        a.face = player.x > a.x ? 'right' : 'left';
        if (a.state !== 'heel' && a.state !== 'sit') setState(a, 'heel', 1.5);
        if (player.moving) a.t = Math.max(a.t, 0.8);
        if (a.state === 'heel' && a.t <= 0) a.state = 'sit';
        if (a.state === 'sit' && player.moving) setState(a, 'heel', 0.8);
      } else {
        if (a.state === 'follow' || a.state === 'heel' || a.state === 'sit') setState(a, 'idle', 1);
        wander(a, dt, map);
      }
      continue;
    }

    // 새: 가까이 오면 날아간다 (+ 참새는 이유 없이도 자주 날아오름)
    if (sp.fly) {
      if (d < sp.flee) {
        if (takeOff(map, a, player)) panic(a, list, map, player);
        continue;
      }
      if (sp.flyChance && rand() < sp.flyChance * dt) {
        if (takeOff(map, a, player)) {
          // 무리 중 몇 마리는 따라 날아오른다
          for (const b of list) {
            if (b !== a && b.kind === a.kind && b.state !== 'fly' &&
                Math.hypot(b.x - a.x, b.y - a.y) < sp.herd && rand() < 0.6) takeOff(map, b, player);
          }
        }
        continue;
      }
      wander(a, dt, map);
      continue;
    }

    // 땅 동물: 경계 → 도망
    if (d < sp.flee && a.state !== 'flee') {
      startFlee(a);
      panic(a, list, map, player);
    }
    if (a.state === 'flee') {
      a.think -= dt;
      if (a.think <= 0) {
        a.ang = clearAngle(map, a, Math.atan2(dy, dx) + a.jitter);
        a.think = 0.3;
      }
      const v = sp.hop ? sp.run * hopFactor(a, 4.2) : sp.run;
      if (moveAng(map, a, v, dt)) a.think = 0;
      if (d > sp.flee * 2.2 && a.t <= 0) { a.z = 0; setState(a, 'idle', 1 + rand() * 2); }
      continue;
    }
    if (sp.alert && d < sp.alert) {
      if (a.state !== 'alert') setState(a, 'alert', 1.5);
      a.face = player.x > a.x ? 'right' : 'left';
      a.moving = false;
      a.z = 0;
      a.t = Math.max(a.t, 0.6);
      continue;
    }
    if (a.state === 'alert' && a.t > 0) continue;
    if (a.state === 'alert') setState(a, 'idle', 0.5);
    wander(a, dt, map);
  }
}

// ══════════════════════════════════════════════════════════════════
//  그리기
// ══════════════════════════════════════════════════════════════════
function frameKey(a) {
  const t = a.anim, flying = a.state === 'fly';
  switch (a.kind) {
    case 'sparrow':
      if (flying) return Math.floor(t * 14) & 1 ? 'flyA' : 'flyB';
      return a.state === 'idle' && Math.floor(t * 2.5) % 3 === 0 ? 'peck' : 'stand';
    case 'mallard':
      if (flying) return Math.floor(t * 8) & 1 ? 'flyA' : 'flyB';
      return a.moving ? (Math.floor(t * 4) & 1 ? 'walkA' : 'walkB') : 'stand';
    case 'rabbit':
      return a.z > 0.4 ? 'hop' : 'sit';
    case 'dog': {
      if (a.state === 'sit') return 'sit';
      const tail = a.wag && Math.floor(t * 7) & 1 ? '_d' : '_u';
      if (!a.moving) return 'stand' + tail;
      return (Math.floor(t * (a.state === 'follow' ? 10 : 6)) & 1 ? 'walkA' : 'walkB') + tail;
    }
    case 'deer':
      if (a.state === 'graze') return 'graze';
      if (!a.moving) return 'stand';
      if (a.state === 'flee') return Math.floor(t * 9) & 1 ? 'runA' : 'runB';
      return Math.floor(t * 4) & 1 ? 'stand' : 'runB';
    case 'bear':
      if (!a.moving) return 'stand';
      return Math.floor(t * (a.state === 'flee' ? 6 : 3)) & 1 ? 'walkA' : 'walkB';
  }
  return Object.keys(a.sp.sprites)[0];
}

// 3D 뷰용: 현재 프레임 스프라이트 (face = 화면 기준 'left' | 'right')
export function animalImage(a, face) {
  return a.sp.sprites[frameKey(a)][face];
}

export const isHigh = (a) => a.z > 5;   // 높이 나는 새는 모든 것 위에 그린다

export function drawAnimalShadow(ctx, a, drawShadow, map) {
  if (a.sp.habitat === 'water' && a.state !== 'fly' && map.terrainAt(tileOf(a.x), tileOf(a.y))?.water) return;
  const [rx, ry, al] = a.sp.shadow;
  const k = 1 / (1 + a.z * 0.06);
  drawShadow(ctx, Math.round(a.x), Math.round(a.y), rx * k, ry * k, al * k);
}

export function drawAnimal(ctx, a, map, clock) {
  const img = a.sp.sprites[frameKey(a)][a.face];
  const x = Math.round(a.x) - (img.width >> 1);
  const y = Math.round(a.y - a.z) - img.height + 1;
  const swimming = a.state !== 'fly' && a.z < 0.5 && map.terrainAt(tileOf(a.x), tileOf(a.y))?.water;
  if (swimming) {
    // 물 위: 아랫부분이 잠기고 물결
    const cut = 2;
    ctx.drawImage(img, 0, 0, img.width, img.height - cut, x, y, img.width, img.height - cut);
    const w = Math.floor(clock * 3 + a.anim) & 1;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(x - 1 - w, Math.round(a.y) - cut, 2, 1);
    ctx.fillRect(x + img.width - 1 + w, Math.round(a.y) - cut, 2, 1);
  } else {
    ctx.drawImage(img, x, y);
  }
}
