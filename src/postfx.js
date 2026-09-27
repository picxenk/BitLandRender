// ══════════════════════════════════════════════════════════════════
//  2패스 후처리
//
//  [패스 1] dither  : 씬 버퍼(160x144) → 디더/팔레트 → FBO 텍스처(160x144, 4색)
//                    A층 필터: 라인 보일, 안개, 비네팅 (결과는 여전히 4색)
//  [패스 2] film    : FBO 텍스처 → 화면 해상도 캔버스
//                    B층 필터: 게이트 위브, 소프트닝, 색수차, 할레이션, 그레인, 먼지
//
//  씬 버퍼 인코딩 규칙 (sprites/tiles 쪽에서 지키는 약속):
//    - 회색(r=g=b)  : 명도. 조명/그림자/그라데이션 모두 회색으로 그린다.
//    - 빨강 성분     : accent = r - g. 1이면 완전한 강조색, 0.5면 픽셀 절반만 강조색(디더).
//
//  모든 필터 유니폼은 0이면 "꺼짐". (filters.js 가 꺼진 필터에 0을 넘긴다)
// ══════════════════════════════════════════════════════════════════

import { getPattern } from './dither.js';

export const PALETTES = [
  { name: 'Kinsplant', colors: ['#5a4b5c', '#a7a0a6', '#efe6c5', '#7c0a0a'] },
  { name: 'DMG',       colors: ['#306230', '#8bac0f', '#c4cfa1', '#0f380f'] },
  { name: 'Ink',       colors: ['#2b2b3a', '#8a8f9e', '#f4f1e8', '#d14b2c'] },
];

const VS = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const COMMON = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

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
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
`;

// ── 패스 1: 디더 / 팔레트 ──────────────────────────────────────────
const FS_DITHER = COMMON + `
uniform sampler2D uScene;
uniform vec2  uRes;       // 160,144
uniform vec2  uCam;       // 카메라 월드 좌표(정수)
uniform vec2  uLightPos;  // 랜턴(플레이어) 화면 좌표
uniform float uLight;     // 전역 조도 0..1
uniform float uTime;
uniform int   uMode;      // 0 = dither, 1 = 단순 양자화, 2 = 원본 버퍼
uniform vec3  uC0, uC1, uC2, uC3;
uniform float uBoil, uFog, uVignette;
uniform float uFlipY;     // 1 = 입력이 WebGL FBO(아래가 원점)인 경우 (3D 카메라 뷰)

// ── 디더 옵션 (dither.js) ──
uniform sampler2D uPattern;   // 임계값 패턴 (R = 임계값 × 256)
uniform float uPatSize;       // 패턴 한 변 크기
uniform float uPatScale;      // 패턴 한 칸 = N 픽셀
uniform float uLevels;        // 2 = 1-bit, 3 = 3단계
uniform float uContrast, uGamma;
uniform float uBand;          // 1 = 일반 디더, 0에 가까울수록 평탄한 면은 단색(경계에만 디더)
uniform float uAccentHard;    // 1 = 강조색을 디더 없이 딱 잘라서
uniform float uAnimate;       // 1 = 패턴 위치가 초당 12번 바뀜
uniform float uAnchor;        // 0 = 월드, 1 = 화면, 2 = 시야 구면 (3D 카메라)
uniform vec3  uSF, uSR, uSU;  // 구면 고정용 카메라 기저 (앞/오른쪽/위)
uniform vec2  uSTan;          // tan(fov/2) (가로, 세로)
uniform float uSK;            // 화면 중심의 1 라디안 = 몇 픽셀
uniform vec2  uSRefF, uSRefR; // 구면 좌표 기준 방향 (xz 평면, 카메라 세션 동안 고정)

// 패턴 좌표: 어디에 고정하느냐에 따라 달라진다
vec2 patternCoord(vec2 pix, vec2 wp) {
  vec2 c = wp;
  if (uAnchor > 1.5) {
    // Obra Dinn 방식: 픽셀의 시야 방향을 (yaw, pitch)로 바꿔 패턴을 카메라를 둘러싼 구에 입힌다.
    // 같은 방향 = 같은 패턴 값이라, 좌우로 돌려도 패턴이 세계와 함께 움직인다.
    vec2 ndc = vec2((pix.x + 0.5) / uRes.x * 2.0 - 1.0, 1.0 - (pix.y + 0.5) / uRes.y * 2.0);
    vec3 d = normalize(uSF + uSR * ndc.x * uSTan.x + uSU * ndc.y * uSTan.y);
    float pitch = asin(clamp(d.y, -1.0, 1.0));
    float yaw = atan(dot(d.xz, uSRefR), dot(d.xz, uSRefF));
    c = vec2(yaw * cos(pitch), -pitch) * uSK;
  } else if (uAnchor > 0.5) {
    c = pix;
  }
  c = floor(c / uPatScale);
  if (uAnimate > 0.5) {
    float fr = floor(uTime * 12.0);
    c += floor(vec2(hash12(vec2(fr, 1.0)), hash12(vec2(fr, 2.0))) * uPatSize);
  }
  return c;
}

