// === SURF: procedural 3D ocean with a breaking shorebreak ===
// GPU vertex-shader waves (offshore swell -> shoaling -> curling lip/tube ->
// whitewash bore -> swash on the sand) plus an exact CPU mirror of the same
// wave function, used for the player physics and the spray particles.
//
// Coordinates: the shoreline follows the beach's wavy sealine z = shoreZ(x);
// d = z - shoreZ(x) is the distance seaward (d > 0 is sea). Waves travel
// towards -d (towards the beach). Mean sea level is y = 0.
import * as THREE from 'three';

export const SURF = {
  period: 9.0,        // s between waves
  L0: 230,            // offshore wavelength
  shoalA: 0.85,       // wavelength shortens near the shore: k = k0 (1 + A e^(-d/B))
  shoalB: 220,
  kx: 0.0012,         // slight obliquity of the crests
  slope: 0.085,       // seabed slope (depth = slope * d - 0.5)
  Hbase: 12.5,        // typical breaking wave height (player eye height is 10)
  breakRatio: 0.95,   // inner-bar waves break where depth ~ H / breakRatio
  peel: 0.22,         // how fast the break point moves away from each wave's peak
  minBreakD: 40,      // every wave has closed out by this distance
  breakSpan: 30,      // distance the crest travels from break onset to lip landing
  q: 0.55,            // horizontal crest sharpening (Gerstner-like)
  setLen: 7,          // waves per set
  runup: 3.2,         // swash run-up length per unit wave height
  film: 1.4,          // swash film thickness over the sand
  flatSand: 100,      // must match main.js FLAT_SAND_WIDTH
  duneStart: -650,    // must match main.js DUNE_START
  // two breaking zones: an outer bar (~60 m out) where the bigger set waves break
  // first, then the waves reform over the trough and break again on the inner bar (~30 m)
  barOuter: 345,      // outer-bar break distance (the player is ~5.9 units per metre)
  outerGain: 1.5,     // outer-bar waves are this much bigger than the base wave
  outerMin: 1.0,      // only waves with Hn > outerMin * Hbase break on the outer bar
  innerGain: 1.15,
  innerMax: 185,      // inner-bar break distance cap
  reform0: 228,       // crest distance where the outer whitewash starts reforming...
  reform1: 200,       // ...into the inner-bar swell
  rogueH: 60,         // rogue wave height (~10 m)
  rogueMin: 180,      // s between rogue waves (random in [rogueMin, rogueMax])
  rogueMax: 420,
};

// The current rogue wave (crest index, height, centre x); set by createSurf().update.
const ROGUE = { fn: -1e9, H: 0, x: 0 };
function rogueG(fn, x) { return fn === ROGUE.fn ? Math.exp(-(((x - ROGUE.x) / 900) ** 2)) : 0; }

const TAU = Math.PI * 2;
const K0 = TAU / SURF.L0;
const OMEGA = TAU / SURF.period;

// ---------- shared math (JS mirror of the GLSL below) ----------
function sstep(a, b, x) {
  let t = (x - a) / (b - a);
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}
function hashU(x) {
  x >>>= 0;
  x ^= x >>> 16; x = Math.imul(x, 0x7feb352d) >>> 0;
  x ^= x >>> 15; x = Math.imul(x, 0x846ca68b) >>> 0;
  x ^= x >>> 16;
  return x >>> 0;
}
const hash01 = (h) => (h & 0xffffff) / 16777216;

// Same wavy sealine as createBeach() in main.js.
export function shoreZ(x) {
  const nx = (x + 1245) / 1290;
  let off = Math.sin(nx * Math.PI) * 60 + Math.sin(nx * Math.PI * 2) * 20 + 50;
  if (nx >= 0.6 && nx <= 1.0) {
    const t = (nx - 0.6) / 0.4;
    off += t * t * (3 - 2 * t) * Math.sin(t * Math.PI) * 100;
  }
  return -off;
}
// Land profile near the shore (flat sand, then the slope towards the dunes).
function landH(z) {
  if (z >= -SURF.flatSand) return 0;
  const t = Math.min(1, (z + SURF.flatSand) / (SURF.duneStart + SURF.flatSand));
  return t * 20;
}
// Sand / seabed surface height (without the sand texture displacement).
export function bedHeight(x, z) {
  const d = z - shoreZ(x);
  return Math.max(0.5 + landH(z) - SURF.slope * Math.max(d, 0), -70);
}

function kOf(d) { const dd = Math.max(d, -30); return K0 * (1 + SURF.shoalA * Math.exp(-dd / SURF.shoalB)); }
function sOf(d) {
  const dd = Math.max(d, -30);
  let s = K0 * (dd - SURF.shoalA * SURF.shoalB * Math.exp(-dd / SURF.shoalB));
  if (d < -30) s += kOf(-30) * (d + 30);
  return s;
}
function wobble(x) { return 0.9 * Math.sin(x * 0.0021 + 0.7) + 0.5 * Math.sin(x * 0.0057 + 2.1); }
function phaseAt(x, d, t) { return OMEGA * t + sOf(d) + SURF.kx * x + wobble(x); }

// Base height of wave fn and its inner-bar height (also drives the swash run-up).
function waveBaseHn(fn) {
  const h = hashU((fn + 100000) | 0);
  const set = 0.5 + 0.5 * Math.sin(fn * TAU / SURF.setLen + 1.0);
  return SURF.Hbase * (0.62 + 0.45 * set + 0.18 * hash01(h));
}
function waveHn(fn, x) {
  return waveBaseHn(fn) * SURF.innerGain + (SURF.rogueH / 3 - waveBaseHn(fn) * SURF.innerGain) * rogueG(fn, x);
}
function waveParams(fn, x, o) {
  const h = hashU((fn + 100000) | 0);
  const h2 = hashU((h ^ 0x9e3779b9) >>> 0);
  const Hn = waveBaseHn(fn);
  const g = rogueG(fn, x);
  const xp = (hash01(h2) * 2 - 1) * 900;
  const ax = Math.abs(x - xp);
  // outer bar
  o.outer = Hn > SURF.outerMin * SURF.Hbase || fn === ROGUE.fn;
  o.HnA = o.outer ? Hn * SURF.outerGain + (ROGUE.H - Hn * SURF.outerGain) * g : Hn * SURF.innerGain;
  o.dbA = o.outer ? Math.max(SURF.barOuter + 15 * Math.sin(x * 0.009 + fn * 2.3) + 70 * g - 0.1 * ax, SURF.barOuter - 20) : -1e4;
  o.boreKA = 0.55 + 0.6 * g;
  // inner bar
  o.Hn = waveHn(fn, x);
  o.db0 = (o.Hn / SURF.breakRatio + 0.5) / SURF.slope;
  o.db = Math.max(Math.min(o.db0, SURF.innerMax) - SURF.peel * ax + 12 * Math.sin(x * 0.013 + fn * 1.7), SURF.minBreakD);
  return o;
}

