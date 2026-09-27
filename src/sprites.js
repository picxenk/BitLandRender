// 문자열 배열로 정의하는 픽셀 스프라이트.
// 씬 버퍼 규칙상 "색"이 아니라 "명도 + 강조 여부"만 표현한다.
//   k = 어두움(0)  m = 중간(0.5)  l = 밝음(1)  r = 강조색  . = 투명

const INK = { k: '#000000', m: '#808080', l: '#ffffff', r: '#ff0000' };

export function makeSprite(rows) {
  const h = rows.length;
  const w = rows[0].length;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const x = c.getContext('2d');
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      const ch = rows[j][i];
      if (ch === '.') continue;
      x.fillStyle = INK[ch];
      x.fillRect(i, j, 1, 1);
    }
  }
  return c;
}

// ══════════════════════════════════════════════════════════════════
//  플레이어 — 후드를 쓴 사진가 + 카메라 가방
//
//  8x11, 맨 아래 행이 발. 비율: 머리(후드) 3줄 · 몸통 5줄 · 다리 3줄
//  색:  r 몸(강조색)  m 얼굴(후드 그늘)·가방·가방끈  k 먼 쪽 팔다리(깊이감)
//       (얼굴을 l 로 하면 배경 크림색과 같아져 머리에 구멍이 난 것처럼 보인다)
//  가방: 오른쪽 엉덩이에 메고, 끈은 왼쪽 어깨에서 몸을 대각선으로 가로지른다
//
//  각 방향 = idle 1장 + walk 4장 [접지A, 통과A, 접지B, 통과B]
//    접지(contact): 두 다리가 가장 벌어진 순간 (낮음)
//    통과(passing): 한 다리가 다른 다리를 지나가는 순간 → main.js 에서 1px 위로 (bob)
//  left 는 right 를 좌우 반전해서 만든다.
// ══════════════════════════════════════════════════════════════════

// 행 목록을 받아 일부 행만 바꾼 사본을 만든다: patch(base, { 6: '....', 8: '....' })
const patch = (base, rows) => base.map((r, i) => rows[i] ?? r);

// ── 정면 (down) ──
const DOWN_IDLE = [
  '...rr...',   // 후드 끝
  '..rmmr..',   // 얼굴 (후드 그늘 속이라 중간 톤)
  '..rmmr..',
  '.rrrrmr.',   // 어깨 + 가방끈 (왼쪽 어깨 → 화면 오른쪽)
  'r.rrmr.r',   // 팔 · 몸통 · 끈
  'r.rmrr.r',
  'mmmrrr.r',   // 가방(화면 왼쪽 = 캐릭터 오른쪽 엉덩이) · 오른손은 가방 뒤
  'mmrrrr..',
  '..r..r..',   // 다리
  '..r..r..',
  '..r..r..',
];
const DOWN_WALK = [
  patch(DOWN_IDLE, {   // 접지A: 화면 오른쪽 다리가 뒤로 (짧고 어둡게), 같은 쪽 팔은 앞으로 (짧게)
    6: 'mmmrrr..',
    8: '..r..k..', 9: '..r..k..', 10: '..r.....' }),
  DOWN_IDLE,           // 통과
  patch(DOWN_IDLE, {   // 접지B: 화면 왼쪽 다리가 뒤로, 오른팔은 뒤로 (길게)
    7: 'mmrrrr.r',
    8: '..k..r..', 9: '..k..r..', 10: '.....r..' }),
  DOWN_IDLE,
];

// ── 뒷면 (up) ── 가방과 끈이 반대쪽에 보인다
const UP_IDLE = [
  '...rr...',
  '..rrrr..',   // 후드 뒤
  '..rrrr..',
  '.rmrrrr.',   // 끈 (왼쪽 어깨 = 화면 왼쪽)
  'r.rmrr.r',
  'r.rrmr.r',
  'r.rrrmmm',   // 가방 (화면 오른쪽)
  '..rrrrmm',
  '..r..r..',
  '..r..r..',
  '..r..r..',
];
const UP_WALK = [
  patch(UP_IDLE, {     // 접지A: 왼팔 앞으로(짧게), 오른쪽 다리 들림
    6: '..rrrmmm',
    8: '..r..k..', 9: '..r..k..', 10: '..r.....' }),
  UP_IDLE,
  patch(UP_IDLE, {     // 접지B: 왼팔 뒤로(길게), 왼쪽 다리 들림
    7: 'r.rrrrmm',
    8: '..k..r..', 9: '..k..r..', 10: '.....r..' }),
  UP_IDLE,
];