float threshold(vec2 c) {
  return texture2D(uPattern, (mod(c, uPatSize) + 0.5) / uPatSize).r * (255.0 / 256.0);
}

void main() {
  vec2 pix = floor(vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y));  // 좌상단 원점
  vec2 wp  = pix + uCam;                                              // 월드 좌표

  // ── 라인 보일: 초당 8번 바뀌는 저주파 노이즈로 샘플 위치를 ±1~2px 흔든다.
  //    영역 단위로 같이 움직이므로 "지글거림"이 아니라 "손그림 선 떨림"이 된다.
  vec2 sp = pix;
  if (uBoil > 0.0) {
    float seed = floor(uTime * 8.0);
    vec2 q = wp / 10.0 + mod(seed, 64.0) * vec2(3.17, 5.71);
    vec2 off = vec2(vnoise(q), vnoise(q + 19.7)) - 0.5;
    sp = clamp(sp + floor(off * 2.5 * uBoil + 0.5), vec2(0.0), uRes - 1.0);
  }

  vec2 suv = (sp + 0.5) / uRes;
  if (uFlipY > 0.5) suv.y = 1.0 - suv.y;
  vec4 c = texture2D(uScene, suv);
  if (uMode == 2) { gl_FragColor = vec4(c.rgb, 1.0); return; }

  // 디더 임계값: 패턴 텍스처에서 읽는다 (고정 기준은 uAnchor)
  float th = (uMode == 1) ? 0.5 : threshold(patternCoord(pix, wp));

  float accent = clamp(c.r - c.g, 0.0, 1.0);
  float lum = clamp(c.g / max(1.0 - accent, 0.001), 0.0, 1.0);

  // ── 안개: 월드에 붙어 천천히 흘러가는 fbm. 밝게 덮고 강조색도 가린다.
  if (uFog > 0.0) {
    vec2 fp = wp / 44.0 + vec2(uTime * 0.07, uTime * 0.025);
    float f = vnoise(fp) * 0.55 + vnoise(fp * 2.1 + 5.2) * 0.3 + vnoise(fp * 4.3 + 9.1) * 0.15;
    float m = smoothstep(0.48, 0.82, f) * uFog;
    lum = mix(lum, 0.96, m);
    accent *= 1.0 - m;
  }

  bool isAccent = uAccentHard > 0.5 ? accent >= 0.5 : accent + th >= 1.0;
  if (isAccent) { gl_FragColor = vec4(uC3, 1.0); return; }

  // 조명 (낮/밤 + 랜턴)
  float glow = 1.0 - smoothstep(6.0, 46.0, distance(pix, uLightPos));
  lum *= uLight + (1.0 - uLight) * glow * 0.9;

  // ── 비네팅: 가장자리 명도를 낮춤 → 디더가 점점 성겨지는 테두리
  if (uVignette > 0.0) {
    vec2 v = (pix + 0.5) / uRes * 2.0 - 1.0;
    float r = length(v) / 1.4142;
    // 세기 1 이상이면 어두운 영역이 안쪽으로 파고든다 (최대 3)
    lum *= 1.0 - clamp(uVignette * smoothstep(0.5, 1.05, r), 0.0, 1.0);
  }

  // 톤 곡선 (감마 → 대비)
  if (uGamma != 1.0) lum = pow(lum, uGamma);
  if (uContrast != 1.0) lum = clamp((lum - 0.5) * uContrast + 0.5, 0.0, 1.0);

  // 양자화: 단계 사이의 위치 f 를 디더 폭(band)으로 좁히면, 경계에서 먼 곳은 단색이 된다
  float L1 = uLevels - 1.0;
  float x = lum * L1;
  float base = floor(x);
  float f = x - base;
  if (uBand < 1.0) f = clamp((f - 0.5) / uBand + 0.5, 0.0, 1.0);
  float q = clamp(base + step(1.0, f + th), 0.0, L1);
  if (uLevels < 2.5) gl_FragColor = vec4(q < 0.5 ? uC0 : uC2, 1.0);     // 1-bit: 가장 어두운색 / 가장 밝은색
  else gl_FragColor = vec4(q < 0.5 ? uC0 : (q < 1.5 ? uC1 : uC2), 1.0);
}
`;

// ── 패스 2: 필름 / 디스플레이 ──────────────────────────────────────
const FS_FILM = COMMON + `
uniform sampler2D uImg;   // 패스 1 결과 (LINEAR 필터)
uniform vec2  uRes;       // 저해상도 160,144
uniform vec2  uOut;       // 출력 캔버스 실제 픽셀 크기
uniform float uPx;        // devicePixelRatio
uniform float uTime;
uniform vec3  uC0, uC2;   // 팔레트 가장 어두운/밝은 색 (먼지/스크래치용)
uniform float uGrain, uChroma, uSoften, uHalation, uWeave, uDust;

