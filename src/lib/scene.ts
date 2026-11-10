/**
 * scene.ts — the whole 3D "Promise Orb" experience (Three.js), "Aurora Saffron" edition.
 *
 * What lives here (top to bottom of the picture)
 *   • Aurora       full-screen shader: plum gradient + slow drifting magenta/violet/teal/saffron blobs
 *   • Grid floor   faint glowing perspective grid under the orb
 *   • Star dust    fine twinkling gold particles
 *   • Orb          iridescent fresnel rim (saffron↔magenta↔violet) + inner swirling plasma core.
 *                  While listening its vertices are pushed out by your voice (waveform sphere).
 *   • Orbit rings  3 thin glowing rings tilted at different angles, each with a bead
 *   • Ripples      colourful rings that expand outward while recording
 *   • Inflow       particles spiral INTO the orb while processing, then BURST outward on results
 *   • Gems         one faceted crystal per promise with an icon inside, a label, and a light trail
 *                  as it flies out of the orb. Red gems pulse + send out shockwave rings.
 *   • Threads      gradient cyan→white-gold lines with light particles flowing owes → owed
 *   • Camera       cinematic fly-in, gentle auto-orbit when idle, camera shake on red reveal,
 *                  OrbitControls for mouse/touch, plus hooks for hand gestures
 *   • Bloom        UnrealBloomPass gives everything bright that soft cinematic glow
 *
 * The React UI talks to this class through a handful of public methods:
 *   setMode, setAudioSource, setSpeaking, setAnalysis, focus/next/prev,
 *   rotateBy, setDistanceTarget, getDistance, snapshot, dispose.
 */
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { iconFor, RISK_EMOJI, type Analysis, type Risk } from "./analysis";
import type { AudioSource } from "./audio";

export type SceneMode = "idle" | "recording" | "processing" | "results";

/* ─────────────── palette ─────────────── */
const COL = {
  saffron: new THREE.Color(0xff9f1c),
  magenta: new THREE.Color(0xff3d9a),
  violet: new THREE.Color(0x7c3aed),
  teal: new THREE.Color(0x14f1d9),
  cyan: new THREE.Color(0x22e4ff),
  gold: new THREE.Color(0xffe9a8),
  deep: new THREE.Color(0x2a0a4a),
  plumTop: new THREE.Color(0x0a0612),
  plumBottom: new THREE.Color(0x1a0b2e),
};
const RISK_COLOR: Record<Risk, number> = { green: 0x2dff8f, amber: 0xffc83d, red: 0xff3b5c };
const IRID = [COL.saffron, COL.magenta, COL.violet];
const RIPPLE_COLORS = [COL.magenta, COL.saffron, COL.teal, COL.violet, COL.cyan];

/* ─────────────── small math helpers ─────────────── */
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
const easeOutBack = (t: number) => {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2);
};
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** Frame-rate independent smoothing: moves `cur` toward `target`. */
const damp = (cur: number, target: number, lambda: number, dt: number) =>
  cur + (target - cur) * (1 - Math.exp(-lambda * dt));
const wrapPi = (a: number) => {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
};
/** Walks saffron → magenta → violet → saffron as t goes 0..1 */
function palette(t: number, out: THREE.Color): THREE.Color {
  const x = (((t % 1) + 1) % 1) * 3;
  const i = Math.floor(x);
  const f = x - i;
  return out.copy(IRID[i % 3]).lerp(IRID[(i + 1) % 3], f * f * (3 - 2 * f));
}

/* ═══════════════════════════ shaders ═══════════════════════════ */

/** Full-screen aurora background (drawn first, never depth-tested). */
const BG_VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.9999, 1.0); }`;
const BG_FRAG = /* glsl */ `
uniform float uTime; uniform float uAspect;
uniform vec3 uTop; uniform vec3 uBottom; uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3; uniform vec3 uC4;
uniform float uBoost;
varying vec2 vUv;
float blob(vec2 p, vec2 c, float r){ vec2 d = p - c; d.x *= uAspect; return exp(-dot(d,d)/(r*r)); }
void main(){
  vec2 p = vUv;
  vec3 col = mix(uBottom, uTop, p.y);
  float t = uTime * 0.11;
  float k = 0.5 + uBoost * 0.5;
  col += uC1 * blob(p, vec2(0.22 + 0.18*sin(t*1.1),       0.72 + 0.14*cos(t*0.9)),       0.42) * 0.30 * k; // magenta
  col += uC2 * blob(p, vec2(0.78 + 0.14*cos(t*0.8),       0.66 + 0.18*sin(t*1.3)),       0.46) * 0.32 * k; // violet
  col += uC3 * blob(p, vec2(0.50 + 0.26*sin(t*0.7 + 2.0), 0.24 + 0.12*cos(t*1.1)),       0.40) * 0.20 * k; // teal
  col += uC4 * blob(p, vec2(0.16 + 0.12*cos(t*1.4),       0.18 + 0.10*sin(t*0.6 + 1.0)), 0.36) * 0.20 * k; // saffron
  col += uC1 * blob(p, vec2(0.62 + 0.2*sin(t*0.5+4.0),    0.9 + 0.05*sin(t)),            0.30) * 0.10;
  col += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233))) * 43758.5453) - 0.5) / 255.0; // dither
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** Faint glowing perspective grid floor. */
const GRID_VERT = /* glsl */ `
varying vec2 vW;
void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xz; gl_Position = projectionMatrix * viewMatrix * w; }`;
const GRID_FRAG = /* glsl */ `
uniform float uTime; uniform vec3 uA; uniform vec3 uB; uniform float uBoost;
varying vec2 vW;
void main(){
  vec2 gp = vW * 0.6;
  vec2 fw = fwidth(gp);
  vec2 l = abs(fract(gp - 0.5) - 0.5) / max(fw, vec2(1e-4));
  float line = 1.0 - min(min(l.x, l.y), 1.0);
  float d = length(vW);
  float fade = exp(-d * 0.15);
  float pulse = 0.5 + 0.5 * sin(d * 0.55 - uTime * 1.3);
  vec3 c = mix(uA, uB, clamp(d * 0.05, 0.0, 1.0));
  float a = line * fade * (0.16 + 0.16 * pulse + uBoost * 0.25) + exp(-d * 0.22) * 0.04;
  gl_FragColor = vec4(c, a);
  #include <colorspace_fragment>
}`;