// One breaking stage: a wave of height Hn breaking at db.
function stageState(Hn, db, db0, boreK, dc, o) {
  const p = (db - dc) / SURF.breakSpan;
  const shoal = 0.55 + 0.45 * sstep(db0 + 420, db0, dc);
  const Hpre = Hn * shoal * (1 + 0.12 * sstep(0, 1, p));
  const depthC = Math.max(SURF.slope * dc - 0.5, 0.3);
  const Hbore = Math.min(Hn, boreK * depthC + 0.8);
  o.p = p;
  o.bore = sstep(1.0, 2.6, p);
  o.H = Hpre + (Hbore - Hpre) * o.bore;
  o.steep = sstep(-1.6, 0.9, p);
  o.thetaMax = 2.7 * sstep(0, 1.15, p) - 1.3 * sstep(1.8, 3.0, p);
  o.pc = Math.min(Math.max(p, 0), 1);
  return o;
}
const _sa = {}, _sb = {};
// Wave state for crest `fn` whose crest is at distance dc: the outer-bar stage
// blended into the inner-bar stage over the trough.
function crestState(fn, x, dc, o) {
  waveParams(fn, x, o);
  const A = stageState(o.HnA, o.dbA, SURF.barOuter, o.boreKA, dc, _sa);
  const B = stageState(o.Hn, o.db, o.db0, 0.55, dc, _sb);
  const wB = sstep(SURF.reform0, SURF.reform1, dc);
  const m = (a, b) => a + (b - a) * wB;
  o.wB = wB;
  o.p = wB < 0.5 ? A.p : B.p;          // the stage in charge (for lip / spray events)
  o.H = m(A.H, B.H); o.bore = m(A.bore, B.bore); o.steep = m(A.steep, B.steep);
  o.thetaMax = m(A.thetaMax, B.thetaMax) * sstep(15, 45, dc); o.pc = m(A.pc, B.pc); // no lip thrown onto dry sand
  return o;
}
// lumpy whitewater displacement (per unit wave height), mirrored in GLSL
function boreLumps(x, z, t) {
  return 0.035 * Math.sin(x * 0.11 + z * 0.07 + t * 2.3) + 0.03 * Math.sin(-x * 0.19 + z * 0.23 + t * 3.1)
    + 0.02 * Math.sin(x * 0.37 - z * 0.29 + t * 4.7);
}
function nGauss(x, w, L) {
  const e = Math.exp(-((0.5 * L / w) ** 2));
  return (Math.exp(-((x / w) ** 2)) - e) / (1 - e);
}

const _ws = {};
// Full surface evaluation at rest position (x, z).
// curl = true: displaced vertex (what the GPU draws, incl. the overhanging lip).
// curl = false: single-valued height field at (x, z) used for physics.
export function evalSurf(x, z, t, curl, out = {}) {
  const zs = shoreZ(x);
  const d = z - zs;
  const phi = phaseAt(x, d, t);
  const fn = Math.floor(phi / TAU + 0.5);
  const psi = phi / TAU - fn;
  const L = TAU / kOf(d);
  const s = psi * L;
  const dc = d - s;
  const w = crestState(fn, x, dc, _ws);
  const H = w.H, p = w.p, bore = w.bore;
  const sh = Math.max(w.steep, bore);
  let s2 = s;
  if (curl) {
    const ah = Math.min(SURF.q * (0.6 + 0.4 * sh) * L / TAU, 1.5 * H);
    s2 = s - ah * Math.sin(TAU * psi);
  }
  const wf = L * (0.13 + (0.035 - 0.13) * sh);
  const wb = L * (0.2 + (0.32 - 0.2) * bore);
  const bump = s2 < 0 ? nGauss(s2, wf, L) : nGauss(s2, wb, L);
  // trough level: towards a crest-independent level near psi = +-0.5, so the trough behind one wave
  // meets the trough ahead of the next without a step (each crest's own -0.2 H differs)
  const tw = sstep(0.25, 0.5, Math.abs(psi));
  const Ht = H + (0.45 * SURF.Hbase * sstep(20, 120, d) - H) * tw;
  let y = H * bump - 0.2 * Ht;
  let dA = dc + s2;

  const pivY = 0.18 * H, topY = 0.8 * H;
  const hw = Math.min(Math.max((y - pivY) / (topY - pivY), 0), 1);
  const bw = 1 - sstep(0, 0.45 * H + wf, s2);
  if (curl) {
    const th = w.thetaMax * Math.pow(hw, 1.1) * bw;
    if (th > 0) {
      const dp = dc - (0.5 * wf + 0.12 * H * w.pc);
      const X = -(dA - dp), Y = y - pivY;
      const c = Math.cos(th), sn = Math.sin(th);
      dA = dp - (X * c + Y * sn);
      y = pivY + (-X * sn + Y * c);
    }
  }

  // turbulent, lumpy whitewater on the bore front and just behind it
  const turb = bore * (1 - sstep(0.15 * L, 0.45 * L, s2)) * sstep(-wf - 4, -0.3 * wf, s2);
  if (turb > 0) y += turb * H * boreLumps(x, z, t);

  // land clamp + swash
  const sand = 0.5 + landH(z);
  if (d < 0) y = Math.min(y, sand - 1.6);
  let wet = 0;
  if (d < 40) {
    const phi0 = phaseAt(x, 0, t);
    const f0 = Math.floor(phi0 / TAU);
    const tau = phi0 / TAU - f0;
    const R = SURF.runup * waveHn(f0, x);
    const tt = tau / 0.75;
    const r = tt < 1 ? R * (tt < 0.3 ? Math.sin(tt / 0.3 * 1.5708) : Math.cos((tt - 0.3) / 0.7 * 1.5708)) : 0;
    wet = sstep(-r - 3, -r + 12, d);
    const bed = d > 0 ? sand - SURF.slope * d : sand;
    // sand the swash has wetted (up to the highest run-up of this or the last wave) keeps a thin layer just above it
    const Rw = Math.max(tt < 0.3 ? r : R, SURF.runup * waveHn(f0 - 1, x) * 0.8);
    const dampSand = sstep(-Rw - 12, -Rw - 4, d); // drops below the sand only where it is already invisible
    const ys = bed + SURF.film * wet + (0.2 * dampSand - 1.5 * (1 - dampSand)) * (1 - wet);
    const k = sstep(40, 20, d);
    // smooth max of the sea surface and the swash film: a hard max leaves a crease the grid renders as a staircase
    const hm = Math.min(Math.max(0.5 + 0.5 * (ys - y) / 2.5, 0), 1);
    const ym = y + (ys - y) * hm + 2.5 * hm * (1 - hm);
    y += (ym - y) * k; dA += (d - dA) * k * hm;
  }

  out.x = x; out.y = y; out.z = zs + dA;
  out.d = d; out.dc = dc; out.s = s2; out.fn = fn; out.p = p; out.H = H; out.bore = bore;
  out.L = L; out.wf = wf; out.hw = hw; out.bw = bw; out.wet = wet; out.thetaMax = w.thetaMax;
  out.db = w.db; out.db0 = w.db0; out.Hn = w.Hn;
  return out;
}