// 텍셀 중심 샘플 = nearest (텍스처는 LINEAR 이지만 중심에선 정확한 값)
vec3 nearest(vec2 uv) { return texture2D(uImg, (floor(uv * uRes) + 0.5) / uRes).rgb; }

// ── 소프트닝: nearest 와 살짝 번진 샘플을 섞는다
vec3 base(vec2 uv) {
  vec3 s = nearest(uv);
  if (uSoften > 0.0) {
    vec2 e = 0.5 / uRes;
    vec3 b = texture2D(uImg, uv + vec2( e.x,  e.y)).rgb + texture2D(uImg, uv + vec2(-e.x,  e.y)).rgb
           + texture2D(uImg, uv + vec2( e.x, -e.y)).rgb + texture2D(uImg, uv + vec2(-e.x, -e.y)).rgb;
    s = mix(s, b * 0.25, uSoften);
  }
  return s;
}

void main() {
  vec2 uv = gl_FragCoord.xy / uOut;
  float frame = mod(floor(uTime * 24.0), 997.0);   // 필름은 24fps로 바뀐다

  // ── 게이트 위브: 화면 전체가 천천히, 약간 덜컥거리며 흔들림
  if (uWeave > 0.0) {
    float t = floor(uTime * 24.0) / 24.0;
    vec2 w = vec2(sin(t * 2.1) + 0.5 * sin(t * 5.3 + 1.0) + (hash12(vec2(frame, 1.0)) - 0.5) * 0.5,
                  0.7 * sin(t * 1.7 + 2.0) + (hash12(vec2(frame, 2.0)) - 0.5) * 0.7);
    uv += w * 0.5 * uWeave / uRes;
  }

  // ── 색수차: R/B를 반대 방향으로 밀기. 가장자리로 갈수록 크게.
  vec3 col;
  if (uChroma > 0.0) {
    vec2 d = (vec2(0.35, 0.0) + (uv - 0.5) * 1.4) * uChroma / uRes;
    col = vec3(base(uv + d).r, base(uv).g, base(uv - d).b);
  } else {
    col = base(uv);
  }

  // ── 할레이션: 밝은 부분을 넓게 블러해서 screen 블렌드 → 어두운 물체 테두리로 빛이 번짐
  if (uHalation > 0.0) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < 8; i++) {
      float a = float(i) * 0.785398;
      vec2 dir = vec2(cos(a), sin(a)) / uRes;
      acc += texture2D(uImg, uv + dir * 1.5).rgb;
      acc += texture2D(uImg, uv + dir * 3.2).rgb;
    }
    acc /= 16.0;
    vec3 glow = acc * smoothstep(0.6, 1.0, luma(acc)) * vec3(1.0, 0.88, 0.8);
    col = 1.0 - (1.0 - col) * (1.0 - glow * uHalation);
  }

  // ── 먼지 / 스크래치
  if (uDust > 0.0) {
    vec2 lp = uv * uRes;
    // 먼지: 16px 칸마다 매 프레임 낮은 확률로 작은 얼룩
    vec2 cell = floor(lp / 16.0);
    vec2 cs = cell + frame * vec2(7.13, 3.31);
    if (hash12(cs) < 0.03 * uDust) {
      vec2 c = (cell + vec2(hash12(cs + 1.7), hash12(cs + 4.2))) * 16.0;
      float r = 0.4 + hash12(cs + 8.8) * 1.3;
      vec2 d = lp - c;
      d.x *= 1.0 + hash12(cs + 2.0) * 1.5;
      float m = 1.0 - smoothstep(r * 0.5, r, length(d));
      col = mix(col, uC0 * 0.8, m * 0.85);
    }
    // 스크래치: 5프레임(약 0.2초) 단위로 등장, 약간 떨리는 세로줄
    float blk = floor(frame / 5.0);
    if (hash12(vec2(blk, 91.0)) < 0.3 * uDust) {
      float sx = hash12(vec2(blk, 17.0)) * uRes.x + (hash12(vec2(frame, 3.0)) - 0.5) * 1.2;
      float m = (1.0 - smoothstep(0.12, 0.45, abs(lp.x - sx)))
              * smoothstep(0.3, 0.7, vnoise(vec2(lp.y * 0.08, frame * 0.3)));
      col = mix(col, mix(uC0, uC2, 0.35), m * 0.55);
    }
  }

  // ── 필름 그레인: 1 CSS 픽셀 단위, 24fps, 삼각 분포 노이즈. 밝은 곳에서 조금 더 강하게.
  if (uGrain > 0.0) {
    vec2 g = floor(gl_FragCoord.xy / max(uPx, 1.0));
    float n = hash12(g + frame * vec2(37.0, 113.0)) + hash12(g * 1.37 + frame * 0.71 + 11.0) - 1.0;
    col += n * uGrain * (0.6 + 0.4 * luma(col));
  }

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
  return s;
}