// ── 옆모습 (right) ── 가까운 쪽 팔다리 = r, 먼 쪽 = k
const SIDE_IDLE = [
  '..rrr...',   // 후드 (뒤로 살짝 늘어짐)
  '..rrrm..',   // 얼굴 (앞쪽, 그늘)
  '..rrrm..',
  '..rrmr..',   // 끈이 가슴을 대각선으로
  '..rmrr..',
  '.mmrrr..',   // 가방 (허리 뒤쪽)
  '.mmrrr..',
  '..rrrr..',
  '...kr...',   // 두 다리 (먼 쪽 어둡게) — 더 이상 기둥처럼 보이지 않음
  '...kr...',
  '...kr...',
];
const SIDE_WALK = [
  patch(SIDE_IDLE, {   // 접지A: 가까운 다리 앞 · 먼 다리 뒤 / 먼 팔이 앞으로 (어두운 손)
    5: '.mmrrrk.',
    8: '..k.r...', 9: '.k...r..', 10: '.k....r.' }),
  patch(SIDE_IDLE, {   // 통과A: 가까운 다리로 서고, 먼 다리가 무릎을 들고 지나감
    8: '...rk...', 9: '...rk...', 10: '...r....' }),
  patch(SIDE_IDLE, {   // 접지B: 먼 다리 앞 · 가까운 다리 뒤 / 가까운 팔이 앞으로 (빨간 손)
    5: '.mmrrrr.',
    8: '..r.k...', 9: '.r...k..', 10: '.r....k.' }),
  patch(SIDE_IDLE, {   // 통과B: 먼 다리로 서고, 가까운 다리가 지나감
    8: '...kr...', 9: '...kr...', 10: '...k....' }),
];

const mirror = (rows) => rows.map((r) => [...r].reverse().join(''));

function build(idle, walk, flip = false) {
  const f = (rows) => makeSprite(flip ? mirror(rows) : rows);
  return { idle: f(idle), walk: walk.map(f), bob: [0, 1, 0, 1] };
}

// PLAYER[dir] = { idle, walk: [4], bob: [4] }  — bob 은 위로 올릴 픽셀 수
export const PLAYER = {
  down:  build(DOWN_IDLE, DOWN_WALK),
  up:    build(UP_IDLE, UP_WALK),
  right: build(SIDE_IDLE, SIDE_WALK),
  left:  build(SIDE_IDLE, SIDE_WALK, true),
};
export const WALK_FRAME_PX = 2.5;   // 걸을 때 프레임 하나 = 2.5px 이동 (한 걸음 5px = 옆모습 보폭)

// ── 엎드린 자세 (포복) ─────────────────────────────────────────────
// 맨 아래 행이 바닥. 사이클: stand → a → stand → b  (등에 멘 가방 m)
const PRONE_DOWN = {          // 머리가 카메라 쪽(아래), 발이 먼 쪽(위)
  stand: [
    '..r..r..',
    '..r..r..',
    '..rrrr..',
    '..rmmr..',   // 등의 가방
    '.rrrrrr.',
    'r.rrrr.r',
    'r.rmmr.r',   // 고개 든 얼굴 + 앞으로 뻗은 두 팔
  ],
  a: [
    '.r...r..',   // 왼 무릎 끌어당김
    '..r..r..',
    '..rrrr..',
    '..rmmr..',
    '.rrrrrrr',
    'r.rrrr..',   // 왼팔 앞, 오른팔 뒤
    'r.rmmr..',
  ],
};

const PRONE_UP = {            // 머리가 먼 쪽(위), 발이 카메라 쪽(아래)
  stand: [
    'r.rrrr.r',   // 뒤통수 + 앞으로 뻗은 두 팔
    'r.rrrr.r',
    '.rrrrrr.',
    '..rmmr..',   // 등의 가방
    '..rrrr..',
    '..r..r..',
    '..r..r..',
  ],
  a: [
    'r.rrrr..',
    'r.rrrr..',
    '.rrrrrrr',
    '..rmmr..',
    '..rrrr..',
    '..r..r..',
    '..r...r.',
  ],
};

const PRONE_RIGHT = {         // 머리가 오른쪽
  stand: [
    '........rrr.',
    '...mm...rrmr',   // 등 위의 가방
    '.rrrrrmrrrr.',
    'rrrrrrrrrrr.',
    'r......r.r..',
  ],
  a: [
    '........rrr.',
    '...rmm..rrmr',   // 무릎 끌어당김
    '..rrrrmrrrr.',
    'rrrrrrrrrrr.',
    'r.........rr',   // 팔 앞으로 뻗음
  ],
  b: [
    '........rrr.',
    '...mm...rrmr',
    '.rrrrrmrrrr.',
    'rrrrrrrrrrr.',
    '.r....rr....',   // 팔 당겨옴, 다리 벌림
  ],
};

function proneBuild(set, flip = false) {
  const f = (rows) => makeSprite(flip ? mirror(rows) : rows);
  const b = set.b || mirror(set.a);
  return { idle: f(set.stand), walk: [set.a, set.stand, b, set.stand].map(f), bob: [0, 0, 0, 0] };
}

export const PLAYER_PRONE = {
  down:  proneBuild(PRONE_DOWN),
  up:    proneBuild(PRONE_UP),
  right: proneBuild(PRONE_RIGHT),
  left:  proneBuild(PRONE_RIGHT, true),
};
export const PRONE_FRAME_PX = 2;   // 포복: 프레임 하나 = 2px 이동