// Distance of crest `fn` from the shore at x, time t (Newton on the phase).
function crestD(fn, x, t) {
  const target = TAU * fn - OMEGA * t - SURF.kx * x - wobble(x);
  let d = 250;
  for (let i = 0; i < 12; i++) d -= (sOf(d) - target) / kOf(d);
  return d;
}
// Lip tip position (in d, y) of a wave in its curl phase.
function lipTip(w, dc) {
  const L = TAU / kOf(dc);
  const sh = Math.max(w.steep, w.bore);
  const wf = L * (0.13 + (0.035 - 0.13) * sh);
  const H = w.H, pivY = 0.18 * H;
  const dp = dc - (0.5 * wf + 0.12 * H * w.pc);
  const X = -(dc - dp), Y = 0.8 * H - pivY, th = w.thetaMax;
  const c = Math.cos(th), sn = Math.sin(th);
  return { d: dp - (X * c + Y * sn), y: pivY + (-X * sn + Y * c), wf };
}

// ---------- GLSL ----------
const GLSL_COMMON = /* glsl */`
#define TAU 6.28318530718
float gDrift; // set by surfPos: how far the swash has carried its foam up the beach (for foam texturing only)
const float K0 = ${K0.toFixed(9)};
const float OMEGA = ${OMEGA.toFixed(9)};
const float SA = ${SURF.shoalA.toFixed(5)};
const float SB = ${SURF.shoalB.toFixed(5)};
const float KX = ${SURF.kx.toFixed(6)};
const float SLOPE = ${SURF.slope.toFixed(6)};
const float HBASE = ${SURF.Hbase.toFixed(5)};
const float BRATIO = ${SURF.breakRatio.toFixed(5)};
const float PEEL = ${SURF.peel.toFixed(5)};
const float MINBD = ${SURF.minBreakD.toFixed(5)};
const float BSPAN = ${SURF.breakSpan.toFixed(5)};
const float QQ = ${SURF.q.toFixed(5)};
const float SETLEN = ${SURF.setLen.toFixed(5)};
const float RUNUP = ${SURF.runup.toFixed(5)};
const float FILM = ${SURF.film.toFixed(5)};
const float FLATSAND = ${SURF.flatSand.toFixed(5)};
const float DUNESTART = ${SURF.duneStart.toFixed(5)};
const float BAROUT = ${SURF.barOuter.toFixed(5)};
const float OUTGAIN = ${SURF.outerGain.toFixed(5)};
const float OUTMIN = ${SURF.outerMin.toFixed(5)};
const float INGAIN = ${SURF.innerGain.toFixed(5)};
const float INMAX = ${SURF.innerMax.toFixed(5)};
const float REF0 = ${SURF.reform0.toFixed(5)};
const float REF1 = ${SURF.reform1.toFixed(5)};
const float ROGUEH = ${SURF.rogueH.toFixed(5)};
uniform float uTime;
uniform vec3 uRogue; // crest index, height, centre x

float sstep(float a, float b, float x) { float t = clamp((x - a) / (b - a), 0.0, 1.0); return t * t * (3.0 - 2.0 * t); }
uint hashU(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du;
  x ^= x >> 15u; x *= 0x846ca68bu;
  x ^= x >> 16u; return x;
}
float hash01(uint h) { return float(h & 0xffffffu) / 16777216.0; }
float shoreZ(float x) {
  float nx = (x + 1245.0) / 1290.0;
  float off = sin(nx * 3.14159265) * 60.0 + sin(nx * 6.28318531) * 20.0 + 50.0;
  if (nx >= 0.6 && nx <= 1.0) { float t = (nx - 0.6) / 0.4; off += t * t * (3.0 - 2.0 * t) * sin(t * 3.14159265) * 100.0; }
  return -off;
}
float landH(float z) {
  if (z >= -FLATSAND) return 0.0;
  return min(1.0, (z + FLATSAND) / (DUNESTART + FLATSAND)) * 20.0;
}
float kOf(float d) { float dd = max(d, -30.0); return K0 * (1.0 + SA * exp(-dd / SB)); }
float sOf(float d) {
  float dd = max(d, -30.0);
  float s = K0 * (dd - SA * SB * exp(-dd / SB));
  if (d < -30.0) s += kOf(-30.0) * (d + 30.0);
  return s;
}
float wobble(float x) { return 0.9 * sin(x * 0.0021 + 0.7) + 0.5 * sin(x * 0.0057 + 2.1); }
float phaseAt(float x, float d) { return OMEGA * uTime + sOf(d) + KX * x + wobble(x); }
float waveBaseHn(float fn) {
  uint h = hashU(uint(int(fn) + 100000));
  float setv = 0.5 + 0.5 * sin(fn * TAU / SETLEN + 1.0);
  return HBASE * (0.62 + 0.45 * setv + 0.18 * hash01(h));
}
float rogueG(float fn, float x) { return abs(fn - uRogue.x) < 0.5 ? exp(-pow((x - uRogue.z) / 900.0, 2.0)) : 0.0; }
float waveHn(float fn, float x) { float b = waveBaseHn(fn) * INGAIN; return b + (ROGUEH / 3.0 - b) * rogueG(fn, x); }
struct WS { float H; float p; float bore; float steep; float th; float pc; float l1; float l2; float cap; float chop; };
WS stageS(float Hn, float db, float db0, float boreK, float dc) {
  WS w;
  float p = (db - dc) / BSPAN;
  float shoal = 0.55 + 0.45 * sstep(db0 + 420.0, db0, dc);
  float Hpre = Hn * shoal * (1.0 + 0.12 * sstep(0.0, 1.0, p));
  float depthC = max(SLOPE * dc - 0.5, 0.3);
  float Hbore = min(Hn, boreK * depthC + 0.8);
  w.p = p;
  w.bore = sstep(1.0, 2.6, p);
  w.H = mix(Hpre, Hbore, w.bore);
  w.steep = sstep(-1.6, 0.9, p);
  w.th = 2.7 * sstep(0.0, 1.15, p) - 1.3 * sstep(1.8, 3.0, p);
  w.pc = clamp(p, 0.0, 1.0);
  w.l1 = sstep(0.25, 0.9, p); w.l2 = sstep(0.9, 1.6, p); w.cap = sstep(-3.0, -1.0, p); w.chop = sstep(-0.5, 0.5, p);
  return w;
}
float nGauss(float x, float w, float L) {
  float e = exp(-pow(0.5 * L / w, 2.0));
  return (exp(-pow(x / w, 2.0)) - e) / (1.0 - e);
}
// returns displaced position; foam/thin/wet via out params
vec3 surfPos(vec2 xz, out float foam, out float thin, out float wetOut, out float sandW, out float age) {
  float x = xz.x, z = xz.y;
  float zs = shoreZ(x);
  float d = z - zs;
  gDrift = 0.0;
  float swAge = 0.0;
  float phi = phaseAt(x, d);
  float fn = floor(phi / TAU + 0.5);
  float psi = phi / TAU - fn;
  float L = TAU / kOf(d);
  float s = psi * L;
  float dc = d - s;

  uint h = hashU(uint(int(fn) + 100000));
  uint h2 = hashU(h ^ 0x9e3779b9u);
  float Hb = waveBaseHn(fn);
  float g = rogueG(fn, x);
  float xp = (hash01(h2) * 2.0 - 1.0) * 900.0;
  float ax = abs(x - xp);
  bool outer = Hb > OUTMIN * HBASE || abs(fn - uRogue.x) < 0.5;
  float HnA = outer ? mix(Hb * OUTGAIN, uRogue.y, g) : Hb * INGAIN;
  float dbA = outer ? max(BAROUT + 15.0 * sin(x * 0.009 + fn * 2.3) + 70.0 * g - 0.1 * ax, BAROUT - 20.0) : -1e4;
  float Hn = waveHn(fn, x);
  float db0 = (Hn / BRATIO + 0.5) / SLOPE;
  float db = max(min(db0, INMAX) - PEEL * ax + 12.0 * sin(x * 0.013 + fn * 1.7), MINBD);
  WS A = stageS(HnA, dbA, BAROUT, 0.55 + 0.6 * g, dc);
  WS B = stageS(Hn, db, db0, 0.55, dc);
  float wB = sstep(REF0, REF1, dc);
  float p = wB < 0.5 ? A.p : B.p;
  float H = mix(A.H, B.H, wB);
  float bore = mix(A.bore, B.bore, wB);
  float steep = mix(A.steep, B.steep, wB);
  float thetaMax = mix(A.th, B.th, wB) * sstep(15.0, 45.0, dc);
  float pc = mix(A.pc, B.pc, wB);
  float lip1 = mix(A.l1, B.l1, wB), lip2 = mix(A.l2, B.l2, wB), capP = mix(A.cap, B.cap, wB), chopP = mix(A.chop, B.chop, wB);
  float dbz = outer ? mix(dbA, db0, wB) : db0;
  float sh = max(steep, bore);

  float ah = min(QQ * (0.6 + 0.4 * sh) * L / TAU, 1.5 * H);
  float s2 = s - ah * sin(TAU * psi);
  float wf = L * mix(0.13, 0.035, sh);
  float wb = L * mix(0.2, 0.32, bore);
  float bump = s2 < 0.0 ? nGauss(s2, wf, L) : nGauss(s2, wb, L);
  float Ht = mix(H, 0.45 * HBASE * sstep(20.0, 120.0, d), sstep(0.25, 0.5, abs(psi)));
  float y = H * bump - 0.2 * Ht;
  float dA = dc + s2;

  float pivY = 0.18 * H, topY = 0.8 * H;
  float hw = clamp((y - pivY) / (topY - pivY), 0.0, 1.0);
  float bw = 1.0 - sstep(0.0, 0.45 * H + wf, s2);
  float th = thetaMax * pow(hw, 1.1) * bw;
  if (th > 0.0) {
    float dp = dc - (0.5 * wf + 0.12 * H * pc);
    float X = -(dA - dp), Y = y - pivY;
    float c = cos(th), sn = sin(th);
    dA = dp - (X * c + Y * sn);
    y = pivY + (-X * sn + Y * c);
  }

  // small wind chop, kept off the lip and the swash
  float chopK = (1.0 - hw * bw * chopP) * sstep(-10.0, 60.0, d);
  y += chopK * (0.45 * sin(x * 0.071 + z * 0.052 - uTime * 1.9) + 0.3 * sin(-x * 0.047 + z * 0.093 - uTime * 2.6));
  // turbulent, lumpy whitewater on the bore front and just behind it
  float turb = bore * (1.0 - sstep(0.15 * L, 0.45 * L, s2)) * sstep(-wf - 4.0, -0.3 * wf, s2);
  y += turb * H * (0.035 * sin(x * 0.11 + z * 0.07 + uTime * 2.3) + 0.03 * sin(-x * 0.19 + z * 0.23 + uTime * 3.1)
    + 0.02 * sin(x * 0.37 - z * 0.29 + uTime * 4.7));

  float sand = 0.5 + landH(z);
  if (d < 0.0) y = min(y, sand - 1.6);
  float wet = 0.0;
  float filmP = d > 0.0 ? 1.0 : 0.0; // is there water here (not just damp sand)?
  sandW = 0.0;
  if (d < 40.0) {
    float phi0 = phaseAt(x, 0.0);
    float f0 = floor(phi0 / TAU);
    float tau = phi0 / TAU - f0;
    float R = RUNUP * waveHn(f0, x);
    float tt = tau / 0.75;
    float r = tt < 1.0 ? R * (tt < 0.3 ? sin(tt / 0.3 * 1.5708) : cos((tt - 0.3) / 0.7 * 1.5708)) : 0.0;
    wet = sstep(-r - 3.0, -r + 12.0, d);
    filmP = max(filmP, wet);
    float bed = d > 0.0 ? sand - SLOPE * d : sand;
    // sand the swash has wetted (up to the highest run-up of this or the last wave) keeps a thin layer just above it
    float Rw = max(tt < 0.3 ? r : R, RUNUP * waveHn(f0 - 1.0, x) * 0.8);
    float dampSand = sstep(-Rw - 12.0, -Rw - 4.0, d);
    float ys = bed + FILM * wet + (0.2 * dampSand - 1.5 * (1.0 - dampSand)) * (1.0 - wet);
    float k = sstep(40.0, 20.0, d);
    float hm = clamp(0.5 + 0.5 * (ys - y) / 2.5, 0.0, 1.0);
    float ym = y + (ys - y) * hm + 2.5 * hm * (1.0 - hm);
    y += (ym - y) * k; dA += (d - dA) * k * hm;
    // wet-sand look: dark where damp, a glassy film just behind the retreating water
    float edge = max(-d - r, 0.0);
    float glaze = tt > 0.3 ? exp(-edge / (0.25 * R + 4.0)) : 0.0;
    float damp = sstep(-Rw - 2.0, -Rw + 6.0, d) * (1.0 - sstep(-r - 6.0, -r + 2.0, d)) * sstep(10.0, 0.0, d);
    sandW = damp * (1.0 + glaze) * 0.5; // 0..0.5 damp, up to 1 with the glassy film
    // foam on the swash, densest at the uprush tip
    float tip = sstep(-r - 3.0, -r + 4.0, d) * (1.0 - sstep(-r + 4.0, -r + 20.0, d));
    wet = clamp(max(wet * 0.3 * sstep(10.0, -5.0, d), 0.85 * tip), 0.0, 1.0) * sstep(1.0, 0.9, tt);
    // swash foam rides up and back with the water, and opens into a lace once the backwash starts
    gDrift = r * sstep(30.0, 30.0 - max(4.0 * r, 40.0), d); // ramp >= 4r long: the foam never folds over and stretches at most ~1.6x
    swAge = sstep(0.25, 0.85, tt);
  }

  // foam
  float fLip = pow(hw, 6.0) * bw * lip1 * (1.0 - 0.3 * bore) + 0.6 * bw * hw * lip2;
  float fFace = 0.18 * sh * bump * (s2 < 0.0 ? 1.0 : 0.3);
  float fBore = bore * (0.18 + 0.32 * (1.0 - sstep(0.0, 0.9 * L, s2)) + 0.5 * sstep(-wf * 1.2, 0.0, s2) * (1.0 - sstep(0.0, 0.2 * L, s2)));
  float fZone = 0.22 * sstep(dbz + 30.0, dbz - 60.0, d) * (0.5 + 0.5 * sin(x * 0.013 + z * 0.021 + fn));
  float fCap = 0.25 * sstep(0.85, 1.0, bump) * capP;
  // residual foam left behind by broken waves: thins out as it ages (behind this crest, or the previous one)
  float ageB = s2 > 0.0 ? s2 / L : 1.0 + s2 / L;  // ~time since a crest passed, in wave periods
  float zoneIn = max(sstep(dbz + 10.0, dbz - 50.0, d), 0.7 * sstep(BAROUT + 10.0, BAROUT - 50.0, d) * sstep(REF1 - 40.0, REF0, d));
  float broke = s2 > 0.0 ? max(bore, lip2) : 1.0;
  float fRes = zoneIn * broke * (0.12 + 0.5 * exp(-3.0 * ageB));
  foam = clamp(max(max(max(fLip, fFace), max(fBore, fZone)), max(fCap, fRes)) * filmP, 0.0, 1.0);
  foam = max(foam, wet);
  age = clamp(mix(ageB, 0.0, max(max(fLip, fBore * (1.0 - sstep(0.0, 0.3 * L, s2))), fFace)), 0.0, 1.0);
  age = mix(age, swAge, min(wet * 1.5, 1.0));
  thin = hw * bw * sh;
  wetOut = wet;
  return vec3(x, y, zs + dA);
}
`;