function program(gl, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, VS));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
  const locs = new Map();
  const loc = (name) => {
    if (!locs.has(name)) locs.set(name, gl.getUniformLocation(p, name));
    return locs.get(name);
  };
  return {
    p,
    aPos: gl.getAttribLocation(p, 'aPos'),
    f1: (n, v) => gl.uniform1f(loc(n), v),
    f2: (n, x, y) => gl.uniform2f(loc(n), x, y),
    f3: (n, v) => gl.uniform3fv(loc(n), v),
    i1: (n, v) => gl.uniform1i(loc(n), v),
  };
}

function texture(gl, filter) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

export function createPostFX(canvas, W, H) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false });
  if (!gl) throw new Error('WebGL을 사용할 수 없습니다.');
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);

  const dither = program(gl, FS_DITHER);
  const film = program(gl, FS_FILM);

  // 화면 전체를 덮는 삼각형 하나
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

  const sceneTex = texture(gl, gl.NEAREST);
  const lowTex = texture(gl, gl.LINEAR);   // 소프트닝/할레이션이 쌍선형 샘플을 쓴다
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, W, H, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  const fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, lowTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  function use(prog) {
    gl.useProgram(prog.p);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(prog.aPos);
    gl.vertexAttribPointer(prog.aPos, 2, gl.FLOAT, false, 0, 0);
  }
  const setUniforms = (prog, obj) => { for (const k in obj) prog.f1(k, obj[k]); };

  // ── 디더 패턴 텍스처 (패턴 이름별로 한 번 생성) ──
  const patTex = new Map();
  function patternTexture(p) {
    let t = patTex.get(p.name);
    if (!t) {
      t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, p.size, p.size, 0, gl.RGBA, gl.UNSIGNED_BYTE, p.data);
      patTex.set(p.name, t);
    }
    return t;
  }
  const DEFAULT_DITHER = {
    pattern: getPattern('bayer4'), scale: 1, levels: 3, contrast: 1, gamma: 1, band: 1, accentHard: false, animate: false, anchor: 0,
  };

  function setDither(o, sphere) {
    const p = o.pattern;
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, patternTexture(p));
    dither.i1('uPattern', 1);
    dither.f1('uPatSize', p.size);
    dither.f1('uPatScale', o.scale);
    dither.f1('uLevels', o.levels);
    dither.f1('uContrast', o.contrast);
    dither.f1('uGamma', o.gamma);
    dither.f1('uBand', o.band);
    dither.f1('uAccentHard', o.accentHard ? 1 : 0);
    dither.f1('uAnimate', o.animate ? 1 : 0);
    // 구면 고정은 카메라 방향이 있을 때만
    const anchor = o.anchor === 2 && !sphere ? 1 : o.anchor;
    dither.f1('uAnchor', anchor);
    if (anchor === 2) {
      const { yaw, pitch, fov, ref } = sphere;
      const cp = Math.cos(pitch);
      const f = [cp * Math.cos(yaw), Math.sin(pitch), cp * Math.sin(yaw)];
      const r = [-Math.sin(yaw), 0, Math.cos(yaw)];
      const u = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
      const tanY = Math.tan(fov / 2);
      dither.f3('uSF', f);
      dither.f3('uSR', r);
      dither.f3('uSU', u);
      dither.f2('uSTan', tanY * (W / H), tanY);
      dither.f1('uSK', (H / 2) / tanY);
      dither.f2('uSRefF', Math.cos(ref), Math.sin(ref));
      dither.f2('uSRefR', -Math.sin(ref), Math.cos(ref));
    }
  }
  const setPalette = (prog, palette, ids) => ids.forEach((i) => prog.f3('uC' + i, hexToRgb(palette.colors[i])));

  return {
    // 출력 캔버스의 실제 픽셀 크기
    resize(w, h) {
      canvas.width = w;
      canvas.height = h;
    },

    gl,

    // 패스 1: 씬 버퍼 → FBO (저해상도 4색)
    //   source    : Canvas2D 씬 버퍼 (탑뷰)
    //   sourceTex : 이미 GPU에 있는 씬 텍스처 (3D 카메라 뷰). 아래가 원점이라 뒤집어 읽는다
    //   ditherOpts: dither.js params() 결과
    //   sphere    : { yaw, pitch, fov, ref } — 구면 고정용 카메라 방향 (3D 카메라 뷰)
    renderScene({ source, sourceTex, cam, light, lightPos, mode, palette, time, uniforms, ditherOpts, sphere }) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, W, H);
      use(dither);
      gl.activeTexture(gl.TEXTURE0);
      if (sourceTex) {
        gl.bindTexture(gl.TEXTURE_2D, sourceTex);
      } else {
        gl.bindTexture(gl.TEXTURE_2D, sceneTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      }
      dither.f1('uFlipY', sourceTex ? 1 : 0);
      dither.i1('uScene', 0);
      dither.f2('uRes', W, H);
      dither.f2('uCam', cam.x, cam.y);
      dither.f2('uLightPos', lightPos.x, lightPos.y);
      dither.f1('uLight', light);
      dither.f1('uTime', time);
      dither.i1('uMode', mode);
      setPalette(dither, palette, [0, 1, 2, 3]);
      setUniforms(dither, uniforms);
      setDither(ditherOpts || DEFAULT_DITHER, sphere);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.activeTexture(gl.TEXTURE0);
    },

    // 패스 1 결과(4색 160x144)를 ImageData로 읽는다 — 사진 저장용 (필름 효과 이전)
    readLow() {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      const px = new Uint8Array(W * H * 4);
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const img = new ImageData(W, H);
      for (let y = 0; y < H; y++) {
        img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);   // 위아래 뒤집기
      }
      return img;
    },

    // 저장된 사진(160x144)을 패스 1 결과 자리에 올린다 → 앨범에서 필름 효과를 입혀 보기
    showImage(image) {
      gl.bindTexture(gl.TEXTURE_2D, lowTex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, image);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    },

    // 패스 2: FBO → 화면 (필름 효과). 매 프레임 호출
    present(opts) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      drawFilm(canvas.width, canvas.height, opts);
    },

    // 패스 2를 화면 대신 w×h 오프스크린에 그려서 ImageData로 돌려준다 (필터가 입혀진 PNG 저장용)
    // 화면에 보이는 것과 같은 필터·같은 시각(time)을 쓰면 같은 그림이 나온다
    renderFilm(w, h, opts) {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      drawFilm(w, h, opts);
      const px = new Uint8Array(w * h * 4);
      gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.deleteFramebuffer(fb);
      gl.deleteTexture(tex);
      const img = new ImageData(w, h);
      for (let y = 0; y < h; y++) img.data.set(px.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
      return img;
    },
  };

  function drawFilm(outW, outH, { time, palette, pixelRatio, uniforms }) {
    gl.viewport(0, 0, outW, outH);
    use(film);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, lowTex);
    film.i1('uImg', 0);
    film.f2('uRes', W, H);
    film.f2('uOut', outW, outH);
    film.f1('uPx', pixelRatio);
    film.f1('uTime', time);
    setPalette(film, palette, [0, 2]);
    setUniforms(film, uniforms);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
}
