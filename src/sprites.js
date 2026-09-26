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

// ── 플레이어 (8x11, 발끝이 맨 아래 행) ────────────────────────────
// 방향마다 stand / a / b 3장. 걷기 사이클은 stand → a → stand → b.
//   상하(정면/뒷면): 다리가 번갈아 들리고(한쪽 발이 짧아짐) 반대쪽 팔이 내려온다.
//   좌우(옆모습)   : 몸이 좁아지고 다리가 앞뒤로 벌어지며, 팔이 앞/뒤로 흔들린다.
// left 는 right 를 좌우 반전해서 자동 생성한다.

// 몸통 윗부분 (머리~허리). 방향별로 얼굴/벨트만 다르다.
const TOP = {
  down: [
    '...rr...',
    '..rrrr..',
    '..rllr..',   // 두 눈
    '..rrrr..',
    '...rr...',
    '..rmmr..',   // 벨트 버클
  ],
  up: [
    '...rr...',
    '..rrrr..',
    '..rrrr..',   // 뒤통수
    '..rrrr..',
    '...rr...',
    '..rrrr..',   // 등 (버클 없음)
  ],
  right: [
    '...rr...',
    '..rrrr..',
    '..rrrl..',   // 옆얼굴, 눈 하나
    '..rrrr..',
    '...rr...',
    '..rrmr..',   // 옆에서 본 벨트
  ],
};

// 팔 2줄 + 옷자락 1줄 + 다리 2줄
const FRONT_BOTTOM = {                // 정면/뒷면 공용
  stand: [
    '.rrrrrr.',
    '.r.rr.r.',   // 양팔 내림
    '..rrrr..',
    '..r..r..',
    '..r..r..',
  ],
  a: [
    '.rrrrrr.',
    '.r.rr...',   // 오른팔 앞으로(짧아 보임)
    '.rrrrr..',   // 왼팔 뒤로(길어 보임)
    '..r..r..',
    '..r.....',   // 오른발 들림
  ],
  b: [
    '.rrrrrr.',
    '...rr.r.',
    '..rrrrr.',
    '..r..r..',
    '.....r..',   // 왼발 들림
  ],
};

const SIDE_BOTTOM = {                 // 오른쪽을 향한 옆모습
  stand: [
    '..rrrr..',
    '..rrrr..',   // 팔은 몸에 붙어 가려짐
    '..rrrr..',
    '...rr...',
    '...rr...',   // 두 다리가 겹침
  ],
  a: [
    '..rrrrr.',
    '..rrrr.r',   // 팔 앞으로
    '..rrrr..',
    '..r..r..',
    '.r....r.',   // 보폭: 앞발/뒷발
  ],
  b: [
    '.rrrrr..',
    'r.rrrr..',   // 팔 뒤로
    '..rrrr..',
    '..r..r..',
    '.r....r.',
  ],
};

const ART = {
  down:  { top: TOP.down,  bottom: FRONT_BOTTOM },
  up:    { top: TOP.up,    bottom: FRONT_BOTTOM },
  right: { top: TOP.right, bottom: SIDE_BOTTOM },
};

const mirror = (rows) => rows.map((r) => [...r].reverse().join(''));

function frames({ top, bottom }, flip = false) {
  return ['stand', 'a', 'stand', 'b'].map((k) => {
    const rows = [...top, ...bottom[k]];
    return makeSprite(flip ? mirror(rows) : rows);
  });
}

// PLAYER[dir] = [stand, a, stand, b]
export const PLAYER = {
  down:  frames(ART.down),
  up:    frames(ART.up),
  right: frames(ART.right),
  left:  frames(ART.right, true),
};

// ── 엎드린 자세 (포복) ─────────────────────────────────────────────
// 맨 아래 행이 바닥(발 위치). 기어가는 사이클: stand → a → stand → b
//   상하: 몸이 세로로 누움. 팔다리가 대각선으로 번갈아 뻗음 (b = a 좌우반전)
//   좌우: 몸이 가로로 길게 누움. 팔을 앞으로 뻗고 무릎을 끌어당김
const PRONE_DOWN = {          // 머리가 카메라 쪽(아래), 발이 먼 쪽(위)
  stand: [
    '..r..r..',
    '..r..r..',
    '..rrrr..',
    '..rrrr..',
    '.rrrrrr.',
    'r.rrrr.r',
    'r.rllr.r',   // 고개 든 얼굴 + 앞으로 뻗은 두 팔
  ],
  a: [
    '.r...r..',   // 왼 무릎 끌어당김
    '..r..r..',
    '..rrrr..',
    '..rrrr..',
    '.rrrrrrr',
    'r.rrrr..',   // 왼팔 앞, 오른팔 뒤
    'r.rllr..',
  ],
};

const PRONE_UP = {            // 머리가 먼 쪽(위), 발이 카메라 쪽(아래)
  stand: [
    'r.rrrr.r',   // 뒤통수 + 앞으로 뻗은 두 팔
    'r.rrrr.r',
    '.rrrrrr.',
    '..rrrr..',
    '..rrrr..',
    '..r..r..',
    '..r..r..',
  ],
  a: [
    'r.rrrr..',
    'r.rrrr..',
    '.rrrrrrr',
    '..rrrr..',
    '..rrrr..',
    '..r..r..',
    '..r...r.',
  ],
};

const PRONE_RIGHT = {         // 머리가 오른쪽
  stand: [
    '........rrr.',
    '........rrlr',
    '.rrrrrmrrrr.',
    'rrrrrrrrrrr.',
    'r......r.r..',
  ],
  a: [
    '........rrr.',
    '...r....rrlr',   // 무릎 끌어당김
    '..rrrrmrrrr.',
    'rrrrrrrrrrr.',
    'r.........rr',   // 팔 앞으로 뻗음
  ],
  b: [
    '........rrr.',
    '........rrlr',
    '.rrrrrmrrrr.',
    'rrrrrrrrrrr.',
    '.r....rr....',   // 팔 당겨옴, 다리 벌림
  ],
};

function proneFrames(set, flip = false) {
  const b = set.b || mirror(set.a);
  return [set.stand, set.a, set.stand, b].map((rows) => makeSprite(flip ? mirror(rows) : rows));
}

export const PLAYER_PRONE = {
  down:  proneFrames(PRONE_DOWN),
  up:    proneFrames(PRONE_UP),
  right: proneFrames(PRONE_RIGHT),
  left:  proneFrames(PRONE_RIGHT, true),
};