const VERT = /* glsl */`
${GLSL_COMMON}
varying vec3 vWorld;
varying vec3 vNrm;
varying float vFoam;
varying float vThin;
varying float vDepth;
varying float vSand;
varying float vAge;
varying float vLand;
varying vec2 vRest;
void main() {
  float f, th, wt, sw, ag, f1, t1, w1, s1, a1;
  vec2 xz = position.xz;
  vec3 P = surfPos(xz, f, th, wt, sw, ag);
  float drift = gDrift;
  vec3 P1 = surfPos(xz + vec2(0.7, 0.0), f1, t1, w1, s1, a1);
  vec3 P2 = surfPos(xz + vec2(0.0, 0.7), f1, t1, w1, s1, a1);
  vSand = sw;
  vAge = ag;
  vec3 n = cross(P2 - P, P1 - P);
  vNrm = length(n) > 1e-6 ? normalize(n) : vec3(0.0, 1.0, 0.0);
  vWorld = P;
  vFoam = f;
  vThin = th;
  float zs = shoreZ(xz.x);
  float bed = max(0.5 + landH(xz.y) - SLOPE * max(xz.y - zs, 0.0), -70.0);
  vDepth = P.y - bed;
  vLand = 1.0 - smoothstep(-3.0, 3.0, xz.y - zs);
  // foam texture coordinates on the undisplaced grid: the foam rocks and stretches with the water
  // (streaks down steep faces, wraps the curl), drifts slowly shoreward and rides the swash
  vRest = vec2(xz.x, xz.y + drift + 2.0 * uTime);
  gl_Position = projectionMatrix * viewMatrix * vec4(P, 1.0);
}
`;