/** The orb: waveform-displaced sphere with iridescent rim + plasma core. */
const ORB_VERT = /* glsl */ `
uniform float uTime; uniform float uLevel; uniform float uRec; uniform float uProcess;
uniform float uBands[32];
varying vec3 vNormal; varying vec3 vViewDir; varying vec3 vPos; varying float vDisp;
float band(float u){
  float m = abs(u * 2.0 - 1.0);               // mirrored → seamless around the sphere
  float f = m * 31.0;
  int i0 = int(floor(f)); int i1 = min(i0 + 1, 31);
  return mix(uBands[i0], uBands[i1], f - float(i0));
}
void main(){
  vec3 p = position;
  float wob = sin(p.x*3.0 + uTime*1.3) * sin(p.y*3.0 + uTime*1.1) * sin(p.z*3.0 + uTime*1.7);
  float taper = sin(uv.y * 3.14159);
  float wave = band(uv.x) * taper;
  float ripple = sin(uv.y*26.0 - uTime*7.0 + uv.x*12.566) * uLevel * taper;
  float d = wob * (0.035 + uProcess * 0.05) + uRec * (wave * 0.55 + ripple * 0.07);
  p += normal * d;
  vDisp = d;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  vPos = position;
  gl_Position = projectionMatrix * mv;
}`;
const ORB_FRAG = /* glsl */ `
uniform float uTime; uniform float uLevel; uniform float uRec; uniform float uProcess; uniform float uSpeak; uniform float uFlash;
uniform vec3 uGold; uniform vec3 uMagenta; uniform vec3 uViolet; uniform vec3 uTeal; uniform vec3 uDeep; uniform vec3 uWhite;
varying vec3 vNormal; varying vec3 vViewDir; varying vec3 vPos; varying float vDisp;
float hash(vec3 p){ p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float noise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0 - 2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)), hash(i+vec3(1,0,0)), f.x), mix(hash(i+vec3(0,1,0)), hash(i+vec3(1,1,0)), f.x), f.y),
             mix(mix(hash(i+vec3(0,0,1)), hash(i+vec3(1,0,1)), f.x), mix(hash(i+vec3(0,1,1)), hash(i+vec3(1,1,1)), f.x), f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5; float s = 0.0; for(int i = 0; i < 3; i++){ s += a * noise(p); p = p*2.03 + vec3(1.7, 9.2, 3.1); a *= 0.5; } return s; }
vec3 pal(float t){
  t = fract(t) * 3.0;
  if (t < 1.0) return mix(uGold, uMagenta, smoothstep(0.0, 1.0, t));
  if (t < 2.0) return mix(uMagenta, uViolet, smoothstep(0.0, 1.0, t - 1.0));
  return mix(uViolet, uGold, smoothstep(0.0, 1.0, t - 2.0));
}
void main(){
  vec3 N = normalize(vNormal); vec3 V = normalize(vViewDir);
  float fr = pow(1.0 - max(dot(N, V), 0.0), 2.3);

  /* inner swirling plasma: domain-warped noise, spins + speeds up while "thinking" */
  float speed = 0.25 + uProcess * 1.8 + uLevel * 0.7;
  vec3 q = normalize(vPos) * 1.7;
  float ang = uTime * 0.3 * (1.0 + uProcess * 4.0);
  mat2 r = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
  q.xz = r * q.xz;
  vec3 w = vec3(fbm(q + vec3(0.0, uTime*speed, 0.0)), fbm(q + vec3(5.2, 1.3, uTime*speed*0.8)), fbm(q*1.3 - uTime*speed*0.5));
  float pl = fbm(q*1.5 + w*1.8 + uTime*speed*0.3);
  vec3 core = mix(uDeep, uMagenta, smoothstep(0.25, 0.55, pl));
  core = mix(core, uGold, smoothstep(0.5, 0.75, pl));
  core = mix(core, uWhite, smoothstep(0.75, 0.95, pl) * 0.8);
  core *= 0.85 + uLevel * 0.8 + uProcess * 0.5;

  /* iridescent film: the rim colour keeps drifting saffron → magenta → violet */
  float film = fr * 0.9 + N.y * 0.35 + dot(w, vec3(0.3)) + uTime * 0.07 + vDisp * 2.0;
  vec3 irid = pal(film);
  vec3 rim = irid * fr * (1.35 + uLevel * 1.4 + uSpeak * 0.7 + uFlash * 2.0);

  vec3 col = core * (1.0 - fr * 0.4) * 1.15 + rim + irid * 0.08;
  col += uTeal * pow(fr, 5.0) * 0.6 * (0.3 + uRec);
  col += pal(vDisp * 6.0 + uTime * 0.2) * max(vDisp, 0.0) * 3.0 * uRec;   // colourful voice peaks
  col += vec3(1.0, 0.8, 0.5) * uFlash * 0.6;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/** Soft glow shell around the orb (back faces only). */
const HALO_VERT = /* glsl */ `
varying vec3 vNormal; varying vec3 vViewDir;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vNormal = normalize(normalMatrix * normal);
  vViewDir = normalize(-mv.xyz);
  gl_Position = projectionMatrix * mv;
}`;
const HALO_FRAG = /* glsl */ `
uniform vec3 uColor; uniform float uStrength;
varying vec3 vNormal; varying vec3 vViewDir;
void main(){
  float d = dot(normalize(vNormal), normalize(vViewDir));
  float i = pow(clamp(-d, 0.0, 1.0) / 0.72, 2.6) * uStrength;
  gl_FragColor = vec4(uColor * i, i);
  #include <colorspace_fragment>
}`;

/** Fine gold star dust. */
const DUST_VERT = /* glsl */ `
attribute float aSeed; uniform float uTime; uniform float uSize; uniform float uScale;
varying float vTw; varying float vSeed;
void main(){
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vTw = 0.4 + 0.6 * pow(0.5 + 0.5 * sin(uTime * (0.6 + aSeed * 1.6) + aSeed * 60.0), 2.0);
  vSeed = aSeed;
  gl_PointSize = uSize * (0.35 + aSeed) * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const DUST_FRAG = /* glsl */ `
varying float vTw; varying float vSeed;
void main(){
  float d = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, d) * vTw;
  vec3 gold = vec3(1.0, 0.62, 0.18);
  vec3 pale = vec3(1.0, 0.86, 0.55);
  gl_FragColor = vec4(mix(gold, pale, vSeed) * 1.3, a * 0.85);
  #include <colorspace_fragment>
}`;

/**
 * Processing particles:
 *  • uBurstT < 0  → spiral INTO the orb (alpha scales with uSuck)
 *  • uBurstT >= 0 → burst OUTWARD (seconds since the results arrived)
 */
const FLOW_VERT = /* glsl */ `
attribute vec3 aDir; attribute float aSeed;
uniform float uTime; uniform float uSuck; uniform float uBurstT; uniform float uSize; uniform float uScale;
varying float vA; varying float vMix; varying float vSeed;
vec3 rotY(vec3 p, float a){ float c = cos(a); float s = sin(a); return vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z); }
void main(){
  vec3 pos; float a; float mx;
  if (uBurstT >= 0.0) {
    float sp = 2.4 + aSeed * 3.8;
    float k = 1.0 - exp(-uBurstT * 2.2);
    pos = rotY(aDir * (1.1 + k * sp), uBurstT * (0.8 + aSeed));
    a = pow(max(0.0, 1.0 - uBurstT / 2.1), 1.4);
    mx = 1.0;
  } else {
    float ph = fract(uTime * (0.16 + aSeed * 0.12) + aSeed * 7.0);
    float r = mix(7.0, 1.15, ph * ph);
    pos = rotY(aDir * r, (1.0 - ph) * (5.0 + aSeed * 3.0));   // spiral inward
    a = uSuck * sin(ph * 3.14159);
    mx = ph;
  }
  vA = a; vMix = mx; vSeed = aSeed;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = uSize * (0.6 + aSeed) * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const FLOW_FRAG = /* glsl */ `
uniform vec3 uC1; uniform vec3 uC2; uniform vec3 uC3;
varying float vA; varying float vMix; varying float vSeed;
void main(){
  float d = length(gl_PointCoord - 0.5);
  vec3 c = mix(uC1, uC2, smoothstep(0.0, 0.5, vSeed));
  c = mix(c, uC3, smoothstep(0.5, 1.0, vSeed));
  c = mix(c, vec3(1.0, 0.93, 0.7), vMix * 0.55);
  gl_FragColor = vec4(c * 1.5, smoothstep(0.5, 0.0, d) * vA);
  #include <colorspace_fragment>
}`;

/** Owe-thread: gradient cyan → white-gold with bright packets flowing along it. */
const THREAD_VERT = /* glsl */ `
varying float vT;
void main(){ vT = uv.x; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const THREAD_FRAG = /* glsl */ `
varying float vT; uniform float uTime; uniform float uReveal; uniform float uBright; uniform vec3 uA; uniform vec3 uB;
void main(){
  if (vT > uReveal) discard;
  float f = fract(vT * 3.0 - uTime * 0.6);
  float pulse = pow(1.0 - f, 5.0);
  float head = smoothstep(uReveal - 0.08, uReveal, vT) * step(uReveal, 0.999);
  vec3 c = mix(uA, uB, vT);
  float a = (0.42 + pulse * 0.9 + head * 1.2) * uBright;
  gl_FragColor = vec4(c * (1.0 + pulse + head * 2.0), a);
  #include <colorspace_fragment>
}`;

/* ═══════════════════════════ texture helpers ═══════════════════════════ */

function makeGlowTexture(): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Emoji drawn on a canvas → texture for the icon floating inside each gem. */
function makeIconTexture(emoji: string): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d")!;
  g.font = '86px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif';
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(emoji, 64, 70);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

/** Small glass pill with 1–2 lines of text, shown as a sprite. */
function makeLabel(lines: string[], accent: string): THREE.Sprite {
  const big = 34;
  const small = 27;
  const c = document.createElement("canvas");
  let g = c.getContext("2d")!;
  const fontFor = (i: number) => `${i === 0 ? 700 : 600} ${i === 0 ? big : small}px system-ui, "Segoe UI Emoji", sans-serif`;
  let maxW = 0;
  lines.forEach((l, i) => {
    g.font = fontFor(i);
    maxW = Math.max(maxW, g.measureText(l).width);
  });
  const w = Math.ceil(maxW) + 54;
  const h = lines.length === 1 ? big + 30 : big + small + 38;
  c.width = w;
  c.height = h;
  g = c.getContext("2d")!;
  g.textBaseline = "middle";
  g.textAlign = "center";
  const r = Math.min(26, h / 2);
  g.beginPath();
  g.roundRect(2, 2, w - 4, h - 4, r);
  const bg = g.createLinearGradient(0, 0, w, h);
  bg.addColorStop(0, "rgba(46,18,78,0.85)");
  bg.addColorStop(1, "rgba(14,6,28,0.85)");
  g.fillStyle = bg;
  g.fill();
  g.strokeStyle = accent;
  g.lineWidth = 3;
  g.stroke();
  const y0 = lines.length === 1 ? h / 2 : 15 + big / 2 + 3;
  lines.forEach((l, i) => {
    g.font = fontFor(i);
    g.fillStyle = i === 0 ? "#ffffff" : "#ffe3a3";
    g.fillText(l, w / 2, i === 0 ? y0 : y0 + big / 2 + small / 2 + 4);
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const s = new THREE.Sprite(mat);
  const worldH = 0.3 * (h / (big + 30));
  s.scale.set((worldH * w) / h, worldH, 1);
  return s;
}

const truncate = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + "…" : s);

/* ═══════════════════════════ internal types ═══════════════════════════ */

const SPARKS = 7;
const TRAIL = 22;

interface NodeObj {
  index: number;
  risk: Risk;
  baseColor: THREE.Color;
  group: THREE.Group;
  gemGroup: THREE.Group;
  gemMat: THREE.MeshStandardMaterial;
  hit: THREE.Mesh;
  glow: THREE.Sprite;
  icon: THREE.Sprite;
  label: THREE.Sprite;
  sel: THREE.Mesh;
  alerts: THREE.Mesh[];
  target: THREE.Vector3;
  angle: number;
  delay: number;
  thread: THREE.Mesh;
  threadMat: THREE.ShaderMaterial;
  curve: THREE.QuadraticBezierCurve3;
  sparks: THREE.Points;
  sparkPos: Float32Array;
  sparkCol: Float32Array;
  trail: THREE.Points;
  trailPos: Float32Array;
  trailCol: Float32Array;
  history: THREE.Vector3[];
  hover: number;
  selAmt: number;
  landed: boolean;
}
interface AnchorObj {
  group: THREE.Group;
  name: string;
  angle: number;
}
interface OrbitRing {
  tilt: THREE.Group;
  ring: THREE.Mesh;
  mat: THREE.MeshBasicMaterial;
  bead: THREE.Mesh;
  speed: number;
}

export interface SceneOptions {
  onSelect?: (index: number | null) => void;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const SPECTRUM_N = 96;
const RING_POOL = 8;
const ANCHOR_R = 3.9;
const NODE_R = 2.9;
const INTRO_SECONDS = 5;
const FLOW_N = 1100;

export class VachanScene {
  private container: HTMLElement;
  private opts: SceneOptions;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private raf = 0;
  private last = performance.now();
  private time = 0;
  private age = 0; // seconds since promises were set
  private ro: ResizeObserver;
  private pixelRatio: number;

  // state
  private mode: SceneMode = "idle";
  private source: AudioSource | null = null;
  private speaking = false;
  private level = 0;
  private recAmt = 0;
  private process = 0;
  private speakAmt = 0;
  private flash = 0;
  private burstT = -1;
  private ringTimer = 0;
  private ringColorIdx = 0;
  private selected: number | null = null;
  private analysis: Analysis | null = null;
  private bands = new Float32Array(32);

  // camera helpers
  private pendingAz = 0;
  private pendingPol = 0;
  private distTarget: number | null = null;
  private introT = 0;
  private homeSph = new THREE.Spherical();
  private lastInteract = -10;
  private shake = 0;
  private viewW = 1;
  private viewH = 1;
  private shiftX = 0; // pixels the picture is pushed left (when the chat panel is open)
  private shiftTarget = 0;
  private shakeOff = new THREE.Vector3();

  // objects
  private bgMat: THREE.ShaderMaterial;
  private gridMat: THREE.ShaderMaterial;
  private orbGroup = new THREE.Group();
  private orbMat: THREE.ShaderMaterial;
  private haloMat: THREE.ShaderMaterial;
  private orbMesh: THREE.Mesh;
  private orbLight: THREE.PointLight;
  private dust: THREE.Points;
  private dustMat: THREE.ShaderMaterial;
  private flow: THREE.Points;
  private flowMat: THREE.ShaderMaterial;
  private orbitRings: OrbitRing[] = [];
  private rings: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; age: number; life: number; power: number; grow: number }[] = [];
  private spectrumLine: THREE.LineLoop;
  private spectrumPos: Float32Array;
  private orbit = new THREE.Group(); // holds anchors, gems, threads; slowly rotates
  private nodes: NodeObj[] = [];
  private anchors: AnchorObj[] = [];
  private glowTex: THREE.CanvasTexture;

  // pointer
  private raycaster = new THREE.Raycaster();
  private ndc = new THREE.Vector2();
  private downX = 0;
  private downY = 0;
  private downT = 0;
  private hoverIndex: number | null = null;
  private pointerDirty = false;
  private tmp = new THREE.Vector3();
  private tmpC = new THREE.Color();

  constructor(container: HTMLElement, opts: SceneOptions = {}) {
    this.container = container;
    this.opts = opts;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, 1.6);

    this.renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setClearColor(0x0a0612, 1);
    const canvas = this.renderer.domElement;
    canvas.style.display = "block";
    canvas.style.touchAction = "none";
    container.appendChild(canvas);

    const w = container.clientWidth || window.innerWidth;
    const h = container.clientHeight || window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 300);
    const aspect = w / h;
    this.camera.position.set(0, 1.6, aspect < 0.8 ? 13.5 : 9.5); // farther back on phones
    this.homeSph.setFromVector3(this.camera.position);

    /* camera controls: mouse / touch fallback that always works */
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.06;
    this.controls.enablePan = false;
    this.controls.minDistance = 4.5;
    this.controls.maxDistance = 18;
    this.controls.rotateSpeed = 0.6;
    this.controls.zoomSpeed = 0.7;
    this.controls.minPolarAngle = 0.25;
    this.controls.maxPolarAngle = Math.PI - 0.25;
    this.controls.autoRotateSpeed = 0.7;
    this.controls.addEventListener("start", () => (this.lastInteract = this.time + 1000));
    this.controls.addEventListener("end", () => (this.lastInteract = this.time));
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) this.introT = 1;

    this.glowTex = makeGlowTexture();

    /* ── post-processing: render → bloom → colour output ── */
    const target = new THREE.WebGLRenderTarget(w * this.pixelRatio, h * this.pixelRatio, {
      type: THREE.HalfFloatType,
      samples: 4, // anti-aliasing (the composer has no built-in MSAA)
    });
    this.composer = new EffectComposer(this.renderer, target);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.6, 0.7, 0.55);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());

    /* ── aurora background ── */
    this.bgMat = new THREE.ShaderMaterial({
      vertexShader: BG_VERT,
      fragmentShader: BG_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uAspect: { value: aspect },
        uBoost: { value: 0 },
        uTop: { value: COL.plumTop },
        uBottom: { value: COL.plumBottom },
        uC1: { value: COL.magenta },
        uC2: { value: COL.violet },
        uC3: { value: COL.teal },
        uC4: { value: COL.saffron },
      },
      depthTest: false,
      depthWrite: false,
    });
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.bgMat);
    bg.frustumCulled = false;
    bg.renderOrder = -1000;
    this.scene.add(bg);

    /* ── grid floor ── */
    this.gridMat = new THREE.ShaderMaterial({
      vertexShader: GRID_VERT,
      fragmentShader: GRID_FRAG,
      uniforms: { uTime: { value: 0 }, uA: { value: COL.magenta }, uB: { value: COL.violet }, uBoost: { value: 0 } },
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const grid = new THREE.Mesh(new THREE.PlaneGeometry(90, 90), this.gridMat);
    grid.rotation.x = -Math.PI / 2;
    grid.position.y = -3.4;
    grid.renderOrder = -500;
    this.scene.add(grid);

    /* ── lights (gems use standard material; orange from the orb, teal + magenta from the sides) ── */
    this.scene.add(new THREE.AmbientLight(0xa58bff, 0.75));
    this.orbLight = new THREE.PointLight(0xff9a5c, 24, 0, 2);
    this.scene.add(this.orbLight);
    const tealLight = new THREE.DirectionalLight(0x14f1d9, 1.1);
    tealLight.position.set(-6, 4, 6);
    this.scene.add(tealLight);
    const pinkLight = new THREE.DirectionalLight(0xff3d9a, 1.0);
    pinkLight.position.set(6, -2, 5);
    this.scene.add(pinkLight);

    /* ── Orb ── */
    this.orbMat = new THREE.ShaderMaterial({
      vertexShader: ORB_VERT,
      fragmentShader: ORB_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uLevel: { value: 0 },
        uRec: { value: 0 },
        uProcess: { value: 0 },
        uSpeak: { value: 0 },
        uFlash: { value: 0 },
        uBands: { value: this.bands },
        uGold: { value: COL.saffron },
        uMagenta: { value: COL.magenta },
        uViolet: { value: COL.violet },
        uTeal: { value: COL.teal },
        uDeep: { value: COL.deep },
        uWhite: { value: COL.gold },
      },
    });
    this.orbMesh = new THREE.Mesh(new THREE.SphereGeometry(1.2, 128, 96), this.orbMat);
    this.orbGroup.add(this.orbMesh);

    this.haloMat = new THREE.ShaderMaterial({
      vertexShader: HALO_VERT,
      fragmentShader: HALO_FRAG,
      uniforms: { uColor: { value: new THREE.Color(COL.magenta) }, uStrength: { value: 0.8 } },
      side: THREE.BackSide,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.orbGroup.add(new THREE.Mesh(new THREE.SphereGeometry(1.8, 48, 32), this.haloMat));
    this.scene.add(this.orbGroup);

    /* ── 3 thin glowing orbit rings, each tilted differently, each with a bead ── */
    const ringDefs = [
      { r: 1.95, tilt: [1.25, 0.2, 0], col: COL.saffron, speed: 0.5 },
      { r: 2.2, tilt: [0.45, 0, 0.95], col: COL.magenta, speed: -0.38 },
      { r: 2.45, tilt: [-0.75, 0, -0.5], col: COL.teal, speed: 0.3 },
    ];
    for (const d of ringDefs) {
      const tilt = new THREE.Group();
      tilt.rotation.set(d.tilt[0], d.tilt[1], d.tilt[2]);
      const mat = new THREE.MeshBasicMaterial({
        color: d.col.clone().multiplyScalar(1.7),
        transparent: true,
        opacity: 0.85,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(d.r, 0.011, 8, 200), mat);
      const bead = new THREE.Mesh(
        new THREE.SphereGeometry(0.055, 12, 10),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(2), toneMapped: false }),
      );
      bead.position.set(d.r, 0, 0);
      ring.add(bead);
      tilt.add(ring);
      this.scene.add(tilt);
      this.orbitRings.push({ tilt, ring, mat, bead, speed: d.speed });
    }

    /* ── Inflow / burst particles (processing) ── */
    const fg = new THREE.BufferGeometry();
    const fdir = new Float32Array(FLOW_N * 3);
    const fseed = new Float32Array(FLOW_N);
    for (let i = 0; i < FLOW_N; i++) {
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      fdir[i * 3] = Math.sin(ph) * Math.cos(th);
      fdir[i * 3 + 1] = Math.cos(ph) * 0.7;
      fdir[i * 3 + 2] = Math.sin(ph) * Math.sin(th);
      fseed[i] = Math.random();
    }
    fg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(FLOW_N * 3), 3));
    fg.setAttribute("aDir", new THREE.BufferAttribute(fdir, 3));
    fg.setAttribute("aSeed", new THREE.BufferAttribute(fseed, 1));
    this.flowMat = new THREE.ShaderMaterial({
      vertexShader: FLOW_VERT,
      fragmentShader: FLOW_FRAG,
      uniforms: {
        uTime: { value: 0 },
        uSuck: { value: 0 },
        uBurstT: { value: -1 },
        uSize: { value: 0.1 },
        uScale: { value: h * this.pixelRatio },
        uC1: { value: COL.teal },
        uC2: { value: COL.magenta },
        uC3: { value: COL.saffron },
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.flow = new THREE.Points(fg, this.flowMat);
    this.flow.frustumCulled = false;
    this.scene.add(this.flow);

    /* ── Gold star dust ── */
    const DN = 2400;
    const dpos = new Float32Array(DN * 3);
    const dseed = new Float32Array(DN);
    for (let i = 0; i < DN; i++) {
      const r = 8 + Math.random() * 40;
      const th = Math.random() * Math.PI * 2;
      const ph = Math.acos(2 * Math.random() - 1);
      dpos[i * 3] = r * Math.sin(ph) * Math.cos(th);
      dpos[i * 3 + 1] = r * Math.cos(ph) * 0.8;
      dpos[i * 3 + 2] = r * Math.sin(ph) * Math.sin(th);
      dseed[i] = Math.random();
    }
    const dg = new THREE.BufferGeometry();
    dg.setAttribute("position", new THREE.BufferAttribute(dpos, 3));
    dg.setAttribute("aSeed", new THREE.BufferAttribute(dseed, 1));
    this.dustMat = new THREE.ShaderMaterial({
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      uniforms: { uTime: { value: 0 }, uSize: { value: 0.13 }, uScale: { value: h * this.pixelRatio } },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.dust = new THREE.Points(dg, this.dustMat);
    this.dust.frustumCulled = false;
    this.scene.add(this.dust);

    /* ── Ripple rings (pool) — colourful, face the camera ── */
    const ringGeo = new THREE.RingGeometry(0.95, 1, 128);
    for (let i = 0; i < RING_POOL; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        toneMapped: false,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      this.scene.add(mesh);
      this.rings.push({ mesh, mat, age: 0, life: 2.2, power: 0, grow: 5 });
    }

    /* ── Live spectrum ring: jagged rainbow ring that follows your voice ── */
    this.spectrumPos = new Float32Array(SPECTRUM_N * 3);
    const specCol = new Float32Array(SPECTRUM_N * 3);
    for (let i = 0; i < SPECTRUM_N; i++) {
      palette(i / SPECTRUM_N, this.tmpC);
      specCol[i * 3] = this.tmpC.r * 1.6;
      specCol[i * 3 + 1] = this.tmpC.g * 1.6;
      specCol[i * 3 + 2] = this.tmpC.b * 1.6;
    }
    const lg = new THREE.BufferGeometry();
    lg.setAttribute("position", new THREE.BufferAttribute(this.spectrumPos, 3));
    lg.setAttribute("color", new THREE.BufferAttribute(specCol, 3));
    this.spectrumLine = new THREE.LineLoop(
      lg,
      new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }),
    );
    this.spectrumLine.frustumCulled = false;
    this.scene.add(this.spectrumLine);

    this.scene.add(this.orbit);

    /* events */
    canvas.addEventListener("pointerdown", this.onDown);
    canvas.addEventListener("pointerup", this.onUp);
    canvas.addEventListener("pointermove", this.onMove);
    canvas.addEventListener("pointerleave", this.onLeave);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();

    this.loop();
  }

  /* ════════════ public API ════════════ */

  setMode(mode: SceneMode) {
    this.mode = mode;
  }

  setAudioSource(src: AudioSource | null) {
    this.source = src;
  }

  setSpeaking(on: boolean) {
    this.speaking = on;
  }

  get promiseCount() {
    return this.nodes.length;
  }

  /** Builds gems + threads for a new analysis (or clears when null). */
  setAnalysis(a: Analysis | null) {
    this.clearPromises();
    this.analysis = a;
    this.age = 0;
    this.orbit.rotation.y = 0;
    if (!a) return;

    // the orb "exhales": particle burst + flash + a big ripple
    this.burstT = 0;
    this.flash = 1;
    this.spawnRing(1, COL.gold, 7.5);

    const names = [...a.parties];
    for (const p of a.promises) {
      if (!names.includes(p.who)) names.push(p.who);
      if (!names.includes(p.to)) names.push(p.to);
    }
    const P = names.length;
    const anchorAngle = (k: number) => Math.PI / 2 + (k * 2 * Math.PI) / P;
    const anchorPos = (k: number) =>
      new THREE.Vector3(Math.sin(anchorAngle(k)) * ANCHOR_R, 0, Math.cos(anchorAngle(k)) * ANCHOR_R);

    /* party anchors: glowing "people" markers on the orbit */
    names.forEach((name, k) => {
      const g = new THREE.Group();
      g.position.copy(anchorPos(k));
      const tint = k % 2 === 0 ? COL.saffron : COL.teal;
      const core = new THREE.Mesh(
        new THREE.IcosahedronGeometry(0.24, 1),
        new THREE.MeshStandardMaterial({ color: tint, emissive: tint, emissiveIntensity: 1.2, roughness: 0.3, flatShading: true }),
      );
      g.add(core);
      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.glowTex, color: tint, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      glow.scale.setScalar(1.5);
      g.add(glow);
      const label = makeLabel(["👤 " + name], "#" + tint.getHexString());
      label.position.y = 0.66;
      g.add(label);
      g.scale.setScalar(0.0001);
      this.orbit.add(g);
      this.anchors.push({ group: g, name, angle: anchorAngle(k) });
    });

    /* decide where each gem sits on the orbit */
    const sideCount = [0, 0];
    const sideSeen = [0, 0];
    if (P <= 2) a.promises.forEach((_, i) => sideCount[i % 2]++);

    const gemGeo = new THREE.OctahedronGeometry(0.34, 0);
    const edgeGeo = new THREE.EdgesGeometry(gemGeo);

    a.promises.forEach((p, i) => {
      const ia = Math.max(0, names.indexOf(p.who));
      const ib = Math.max(0, names.indexOf(p.to));
      let ang: number;
      if (P <= 2) {
        const side = i % 2;
        const k = sideSeen[side]++;
        ang = side * Math.PI + (k - (sideCount[side] - 1) / 2) * 0.62;
      } else {
        const a1 = anchorAngle(ia);
        ang = a1 + wrapPi(anchorAngle(ib) - a1) / 2 + ((i % 3) - 1) * 0.12;
      }
      const r = NODE_R + (i % 2) * 0.25;
      const y = ((i % 3) - 1) * 0.55;
      const target = new THREE.Vector3(Math.sin(ang) * r, y, Math.cos(ang) * r);

      const color = new THREE.Color(RISK_COLOR[p.risk]);
      const group = new THREE.Group();

      /* the gem: translucent faceted crystal + bright edges */
      const gemGroup = new THREE.Group();
      const gemMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.75,
        roughness: 0.12,
        metalness: 0.3,
        flatShading: true,
        transparent: true,
        opacity: 0.66,
        depthWrite: false,
      });
      const gem = new THREE.Mesh(gemGeo, gemMat);
      gem.scale.set(1, 1.35, 1);
      gem.renderOrder = 2;
      gemGroup.add(gem);
      const edges = new THREE.LineSegments(
        edgeGeo,
        new THREE.LineBasicMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.45).multiplyScalar(1.6), transparent: true, opacity: 0.95, toneMapped: false }),
      );
      edges.scale.set(1, 1.35, 1);
      edges.renderOrder = 3;
      gemGroup.add(edges);
      group.add(gemGroup);

      /* the icon floating inside (💰 📅 🏠 🤝 ⚠️) */
      const icon = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: makeIconTexture(iconFor(p)), transparent: true, depthTest: false, depthWrite: false }),
      );
      icon.scale.setScalar(0.34);
      icon.renderOrder = 5;
      group.add(icon);

      // big invisible sphere = easy to tap with a finger
      const hit = new THREE.Mesh(new THREE.SphereGeometry(0.66, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
      hit.userData.index = i;
      group.add(hit);

      const glow = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: this.glowTex, color, transparent: true, opacity: 0.75, blending: THREE.AdditiveBlending, depthWrite: false }),
      );
      glow.scale.setScalar(2.0);
      group.add(glow);

      const head = p.amount !== null ? "₹" + p.amount.toLocaleString("en-IN") : truncate(p.what, 18);
      const label = makeLabel([`${RISK_EMOJI[p.risk]} ${head}`, `📅 ${truncate(p.due, 20)}`], "#" + color.getHexString());
      label.position.y = 0.82;
      label.renderOrder = 6;
      group.add(label);

      const sel = new THREE.Mesh(
        new THREE.RingGeometry(0.5, 0.55, 64),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }),
      );
      group.add(sel);

      /* red = pulsing shockwave rings */
      const alerts: THREE.Mesh[] = [];
      if (p.risk === "red") {
        for (let k = 0; k < 2; k++) {
          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.4, 0.45, 64),
            new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.6), transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
          );
          group.add(ring);
          alerts.push(ring);
        }
      }

      /* thread: owes party → (passes through this gem) → owed party */
      const A = anchorPos(ia);
      const B = anchorPos(ib);
      const C = target.clone().multiplyScalar(2).sub(A.clone().add(B).multiplyScalar(0.5));
      const curve = new THREE.QuadraticBezierCurve3(A, C, B);
      const threadMat = new THREE.ShaderMaterial({
        vertexShader: THREAD_VERT,
        fragmentShader: THREAD_FRAG,
        uniforms: {
          uTime: { value: 0 },
          uReveal: { value: 0 },
          uBright: { value: 0.7 },
          uA: { value: COL.cyan },
          uB: { value: COL.gold },
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const thread = new THREE.Mesh(new THREE.TubeGeometry(curve, 90, 0.022, 6, false), threadMat);
      thread.frustumCulled = false;
      this.orbit.add(thread);

      /* little lights travelling along the thread, from "owes" to "owed" */
      const sparkPos = new Float32Array(SPARKS * 3);
      const sparkCol = new Float32Array(SPARKS * 3);
      const sg = new THREE.BufferGeometry();
      sg.setAttribute("position", new THREE.BufferAttribute(sparkPos, 3));
      sg.setAttribute("color", new THREE.BufferAttribute(sparkCol, 3));
      const sparks = new THREE.Points(
        sg,
        new THREE.PointsMaterial({ size: 0.26, map: this.glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
      );
      sparks.frustumCulled = false;
      sparks.visible = false;
      this.orbit.add(sparks);

      /* light trail while flying out of the orb */
      const trailPos = new Float32Array(TRAIL * 3);
      const trailCol = new Float32Array(TRAIL * 3);
      const tg = new THREE.BufferGeometry();
      tg.setAttribute("position", new THREE.BufferAttribute(trailPos, 3));
      tg.setAttribute("color", new THREE.BufferAttribute(trailCol, 3));
      const trail = new THREE.Points(
        tg,
        new THREE.PointsMaterial({ size: 0.2, map: this.glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
      );
      trail.frustumCulled = false;
      trail.visible = false;
      this.orbit.add(trail);
      const history = Array.from({ length: TRAIL }, () => new THREE.Vector3());

      group.scale.setScalar(0.0001);
      this.orbit.add(group);

      this.nodes.push({
        index: i, risk: p.risk, baseColor: color, group, gemGroup, gemMat, hit, glow, icon, label, sel, alerts, target,
        angle: ang, delay: 0.5 + i * 0.6, thread, threadMat, curve, sparks, sparkPos, sparkCol, trail, trailPos, trailCol,
        history, hover: 0, selAmt: 0, landed: false,
      });
    });
  }

  /** Focus a promise (turns the orbit so it faces you) or pass null to release. */
  focus(index: number | null) {
    if (index !== null && (index < 0 || index >= this.nodes.length)) return;
    this.selected = index;
    if (index !== null) {
      const d = this.getDistance();
      this.distTarget = clamp(d, 5.5, 8.5);
    }
    this.opts.onSelect?.(index);
  }
  next() {
    const n = this.nodes.length;
    if (!n) return;
    this.focus(this.selected === null ? 0 : (this.selected + 1) % n);
  }
  prev() {
    const n = this.nodes.length;
    if (!n) return;
    this.focus(this.selected === null ? n - 1 : (this.selected - 1 + n) % n);
  }

  /** Gesture hook: rotate camera around the orb (radians; eased). */
  rotateBy(dAzimuth: number, dPolar: number) {
    this.pendingAz += dAzimuth;
    this.pendingPol += dPolar;
    this.lastInteract = this.time;
  }
  /** Gesture hook: ease the camera distance to `d` (or null to stop). */
  setDistanceTarget(d: number | null) {
    this.distTarget = d === null ? null : clamp(d, this.controls.minDistance, this.controls.maxDistance);
    this.lastInteract = this.time;
  }
  getDistance() {
    return this.camera.position.distanceTo(this.controls.target);
  }

  /** Renders one frame and returns a copy for the share card. */
  snapshot(): HTMLCanvasElement {
    this.composer.render(0);
    const src = this.renderer.domElement;
    const out = document.createElement("canvas");
    out.width = src.width;
    out.height = src.height;
    out.getContext("2d")!.drawImage(src, 0, 0);
    return out;
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointerdown", this.onDown);
    canvas.removeEventListener("pointerup", this.onUp);
    canvas.removeEventListener("pointermove", this.onMove);
    canvas.removeEventListener("pointerleave", this.onLeave);
    this.controls.dispose();
    this.clearPromises();
    this.scene.traverse((o) => {
      const m = o as THREE.Mesh;
      m.geometry?.dispose?.();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose?.();
    });
    this.glowTex.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    canvas.remove();
  }

  /* ════════════ internals ════════════ */

  private clearPromises() {
    const disposeTree = (obj: THREE.Object3D) => {
      obj.traverse((o) => {
        const m = o as THREE.Mesh & { material?: THREE.Material & { map?: THREE.Texture | null } };
        m.geometry?.dispose?.();
        if (m.material) {
          // sprite labels/icons own their canvas texture; the shared glow texture is kept
          if (m.material.map && m.material.map !== this.glowTex) m.material.map.dispose();
          m.material.dispose();
        }
      });
    };
    for (const n of this.nodes) {
      disposeTree(n.group);
      disposeTree(n.thread);
      disposeTree(n.sparks);
      disposeTree(n.trail);
    }
    for (const a of this.anchors) disposeTree(a.group);
    this.orbit.clear();
    this.nodes = [];
    this.anchors = [];
    this.selected = null;
    this.hoverIndex = null;
    this.opts.onSelect?.(null);
  }

  private resize() {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(this.pixelRatio);
    this.renderer.setSize(w, h, true);
    this.composer.setPixelRatio(this.pixelRatio);
    this.composer.setSize(w, h);
    this.camera.aspect = w / h;
    this.viewW = w;
    this.viewH = h;
    this.applyView();
    const scale = h * this.pixelRatio;
    this.dustMat.uniforms.uScale.value = scale;
    this.flowMat.uniforms.uScale.value = scale;
    this.bgMat.uniforms.uAspect.value = w / h;
  }

  /**
   * Nudges the picture up (clear of the timeline / mic) and sideways (clear of the chat panel).
   * Uses the camera's view offset, so clicking and raycasting stay exact.
   */
  private applyView() {
    const w = this.viewW;
    const h = this.viewH;
    const lift = w < h * 0.8 ? 0.03 : h < 720 ? 0.1 : 0.06;
    this.camera.setViewOffset(w, h, this.shiftX, h * lift, w, h);
  }

  /** Push the whole picture left by `px` pixels (eased). Pass 0 to centre it again. */
  setLayoutShift(px: number) {
    this.shiftTarget = px;
  }

  private spawnRing(power: number, color?: THREE.Color, grow = 5.2) {
    const ring = this.rings.find((r) => !r.mesh.visible);
    if (!ring) return;
    ring.age = 0;
    ring.life = 2.1 + power * 0.6;
    ring.power = power;
    ring.grow = grow;
    const c = color ?? RIPPLE_COLORS[this.ringColorIdx++ % RIPPLE_COLORS.length];
    ring.mat.color.copy(c).multiplyScalar(1.7);
    ring.mesh.visible = true;
  }

  private pick(clientX: number, clientY: number): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1));
    this.raycaster.setFromCamera(this.ndc, this.camera);
    const hits = this.raycaster.intersectObjects(this.nodes.map((n) => n.hit), false);
    return hits.length ? (hits[0].object.userData.index as number) : null;
  }

  private onDown = (e: PointerEvent) => {
    this.downX = e.clientX;
    this.downY = e.clientY;
    this.downT = performance.now();
  };
  private onUp = (e: PointerEvent) => {
    const moved = Math.hypot(e.clientX - this.downX, e.clientY - this.downY);
    if (moved > 8 || performance.now() - this.downT > 600) return; // it was a drag, not a tap
    const idx = this.pick(e.clientX, e.clientY);
    if (idx !== null) this.focus(idx);
    else if (this.selected !== null) this.focus(null);
  };
  private onMove = (e: PointerEvent) => {
    if (e.pointerType !== "mouse" || e.buttons) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -(((e.clientY - rect.top) / rect.height) * 2 - 1));
    this.pointerDirty = true;
  };
  private onLeave = () => {
    this.hoverIndex = null;
    this.pointerDirty = false;
  };

  private loop = () => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min((now - this.last) / 1000, 0.05);
    this.last = now;
    this.update(dt);
    this.composer.render(dt);
  };

  private update(dt: number) {
    if (this.shiftX !== this.shiftTarget) {
      this.shiftX = Math.abs(this.shiftX - this.shiftTarget) > 0.3 ? damp(this.shiftX, this.shiftTarget, 5, dt) : this.shiftTarget;
      this.applyView();
    }
    this.time += dt;
    this.age += dt;
    const t = this.time;

    /* ── smoothed state ── */
    const recording = this.mode === "recording";
    this.recAmt = damp(this.recAmt, recording ? 1 : 0, 5, dt);
    this.process = damp(this.process, this.mode === "processing" ? 1 : 0, 2.2, dt);
    this.speakAmt = damp(this.speakAmt, this.speaking ? 1 : 0, 5, dt);
    this.flash = damp(this.flash, 0, 2.6, dt);
    const raw = recording && this.source ? this.source.level() : 0;
    const speakPulse = this.speakAmt * (0.28 + 0.2 * Math.sin(t * 9) * Math.sin(t * 3.1));
    this.level = damp(this.level, Math.max(raw, speakPulse), 14, dt);

    /* waveform bands: your voice while recording, a soft synthetic wave while the app speaks */
    const spec = recording && this.source ? this.source.spectrum(48) : null;
    for (let i = 0; i < 32; i++) {
      let target = 0;
      if (spec) target = spec[Math.floor((i * 47) / 31)];
      else if (this.speakAmt > 0.05) target = this.speakAmt * (0.3 + 0.25 * Math.sin(t * 7 + i * 0.7) * Math.sin(t * 2.3 + i * 0.2));
      this.bands[i] = damp(this.bands[i], target, spec ? 18 : 7, dt);
    }
    const recVis = Math.max(this.recAmt, this.speakAmt * 0.35);

    /* ── orb ── */
    const u = this.orbMat.uniforms;
    u.uTime.value = t;
    u.uLevel.value = this.level;
    u.uRec.value = recVis;
    u.uProcess.value = this.process;
    u.uSpeak.value = this.speakAmt;
    u.uFlash.value = this.flash;
    this.orbMesh.rotation.y += dt * (0.15 + this.process * 2.4);
    this.orbMesh.rotation.x = Math.sin(t * 0.3) * 0.15;
    const breath = 1 + 0.028 * Math.sin(t * 1.25) + this.level * 0.12 + this.process * 0.04 * Math.sin(t * 6) + this.flash * 0.1;
    this.orbGroup.scale.setScalar(breath);
    palette(t * 0.06, this.haloMat.uniforms.uColor.value as THREE.Color);
    this.haloMat.uniforms.uStrength.value = 0.7 + 0.2 * Math.sin(t * 1.25) + this.level * 1.2 + this.process * 0.5 + this.flash * 1.2;
    this.orbLight.intensity = 22 + this.level * 40 + this.process * 12 + this.flash * 40;
    this.bloom.strength = 0.55 + this.level * 0.4 + this.flash * 0.6 + this.process * 0.15;

    /* ── background, floor, dust ── */
    this.bgMat.uniforms.uTime.value = t;
    this.bgMat.uniforms.uBoost.value = this.level * 0.6 + this.process * 0.4 + this.flash * 0.5;
    this.gridMat.uniforms.uTime.value = t;
    this.gridMat.uniforms.uBoost.value = this.level + this.process * 0.6 + this.flash;
    this.dust.rotation.y += dt * 0.012;
    this.dustMat.uniforms.uTime.value = t;

    /* ── 3 orbit rings spin (faster while thinking) ── */
    for (const r of this.orbitRings) {
      r.ring.rotation.z += dt * r.speed * (1 + this.process * 4);
      r.tilt.rotation.y += dt * 0.05 * Math.sign(r.speed);
      r.mat.opacity = 0.7 + this.level * 0.3 + this.process * 0.2;
    }

    /* ── inflow (processing) / burst (results) particles ── */
    if (this.burstT >= 0) {
      this.burstT += dt;
      if (this.burstT > 2.2) this.burstT = -1;
    }
    this.flowMat.uniforms.uTime.value = t;
    this.flowMat.uniforms.uSuck.value = this.process;
    this.flowMat.uniforms.uBurstT.value = this.burstT;
    this.flow.visible = this.process > 0.01 || this.burstT >= 0;

    /* ── colourful ripple rings (while recording) ── */
    if (recording) {
      this.ringTimer += dt;
      const interval = 0.8 - this.level * 0.62;
      if (this.ringTimer > interval) {
        this.ringTimer = 0;
        this.spawnRing(0.25 + this.level * 0.75);
      }
    }
    for (const r of this.rings) {
      if (!r.mesh.visible) continue;
      r.age += dt;
      const k = r.age / r.life;
      if (k >= 1) {
        r.mesh.visible = false;
        continue;
      }
      r.mesh.quaternion.copy(this.camera.quaternion); // always face the viewer
      r.mesh.scale.setScalar(1.45 + easeOutCubic(k) * r.grow);
      r.mat.opacity = Math.pow(1 - k, 1.6) * (0.3 + r.power * 0.7);
    }

    /* live rainbow spectrum ring */
    const sp = this.spectrumLine.material as THREE.LineBasicMaterial;
    sp.opacity = this.recAmt * 0.9;
    this.spectrumLine.visible = this.recAmt > 0.02;
    if (this.spectrumLine.visible) {
      const bars = spec ?? new Float32Array(48);
      for (let i = 0; i < SPECTRUM_N; i++) {
        const idx = i < SPECTRUM_N / 2 ? i : SPECTRUM_N - 1 - i; // mirrored
        const a = (i / SPECTRUM_N) * Math.PI * 2 + t * 0.15;
        const rad = 1.85 * breath + bars[idx] * 1.0;
        this.spectrumPos[i * 3] = Math.cos(a) * rad;
        this.spectrumPos[i * 3 + 1] = Math.sin(a) * rad;
        this.spectrumPos[i * 3 + 2] = 0;
      }
      (this.spectrumLine.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
      this.spectrumLine.quaternion.copy(this.camera.quaternion);
    }

    /* ── orbit group: slow drift, or turn the focused gem toward the camera ── */
    if (this.selected !== null && this.nodes[this.selected]) {
      const camA = Math.atan2(this.camera.position.x, this.camera.position.z);
      const want = camA - this.nodes[this.selected].angle;
      const diff = wrapPi(want - this.orbit.rotation.y);
      this.orbit.rotation.y += diff * (1 - Math.exp(-dt * 2.6));
    } else if (this.mode !== "processing") {
      this.orbit.rotation.y += dt * 0.07;
    }

    /* ── hover (mouse) ── */
    if (this.pointerDirty && this.nodes.length) {
      this.pointerDirty = false;
      this.raycaster.setFromCamera(this.ndc, this.camera);
      const hits = this.raycaster.intersectObjects(this.nodes.map((n) => n.hit), false);
      this.hoverIndex = hits.length ? (hits[0].object.userData.index as number) : null;
      this.renderer.domElement.style.cursor = this.hoverIndex !== null ? "pointer" : "";
    }

    this.updateAnchors();
    this.updateNodes(dt, t);
    this.updateCamera(dt, t);
  }

  /** Cinematic intro → OrbitControls (+ gestures, auto-orbit, shake). */
  private updateCamera(dt: number, t: number) {
    this.camera.position.sub(this.shakeOff); // remove last frame's shake
    const target = this.controls.target;

    if (this.introT < 1) {
      /* fly-in: swoop from far away, high up and off to the side, down to the home view */
      this.introT = Math.min(1, this.introT + dt / INTRO_SECONDS);
      const e = easeInOutCubic(this.introT);
      const sph = new THREE.Spherical(
        lerp(30, this.homeSph.radius, e),
        lerp(0.75, this.homeSph.phi, e),
        lerp(1.7, this.homeSph.theta, e),
      );
      this.camera.position.setFromSpherical(sph);
      this.camera.lookAt(target);
    } else {
      /* gesture rotation (eased) */
      const k = 1 - Math.exp(-dt * 10);
      const az = this.pendingAz * k;
      const pol = this.pendingPol * k;
      this.pendingAz -= az;
      this.pendingPol -= pol;
      if (Math.abs(az) + Math.abs(pol) > 1e-6) {
        const offset = this.tmp.copy(this.camera.position).sub(target);
        const sph = new THREE.Spherical().setFromVector3(offset);
        sph.theta -= az;
        sph.phi = clamp(sph.phi - pol, 0.3, Math.PI - 0.3);
        sph.makeSafe();
        offset.setFromSpherical(sph);
        this.camera.position.copy(target).add(offset);
      }
      if (this.distTarget !== null) {
        const cur = this.getDistance();
        const nd = damp(cur, this.distTarget, 5, dt);
        this.camera.position.sub(target).setLength(nd).add(target);
        if (Math.abs(nd - this.distTarget) < 0.02) this.distTarget = null;
      }
      // gentle auto-orbit whenever nobody is touching the scene
      this.controls.autoRotate = t - this.lastInteract > 2.5 && this.selected === null && this.mode !== "recording";
      this.controls.update(dt);
    }

    /* camera shake (e.g. when a red gem lands) */
    this.shake *= Math.exp(-dt * 3.2);
    if (this.shake > 0.002) {
      this.shakeOff
        .set(Math.sin(t * 61) * 0.5 + Math.sin(t * 37) * 0.5, Math.cos(t * 53) * 0.5, Math.sin(t * 29) * 0.3)
        .multiplyScalar(0.16 * this.shake);
    } else this.shakeOff.set(0, 0, 0);
    this.camera.position.add(this.shakeOff);
  }

  private updateAnchors() {
    const appear = easeOutBack(clamp(this.age / 0.9, 0, 1));
    for (const a of this.anchors) {
      a.group.scale.setScalar(Math.max(0.0001, appear));
      a.group.children[0].rotation.y += 0.012;
      a.group.children[0].rotation.x += 0.006;
    }
  }

  private updateNodes(dt: number, t: number) {
    for (const n of this.nodes) {
      const age = this.age - n.delay;
      const prog = clamp(age / 1.7, 0, 1);
      const e = easeOutCubic(prog);

      /* fly out of the orb: grow outward along an arc while swirling into orbit */
      this.tmp.copy(n.target).multiplyScalar(e).applyAxisAngle(Y_AXIS, (1 - e) * 1.6);
      this.tmp.y += Math.sin(Math.PI * e) * 1.0;
      n.group.position.copy(this.tmp);
      n.group.scale.setScalar(Math.max(0.0001, easeOutBack(prog)));

      /* light trail behind the flying gem */
      n.history.unshift(n.history.pop()!.copy(n.group.position));
      const trailAmt = age > 0 ? 1 - smooth(0.8, 1, prog) : 0;
      n.trail.visible = trailAmt > 0.01;
      if (n.trail.visible) {
        for (let i = 0; i < TRAIL; i++) {
          const p = n.history[i];
          const f = Math.pow(1 - i / TRAIL, 2) * trailAmt * 1.9;
          n.trailPos[i * 3] = p.x;
          n.trailPos[i * 3 + 1] = p.y;
          n.trailPos[i * 3 + 2] = p.z;
          n.trailCol[i * 3] = n.baseColor.r * f;
          n.trailCol[i * 3 + 1] = n.baseColor.g * f;
          n.trailCol[i * 3 + 2] = n.baseColor.b * f;
        }
        (n.trail.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        (n.trail.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      }

      /* touchdown: red gems shake the camera and flare the orb */
      if (!n.landed && prog >= 0.92) {
        n.landed = true;
        if (n.risk === "red") {
          this.shake = 1;
          this.flash = Math.max(this.flash, 0.45);
        }
      }

      const isRed = n.risk === "red";
      const pulse = isRed ? 1 + 0.14 * Math.sin(t * 5 + n.index) : 1 + 0.035 * Math.sin(t * 1.5 + n.index);
      n.hover = damp(n.hover, this.hoverIndex === n.index ? 1 : 0, 12, dt);
      n.selAmt = damp(n.selAmt, this.selected === n.index ? 1 : 0, 8, dt);
      n.gemGroup.scale.setScalar(pulse * (1 + n.hover * 0.18 + n.selAmt * 0.28));
      n.gemGroup.rotation.y += dt * (0.7 + n.selAmt * 0.8);
      n.gemGroup.position.y = Math.sin(t * 1.2 + n.index * 1.7) * 0.06;
      n.gemMat.emissiveIntensity = (isRed ? 0.8 + 0.55 * Math.sin(t * 5 + n.index) : 0.75) + n.selAmt * 0.55 + n.hover * 0.3;
      (n.glow.material as THREE.SpriteMaterial).opacity = (isRed ? 0.62 + 0.28 * Math.sin(t * 5 + n.index) : 0.6) + n.selAmt * 0.25;
      n.icon.position.y = n.gemGroup.position.y;
      (n.icon.material as THREE.SpriteMaterial).opacity = smooth(0.7, 1, prog);
      (n.label.material as THREE.SpriteMaterial).opacity = smooth(0.75, 1, prog);
      n.label.position.y = 0.82 + Math.sin(t * 1.2 + n.index * 1.7) * 0.04;

      // selection ring
      const selMat = n.sel.material as THREE.MeshBasicMaterial;
      selMat.opacity = n.selAmt * 0.9;
      n.sel.visible = n.selAmt > 0.01;
      if (n.sel.visible) n.sel.lookAt(this.camera.position);

      // red shockwave rings expanding outward, repeating
      n.alerts.forEach((ring, k) => {
        const ph = (t * 0.7 + k * 0.5 + n.index * 0.3) % 1;
        ring.scale.setScalar(1 + ph * 3.6);
        (ring.material as THREE.MeshBasicMaterial).opacity = Math.pow(1 - ph, 1.5) * 0.85 * smooth(0.85, 1, prog);
        ring.lookAt(this.camera.position);
      });

      /* thread: draws itself from the "owes" party after the gem lands */
      const reveal = easeOutCubic(clamp((age - 1.0) / 1.5, 0, 1));
      n.threadMat.uniforms.uTime.value = t;
      n.threadMat.uniforms.uReveal.value = reveal;
      n.threadMat.uniforms.uBright.value = 0.55 + n.selAmt * 0.6 + n.hover * 0.2;

      n.sparks.visible = reveal >= 0.999;
      if (n.sparks.visible) {
        for (let k = 0; k < SPARKS; k++) {
          const tt = (t * 0.17 + k / SPARKS + n.index * 0.19) % 1;
          n.curve.getPoint(tt, this.tmp);
          n.sparkPos[k * 3] = this.tmp.x;
          n.sparkPos[k * 3 + 1] = this.tmp.y;
          n.sparkPos[k * 3 + 2] = this.tmp.z;
          this.tmpC.copy(COL.cyan).lerp(COL.gold, tt).multiplyScalar(Math.sin(Math.PI * tt) * 1.8);
          n.sparkCol[k * 3] = this.tmpC.r;
          n.sparkCol[k * 3 + 1] = this.tmpC.g;
          n.sparkCol[k * 3 + 2] = this.tmpC.b;
        }
        (n.sparks.geometry.attributes.position as THREE.BufferAttribute).needsUpdate = true;
        (n.sparks.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true;
      }
    }
  }
}
