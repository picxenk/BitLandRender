// ══════════════════════════════════════════════════════════════════
//  카메라 뷰 3D 렌더러 — "평면들의 모음"
//
//  맵을 WebGL 사각형으로 조립한다.
//    바닥   : 타일마다 높이에 맞춘 수평 사각형 (map.floor 텍스처)
//    벽     : 높이가 다른 타일 경계에 세운 수직 사각형
//    오브젝트/동물 : 항상 카메라를 향하는 빌보드 (탑뷰 스프라이트 그대로)
//    하늘   : 전체 화면 패스 (그라데이션 + 구름 + 먼 산 실루엣 + 밤하늘 별)
//
//  출력은 탑뷰와 같은 "씬 버퍼 인코딩"(회색 = 명도, r-g = 강조)이라
//  기존 디더/팔레트/필름 패스를 그대로 통과한다.
//  월드 단위 = 탑뷰 픽셀. X = 동쪽, Y = 위, Z = 남쪽. 언덕 1단 = LEVEL.
// ══════════════════════════════════════════════════════════════════

import { OBJECTS, objectImage, variantCount, TILE } from './tiles.js';
import { SPECIES, animalImage } from './animals.js';
import { rng } from './util.js';

export const LEVEL = 8;
const NEAR = 0.5, FAR = 600;
const FOG_NEAR = '70.0', FOG_FAR = '330.0', FOG_LUM = '0.9';