// typical colour of the sand under the water as drawn (linear, matched to the beach material's render)
const BED_LIN = [0.5606, 0.4291, 0.2832]; // sRGB ~(199, 184, 160) on screen, measured with the surf hidden

const FRAG = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir;
uniform sampler2D uNormTex;
varying vec3 vWorld;
varying vec3 vNrm;
varying float vFoam;
varying float vThin;
varying float vDepth;
varying float vSand;
varying float vAge;
varying float vLand;
varying vec2 vRest;

vec2 hash2(vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return fract(sin(p) * 43758.5453);
}
// distance to the nearest cell wall of a slowly churning cellular pattern (0 on the walls)
float cellWall(vec2 p, float t) {
  vec2 i = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = hash2(i + g);
    o = 0.5 + 0.42 * sin(t + 6.2831 * o);
    float dd = length(g + o - f);
    if (dd < d1) { d2 = d1; d1 = dd; } else if (dd < d2) d2 = dd;
  }
  return d2 - d1;
}
// smooth value noise (quintic fade), 0..1; seamless, unlike the old foam photo, which did not tile
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 k = vec2(127.1, 311.7);
  float a = fract(sin(dot(i, k)) * 43758.5453), b = fract(sin(dot(i + vec2(1.0, 0.0), k)) * 43758.5453);
  float c = fract(sin(dot(i + vec2(0.0, 1.0), k)) * 43758.5453), d = fract(sin(dot(i + 1.0, k)) * 43758.5453);
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
const mat2 ROT = mat2(0.8, -0.6, 0.6, 0.8); // rotates each octave so the noise grid does not show
// round holes of random size scattered over a jittered grid: 1 at a hole's centre, 0 on its rim, negative
// outside (-0.5 at 1.5 radii); grow scales every hole, so foam opens up from pin holes into a lace
float holes(vec2 p, float t, float grow) {
  vec2 i = floor(p), f = fract(p);
  float h = -4.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = hash2(i + g);
    vec2 c = g + 0.5 + 0.36 * sin(t * (0.6 + 0.5 * o.yx) + 6.2831 * o) - f;
    float r = (0.18 + 0.5 * o.x * o.y) * grow;
    h = max(h, 1.0 - length(c) / r);
  }
  return h;
}
// foam left between the holes of one scale: 0 inside a hole, a soft translucent rim, thickest far from holes
float laceScale(float h) { return smoothstep(0.12, -0.45, h); }

