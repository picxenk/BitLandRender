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

float bayer2(vec2 a) { a = floor(a); return fract(a.x * 0.5 + a.y * a.y * 0.75); }
float bayer4(vec2 a) { return bayer2(0.5 * a) * 0.25 + bayer2(a); }

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

  vec4 c = texture2D(uScene, (sp + 0.5) / uRes);
  if (uMode == 2) { gl_FragColor = vec4(c.rgb, 1.0); return; }

  // 디더 임계값은 월드 좌표 기준 → 카메라 이동 시 패턴 고정
  float th = (uMode == 1) ? 0.5 : bayer4(wp) + 1.0 / 32.0;

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

  if (accent + th >= 1.0) { gl_FragColor = vec4(uC3, 1.0); return; }

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

  float q = clamp(floor(lum * 2.0 + th), 0.0, 2.0);
  gl_FragColor = vec4(q < 0.5 ? uC0 : (q < 1.5 ? uC1 : uC2), 1.0);
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
  const setPalette = (prog, palette, ids) => ids.forEach((i) => prog.f3('uC' + i, hexToRgb(palette.colors[i])));

  return {
    // 출력 캔버스의 실제 픽셀 크기
    resize(w, h) {
      canvas.width = w;
      canvas.height = h;
    },

    // 패스 1: 씬 버퍼 → FBO (저해상도 4색)
    renderScene({ source, cam, light, lightPos, mode, palette, time, uniforms }) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.viewport(0, 0, W, H);
      use(dither);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, sceneTex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
      dither.i1('uScene', 0);
      dither.f2('uRes', W, H);
      dither.f2('uCam', cam.x, cam.y);
      dither.f2('uLightPos', lightPos.x, lightPos.y);
      dither.f1('uLight', light);
      dither.f1('uTime', time);
      dither.i1('uMode', mode);
      setPalette(dither, palette, [0, 1, 2, 3]);
      setUniforms(dither, uniforms);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },

    // 패스 2: FBO → 화면 (필름 효과). 매 프레임 호출
    present({ time, palette, pixelRatio, uniforms }) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      use(film);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, lowTex);
      film.i1('uImg', 0);
      film.f2('uRes', W, H);
      film.f2('uOut', canvas.width, canvas.height);
      film.f1('uPx', pixelRatio);
      film.f1('uTime', time);
      setPalette(film, palette, [0, 2]);
      setUniforms(film, uniforms);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}