const PREC = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
`;

const NOISE = `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { return vnoise(p) * 0.55 + vnoise(p * 2.1 + 5.2) * 0.3 + vnoise(p * 4.3 + 9.1) * 0.15; }
`;

// ── 지오메트리 (바닥/벽/빌보드/그림자 공용) ────────────────────────
const GEO_VS = `
attribute vec3 aPos;
attribute vec2 aUV;
attribute float aShade;
attribute vec2 aCorner;   // 빌보드 모서리 오프셋 (x: 카메라 오른쪽, y: 위). 정적 지오메트리는 0
attribute float aWater;
uniform mat4 uVP;
uniform vec3 uRight;
varying vec2 vUV;
varying float vShade;
varying vec3 vWorld;
varying float vWater;
void main() {
  vec3 w = aPos + uRight * aCorner.x + vec3(0.0, aCorner.y, 0.0);
  vWorld = w; vUV = aUV; vShade = aShade; vWater = aWater;
  gl_Position = uVP * vec4(w, 1.0);
}`;

const GEO_FS = PREC + NOISE + `
uniform sampler2D uTex;
uniform float uAlphaTest, uShadow, uLight, uTime;
uniform vec3 uEye;
varying vec2 vUV;
varying float vShade;
varying vec3 vWorld;
varying float vWater;
void main() {
  float dist = distance(vWorld, uEye);
  float f = smoothstep(${FOG_NEAR}, ${FOG_FAR}, dist);

  // 그림자: 방사형 알파, 검정으로 블렌딩 (탑뷰의 rgba(0,0,0,a) 와 같은 효과)
  if (uShadow > 0.5) {
    float r = length(vUV * 2.0 - 1.0);
    float a = vShade * (1.0 - smoothstep(0.25, 1.0, r)) * (1.0 - f);
    gl_FragColor = vec4(0.0, 0.0, 0.0, a);
    return;
  }

  vec4 c = texture2D(uTex, vUV);
  if (uAlphaTest > 0.5 && c.a < 0.5) discard;
  float acc = clamp(c.r - c.g, 0.0, 1.0);
  float lum = clamp(c.g / max(1.0 - acc, 0.001), 0.0, 1.0) * vShade;

  // 물: 흐르는 밝은 띠 + 반짝임
  if (vWater > 0.5) {
    float band = vnoise(vWorld.xz * vec2(0.08, 0.3) + vec2(uTime * 0.25, 0.0));
    lum += 0.14 * smoothstep(0.55, 0.8, band);
    float s = hash12(floor(vWorld.xz) + floor(uTime * 3.0) * vec2(17.0, 31.0));
    if (s > 0.985 && band > 0.45) lum = 1.0;
  }

  // 거리 안개: 멀수록 밝게, 강조색도 옅어짐
  lum = mix(lum, ${FOG_LUM}, f);
  acc *= 1.0 - f;

  // 낮/밤 + 랜턴 (카메라 주변만 밝음)
  float glow = 1.0 - smoothstep(8.0, 56.0, dist);
  lum *= uLight + (1.0 - uLight) * glow * 0.9;

  float k = 1.0 - acc;
  gl_FragColor = vec4(lum * k + acc, lum * k, lum * k, 1.0);
}`;

// ── 전체 화면 패스 ───────────────────────────────────────────────
const FULL_VS = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

const SKY_FS = PREC + NOISE + `
uniform vec2 uRes, uTan;
uniform vec3 uF, uR, uU;
uniform float uLight, uTime;
void main() {
  vec2 ndc = gl_FragCoord.xy / uRes * 2.0 - 1.0;
  vec3 d = normalize(uF + uR * ndc.x * uTan.x + uU * ndc.y * uTan.y);
  float e = asin(clamp(d.y, -1.0, 1.0));
  vec2 ring = normalize(d.xz + 1e-5);
  float hFar = 0.03 + 0.06 * fbm(ring * 1.7 + 3.0);
  float hNear = 0.01 + 0.045 * fbm(ring * 3.5 + 11.0);

  float lum = ${FOG_LUM};
  if (e > 0.0) {
    lum = mix(${FOG_LUM}, 0.8, smoothstep(0.0, 0.9, e));             // 위로 갈수록 살짝 어둡게
    vec2 p = d.xz / (d.y + 0.12) * 1.5 + vec2(uTime * 0.03, 0.0);   // 구름 층에 투영
    lum = mix(lum, 1.0, smoothstep(0.52, 0.66, fbm(p)) * smoothstep(0.03, 0.14, e));
    if (e < hFar) lum = 0.8;                                         // 먼 산
    if (e < hNear) lum = 0.68;                                       // 가까운 산
  }
  lum *= uLight;
  if (e > max(hFar, 0.06)) {                                         // 별 (밤에만 보임)
    vec2 sp = floor(d.xz / (d.y + 0.3) * 90.0);
    if (hash12(sp) > 0.996) lum = max(lum, (1.0 - uLight) * 1.1);
  }
  gl_FragColor = vec4(vec3(lum), 1.0);
}`;

const OVL_FS = PREC + `
uniform sampler2D uTex;
uniform vec2 uRes;
void main() {
  vec2 uv = vec2(gl_FragCoord.x / uRes.x, 1.0 - gl_FragCoord.y / uRes.y);
  vec4 c = texture2D(uTex, uv);
  if (c.a < 0.5) discard;
  gl_FragColor = vec4(c.rgb, 1.0);
}`;

// ══════════════════════════════════════════════════════════════════
//  작은 행렬/벡터 유틸 (column-major)
// ══════════════════════════════════════════════════════════════════
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

function perspective(fovy, aspect, n, f) {
  const t = 1 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = t / aspect; m[5] = t; m[10] = (f + n) / (n - f); m[11] = -1; m[14] = (2 * f * n) / (n - f);
  return m;
}
function lookAt(eye, fwd, up) {
  const z = norm([-fwd[0], -fwd[1], -fwd[2]]);
  const x = norm(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}
function mul(a, b) {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
    o[c * 4 + r] = s;
  }
  return o;
}

// ══════════════════════════════════════════════════════════════════
//  GL 헬퍼
// ══════════════════════════════════════════════════════════════════
function makeProgram(gl, vs, fs) {
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const locs = new Map();
  return {
    p,
    attr: (n) => gl.getAttribLocation(p, n),
    u: (n) => { if (!locs.has(n)) locs.set(n, gl.getUniformLocation(p, n)); return locs.get(n); },
  };
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}
const pow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

// ── 아틀라스: 모든 오브젝트 변형 + 동물 프레임을 한 장에 모은다 (빈 여백은 잘라냄) ──
function buildAtlas() {
  const imgs = new Map();   // canvas → { canvas, ax, ay }
  for (const [ch, def] of Object.entries(OBJECTS)) {
    for (let v = 0; v < variantCount(def); v++) {
      const img = objectImage(ch, v);
      imgs.set(img.canvas, img);
    }
  }
  for (const sp of Object.values(SPECIES)) {
    for (const frame of Object.values(sp.sprites)) {
      for (const c of [frame.left, frame.right]) imgs.set(c, { canvas: c, ax: c.width >> 1, ay: c.height });
    }
  }

  const SIZE = 1024, PAD = 2;
  const out = canvas(SIZE, SIZE);
  const octx = out.getContext('2d');
  const entries = new Map();
  let cx = PAD, cy = PAD, rowH = 0;
  for (const img of imgs.values()) {
    const { canvas: c, ax, ay } = img;
    const data = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let x0 = c.width, y0 = c.height, x1 = -1, y1 = -1;
    for (let y = 0; y < c.height; y++) {
      for (let x = 0; x < c.width; x++) {
        if (data[(y * c.width + x) * 4 + 3] > 0) {
          if (x < x0) x0 = x; if (x > x1) x1 = x;
          if (y < y0) y0 = y; if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < 0) continue;
    const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
    if (cx + bw + PAD > SIZE) { cx = PAD; cy += rowH + PAD; rowH = 0; }
    octx.drawImage(c, x0, y0, bw, bh, cx, cy, bw, bh);
    entries.set(c, {
      u0: cx / SIZE, v0: cy / SIZE, u1: (cx + bw) / SIZE, v1: (cy + bh) / SIZE,
      x0: x0 - ax, x1: x0 + bw - ax,          // 가로: 발 위치 기준
      y0: ay - (y0 + bh), y1: ay - y0,        // 세로: 위가 +
    });
    cx += bw + PAD;
    rowH = Math.max(rowH, bh);
  }
  return { canvas: out, entries };
}

function makeWallCanvas() {
  const c = canvas(16, 16);
  const x = c.getContext('2d');
  const r = rng(99);
  x.fillStyle = '#c8c8c8';
  x.fillRect(0, 0, 16, 16);
  x.fillStyle = '#8a8a8a';
  for (let i = 0; i < 34; i++) x.fillRect(Math.floor(r() * 16), Math.floor(r() * 16), 1, 1);
  x.fillStyle = '#9a9a9a';
  x.fillRect(0, 8, 16, 1);                      // 지층 줄무늬 (1단마다)
  x.fillStyle = '#3a3a3a';
  for (let i = 0; i < 5; i++) {                 // 균열
    x.fillRect(Math.floor(r() * 16), Math.floor(r() * 16), 1, 2 + Math.floor(r() * 4));
  }
  return c;
}

// ══════════════════════════════════════════════════════════════════
//  렌더러
// ══════════════════════════════════════════════════════════════════
export function createCamera3D(gl, W, H) {
  const geo = makeProgram(gl, GEO_VS, GEO_FS);
  const sky = makeProgram(gl, FULL_VS, SKY_FS);
  const ovl = makeProgram(gl, FULL_VS, OVL_FS);
  const GEO_ATTRS = [['aPos', 3, 0], ['aUV', 2, 12], ['aShade', 1, 20], ['aCorner', 2, 24], ['aWater', 1, 32]]
    .map(([n, size, off]) => ({ loc: geo.attr(n), size, off }))
    .filter((a) => a.loc >= 0);

  const tri = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, tri);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  function texture(src, { mip = false, repeat = false } = {}) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    const wrap = repeat ? gl.REPEAT : gl.CLAMP_TO_EDGE;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST);
    if (src) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    return t;
  }

  // 오프스크린 타깃 (160x144 + 깊이)
  const colorTex = texture(null);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const depth = gl.createRenderbuffer();
  gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, W, H);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  const atlas = buildAtlas();
  const atlasTex = texture(atlas.canvas);
  const wallTex = texture(makeWallCanvas(), { repeat: true });
  const white = canvas(1, 1);
  white.getContext('2d').fillStyle = '#fff';
  white.getContext('2d').fillRect(0, 0, 1, 1);
  const whiteTex = texture(white);
  const ovlTex = texture(null);
  const dynBuf = gl.createBuffer();
  const shadowBuf = gl.createBuffer();

  let map = null, floorTex = null, floorSize = [1, 1], meshes = {};

  function upload(arr) {
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(arr), gl.STATIC_DRAW);
    return { buf, count: arr.length / 9 };
  }

  // 정점 = [x y z  u v  shade  cornerX cornerY  water]
  const quad = (arr, a, b, c, d) => arr.push(...a, ...b, ...c, ...a, ...c, ...d);

  function pushBill(arr, x, y, z, e) {
    const V = (cx, cy, u, v) => [x, y, z, u, v, 1, cx, cy, 0];
    quad(arr, V(e.x0, e.y0, e.u0, e.v1), V(e.x1, e.y0, e.u1, e.v1), V(e.x1, e.y1, e.u1, e.v0), V(e.x0, e.y1, e.u0, e.v0));
  }

  // ── 맵 → 메시 (맵을 불러올 때 한 번) ──
  function build(m) {
    map = m;
    const fc = canvas(pow2(m.pxW), pow2(m.pxH));
    const fctx = fc.getContext('2d');
    fctx.fillStyle = '#fff';
    fctx.fillRect(0, 0, fc.width, fc.height);
    fctx.drawImage(m.floor, 0, 0);
    if (floorTex) gl.deleteTexture(floorTex);
    floorTex = texture(fc, { mip: true });
    floorSize = [fc.width, fc.height];
    for (const k in meshes) gl.deleteBuffer(meshes[k].buf);

    const hAt = (tx, ty) => (m.inBounds(tx, ty) ? m.heightAt(tx, ty) * LEVEL : 0);
    const fl = [], wl = [];
    const [FW, FH] = floorSize;
    for (let ty = 0; ty < m.H; ty++) {
      for (let tx = 0; tx < m.W; tx++) {
        const h = hAt(tx, ty);
        const water = m.terrainAt(tx, ty).water ? 1 : 0;
        const x0 = tx * TILE, x1 = x0 + TILE, z0 = ty * TILE, z1 = z0 + TILE;
        const F = (x, z) => [x, h, z, x / FW, z / FH, 1, 0, 0, water];
        quad(fl, F(x0, z0), F(x1, z0), F(x1, z1), F(x0, z1));

        // 벽: 더 낮은 이웃 쪽 경계에 세운다. 빛은 북서쪽에서 (탑뷰와 같은 방향)
        const sides = [
          [0, -1, 0.95, [x0, z0], [x1, z0]],   // 북
          [0, 1, 0.7, [x1, z1], [x0, z1]],     // 남
          [-1, 0, 0.85, [x0, z1], [x0, z0]],   // 서
          [1, 0, 0.55, [x1, z0], [x1, z1]],    // 동
        ];
        for (const [dx, dz, shade, p0, p1] of sides) {
          const hn = hAt(tx + dx, ty + dz);
          if (hn >= h - 0.01) continue;
          const along = (p) => (dz !== 0 ? p[0] : p[1]) / 16;
          const V = (p, y, s) => [p[0], y, p[1], along(p), (32 - y) / 16, s, 0, 0, 0];
          quad(wl, V(p0, h, shade), V(p1, h, shade), V(p1, hn, shade * 0.5), V(p0, hn, shade * 0.5));
        }
      }
    }

    const ob = [];
    for (const o of m.objects) {
      const e = atlas.entries.get(objectImage(o.ch, o.v).canvas);
      if (e) pushBill(ob, o.x, hAt(o.tx, o.ty), o.y, e);
    }

    // 맵 바깥의 끝없는 들판 (맵 바닥보다 살짝 아래)
    const out = [];
    const G = (x, z) => [x, -0.05, z, 0, 0, 0.97, 0, 0, 0];
    quad(out, G(-3000, -3000), G(3000, -3000), G(3000, 3000), G(-3000, 3000));

    meshes = { floor: upload(fl), walls: upload(wl), objects: upload(ob), outside: upload(out) };
  }

  function bindGeo(buf) {
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    for (const a of GEO_ATTRS) {
      gl.enableVertexAttribArray(a.loc);
      gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, 36, a.off);
    }
  }
  function unbindGeo() { for (const a of GEO_ATTRS) gl.disableVertexAttribArray(a.loc); }

  function drawMesh(mesh, tex, alphaTest) {
    if (!mesh || !mesh.count) return;
    bindGeo(mesh.buf);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1f(geo.u('uAlphaTest'), alphaTest ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }

  function drawFull(prog) {
    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, tri);
    const loc = prog.attr('aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disableVertexAttribArray(loc);
  }

  const tileWater = (x, y) => map.terrainAt(Math.floor(x / TILE), Math.floor(y / TILE))?.water;

  // ── 한 프레임 ──
  //  eye [x,y,z], yaw(라디안, 0 = 동쪽, +π/2 = 남쪽), pitch, fov(세로)
  //  overlay: 뷰파인더 UI 캔버스 (160x144, 투명 배경, 씬 버퍼 인코딩) 또는 null
  function render({ eye, yaw, pitch, fov, light, time, animals, overlay }) {
    const cp = Math.cos(pitch);
    const f = [cp * Math.cos(yaw), Math.sin(pitch), cp * Math.sin(yaw)];
    const r = [-Math.sin(yaw), 0, Math.cos(yaw)];
    const u = cross(r, f);
    const vp = mul(perspective(fov, W / H, NEAR, FAR), lookAt(eye, f, u));

    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, W, H);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.activeTexture(gl.TEXTURE0);

    // 1) 하늘
    gl.disable(gl.DEPTH_TEST);
    gl.useProgram(sky.p);
    gl.uniform2f(sky.u('uRes'), W, H);
    const tanY = Math.tan(fov / 2);
    gl.uniform2f(sky.u('uTan'), tanY * (W / H), tanY);
    gl.uniform3fv(sky.u('uF'), f);
    gl.uniform3fv(sky.u('uR'), r);
    gl.uniform3fv(sky.u('uU'), u);
    gl.uniform1f(sky.u('uLight'), light);
    gl.uniform1f(sky.u('uTime'), time);
    drawFull(sky);

    // 2) 지오메트리
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LESS);
    gl.useProgram(geo.p);
    gl.uniformMatrix4fv(geo.u('uVP'), false, vp);
    gl.uniform3fv(geo.u('uRight'), r);
    gl.uniform3fv(geo.u('uEye'), eye);
    gl.uniform1f(geo.u('uLight'), light);
    gl.uniform1f(geo.u('uTime'), time);
    gl.uniform1i(geo.u('uTex'), 0);
    gl.uniform1f(geo.u('uShadow'), 0);
    drawMesh(meshes.outside, whiteTex, false);
    drawMesh(meshes.floor, floorTex, false);
    drawMesh(meshes.walls, wallTex, false);
    drawMesh(meshes.objects, atlasTex, true);

    // 동물 빌보드 + 그림자 (매 프레임 새로 만든다)
    const bill = [], shadows = [];
    for (const a of animals) {
      const s = a.face === 'right' ? 1 : -1;
      const face = s * r[0] >= 0 ? 'right' : 'left';   // 월드 좌우 → 화면 좌우
      const e = atlas.entries.get(animalImage(a, face));
      if (!e) continue;
      const ground = a.h * LEVEL;
      const swim = a.state !== 'fly' && a.z < 0.5 && tileWater(a.x, a.y);
      pushBill(bill, a.x, ground + a.z - (swim ? 2 : 0), a.y, e);
      if (!swim) {
        const [rx, , al] = a.sp.shadow;
        const k = 1 / (1 + a.z * 0.06);
        const R = rx * k, alpha = al * k;
        const S = (x, z, uu, vv) => [x, ground + 0.15, z, uu, vv, alpha, 0, 0, 0];
        quad(shadows, S(a.x - R, a.y - R * 0.8, 0, 0), S(a.x + R, a.y - R * 0.8, 1, 0),
          S(a.x + R, a.y + R * 0.8, 1, 1), S(a.x - R, a.y + R * 0.8, 0, 1));
      }
    }
    if (bill.length) {
      gl.bindBuffer(gl.ARRAY_BUFFER, dynBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(bill), gl.DYNAMIC_DRAW);
      drawMesh({ buf: dynBuf, count: bill.length / 9 }, atlasTex, true);
    }
    if (shadows.length) {
      gl.bindBuffer(gl.ARRAY_BUFFER, shadowBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(shadows), gl.DYNAMIC_DRAW);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.uniform1f(geo.u('uShadow'), 1);
      drawMesh({ buf: shadowBuf, count: shadows.length / 9 }, whiteTex, false);
      gl.uniform1f(geo.u('uShadow'), 0);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }
    unbindGeo();

    // 3) 뷰파인더 UI
    gl.disable(gl.DEPTH_TEST);
    if (overlay) {
      gl.bindTexture(gl.TEXTURE_2D, ovlTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, overlay);
      gl.useProgram(ovl.p);
      gl.uniform1i(ovl.u('uTex'), 0);
      gl.uniform2f(ovl.u('uRes'), W, H);
      drawFull(ovl);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return colorTex;
  }

  return { build, render };
}