// Foam thickness (0 = none; about 1 = opaque) at foam coordinates p.
// Foam is a sheet of bubbles with round holes at three scales (domain-warped so they are not perfect circles).
// The holes are sized so the foam covers about fa of the surface (one hole per cell of mean area
// pi E[r^2] = 0.33 g^2, so a scale leaves exp(-0.33 g^2) uncovered); young foam has mostly small holes,
// old foam opens into a coarse lace around large ones. Thickness grows away from the holes.
// ft = lumpiness (0..1) from a few octaves of noise.
float foamThick(vec2 p, float fa, float age, float dist, out float ft) {
  float n1 = vnoise(p * 0.16), n2 = vnoise(ROT * p * 0.41 + 7.3), n3 = vnoise(ROT * ROT * p * 1.07 + 3.1);
  float t1 = 0.6 * n1 + 0.4 * n2 + 0.1, t2 = 0.6 * n2 + 0.4 * n3 + 0.1; // ~0.6 on average, like the old texture
  ft = clamp((t1 * 0.65 + t2 * 0.35 - 0.45) / 0.3, 0.0, 1.0);
  float C = clamp(fa * (0.75 + 0.5 * ft), 0.04, 0.97);           // target coverage, lumpier with the texture
  float G = -log(C) / 0.33 + 0.12;                              // total g^2 over the three scales
  vec3 w = mix(vec3(0.15, 0.30, 0.55), vec3(0.55, 0.30, 0.15), age);
  vec3 g = min(sqrt(G * w), vec3(1.5));                         // the 3x3 search reaches about 1.5
  vec2 q = p + 3.2 * vec2(t1 - 0.6, t2 - 0.6);
  float k1 = 1.0 - smoothstep(700.0, 1600.0, dist);
  float k2 = 1.0 - smoothstep(250.0, 800.0, dist), k3 = 1.0 - smoothstep(70.0, 260.0, dist);
  vec3 mean = exp(-0.33 * g * g) * 0.85;                         // a faded scale is replaced by its mean cover
  float f1 = k1 > 0.0 ? mix(mean.x, laceScale(holes(q * 0.12, uTime * 0.25, g.x)), k1) : mean.x;
  float f2 = k2 > 0.0 ? mix(mean.y, laceScale(holes(q * 0.35 + 5.1, uTime * 0.45, g.y)), k2) : mean.y;
  float f3 = k3 > 0.0 ? mix(mean.z, laceScale(holes(q * 1.05 + 2.7, uTime * 0.8, g.z)), k3) : mean.z;
  float lace = f1 * f2 * f3;
  return lace * (0.2 + 0.7 * clamp(fa, 0.0, 1.6)) * (0.6 + 0.6 * ft) * smoothstep(0.0, 0.3, fa); // sparse foam is a thin film
}

const vec3 HORIZON = vec3(0.80, 0.82, 0.82);
const vec3 ZENITH  = vec3(0.18, 0.45, 0.85);
const vec3 DEEP    = vec3(0.01, 0.17, 0.42);
const vec3 SHALLOW = vec3(0.03, 0.50, 0.62);
const vec3 SSS     = vec3(0.06, 0.70, 0.72);
const vec3 BED     = vec3(${BED_LIN.map((v) => v.toFixed(4)).join(', ')}); // the dry sand as rendered (linear, before the x1.55)
const vec3 SIGMA   = vec3(1.3, 0.75, 0.7) / 5.9; // extinction per unit (per metre / 5.9): turbid surf-zone water

