/**
 * GLSL for the Agent Core scene. Deliberately small: one noise function, no post-processing,
 * additive blending for light instead of bloom passes.
 */

/** 3D simplex noise — Ian McEwan, Ashima Arts (MIT). */
export const SIMPLEX_NOISE = /* glsl */ `
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m = m * m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}
`;

export const CORE_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uAmp;
varying vec3 vNormal;
varying vec3 vViewPos;
varying float vNoise;
${SIMPLEX_NOISE}
void main() {
  // Shared vertices get identical offsets, so the faceted body breathes without tearing.
  float n = snoise(position * 1.6 + vec3(0.0, uTime * 0.2, uTime * 0.1));
  vNoise = n;
  vec3 p = position + normal * n * 0.045 * uAmp;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vViewPos = mv.xyz;
  gl_Position = projectionMatrix * mv;
}
`;

export const CORE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uDeep;
uniform vec3 uHot;
uniform float uIntensity;
uniform float uTime;
varying vec3 vNormal;
varying vec3 vViewPos;
varying float vNoise;
void main() {
  vec3 view = normalize(-vViewPos);
  // Facet normal from screen-space derivatives: a crystalline, engineered surface.
  vec3 facet = normalize(cross(dFdx(vViewPos), dFdy(vViewPos)));
  float fdv = clamp(abs(dot(facet, view)), 0.0, 1.0);
  float sdv = clamp(dot(normalize(vNormal), view), 0.0, 1.0);
  float rim = pow(1.0 - sdv, 2.6);
  float facetLight = pow(1.0 - fdv, 1.6);
  float scan = smoothstep(0.92, 1.0, sin(vNoise * 22.0 + uTime * 1.4)) * 0.35;
  vec3 col = uDeep
    + uColor * (facetLight * 0.55 + rim * 1.25 + scan * 0.4)
    + uHot * pow(sdv, 5.0) * 0.55;
  gl_FragColor = vec4(col * uIntensity, 1.0);
}
`;

/** Points with soft discs; per-point size and alpha. */
export const DOTS_VERTEX = /* glsl */ `
uniform float uTime;
uniform float uSize;
uniform float uPixelRatio;
attribute float aSeed;
varying float vTwinkle;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vTwinkle = 0.55 + 0.45 * sin(uTime * (0.8 + aSeed * 1.6) + aSeed * 60.0);
  gl_PointSize = uSize * uPixelRatio * (10.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

export const DOTS_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying float vTwinkle;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.05, d);
  gl_FragColor = vec4(uColor, a * uOpacity * vTwinkle);
}
`;

/** Lines whose light flows along a 0..1 parameter (`aT`): data rings, links, streams. */
export const FLOW_LINE_VERTEX = /* glsl */ `
attribute float aT;
varying float vT;
void main() {
  vT = aT;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

export const FLOW_LINE_FRAGMENT = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
uniform float uSpeed;
uniform float uDashes;
uniform float uBase;
varying float vT;
void main() {
  float phase = fract(vT * uDashes - uTime * uSpeed);
  float comet = pow(phase, 7.0);
  float a = (uBase + comet * 0.95) * uOpacity;
  gl_FragColor = vec4(uColor * (0.7 + comet * 0.8), a);
}
`;