void main() {
  vec3 N = normalize(vNrm);
  if (!gl_FrontFacing) N = -N;
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  vec2 uv = vWorld.xz;
  vec3 n1 = texture2D(uNormTex, uv * 0.011 + vec2(0.012, 0.017) * uTime).rgb * 2.0 - 1.0;
  vec3 n2 = texture2D(uNormTex, uv * 0.029 - vec2(0.021, -0.009) * uTime).rgb * 2.0 - 1.0;
  vec3 dn = n1 + n2;
  float detail = 0.32 * (1.0 - smoothstep(250.0, 3500.0, dist));
  N = normalize(N + vec3(dn.x, 0.0, dn.y) * detail);

  float NdV = max(dot(N, V), 0.0);
  float F = 0.02 + 0.98 * pow(1.0 - NdV, 5.0);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 sky = mix(HORIZON, ZENITH, smoothstep(0.0, 0.35, R.y));
  float sunR = max(dot(R, uSunDir), 0.0);
  sky += vec3(1.0, 0.95, 0.85) * (pow(sunR, 12.0) * 0.25);
  vec3 spec = vec3(1.0, 0.97, 0.9) * (pow(sunR, 60.0) * 0.5 + pow(sunR, 280.0) * 7.0 + pow(sunR, 2500.0) * 45.0);

  float shallow = 1.0 - smoothstep(0.5, 14.0, vDepth);
  float NdL = max(dot(N, uSunDir), 0.0);
  // in-scatter colour: turquoise in the waves, a muted sea-green in the last few decimetres over the sand
  // (there the sand seen through the water supplies the colour)
  vec3 inS = mix(vec3(0.05, 0.26, 0.24), SHALLOW, smoothstep(2.0, 10.0, vDepth));
  vec3 body = mix(DEEP, inS, shallow) * (0.65 + 0.5 * NdL);
  float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
  body += SSS * vThin * (0.5 + 1.6 * back) * smoothstep(4.0, 14.0, vDepth); // no glow through a low bore front
  F *= 1.0 - 0.6 * vThin; // a steep, thin breaking face shows its body colour more than the sky

  // Shallow water: the sand under it is seen through the water with per-channel (Beer-Lambert) extinction
  // along the refracted view ray and the sunlight's path down, plus caustics. Everything is written as
  // P + W * bed, where bed is the sand drawn behind the water and W its per-channel weight (see the end).
  vec3 T = vec3(0.0), caus = vec3(0.0);
  if (gl_FrontFacing && vDepth < 30.0) {
    vec3 Rt = refract(-V, N, 0.75);
    float cosT = max(-Rt.y, 0.3);
    float cosS = sqrt(1.0 - (1.0 - uSunDir.y * uSunDir.y) * 0.5625);
    float dz = max(vDepth, 0.0);
    T = exp(-SIGMA * dz * (1.0 / cosT + 1.0 / cosS));
    // caustics: two drifting cell networks, focused at a few decimetres of depth, blurred out further down
    vec2 bp = vWorld.xz + Rt.xz * (dz / cosT);
    float c1 = cellWall(bp * 0.21 + vec2(0.0, uTime * 0.12), uTime * 0.8);
    float c2 = cellWall(bp * 0.29 + vec2(uTime * 0.09, 3.7), -uTime * 0.65 + 1.3);
    float cl = exp(-c1 * 9.0) + exp(-c2 * 9.0);
    caus = vec3(1.0, 0.98, 0.9) * (cl * 1.3 * smoothstep(0.6, 3.5, dz) * exp(-dz / 16.0) * (0.4 + 0.6 * NdL));
  }
  const float WETDARK = 0.6; // wet sand is darker than dry
  vec3 Tw = T * WETDARK;
  vec3 P = (1.0 - F) * (body * (1.0 - T) + Tw * caus * BED) + F * sky + spec * (1.0 - 0.6 * vFoam);
  vec3 W = (1.0 - F) * Tw;

  // foam: a sheet of bubbles whose thickness sets how opaque and how white it is; thin foam is a translucent
  // film tinted by the water, thick foam scatters to bright white, with blue-grey crevices between the lumps
  float blot = clamp((0.65 * vnoise(uv * 0.028 + 0.37) + 0.35 * vnoise(ROT * uv * 0.071) - 0.38) / 0.3, 0.0, 1.0); // large-scale break-up
  float fa = vFoam * (0.7 + 0.6 * blot);
  float ft = 0.0, tau = 0.0;
  if (fa > 0.01) tau = foamThick(vRest, fa, vAge, dist, ft);
  // relief from the thickness (surface-gradient bump mapping), faded out with distance
  float bumpK = 1.5 * (1.0 - smoothstep(60.0, 450.0, dist));
  vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
  float hgt = min(tau, 1.6) * bumpK;
  float hx = dFdx(hgt), hy = dFdy(hgt);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 nb = abs(det) * N - sign(det) * (hx * r1 + hy * r2);
  vec3 Nf = dot(nb, nb) > 1e-14 ? normalize(nb) : N;
  float af = 1.0 - exp(-3.2 * tau);
  float wrap = clamp(dot(Nf, uSunDir) * 0.6 + 0.4, 0.0, 1.0);
  float thickL = smoothstep(0.05, 1.1, tau);
  vec3 foamCol = mix(vec3(0.70, 0.80, 0.88), vec3(1.0), thickL) * (0.78 + 1.0 * wrap + 0.3 * back + 0.15 * Nf.y) * (0.94 + 0.06 * ft);
  foamCol = mix(mix(body * 2.0, foamCol, 0.6), foamCol, thickL); // thin films keep some water colour
  P = mix(P, foamCol, af);
  W *= 1.0 - af;

  float haze = 1.0 - exp(-dist * 0.00024);
  P = mix(P, HORIZON, haze * 0.85);
  W *= 1.0 - haze * 0.85;

  // damp sand left by the swash: a dark, transparent layer, mirror-like where the film is still draining
  // (the layer and the dry-sand drop are judged per pixel from the interpolated depth, so the edge is smooth)
  float sandL = (1.0 - smoothstep(0.3, 0.7, vDepth)) * vLand;
  if (sandL > 0.0) {
    float damp = min(vSand * 2.0, 1.0), glaze = clamp(vSand * 2.0 - 1.0, 0.0, 1.0);
    vec3 Ns = normalize(vec3(0.0, 1.0, 0.0) + vec3(dn.x, 0.0, dn.y) * 0.03);
    float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(Ns, V), 0.0), 5.0);
    vec3 Rs = reflect(-V, Ns);
    vec3 skyS = mix(HORIZON, ZENITH, smoothstep(0.0, 0.35, Rs.y)) + vec3(1.0, 0.95, 0.85) * pow(max(dot(Rs, uSunDir), 0.0), 400.0) * 12.0;
    float refl = glaze * Fs;
    float sandA = clamp(0.4 * damp + refl, 0.0, 1.0);
    vec3 sandCol = mix(vec3(0.17, 0.13, 0.08), skyS, refl / max(refl + 0.4 * damp, 1e-3));
    vec3 Ps = mix(sandCol * sandA, foamCol, af);
    vec3 Ws = vec3((1.0 - sandA) * (1.0 - af));
    Ps = mix(Ps, HORIZON, haze * 0.85);
    Ws *= 1.0 - haze * 0.85;
    P = mix(P, Ps, sandL);
    W = mix(W, Ws, sandL);
  }

  // Output. Blending can only weight the sand behind by one alpha, so alpha takes the red weight (the
  // smallest: red is absorbed most) and the rest of the green/blue transmission is added here using the
  // typical sand colour BED. The sum is done in display space (after tone mapping), where blending happens.
  float alpha = clamp(1.0 - W.r, 0.0, 1.0);
  vec3 tgt = linearToOutputTexel(vec4(toneMapping((P + W * BED) * 1.55), 1.0)).rgb;
  vec3 bedD = linearToOutputTexel(vec4(toneMapping(BED * 1.55), 1.0)).rgb;
  vec3 c = clamp((tgt - bedD * (1.0 - alpha)) / max(alpha, 1e-3), 0.0, 1.0);
  gl_FragColor = vec4(c, alpha);
}
`;

// Non-uniform grid lines: fine near `fine0..fine1`, growing spacing outside.
function gridLines(min, max, fine0, fine1, base, grow) {
  const out = [];
  const step = (v) => {
    const o = v < fine0 ? fine0 - v : v > fine1 ? v - fine1 : 0;
    return base + o * grow;
  };
  // start from the fine region and walk outward both ways
  let v = fine0;
  const left = [];
  while (v > min) { left.push(v); v -= step(v); }
  left.push(min);
  left.reverse();
  out.push(...left);
  v = fine0 + step(fine0);
  while (v < max) { out.push(v); v += step(v); }
  out.push(max);
  return out;
}

function buildGeometry(quality) {
  const f = quality === 'high' ? 1.0 : quality === 'low' ? 1.8 : 1.35;
  const xs = gridLines(-4950, 4950, -800, 800, 3.5 * f, 0.0075);
  const zs = gridLines(-260, 4850, -260, 350, 1.3 * f, 0.0145);
  const nx = xs.length, nz = zs.length;
  const pos = new Float32Array(nx * nz * 3);
  let k = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    pos[k++] = xs[i]; pos[k++] = 0; pos[k++] = zs[j];
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  k = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[k++] = a; idx[k++] = c; idx[k++] = b;
    idx[k++] = b; idx[k++] = c; idx[k++] = d;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 2300), 8000);
  return { geometry: g, vertices: nx * nz };
}

// ---------- spray particles ----------
const SPRAY_VERT = /* glsl */`
attribute float aSize;
attribute float aAlpha;
attribute float aSeed;
varying float vAlpha;
varying float vSeed;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (700.0 / max(-mv.z, 1.0));
  vAlpha = aAlpha;
  vSeed = aSeed;
  gl_Position = projectionMatrix * mv;
}`;
const SPRAY_FRAG = /* glsl */`
varying float vAlpha;
varying float vSeed;
float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h1(i), h1(i + vec2(1.0, 0.0)), u.x), mix(h1(i + vec2(0.0, 1.0)), h1(i + 1.0), u.x), u.y);
}
// a ragged, soft-edged puff (each particle its own shape) rather than a round disc
void main() {
  vec2 c = gl_PointCoord - 0.5;
  vec2 q = c * 4.0 + vSeed * 17.0;
  float n = 0.6 * vn(q) + 0.4 * vn(q * 2.3 + 3.1);
  float a = smoothstep(1.0, 0.15, length(c) * 2.0 + 0.55 * (n - 0.5)) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(0.97, 0.99, 1.0, a * (0.75 + 0.25 * n));
}`;

class Spray {
  constructor(scene, count) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count).fill(1);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.drag = new Float32Array(count);
    this.alphaMul = new Float32Array(count);
    this.seed = new Float32Array(count).map(() => Math.random());
    this.next = 0;
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aSize', this.sizeAttr);
    g.setAttribute('aAlpha', this.alphaAttr);
    g.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: SPRAY_VERT, fragmentShader: SPRAY_FRAG,
      transparent: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
  }
  emit(x, y, z, vx, vy, vz, life, size, drag, alpha = 0.9) {
    const i = this.next; this.next = (this.next + 1) % this.count;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.drag[i] = drag; this.alphaMul[i] = alpha;
  }
  update(dt) {
    for (let i = 0; i < this.count; i++) {
      if (this.life[i] <= 0) { this.alpha[i] = 0; continue; }
      this.life[i] -= dt;
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= dr; this.vel[i * 3 + 2] *= dr;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr - 30 * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const a = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.min(1, a * 1.6) * this.alphaMul[i];
      this.size[i] *= 1 + 0.6 * dt;
    }
    this.posAttr.needsUpdate = this.sizeAttr.needsUpdate = this.alphaAttr.needsUpdate = true;
  }
}

// ---------- public API ----------
export function createSurf(scene, { sunDir, quality = 'medium', rogueIn } = {}) {
  const loader = new THREE.TextureLoader();
  const normTex = loader.load('./textures/waternormals.jpg');
  normTex.wrapS = normTex.wrapT = THREE.RepeatWrapping;

  const { geometry, vertices } = buildGeometry(quality);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: {
      uTime: { value: 0 },
      uSunDir: { value: (sunDir || new THREE.Vector3(0, 0.26, 0.97)).clone().normalize() },
      uNormTex: { value: normTex },
      uRogue: { value: new THREE.Vector3(-1e9, 0, 0) },
    },
    side: THREE.DoubleSide,
    transparent: true,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'surf';
  scene.add(mesh);

  const spray = new Spray(scene, 3000);
  const st = {};
  let time = 0, emitAcc = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);
  let nextRogue = rogueIn != null ? rogueIn : rnd(SURF.rogueMin, SURF.rogueMax);
  ROGUE.fn = -1e9; ROGUE.H = 0;
  // pick the crest now ~1400 units offshore (about 40 s out) and make it the rogue
  function spawnRogue(cx) {
    ROGUE.fn = Math.round(phaseAt(cx, 1400, time) / TAU);
    ROGUE.H = SURF.rogueH; ROGUE.x = cx;
    material.uniforms.uRogue.value.set(ROGUE.fn, ROGUE.H, ROGUE.x);
  }

  function sample(x, z) {
    const r = evalSurf(x, z, time, false, {});
    const ra = evalSurf(x, z + 1, time, false, {});
    const rb = evalSurf(x, z - 1, time, false, {});
    r.dydz = (ra.y - rb.y) / 2;
    r.bed = bedHeight(x, z);
    r.depth = r.y - r.bed;
    // depth-averaged water velocity (shallow-water estimate), units per second, +z seaward
    const c = r.L / SURF.period;
    const depth = Math.max(r.depth, 1.5);
    const eta = Math.max(r.y, -3);
    r.u = Math.max(-c * 1.6, Math.min(c * 0.6, -c * eta / depth * (1 + 1.5 * r.bore)));
    // the lip of a breaking wave falling on (x, z)?
    r.lipHit = null;
    for (const fn of [r.fn, r.fn + 1]) {
      const dc = crestD(fn, x, time);
      crestState(fn, x, dc, st);
      if (st.p > 0.55 && st.p < 1.6 && st.H > 4) {
        const tip = lipTip(st, dc);
        if (r.d > tip.d - 4 && r.d < dc + 2) { r.lipHit = { fn, H: st.H, kind: 'lip', yTop: 0.8 * st.H }; break; }
      } else if (st.p >= 1.6 && st.H > 4.5 && Math.abs(r.d - dc) < 5) {
        r.lipHit = { fn, H: st.H, kind: 'bore', yTop: 0.8 * st.H }; break;
      }
    }
    return r;
  }

  function emitSpray(dt, cx) {
    emitAcc += dt;
    if (emitAcc < 1 / 30) return;
    const step = emitAcc; emitAcc = 0;
    for (let x = Math.round(cx / 40) * 40 - 1600; x <= cx + 1600; x += 40) {
      const ex = x + (Math.random() - 0.5) * 40;
      const zs = shoreZ(ex);
      const nLo = Math.ceil(phaseAt(ex, 15, time) / TAU), nHi = Math.floor(phaseAt(ex, 440, time) / TAU);
      for (let fn = nLo; fn <= nHi; fn++) {
        const dc = crestD(fn, ex, time);
        crestState(fn, ex, dc, st);
        if (st.p > 0.35 && st.p < 1.35) {
          // lip spray, thrown forward off the tip
          const tip = lipTip(st, dc);
          const n = Math.min(30, Math.floor(st.H * 0.9 * step * 30 * (0.5 + Math.random())));
          for (let i = 0; i < n; i++) {
            spray.emit(ex + (Math.random() - 0.5) * 40, tip.y + Math.random() * 2, zs + tip.d + (Math.random() - 0.5) * 3,
              (Math.random() - 0.5) * 6, 8 + Math.random() * 14, -14 - Math.random() * 18,
              0.6 + Math.random() * 0.7, 1.2 + Math.random() * 1.6, 0.8);
          }
        }
        if (st.p > 0.9 && st.p < 3.2 && st.H > 2) {
          // whitewash mist rising off the bore / landing lip
          const n = Math.min(20, Math.floor(st.H * 0.45 * step * 30 * Math.random() + 0.3));
          for (let i = 0; i < n; i++) {
            spray.emit(ex + (Math.random() - 0.5) * 40, 0.5 * st.H + Math.random() * 2, zs + dc - 4 + Math.random() * 8,
              (Math.random() - 0.5) * 4, 3 + Math.random() * 6, -st.H * 0.8 - Math.random() * 6,
              1.0 + Math.random() * 1.2, 3 + Math.random() * 4, 1.5, 0.4); // thin mist
          }
        }
      }
    }
  }

  return {
    mesh, material, vertices,
    get time() { return time; },
    update(dt, cameraX = 0) {
      time += dt;
      material.uniforms.uTime.value = time;
      if (time >= nextRogue) { spawnRogue(cameraX); nextRogue = time + rnd(SURF.rogueMin, SURF.rogueMax); }
      emitSpray(dt, cameraX);
      spray.update(dt);
    },
    sample,
    // the current rogue wave: crest distance from the shore at x (null when none is on its way in)
    rogue(x = ROGUE.x) {
      if (ROGUE.H <= 0) return null;
      const dc = crestD(ROGUE.fn, x, time);
      return dc > -40 ? { fn: ROGUE.fn, d: dc, H: ROGUE.H, x: ROGUE.x, next: nextRogue - time } : null;
    },
    triggerRogue(cx = 0) { spawnRogue(cx); },
    dispose() {
      scene.remove(mesh); scene.remove(spray.points);
      geometry.dispose(); material.dispose();
      spray.points.geometry.dispose(); spray.points.material.dispose();
    },
  };
}
