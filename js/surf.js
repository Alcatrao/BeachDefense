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
  period: 8.5,        // s between waves
  L0: 400,            // offshore wavelength (crests travel at L0 / period offshore, ~0.54 of that at the shore)
  shoalA: 0.85,       // wavelength shortens near the shore: k = k0 (1 + A e^(-d/B))
  shoalB: 220,
  kx: 0.0012,         // slight obliquity of the crests
  slope: 0.085,       // seabed slope (depth = slope * d - 0.5)
  Hbase: 20,          // typical breaking wave height (player eye height is 10)
  breakRatio: 0.95,   // inner-bar waves break where depth ~ H / breakRatio
  peel: 0.22,         // how fast the break point moves away from each wave's peak
  minBreakD: 40,      // every wave has closed out by this distance
  breakSpan: 45,      // distance the crest travels from break onset to lip landing
  q: 0.55,            // horizontal crest sharpening (Gerstner-like)
  setLen: 7,          // waves per set
  runup: 3.2,         // swash run-up length per unit wave height
  swashLobe: 0.3,     // how much a wave's run-up varies along the beach (+-; its lobes are ~7-14 m wide)
  film: 1.4,          // swash film thickness over the sand
  flatSand: 100,      // must match main.js FLAT_SAND_WIDTH
  duneStart: -650,    // must match main.js DUNE_START
  // two breaking zones: an outer bar (~80 m out) where the bigger set waves break, their whitewater bores
  // charging on across the trough to the shorebreak; the others break on the inner bar (~45 m)
  barOuter: 470,      // outer-bar break distance (the player is ~5.9 units per metre)
  outerGain: 1.5,     // outer-bar waves are this much bigger than the base wave
  outerMin: 1.0,      // only waves with Hn > outerMin * Hbase break on the outer bar
  innerGain: 1.15,
  innerMax: 275,      // inner-bar break distance cap
  reform0: 345,       // crest distance where a swell that did not break on the outer bar...
  reform1: 305,       // ...takes on its inner-bar break
  rogueH: 85,         // rogue wave height (~14 m)
  rogueMin: 180,      // s between rogue waves (random in [rogueMin, rogueMax])
  rogueMax: 420,
};

// The current rogue wave (crest index, height, centre x); set by createSurf().update.
const ROGUE = { fn: -1e9, H: 0, x: 0 };
function rogueG(fn, x) { return fn === ROGUE.fn ? Math.exp(-(((x - ROGUE.x) / 900) ** 2)) : 0; }
// A bore's height wanders along its crest (about -1..1, fixed per crest; mirrored in GLSL)
function boreVar(fn, x) {
  return 0.45 * Math.sin(x * 0.029 + fn * 2.1) + 0.25 * Math.sin(x * 0.051 + fn * 4.3 + 1.0)
    + 0.15 * Math.sin(x * 0.067 + fn * 1.1) + 0.15 * Math.sin(x * 0.13 + fn * 1.7 + 2.5);
}

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
// Each wave's swash runs up further in some places than in others: lobes along the beach (-1..1, fixed per wave;
// mirrored in GLSL), and their slope along x.
function swashLobe(fn, x) {
  return 0.55 * Math.sin(x * 0.045 + fn * 2.7) + 0.33 * Math.sin(x * 0.097 + fn * 4.1 + 1.3)
    + 0.12 * Math.sin(x * 0.16 + fn * 1.9 + 0.4);
}
function swashLobeDx(fn, x) {
  return 0.02475 * Math.cos(x * 0.045 + fn * 2.7) + 0.03201 * Math.cos(x * 0.097 + fn * 4.1 + 1.3)
    + 0.0192 * Math.cos(x * 0.16 + fn * 1.9 + 0.4);
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
  // and it peaks up as it nears its break, by 16 % (most of it before the lip starts to throw, at p 0)
  const Hpre = Hn * shoal * (1 + 0.16 * sstep(-3.5, 1.0, p));
  // the bore's height follows the depth, and faster than it (depth^1.5, against the depth where this stage broke):
  // a bore that merely kept pace with the depth would look the same size all the way in from the beach (constant
  // H / dc); this one shrinks on its way in and is all but gone at the waterline
  const depthC = Math.max(SURF.slope * dc - 0.5, 0.3), depthB = Math.max(SURF.slope * db - 0.5, 0.3);
  const Hbore = Math.min(Hn, boreK * depthC * Math.sqrt(depthC / depthB) + 0.5);
  o.p = p;
  o.bore = sstep(0.95, 2.0, p); // the crash spends the wave's height quickly: bore height by p ~ 2
  // ... and near the sand in any case: a closeout that broke late (db ~ 40) would still be ~9 high when its crest
  // reaches the waterline, where the land clamp cuts its face off into a wall standing on the sand
  o.bore = 1 - (1 - o.bore) * (1 - sstep(16, 3, dc));
  o.H = Hpre + (Hbore - Hpre) * o.bore;
  // the landed lip keeps the shape of the wave that threw it (Hc) and is squashed down to the bore height H,
  // so it collapses into a low roller; the shape relaxes to the bore's own over p 2.6..5
  o.Hc = o.H + (Hpre - o.H) * (1 - sstep(2.6, 5.0, p));
  o.steep = sstep(-1.6, 0.9, p);
  // the lip only ever rolls further: after landing it turns over into the roller and never unrolls into a tube again.
  o.thetaMax = 2.7 * sstep(0, 1.15, p) + 0.35 * sstep(1.1, 1.9, p);
  // before it throws, the crest forms: its top peaks (crest) and then leans forward (lean, a shear: see evalSurf), so
  // the face stands up before the lip leaves it; both are gone once the lip is out (p 0.7), so the tube is unchanged
  o.crest = sstep(-3.5, -1.0, p) * (1 - sstep(0.2, 0.7, p));
  o.lean = sstep(-2.6, -0.6, p) * (1 - sstep(0.2, 0.7, p));
  o.pc = Math.min(Math.max(p, 0), 1);
  return o;
}
const _sa = {}, _sb = {};
// Wave state for crest `fn` whose crest is at distance dc. A wave big enough to break on the outer bar stays that
// stage all the way in: its whitewater bore charges on across the trough to the shorebreak. Any other blends into
// its inner-bar stage over the trough.
function crestState(fn, x, dc, o) {
  waveParams(fn, x, o);
  const A = stageState(o.HnA, o.dbA, SURF.barOuter, o.boreKA, dc, _sa);
  const B = stageState(o.Hn, o.db, o.db0, 0.55, dc, _sb);
  const wB = o.outer ? 0 : sstep(SURF.reform0, SURF.reform1, dc);
  const m = (a, b) => a + (b - a) * wB;
  o.wB = wB;
  o.p = wB < 0.5 ? A.p : B.p;          // the stage in charge (for lip / spray events)
  o.H = m(A.H, B.H); o.Hc = Math.max(m(A.Hc, B.Hc), 1e-3); o.bore = m(A.bore, B.bore); o.steep = m(A.steep, B.steep);
  o.H *= 1 + 0.25 * o.bore * boreVar(fn, x); // lumps along the bore's top (not the curl: bore is 0 until it lands)
  o.pc = m(A.pc, B.pc);
  const cur = o.outer ? A : B; // the stage whose curl is in charge
  o.thetaMax = cur.thetaMax; o.crest = cur.crest; o.lean = cur.lean;
  // once the lip has landed the tube collapses: the roller shrinks to a small one riding the bore front
  // (p 1.0 -> 1.9, sig = roller size), and shrinks away before reaching the sand
  const sigS = sstep(15, 45, dc), sigP = 1 - 0.6 * sstep(1.0, 1.9, cur.p);
  o.sig = sigS * sigP;
  o.imp = m(impOf(A.p), impOf(B.p));
  // and the tube's air pocket closes (p 1.05 -> 1.5): the roller becomes one solid tumbling mass (see evalSurf)
  o.fill = sstep(1.05, 1.5, cur.p);
  o.pC = cur.p; // the stage of the curl in charge
  o.D = surgeOf(o, Math.min(Math.max((dc + 15) / 60, 0), 1), sigS * sigP, TAU / kOf(dc));
  return o;
}
// How far the wave is carried forward while it breaks (mirrored in GLSL). Rotating past its turn-over angle
// (atan2(Y, X) from straight back) and the roller shrinking (sigS sigP) would pull the lip tip back towards the
// crest, which reads as the breaking wave rolling backwards: the wave moves forward by that much instead (evalSurf
// shifts it by D), so the tip keeps its furthest reach and the front never slows below the crest's own speed.
// keep: how much of that reach is kept; it is let go evenly over crest d 45 -> -15, much slower than the crest
// moves, so the bore still meets the swash at the shoreline.
function surgeOf(w, keep, shrink, L) {
  const sh = Math.max(w.steep, w.bore), Hc = w.Hc;
  const wc = Math.min(L * (0.13 - 0.095 * sh), 0.32 * Hc);
  const X = 0.5 * wc + 0.12 * Hc * w.pc, Y = 0.62 * Hc; // the lip tip from the pivot, before it turns
  const th = Math.max(w.thetaMax, Math.PI - Math.atan2(Y, X));
  return Math.min(keep * (shrink * (-X * (1 - Math.cos(th)) - Y * Math.sin(th)) + X + Math.hypot(X, Y)), 0.2 * L);
}
// impact whitewater of one stage: from the moment the lip lands (p ~ 0.9) until the bore has taken over
function impOf(p) { return sstep(0.9, 1.2, p) * (1 - sstep(3, 5, p)); }
// lumps of the tumbling whitewater mass, about -1..1 (mirrored in GLSL); slow, so the mass boils instead of trembling
function rollerLumps(x, u, fn, t) {
  return 0.5 * Math.sin(x * 0.043 + u * 0.12 + 0.7 * t + fn * 1.7) + 0.35 * Math.sin(-x * 0.079 + u * 0.19 + 1.0 * t + fn * 0.9)
    + 0.25 * Math.sin(x * 0.131 - u * 0.09 + 1.3 * t) + 0.2 * Math.sin(x * 0.17 + u * 0.21 + 1.6 * t + fn);
}
// lumpy whitewater displacement (per unit wave height), mirrored in GLSL: on the crest-relative s2, so the lumps ride
// the bore (and its mesh rows) and only boil slowly, instead of racing through it as travelling ripples
function boreLumps(x, s2, t) {
  return 0.035 * Math.sin(x * 0.11 + s2 * 0.07 + t * 0.6) + 0.03 * Math.sin(-x * 0.19 + s2 * 0.23 + t * 0.8)
    + 0.02 * Math.sin(x * 0.37 - s2 * 0.29 + t * 1.1);
}
function nGauss(x, w, L, q = 2) {
  if (q === 2) {
    const e = Math.exp(-((0.5 * L / w) ** 2));
    return (Math.exp(-((x / w) ** 2)) - e) / (1 - e);
  }
  // q < 2: a peaked top (a forming crest)
  const e = Math.exp(-Math.pow(0.5 * L / w, q));
  return (Math.exp(-Math.pow(Math.abs(x / w), q)) - e) / (1 - e);
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
  let psi = phi / TAU - fn;
  const L = TAU / kOf(d);
  let s = psi * L;
  let dc = d - s;
  const w = crestState(fn, x, dc, _ws);
  // the breaking wave carried forward by D (see surgeOf); only near its crest, so the next wave keeps its place
  s += w.D * (1 - sstep(0.1, 0.45, Math.abs(psi)));
  psi = s / L; dc = d - s;
  const H = w.H, p = w.p, bore = w.bore;
  const sh = Math.max(w.steep, bore);
  let s2 = s;
  if (curl) {
    const ah = Math.min(SURF.q * (0.6 + 0.4 * sh) * L / TAU, 1.5 * H);
    s2 = s - ah * Math.sin(TAU * psi);
  }
  const wf = L * (0.13 + (0.035 - 0.13) * sh);
  const wb = L * (0.2 + (0.32 - 0.2) * bore);
  const qf = 2 - 0.6 * w.crest, qb = 2 - 0.4 * w.crest; // a forming crest peaks (stageState)
  const bump = s2 < 0 ? nGauss(s2, wf, L, qf) : nGauss(s2, wb, L, qb);
  // trough level: towards a crest-independent level near psi = +-0.5, so the trough behind one wave
  // meets the trough ahead of the next without a step (each crest's own -0.2 H differs)
  const tw = sstep(0.25, 0.5, Math.abs(psi));
  const tgt = 0.45 * SURF.Hbase * sstep(20, 120, d);
  const Ht = H + (tgt - H) * tw;
  let y = H * bump - 0.2 * Ht;
  let dA = dc + s2;
  // a forming crest leans forward: its top is sheared shoreward, most at the peak (by at most 0.45 wf, so the face
  // never folds over: the shear's slope stays under 0.55)
  dA -= w.lean * Math.min(0.3 * H, 0.45 * wf) * bump * bump;

  // curl, shaped at the height Hc and squashed to H (see stageState); a roller of relative size sig is the
  // full-size curl displacement taken at u = s2 / sig and scaled by sig, so it shrinks without unrolling.
  // Below 0.8 of full size its front and back are widened in u (kw), so it never spans fewer mesh rows than at
  // 0.8: a narrower roller spans too few rows and renders as spikes where the crest crosses the rows obliquely
  // (the mesh rows follow the crests only inside |x| 1000, see buildGeometry).
  const Hc = w.Hc, Htc = Hc + (tgt - Hc) * tw, sig = w.sig;
  const pivY = 0.18 * Hc, topY = 0.8 * Hc, wc = Math.min(wf, 0.32 * Hc);
  const u = s2 / Math.max(sig, 1e-3);
  const kw = Math.max(1, 0.8 / Math.max(sig, 0.05)), wfk = wf * kw;
  const yv = Hc * (u < 0 ? nGauss(u, wfk, L, qf) : nGauss(u, wb, L, qb)) - 0.2 * Htc;
  const hw = Math.min(Math.max((yv - pivY) / (topY - pivY), 0), 1);
  const bw = 1 - sstep(0, (0.45 * Hc + wc) * kw, u);
  let wm = 0; // the collapsed roller's step (see below), kept out of the swash pull
  if (curl) {
    const th = w.thetaMax * Math.pow(hw, 1.1) * bw;
    if (th > 0) {
      const dp = dc - (0.5 * wc + 0.12 * Hc * w.pc);
      const X = -(dc + u - dp), Y = yv - pivY;
      const c = Math.cos(th), sn = Math.sin(th);
      let rx = -(X * c + Y * sn), ry = -X * sn + Y * c; // the rotated point, relative to the pivot
      if (u < 0 && w.fill > 0) {
        // the tube closes: the inner wall (u from uT, where the face reaches the pivot height, up to the lip tip
        // at u = 0) is pulled onto the straight chord between those two points
        const e = Math.exp(-((0.5 * L / wfk) ** 2)), g = (pivY + 0.2 * Htc) / Hc;
        const uT = -wfk * Math.sqrt(-Math.log(Math.min(Math.max(g + (1 - g) * e, 1e-4), 0.9999)));
        const yv0 = Hc - 0.2 * Htc, th0 = w.thetaMax * Math.pow(Math.min(Math.max((yv0 - pivY) / (topY - pivY), 0), 1), 1.1);
        const X0 = dp - dc, Y0 = yv0 - pivY, c0 = Math.cos(th0), s0 = Math.sin(th0);
        const tx = -(X0 * c0 + Y0 * s0), ty = -X0 * s0 + Y0 * c0; // the lip tip
        const q = Math.min(Math.max(u / uT, 0), 1);
        rx += (tx + (dc + uT - dp - tx) * q - rx) * w.fill;
        ry += (ty * (1 - q) - ry) * w.fill;
      }
      const rag = w.imp * Math.sqrt(hw) * bw; // the landed roller breaks up into a ragged, tumbling mass
      if (rag > 0) {
        const a = 0.16 * Hc * rag * rollerLumps(x, u, fn, t) / Math.max(Math.hypot(rx, ry), 0.35 * Hc);
        rx += a * rx; ry += a * ry;
      }
      // the collapsed roller rides the bore as a solid step (p 1.5 -> 1.9): its front (u 0..uN, up to the nose, its
      // most forward point) becomes a steep ramp down to a toe just under the face at most 0.6 m ahead, and the inner
      // wall (u uT..0) the straight chord from the toe back to the face. Otherwise the ragged chord pokes through the
      // face and the near edge-on underside shows as a thin crest-parallel seam.
      const wallT = w.fill * sstep(1.5, 1.9, w.pC) * sstep(0, 0.02, sig);
      if (wallT > 0) {
        const uB = (0.45 * Hc + wc) * kw;
        const uN = 0.3 * uB * wb / Math.pow(uB ** 4 + wb ** 4, 0.25); // stays on the roller's front at any size
        const eT = Math.exp(-((0.5 * L / wfk) ** 2)), gT = (pivY + 0.2 * Htc) / Hc;
        const uT = -wfk * Math.sqrt(-Math.log(Math.min(Math.max(gT + (1 - gT) * eT, 1e-4), 0.9999)));
        wm = wallT * sstep(uT, 0.5 * uT, u) * (1 - sstep(uN, 2 * uN, u));
        if (u >= uT && u < uN) {
          const yN = Hc * nGauss(uN, wb, L) - 0.2 * Htc, hwN = Math.min(Math.max((yN - pivY) / (topY - pivY), 0), 1);
          const bwN = 1 - sstep(0, uB, uN), thN = w.thetaMax * Math.pow(hwN, 1.1) * bwN;
          const XN = -(dc + uN - dp), YN = yN - pivY, cN = Math.cos(thN), sN = Math.sin(thN);
          let nx = -(XN * cN + YN * sN), ny = -XN * sN + YN * cN; // the nose, with its own lumps
          const aN = 1 + 0.16 * Hc * w.imp * Math.sqrt(hwN) * bwN * rollerLumps(x, uN, fn, t) / Math.max(Math.hypot(nx, ny), 0.35 * Hc);
          nx *= aN; ny *= aN;
          // a gentle front on a small late step instead of a backlit vertical wall
          const toeX = nx - Math.min(0.6 / sig, 0.5 * uN);
          const zT = sig * (toeX + dp - dc), yv0 = Hc - 0.2 * Htc;
          const eps = (0.25 * H + 0.8) * Hc / Math.max(H, 1e-3) * sstep(0.1, 0.3, sig);
          const toeY = (Hc * (zT < 0 ? nGauss(zT, wf, L) : nGauss(zT, wb, L)) - 0.2 * Htc - eps - yv0) / sig + yv0 - pivY;
          let qx, qy;
          if (u >= 0) { const q = u / uN; qx = toeX + (nx - toeX) * q; qy = toeY + (ny - toeY) * q; }
          else { const q = Math.min(Math.max(u / uT, 0), 1); qx = toeX + (dc + uT - dp - toeX) * q; qy = toeY * (1 - q); }
          rx += (qx - rx) * wallT; ry += (qy - ry) * wallT;
        }
      }
      const yc = Hc * bump - 0.2 * Htc + sig * (pivY + ry - yv);
      dA += sig * (dp + rx - (dc + u));
      y = -0.2 * Ht + (yc + 0.2 * Htc) * (H / Hc);
    }
  }

  // turbulent, lumpy whitewater on the bore front and just behind it
  const turb = bore * (1 - sstep(0.15 * L, 0.45 * L, s2)) * sstep(-wf - 4, -0.3 * wf, s2);
  if (turb > 0) y += turb * H * boreLumps(x, s2, t);

  // land clamp + swash
  const sand = 0.5 + landH(z);
  if (d < 0) y = Math.min(y, sand - 1.6);
  let wet = 0;
  if (d < 40) {
    const phi0 = phaseAt(x, 0, t);
    const f0 = Math.floor(phi0 / TAU);
    const tau = phi0 / TAU - f0;
    const tt = tau / 0.75;
    const lob = SURF.swashLobe * swashLobe(f0, x);
    const R0 = SURF.runup * waveHn(f0, x), R = R0 * (1 + lob);
    const r0 = tt < 1 ? R0 * (tt < 0.3 ? Math.sin(tt / 0.3 * 1.5708) : Math.cos((tt - 0.3) / 0.7 * 1.5708)) : 0;
    const r = r0 * (1 + lob);
    // the bands along the front are measured across it (along d, its steep lobe sides would thin them to slivers)
    const gF = r0 * SURF.swashLobe * swashLobeDx(f0, x);
    wet = sstep(-3, 12, (d + r) / Math.sqrt(1 + gF * gF));
    const bed = d > 0 ? sand - SURF.slope * d : sand;
    // sand the swash has wetted (up to the highest run-up of this or the last wave) keeps a thin layer just above it
    const Rp = SURF.runup * waveHn(f0 - 1, x) * 0.8, Rc = tt < 0.3 ? r : R;
    const Rq = Rp * (1 + SURF.swashLobe * swashLobe(f0 - 1, x)), Rw = Math.max(Rc, Rq);
    const gW = Rc >= Rq ? (tt < 0.3 ? r0 : R0) * SURF.swashLobe * swashLobeDx(f0, x) : Rp * SURF.swashLobe * swashLobeDx(f0 - 1, x);
    const dampSand = sstep(-12, -4, (d + Rw) / Math.sqrt(1 + gW * gW)); // drops below the sand only where it is already invisible
    const ys = bed + SURF.film * wet + (0.2 * dampSand - 1.5 * (1 - dampSand)) * (1 - wet);
    const k = sstep(40, 20, d);
    // smooth max of the sea surface and the swash film: a hard max leaves a crease the grid renders as a staircase
    const hm = Math.min(Math.max(0.5 + 0.5 * (ys - y) / 2.5, 0), 1);
    const ym = y + (ys - y) * hm + 2.5 * hm * (1 - hm);
    y += (ym - y) * k; dA += (d - dA) * k * hm * (1 - wm); // pulling the step back to rest would lean it
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
  const H = w.H, Hc = w.Hc, pivY = 0.18 * Hc, topY = 0.8 * Hc, wc = Math.min(wf, 0.32 * Hc);
  const dp = dc - (0.5 * wc + 0.12 * Hc * w.pc);
  const X = -(dc - dp), Y = topY - pivY, th = w.thetaMax;
  const c = Math.cos(th), sn = Math.sin(th);
  // the crest point carried by a roller of size sig, squashed from Hc to H like the surface
  const y = topY + w.sig * (pivY + (-X * sn + Y * c) - topY);
  return { d: dc - w.D + w.sig * (dp - (X * c + Y * sn) - dc), y: -0.2 * H + (y + 0.2 * Hc) * (H / Hc), wf };
}
// The front face and top of a bore at x, sampled off the surface itself (the collapsed roller's front pokes out
// some way ahead of the lip tip td, and its top stands behind it). out: z = the face (the furthest shoreward point
// above a third of the way up), yb = the water just ahead of it, top = the highest point, zt = where it is
const _bf = {}, _bfy = new Float32Array(10), _bfz = new Float32Array(10);
function boreFace(x, zs, td, H, t, out) {
  out.yb = evalSurf(x, zs + td - 1.5 * H, t, false, _bf).y;
  let top = out.yb, zt = zs + td;
  for (let i = 0; i < 10; i++) {
    evalSurf(x, zs + td + H * (-0.8 + 0.27 * i), t, true, _bf);
    _bfy[i] = _bf.y; _bfz[i] = _bf.z;
    if (_bf.y > top) { top = _bf.y; zt = _bf.z; }
  }
  const yc = out.yb + 0.33 * (top - out.yb);
  let z = zs + td;
  for (let i = 0; i < 10; i++) if (_bfy[i] > yc) z = Math.min(z, _bfz[i]);
  out.z = z; out.top = top; out.zt = zt;
  return out;
}

// ---------- GLSL ----------
const GLSL_COMMON = /* glsl */`
#define TAU 6.28318530718
float gDrift; // set by surfPos: how far the swash has carried its foam up the beach (for foam texturing only)
vec2 gCrest;  // set by surfPos: position across the crest (s2) and a mask that is 1 near the crest (foam texturing only)
vec3 gBrk;    // set by surfPos: the breaker's own texture frame and its weight (see the end of surfPos)
bool gFlat = false; // set before surfPos: no crest bunching and no curl, so (x, z) stays put (JS evalSurf with curl false)
float gTs = 0.0;    // set before surfPos: how far after uTime to take the surface (s)
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
const float SWLOBE = ${SURF.swashLobe.toFixed(5)};
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
float phaseAt(float x, float d) { return OMEGA * (uTime + gTs) + sOf(d) + KX * x + wobble(x); }
float waveBaseHn(float fn) {
  uint h = hashU(uint(int(fn) + 100000));
  float setv = 0.5 + 0.5 * sin(fn * TAU / SETLEN + 1.0);
  return HBASE * (0.62 + 0.45 * setv + 0.18 * hash01(h));
}
float rogueG(float fn, float x) { return abs(fn - uRogue.x) < 0.5 ? exp(-pow((x - uRogue.z) / 900.0, 2.0)) : 0.0; }
float boreVar(float fn, float x) {
  return 0.45 * sin(x * 0.029 + fn * 2.1) + 0.25 * sin(x * 0.051 + fn * 4.3 + 1.0)
    + 0.15 * sin(x * 0.067 + fn * 1.1) + 0.15 * sin(x * 0.13 + fn * 1.7 + 2.5);
}
// where the bore's white front reaches, also wandering along the crest (-1..1, shorter than boreVar; foam only)
float boreRag(float fn, float x) {
  return 0.45 * sin(x * 0.093 + fn * 3.7) + 0.35 * sin(x * 0.17 + fn * 1.3 + 2.0) + 0.2 * sin(x * 0.24 + fn * 5.1 + 0.7);
}
float waveHn(float fn, float x) { float b = waveBaseHn(fn) * INGAIN; return b + (ROGUEH / 3.0 - b) * rogueG(fn, x); }
// how much further than the mean wave fn's swash runs up at x (-1..1), and its slope along x
float swashLobe(float fn, float x) {
  return 0.55 * sin(x * 0.045 + fn * 2.7) + 0.33 * sin(x * 0.097 + fn * 4.1 + 1.3) + 0.12 * sin(x * 0.16 + fn * 1.9 + 0.4);
}
float swashLobeDx(float fn, float x) {
  return 0.02475 * cos(x * 0.045 + fn * 2.7) + 0.03201 * cos(x * 0.097 + fn * 4.1 + 1.3) + 0.0192 * cos(x * 0.16 + fn * 1.9 + 0.4);
}
// where crest fn starts to break at x: on the outer bar if it is big enough (surfPos's dbA), else its inner-bar
// break distance (db0)
float breakZone(float fn, float x) {
  if (waveBaseHn(fn) > OUTMIN * HBASE || abs(fn - uRogue.x) < 0.5) {
    uint h2 = hashU(hashU(uint(int(fn) + 100000)) ^ 0x9e3779b9u);
    float ax = abs(x - (hash01(h2) * 2.0 - 1.0) * 900.0);
    return max(BAROUT + 15.0 * sin(x * 0.009 + fn * 2.3) + 70.0 * rogueG(fn, x) - 0.1 * ax, BAROUT - 20.0);
  }
  return (waveHn(fn, x) / BRATIO + 0.5) / SLOPE;
}
struct WS { float H; float Hc; float p; float bore; float steep; float th; float pc; float l1; float l2; float cap; float chop; float cr; float ln; };
WS stageS(float Hn, float db, float db0, float boreK, float dc) {
  WS w;
  float p = (db - dc) / BSPAN;
  float shoal = 0.55 + 0.45 * sstep(db0 + 420.0, db0, dc);
  float Hpre = Hn * shoal * (1.0 + 0.16 * sstep(-3.5, 1.0, p)); // peaking up as it nears its break
  float depthC = max(SLOPE * dc - 0.5, 0.3), depthB = max(SLOPE * db - 0.5, 0.3);
  float Hbore = min(Hn, boreK * depthC * sqrt(depthC / depthB) + 0.5); // shrinks faster than the depth (stageState)
  w.p = p;
  w.bore = 1.0 - (1.0 - sstep(0.95, 2.0, p)) * (1.0 - sstep(16.0, 3.0, dc)); // a bore by the sand in any case
  w.H = mix(Hpre, Hbore, w.bore);
  w.Hc = mix(w.H, Hpre, 1.0 - sstep(2.6, 5.0, p)); // shape height of the collapsing curl (see stageState)
  w.steep = sstep(-1.6, 0.9, p);
  w.th = 2.7 * sstep(0.0, 1.15, p) + 0.35 * sstep(1.1, 1.9, p); // never unrolls
  w.cr = sstep(-3.5, -1.0, p) * (1.0 - sstep(0.2, 0.7, p)); // a forming crest peaks ...
  w.ln = sstep(-2.6, -0.6, p) * (1.0 - sstep(0.2, 0.7, p)); // ... and leans (stageState)
  w.pc = clamp(p, 0.0, 1.0);
  w.l1 = sstep(0.25, 0.9, p); w.l2 = sstep(0.9, 1.6, p); w.cap = sstep(-3.0, -1.0, p); w.chop = sstep(-0.5, 0.5, p);
  return w;
}
float nGauss(float x, float w, float L) {
  float e = exp(-pow(0.5 * L / w, 2.0));
  return (exp(-pow(x / w, 2.0)) - e) / (1.0 - e);
}
float nGauss(float x, float w, float L, float q) { // q < 2: a peaked top (JS nGauss)
  float e = exp(-pow(0.5 * L / w, q));
  return (exp(-pow(abs(x / w), q)) - e) / (1.0 - e);
}
// impact whitewater of one stage: from the moment the lip lands (p ~ 0.9) until the bore has taken over
float impOf(float p) { return sstep(0.9, 1.2, p) * (1.0 - sstep(3.0, 5.0, p)); }
// lumps of the tumbling whitewater mass, about -1..1 (mirrored in JS): they roll forward over the roller and boil,
// slowly, so the mass does not tremble; wavelengths of at least ~8 grid cells so the mesh can follow them
float rollerLumps(float x, float u, float fn) {
  float t = uTime + gTs;
  return 0.5 * sin(x * 0.043 + u * 0.12 + 0.7 * t + fn * 1.7) + 0.35 * sin(-x * 0.079 + u * 0.19 + 1.0 * t + fn * 0.9)
    + 0.25 * sin(x * 0.131 - u * 0.09 + 1.3 * t) + 0.2 * sin(x * 0.17 + u * 0.21 + 1.6 * t + fn);
}
// returns displaced position; foam/thin/wet via out params
vec3 surfPos(vec2 xz, out float foam, out float thin, out float wetOut, out vec4 sandW, out float age) {
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
  float wB = outer ? 0.0 : sstep(REF0, REF1, dc); // an outer-bar wave's bore charges on to the shore (crestState)
  float p = wB < 0.5 ? A.p : B.p;
  float H = mix(A.H, B.H, wB);
  float Hc = max(mix(A.Hc, B.Hc, wB), 1e-3);
  float bore = mix(A.bore, B.bore, wB);
  H *= 1.0 + 0.25 * bore * boreVar(fn, x); // crestState
  float steep = mix(A.steep, B.steep, wB);
  float thetaMax = outer ? A.th : B.th;
  float crestP = outer ? A.cr : B.cr, leanP = outer ? A.ln : B.ln;
  float qf = 2.0 - 0.6 * crestP, qb = 2.0 - 0.4 * crestP;
  float pC = outer ? A.p : B.p; // the stage of the curl in charge
  float sigS = sstep(15.0, 45.0, dc), sigP = 1.0 - 0.6 * sstep(1.0, 1.9, pC);
  float sig = sigS * sigP; // collapsing tube
  float fillT = sstep(1.05, 1.5, pC); // ... whose air pocket closes into a solid roller
  float pc = mix(A.pc, B.pc, wB);
  float lip1 = mix(A.l1, B.l1, wB), lip2 = mix(A.l2, B.l2, wB), capP = mix(A.cap, B.cap, wB), chopP = mix(A.chop, B.chop, wB);
  float dbz = outer ? dbA : db0;
  float sh = max(steep, bore);
  { // the breaking wave carried forward by D, near its crest (surgeOf / evalSurf in JS)
    float Ls = TAU / kOf(dc), wcD = min(Ls * mix(0.13, 0.035, sh), 0.32 * Hc);
    float X = 0.5 * wcD + 0.12 * Hc * pc, Y = 0.62 * Hc, th = max(thetaMax, atan(Y, -X));
    float keep = clamp((dc + 15.0) / 60.0, 0.0, 1.0);
    float D = min(keep * (sigS * sigP * (-X * (1.0 - cos(th)) - Y * sin(th)) + X + length(vec2(X, Y))), 0.2 * Ls);
    s += D * (1.0 - sstep(0.1, 0.45, abs(psi)));
    psi = s / L; dc = d - s;
  }

  float ah = min(QQ * (0.6 + 0.4 * sh) * L / TAU, 1.5 * H);
  float s2 = gFlat ? s : s - ah * sin(TAU * psi);
  gCrest = vec2(s2, 1.0 - sstep(0.3, 0.42, abs(psi))); // 0 where the crest index changes (no seam)
  float wf = L * mix(0.13, 0.035, sh);
  float wb = L * mix(0.2, 0.32, bore);
  float bump = s2 < 0.0 ? nGauss(s2, wf, L, qf) : nGauss(s2, wb, L, qb);
  float tgt = 0.45 * HBASE * sstep(20.0, 120.0, d), tw = sstep(0.25, 0.5, abs(psi));
  float Ht = mix(H, tgt, tw);
  float y = H * bump - 0.2 * Ht;
  float dA = dc + s2;
  dA -= leanP * min(0.3 * H, 0.45 * wf) * bump * bump; // a forming crest leans forward (evalSurf)

  // curl shaped at Hc, squashed to H; a roller of size sig = full-size curl displacement at u = s2 / sig, times sig.
  // Below sig 0.8 its front and back widen in u (kw): a roller spanning fewer mesh rows spikes where the crest crosses them obliquely
  float Htc = mix(Hc, tgt, tw);
  float pivY = 0.18 * Hc, topY = 0.8 * Hc, wc = min(wf, 0.32 * Hc);
  float u = s2 / max(sig, 1e-3);
  float kw = max(1.0, 0.8 / max(sig, 0.05)), wfk = wf * kw;
  float yv = Hc * (u < 0.0 ? nGauss(u, wfk, L, qf) : nGauss(u, wb, L, qb)) - 0.2 * Htc;
  float hw = clamp((yv - pivY) / (topY - pivY), 0.0, 1.0);
  float bw = 1.0 - sstep(0.0, (0.45 * Hc + wc) * kw, u);
  float th = gFlat ? 0.0 : thetaMax * pow(hw, 1.1) * bw;
  float imp = mix(impOf(A.p), impOf(B.p), wB);
  float wm = 0.0; // the collapsed roller's step (see below), kept out of the swash pull
  if (th > 0.0) {
    float dp = dc - (0.5 * wc + 0.12 * Hc * pc);
    float X = -(dc + u - dp), Y = yv - pivY;
    float c = cos(th), sn = sin(th);
    float rx = -(X * c + Y * sn), ry = -X * sn + Y * c; // the rotated point, relative to the pivot
    // the tube closes: the inner wall (u from uT, where the face reaches the pivot height, to the lip tip at u = 0)
    // is pulled onto the straight chord between those two points
    if (u < 0.0 && fillT > 0.0) {
      float e = exp(-pow(0.5 * L / wfk, 2.0)), g = (pivY + 0.2 * Htc) / Hc;
      float uT = -wfk * sqrt(-log(clamp(g + (1.0 - g) * e, 1e-4, 0.9999)));
      float yv0 = Hc - 0.2 * Htc, th0 = thetaMax * pow(clamp((yv0 - pivY) / (topY - pivY), 0.0, 1.0), 1.1);
      float X0 = dp - dc, Y0 = yv0 - pivY, c0 = cos(th0), s0 = sin(th0);
      vec2 tip = vec2(-(X0 * c0 + Y0 * s0), -X0 * s0 + Y0 * c0);
      vec2 ch = mix(tip, vec2(dc + uT - dp, 0.0), clamp(u / uT, 0.0, 1.0));
      rx = mix(rx, ch.x, fillT); ry = mix(ry, ch.y, fillT);
    }
    // once the lip has landed the roller breaks up into a ragged, tumbling mass: lumps pushed out from its axis
    float rag = imp * sqrt(hw) * bw;
    if (rag > 0.0) {
      float a = 0.16 * Hc * rag * rollerLumps(x, u, fn) / max(length(vec2(rx, ry)), 0.35 * Hc); // never through the axis
      rx += a * rx; ry += a * ry;
    }
    // the collapsed roller rides the bore as a solid step (p 1.5 -> 1.9): its front (u 0..uN, up to the nose) a steep
    // ramp down to a toe just under the face at most 0.6 m ahead, the inner wall (u uT..0) the chord from the toe back
    // to the face. Otherwise the ragged chord pokes through the face and the edge-on underside shows as a thin seam
    float wallT = fillT * sstep(1.5, 1.9, pC) * sstep(0.0, 0.02, sig);
    if (wallT > 0.0) {
      float uB = (0.45 * Hc + wc) * kw;
      float uN = 0.3 * uB * wb / pow(pow(uB, 4.0) + pow(wb, 4.0), 0.25); // stays on the roller's front at any size
      float eT = exp(-pow(0.5 * L / wfk, 2.0)), gT = (pivY + 0.2 * Htc) / Hc;
      float uT = -wfk * sqrt(-log(clamp(gT + (1.0 - gT) * eT, 1e-4, 0.9999)));
      wm = wallT * sstep(uT, 0.5 * uT, u) * (1.0 - sstep(uN, 2.0 * uN, u));
      if (u >= uT && u < uN) {
        float yN = Hc * nGauss(uN, wb, L) - 0.2 * Htc, hwN = clamp((yN - pivY) / (topY - pivY), 0.0, 1.0);
        float bwN = 1.0 - sstep(0.0, uB, uN), thN = thetaMax * pow(hwN, 1.1) * bwN;
        float XN = -(dc + uN - dp), YN = yN - pivY, cN = cos(thN), sN = sin(thN);
        vec2 nose = vec2(-(XN * cN + YN * sN), -XN * sN + YN * cN); // with its own lumps
        nose *= 1.0 + 0.16 * Hc * imp * sqrt(hwN) * bwN * rollerLumps(x, uN, fn) / max(length(nose), 0.35 * Hc);
        float toeX = nose.x - min(0.6 / sig, 0.5 * uN); // a gentle front on a small late step, not a backlit wall
        float zT = sig * (toeX + dp - dc), yv0 = Hc - 0.2 * Htc;
        float eps = (0.25 * H + 0.8) * Hc / max(H, 1e-3) * sstep(0.1, 0.3, sig);
        vec2 toe = vec2(toeX, (Hc * (zT < 0.0 ? nGauss(zT, wf, L) : nGauss(zT, wb, L)) - 0.2 * Htc - eps - yv0) / sig + yv0 - pivY);
        vec2 q = u >= 0.0 ? mix(toe, nose, u / uN) : mix(toe, vec2(dc + uT - dp, 0.0), clamp(u / uT, 0.0, 1.0));
        rx = mix(rx, q.x, wallT); ry = mix(ry, q.y, wallT);
      }
    }
    float yc = Hc * bump - 0.2 * Htc + sig * (pivY + ry - yv);
    dA += sig * (dp + rx - (dc + u));
    y = -0.2 * Ht + (yc + 0.2 * Htc) * (H / Hc);
  }

  // turbulent, lumpy whitewater on the bore front and just behind it (slow lumps riding the bore, see boreLumps in JS)
  float turb = bore * (1.0 - sstep(0.15 * L, 0.45 * L, s2)) * sstep(-wf - 4.0, -0.3 * wf, s2);
  float tT = uTime + gTs;
  y += turb * H * (0.035 * sin(x * 0.11 + s2 * 0.07 + tT * 0.6) + 0.03 * sin(-x * 0.19 + s2 * 0.23 + tT * 0.8)
    + 0.02 * sin(x * 0.37 - s2 * 0.29 + tT * 1.1));
  // the foam of the surf zone belongs to the crest that last passed: this one behind it, the one before it (fn - 1)
  // ahead of it, so that it runs on across the edges between the crests' cells; it lies from where that one broke in
  float fz = s2 < 0.0 ? fn - 1.0 : fn, dbzF = s2 < 0.0 ? breakZone(fz, x) : dbz;
  float zoneIn = sstep(dbzF + 10.0, dbzF - 50.0, d);
  // small wind chop, kept off the lip and the swash and damped over the surf zone's broken water: the bore's
  // whitewater (where it ran through the white mass as a fast travelling tremble against the sea beyond) and the
  // foam-streaked wash behind and ahead of it (whose lace it bobbed up and down: a shimmer along the lace's edges)
  float chopK = (1.0 - hw * bw * chopP) * sstep(-10.0, 60.0, d) * (1.0 - 0.85 * max(turb, zoneIn));
  y += chopK * (0.45 * sin(x * 0.071 + z * 0.052 - tT * 1.9) + 0.3 * sin(-x * 0.047 + z * 0.093 - tT * 2.6));

  float sand = 0.5 + landH(z);
  if (d < 0.0) y = min(y, sand - 1.6);
  float wet = 0.0;
  float filmP = d > 0.0 ? 1.0 : 0.0; // is there water here (not just damp sand)?
  sandW = vec4(100.0, 100.0, 0.0, 0.0); // no damp sand
  if (d < 40.0) {
    float phi0 = phaseAt(x, 0.0);
    float f0 = floor(phi0 / TAU);
    float tau = phi0 / TAU - f0;
    float tt = tau / 0.75;
    // each wave runs up further in some places than in others (lobes along the beach, new ones every wave)
    float lob = SWLOBE * swashLobe(f0, x);
    float R0 = RUNUP * waveHn(f0, x), R = R0 * (1.0 + lob);
    float r0 = tt < 1.0 ? R0 * (tt < 0.3 ? sin(tt / 0.3 * 1.5708) : cos((tt - 0.3) / 0.7 * 1.5708)) : 0.0;
    float r = r0 * (1.0 + lob);
    // dF: distance seaward of the front, measured across it (along d, its steep lobe sides thinned every band along
    // it to a sliver and frayed it into teeth on the grid)
    float gF = r0 * SWLOBE * swashLobeDx(f0, x);
    float dF = (d + r) * inversesqrt(1.0 + gF * gF);
    wet = sstep(-3.0, 12.0, dF);
    filmP = max(filmP, wet);
    float bed = d > 0.0 ? sand - SLOPE * d : sand;
    // sand the swash has wetted (up to the highest run-up of this or the last wave) keeps a thin layer just above it;
    // dW: distance seaward of that line, across it
    float Rp = RUNUP * waveHn(f0 - 1.0, x) * 0.8, Rc = tt < 0.3 ? r : R;
    float Rq = Rp * (1.0 + SWLOBE * swashLobe(f0 - 1.0, x)), Rw = max(Rc, Rq);
    float gW = Rc >= Rq ? (tt < 0.3 ? r0 : R0) * SWLOBE * swashLobeDx(f0, x) : Rp * SWLOBE * swashLobeDx(f0 - 1.0, x);
    float dW = (d + Rw) * inversesqrt(1.0 + gW * gW);
    float dampSand = sstep(-12.0, -4.0, dW);
    float ys = bed + FILM * wet + (0.2 * dampSand - 1.5 * (1.0 - dampSand)) * (1.0 - wet);
    float k = sstep(40.0, 20.0, d);
    float hm = clamp(0.5 + 0.5 * (ys - y) / 2.5, 0.0, 1.0);
    float ym = y + (ys - y) * hm + 2.5 * hm * (1.0 - hm);
    y += (ym - y) * k; dA += (d - dA) * k * hm * (1.0 - wm); // pulling the step back to rest would lean it
    // wet-sand look (dark where damp, a glassy film just behind the retreating water), shaded per pixel from these
    // distances: the shading itself, interpolated over the grid's 4.7 columns, left steps along the lobes' steep sides
    sandW = vec4(dW, dF, sstep(10.0, 0.0, d), tt > 0.3 ? 1.0 / (0.25 * R + 4.0) : 0.0);
    // foam on the swash, densest at the uprush tip
    float tip = sstep(-3.0, 4.0, dF) * (1.0 - sstep(4.0, 20.0, dF));
    wet = clamp(max(wet * 0.3 * sstep(10.0, -5.0, d), 0.85 * tip), 0.0, 1.0) * sstep(1.0, 0.9, tt);
    // swash foam rides up and back with the water, and opens into a lace once the backwash starts
    // ramp >= 4r long: the foam never folds over and stretches at most ~1.6x (the unlobed run-up: the lobes' slope
    // along x would shear the foam texture)
    gDrift = r0 * sstep(30.0, 30.0 - max(4.0 * r0, 40.0), d);
    swAge = sstep(0.25, 0.85, tt);
  }

  // foam
  float fLip = pow(hw, 6.0) * bw * lip1 * (1.0 - 0.3 * bore) + 0.6 * bw * hw * lip2;
  float fFace = 0.18 * sh * bump * (s2 < 0.0 ? 1.0 : 0.3);
  // the bore: a solid white tumbling front down to the toe of its face, thick foam for a while behind it, then lace
  // (its front edge ragged along the crest, rag)
  float rag = 1.2 * wf * boreRag(fn, x);
  float fBore = bore * (0.18 + 0.32 * (1.0 - sstep(0.0, 0.9 * L, s2))
    + 0.85 * sstep(-2.4 * wf, -1.0 * wf, s2 + rag) * (1.0 - sstep(0.05 * L, 0.35 * L, s2)));
  // impact: once the lip lands, the roller, the face it plunged into and the splash-up over the back turn white
  // (above 1 the foam is thicker and fully opaque; the roller zone shrinks with the roller, sig, while the face
  // stays white down to its toe).
  // The whitewater spreads from the landing tip up over the whole curtain by p ~ 1.2, so no clear water is left
  // on the collapsing roller.
  float spread =mix(sstep(0.88, 1.22, A.p), sstep(0.88, 1.22, B.p), wB);
  float roll = sstep(0.75 * (1.0 - spread), 0.75 * (1.0 - spread) + 0.25, sqrt(hw) * bw);
  float fImp = imp * max(1.5 * max(roll, s2 < 0.0 ? sstep(-2.4 * wf, -1.0 * wf, s2 + rag * bore) : 0.0),
    s2 > 0.0 ? 0.9 * (1.0 - sstep(0.0, 0.4 * L, s2)) : 0.0);
  // a closeout near the sand: its roller shrinks away with the depth (sig, crest d 45 -> 15) before or just after
  // its lip lands, which in clear water reads as the curl rolling back. So the shrinking roller turns to
  // whitewater, which spills down the face as the roller goes (down to the toe once it is gone): the curl
  // collapses into foam
  float loss = 1.0 - sstep(15.0, 45.0, dc);
  float fCol = sstep(0.08, 0.35, loss) * sstep(0.05, 0.4, pC) * (1.0 - sstep(3.0, 5.0, pC))
    * max(1.5 * sstep(0.3, 0.65, sqrt(hw) * bw), s2 < 0.0 ? 1.3 * sstep(-(0.5 + 1.6 * loss) * wf - 3.0, -(0.5 + 1.6 * loss) * wf, s2) : 0.0);
  float fZone = 0.22 * sstep(dbzF + 30.0, dbzF - 60.0, d) * (0.5 + 0.5 * sin(x * 0.013 + z * 0.021 + fz)); // (fz, dbzF: see the chop)
  float fCap = 0.25 * sstep(0.85, 1.0, bump) * capP;
  // the forming crest feathers: a ragged white line along its peak (not over its back) just before the lip throws
  float fFeather = 0.7 * sstep(0.9, 1.0, bump) * (s2 < 0.0 ? 1.0 : 1.0 - sstep(0.0, 0.3 * wf + 1.0, s2))
    * crestP * sstep(-1.6, -0.4, pC) * (1.0 - bore);
  // residual foam left behind by broken waves: thins out as it ages (behind this crest, or the previous one)
  float ageB = s2 > 0.0 ? s2 / L : 1.0 + s2 / L;  // ~time since a crest passed, in wave periods
  float broke = s2 > 0.0 ? max(bore, lip2) : 1.0;
  float fRes = zoneIn * broke * (0.14 + 0.6 * exp(-3.0 * ageB));
  foam = clamp(max(max(max(fLip, fFace), max(fBore, fZone)), max(max(max(fCap, fFeather), fRes), max(fImp, fCol))) * filmP, 0.0, 1.6);
  foam = max(foam, wet);
  float young = max(max(max(fLip, fBore * (1.0 - sstep(0.0, 0.3 * L, s2))), max(fFace, fFeather)), max(fImp, fCol));
  age = clamp(mix(ageB, 0.0, min(young, 1.0)), 0.0, 1.0);
  // the swash's foam ages with the swash, but a breaker's fresh whitewater arriving over it stays fresh (aged, it
  // opens into lace, which a steep face stretches into vertical streaks)
  age = mix(age, swAge, min(wet * 1.5, 1.0) * (1.0 - min(young, 1.0)));
  thin = hw * bw * sh;
  wetOut = wet;
  gCrest.x = dA - dc; // displaced position relative to the crest: the whitewater pattern travels and tumbles with it
  // a steep or breaking face and its curl take their foam, glints and ripples from the breaker's own frame: x and
  // the position across the crest (s2), which the fragment shader runs down the face and the hanging curtain. The
  // rest grid and the world xz would climb the steep face, and the rest grid also climbs the curtain once the lip
  // pitches over (from the face it runs round the tip and up the lip's outer side). Steep means breaking (sh) or a
  // face over ~25 deg (0.86 H / wf, the face's largest slope): the unbroken shoulder beside a tube is that steep too
  float uBs = max((0.45 * Hc + wc) * kw * sig, 0.3 * Hc);
  float stK = max(sstep(0.6, 0.85, sh), sstep(0.45, 0.7, 0.86 * H / wf));
  gBrk = vec3(x + 37.0 * fn, s2 + 51.0 * fn, stK * sstep(-3.0 * wf, -1.8 * wf, s2)
    * (1.0 - sstep(0.5 * uBs, uBs, s2)) * gCrest.y * sstep(15.0, 40.0, d));
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
varying vec4 vSand; // the damp sand's distances: seaward of the run-up's line and of the front, near the shore, glaze
varying float vAge;
varying float vLand;
varying vec2 vRest;
varying vec2 vCrest;
varying vec3 vBrk;
varying float vSpd; // how fast the surface here rises or falls as the crests pass (units/s)
varying vec4 vVel;  // how far the water here moves in a frame (xyz) and how far its foam drifts in that frame (w)
varying float vDFoam; // and how much its foam (vFoam) grows in that frame
varying vec2 vDBrk;   // and how far the breaker's frame (vBrk.xy, which rides the crest) moves over it in that frame
uniform float uRowF; // how far the rows have slid toward the next one shoreward (see buildGeometry)
void main() {
  float f, th, wt, ag, f1, t1, w1, a1;
  vec4 sw, s1;
  vec2 xz = position.xz + vec2(0.0, uRowF * position.y);
  vec3 P = surfPos(xz, f, th, wt, sw, ag);
  float drift = gDrift;
  vCrest = gCrest;
  vBrk = gBrk;
#ifdef FACETS
  vNrm = vec3(0.0, 1.0, 0.0); // unused: the fragment shader takes each facet's own normal
  vSpd = 0.0; // unused: the soft tier's ripples are a plain tiled map
  vVel = vec4(0.0);
  vDFoam = 0.0;
  vDBrk = vec2(0.0);
#else
  // normal from offsets near the grid spacing (x 4.7, z 1.75): no shading detail the mesh cannot follow
  vec3 P1 = surfPos(xz + vec2(1.8, 0.0), f1, t1, w1, s1, a1);
  vec3 P2 = surfPos(xz + vec2(0.0, 1.0), f1, t1, w1, s1, a1);
  vec3 n = cross(P2 - P, P1 - P);
  vNrm = length(n) > 1e-6 ? normalize(n) : vec3(0.0, 1.0, 0.0);
  // the crests travel shoreward at c = OMEGA / k, so a point fixed over the bed rises or falls at c times the
  // shoreward slope: what the fragment shader turns into the face's sweep across the screen
  float cw = OMEGA / kOf(xz.y - shoreZ(xz.x));
  vSpd = cw * (P2.y - P.y);
  // where there is foam, the same water a frame later: how far it moves, and how far its foam drifts, in a frame
  vVel = vec4(0.0);
  vDFoam = 0.0;
  vDBrk = vec2(0.0);
  if (f > 0.0) {
    gTs = 1.0 / 60.0;
    vVel.xyz = surfPos(xz, f1, t1, w1, s1, a1) - P;
    vVel.w = gDrift - drift;
    vDFoam = f1 - f;
    vDBrk = gBrk.xy - vBrk.xy;
    vDBrk *= min(1.0, 2.0 / max(length(vDBrk), 1e-6)); // not across a jump between the crests' cells
    gTs = 0.0;
  }
#endif
  vSand = sw;
  vAge = ag;
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
// the look (LOOKS below): water and sky colours, and the strength of the stylised terms (all off in 'classic')
uniform vec3 uHorizon, uZenith, uDeep, uShallow, uShore, uSSS, uSigma, uHazeCol, uDropCol, uSpecCol, uBed, uDamp;
uniform float uFresK, uFresMax, uHazeK, uGlare, uRipple, uEmboss, uDrop, uWetDark, uVivid, uSandDisp, uRipScale;
uniform vec4 uUnder; // the eye under the water: rgb its soft blue (display colour), w its fog density (0 above the water)
varying vec3 vWorld;
varying vec3 vNrm;
varying float vFoam;
varying float vThin;
varying float vDepth;
varying vec4 vSand;
varying float vAge;
varying float vLand;
varying vec2 vRest;
varying vec2 vCrest;
varying vec3 vBrk;
varying float vSpd;
varying vec4 vVel;
varying float vDFoam;
varying vec2 vDBrk;

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
// foam left between the holes of one scale (h: 1 at a hole's centre, 0 on its rim, -0.5 at 1.5 radii): 0 inside a
// hole, a soft translucent rim, thickest far from holes
float laceScale(float h) { return smoothstep(0.12, -0.45, h); }
// one scale of lace: holes of random size scattered over a jittered grid; grow scales every hole, so foam opens
// up from pin holes into a lace. With lw = 1 each hole's radius varies around it by a random 2- and 3-lobed term
// (cos 2θ, sin 2θ)·q and (cos 3θ, sin 3θ)·q.yx, so the holes are torn shapes, not circles; lw = 0 keeps them round.
// Averaged over a frame in which the pattern slides m (cells) under the pixel, as a motion blur: each hole sweeps a
// capsule, and a point on its track is inside the hole for the chord through it (half length hw at the soft rim's
// middle, 1.165 radii), a share 2 hw / |m| of the frame; the swept holes thin the foam together. Unblurred (m = 0)
// the overlapping holes merge.
float lace(vec2 p, float t, float grow, vec2 m, float lw) {
  vec2 i = floor(p), f = fract(p);
  float mm = max(dot(m, m), 1e-8), lm = sqrt(mm), h = -4.0, a = 1.0;
  for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
    vec2 g = vec2(float(x), float(y));
    vec2 o = hash2(i + g);
    vec2 c = g + 0.5 + 0.36 * sin(t * (0.6 + 0.5 * o.yx) + 6.2831 * o) - f;
    float r = (0.18 + 0.5 * o.x * o.y) * grow, cm = dot(c, m);
    // dd: from the nearest point of the hole's track; the lobe terms written without normalising dd (re >= 0.29 r)
    vec2 dd = c - m * clamp(cm / mm, -0.5, 0.5), q = o * 2.0 - 1.0;
    float ld = length(dd), il = lw / max(ld * ld, 1e-8);
    float re = r * (1.0 + il * (0.3 * dot(vec2(dd.x * dd.x - dd.y * dd.y, 2.0 * dd.x * dd.y), q)
      + 0.2 / max(ld, 1e-4) * dot(vec2(dd.x * (4.0 * dd.x * dd.x - 3.0 * ld * ld), dd.y * (3.0 * ld * ld - 4.0 * dd.y * dd.y)), q.yx)));
    float hc = 1.0 - ld / re;
    float hw = sqrt(max(1.357 * re * re - dot(c, c) + cm * cm / mm, 0.0));
    h = max(h, hc);
    a *= 1.0 - (1.0 - laceScale(hc)) * min(1.0, 2.0 * hw / lm);
  }
  return mix(laceScale(h), a, smoothstep(0.0, 0.2, lm));
}

// Foam thickness (0 = none; about 1 = opaque) at foam coordinates p.
// Foam is a sheet of bubbles with holes at three scales, domain-warped so they are not perfect circles. The warp
// fades where the foam slides fast, and the motion blur would then stretch round holes into rows of capsules, so
// the two coarse scales also get random lobed outlines.
// The holes are sized so the foam covers about fa of the surface (one hole per cell of mean area
// pi E[r^2] = 0.33 g^2, so a scale leaves exp(-0.33 g^2) uncovered); young foam has mostly small holes,
// old foam opens into a coarse lace around large ones. Thickness grows away from the holes.
// ft = lumpiness (0..1) from a few octaves of noise. sl = how far p slides under the pixel in a frame, dfa = how
// much fa grows in a frame.
float foamThick(vec2 p, float fa, float age, float dist, vec2 sl, float dfa, out float ft) {
  float sv = length(sl);
  // (each octave fades to its mean where it slides fast, as the holes do below: the finest warps all of them)
  vec3 kn = 1.0 - smoothstep(0.05, 0.2, sv * vec3(0.16, 0.41, 1.07));
  float n1 = mix(0.5, vnoise(p * 0.16), kn.x), n2 = mix(0.5, vnoise(ROT * p * 0.41 + 7.3), kn.y);
  float n3 = mix(0.5, vnoise(ROT * ROT * p * 1.07 + 3.1), kn.z);
  float t1 = 0.6 * n1 + 0.4 * n2 + 0.1, t2 = 0.6 * n2 + 0.4 * n3 + 0.1; // ~0.6 on average, like the old texture
  ft = clamp((t1 * 0.65 + t2 * 0.35 - 0.45) / 0.3, 0.0, 1.0);
  float C = clamp(fa * (0.75 + 0.5 * ft), 0.04, 0.97 + 0.025 * smoothstep(1.0, 1.5, fa)); // target coverage, lumpier with the texture; thick foam closes up
  float G = -log(C) / 0.33 + 0.12;                              // total g^2 over the three scales
  vec3 w = mix(vec3(0.15, 0.30, 0.55), vec3(0.55, 0.30, 0.15), age);
  vec3 g = min(sqrt(G * w), vec3(1.5));                         // the 3x3 search reaches about 1.5
  vec2 q = p + 3.2 * vec2(t1 - 0.6, t2 - 0.6);
  // the holes slide as q does, which the warp stretches and turns: q a frame on (at p + sl) less q now
  vec2 p1 = p + sl;
  float d1 = mix(0.5, vnoise(p1 * 0.16), kn.x) - n1, d2 = mix(0.5, vnoise(ROT * p1 * 0.41 + 7.3), kn.y) - n2;
  float d3 = mix(0.5, vnoise(ROT * ROT * p1 * 1.07 + 3.1), kn.z) - n3;
  vec2 sq = sv > 0.0 ? sl + 3.2 * vec2(0.6 * d1 + 0.4 * d2, 0.6 * d2 + 0.4 * d3) : vec2(0.0);
  float sqv = length(sq);
  float k1 = 1.0 - smoothstep(700.0, 1600.0, dist);
  float k2 = 1.0 - smoothstep(250.0, 800.0, dist), k3 = 1.0 - smoothstep(70.0, 260.0, dist);
  // where the cells slide under the pixel (a bore running in over the wash), each scale is blurred along its slide
  // (lace); one sliding more than about a third of a cell in a frame, nearing the search's reach, fades towards its
  // mean. So does one whose holes shrink or open fast as the foam thickens or thins (the bore's own front), the rims
  // moving by about 0.3 dg for a mean radius 0.3 g, more than about a twentieth of a cell in a frame. Each keeps 0.4 of
  // its contrast, so fast foam stays a lace rather than a flat haze
  float dC = C > 0.04 && C < 0.97 ? dfa * (0.75 + 0.5 * ft) : 0.0;
  vec3 dg = step(g, vec3(1.49)) * g * dC / (-0.66 * C * G);
  vec3 km = 0.4 + 0.6 * (1.0 - smoothstep(0.15, 0.45, sqv * vec3(0.12, 0.35, 1.05))) * (1.0 - smoothstep(0.05, 0.2, 0.3 * abs(dg)));
  k1 *= km.x; k2 *= km.y; k3 *= km.z;
  vec3 mean = exp(-0.33 * g * g) * 0.85;                         // a faded scale is replaced by its mean cover
  float f1 = k1 > 0.0 ? mix(mean.x, lace(q * 0.12, uTime * 0.25, g.x, sq * 0.12, 1.0), k1) : mean.x;
  float f2 = k2 > 0.0 ? mix(mean.y, lace(q * 0.35 + 5.1, uTime * 0.45, g.y, sq * 0.35, 1.0), k2) : mean.y;
  float f3 = k3 > 0.0 ? mix(mean.z, lace(q * 1.05 + 2.7, uTime * 0.8, g.z, sq * 1.05, 0.0), k3) : mean.z;
  float lace = f1 * f2 * f3;
  return lace * (0.2 + 0.7 * clamp(fa, 0.0, 1.6)) * (0.6 + 0.6 * ft) * smoothstep(0.0, 0.3, fa); // sparse foam is a thin film
}
// billowing lumps (sum of |noise| octaves, with a soft fold so the creases are not black hairlines),
// boiling as the octaves drift apart; k3 fades the finest octave to its mean
float sabs(float v) { return sqrt(v * v + 0.02); }
float billow(vec2 q, float t, float k3) {
  float b1 = sabs(2.0 * vnoise(q + vec2(0.0, 0.17 * t)) - 1.0);
  float b2 = sabs(2.0 * vnoise(ROT * q * 2.1 + vec2(3.7 + 0.31 * t, 1.3)) - 1.0);
  float b3 = sabs(2.0 * vnoise(ROT * ROT * q * 4.4 + vec2(5.1, 2.6 - 0.5 * t)) - 1.0);
  return 0.5 * b1 + 0.32 * b2 + 0.18 * mix(0.33, b3, k3);
}

#define BED uBed // the dry sand as rendered (linear, before the x1.55): per look, matched to the beach's tint (LOOKS bed)
const mat2 RIPA = mat2(0.94, 0.34, -0.34, 0.94), RIPB = mat2(0.94, -0.34, 0.34, 0.94); // +-20 degrees
const mat2 R37 = mat2(0.8, 0.6, -0.6, 0.8); // turns the second detail layer ~37 degrees off the first
// One detail normal from the tiled normal map without visible repetition (iq's "texture repetition",
// technique 3): a smooth noise over the texture picks one of 9 random offsets per irregular patch, and two
// offsets blend across each patch border (the border sharpened by the samples' difference). c is in texture
// tiles, cx and cy its screen derivatives (explicit, so a patch border does not jump the mip level).
vec3 normNT(vec2 c, vec2 cx, vec2 cy, float seed) {
#ifdef SOFT
  return texture2D(uNormTex, c).rgb * 2.0 - 1.0;
#else
  float l = 8.0 * vnoise(ROT * c * 0.9 + seed);
  float ia = floor(l), f = fract(l);
  vec2 oa = sin(vec2(3.0, 7.0) * (ia + seed)), ob = sin(vec2(3.0, 7.0) * (ia + 1.0 + seed));
  vec3 a = textureGrad(uNormTex, c + oa, cx, cy).rgb, b = textureGrad(uNormTex, c + ob, cx, cy).rgb;
  return mix(a, b, smoothstep(0.25, 0.75, f - 0.1 * (a.x + a.y + a.z - b.x - b.y - b.z))) * 2.0 - 1.0;
#endif
}
// the detail normals' slope: two layers of the normal map, the second turned off the first, at c (metres; cx and cy
// its screen derivatives), each sampled without tiling (normNT: a tiled map repeats as a regular weave over open water)
vec2 detailSlope(vec2 c, vec2 cx, vec2 cy) {
  vec3 n1 = normNT(c * 0.011 + vec2(0.012, 0.017) * uTime, cx * 0.011, cy * 0.011, 0.0);
  vec3 n2 = normNT(R37 * c * 0.029 - vec2(0.021, -0.009) * uTime, R37 * cx * 0.029, R37 * cy * 0.029, 3.7);
  return n1.xy + n2.xy * R37; // the second layer's slope turned back
}
// fine wind ripples stretched along the crests, two sets crossing at a shallow angle: the dense, embossed wavelets of
// AoM's water. Each set's slope is turned back from its rotated, stretched frame. w = c with its lines bent by a
// gentle warp (ripWarp), so that the sets do not lie over the whole sea as one even, parallel weave (not on the
// software tier, which has the tiled map anyway)
vec2 ripWarp(vec2 c) {
#ifdef SOFT
  return c;
#else
  return c + 9.0 * vec2(vnoise(c * 0.021 + 3.3), vnoise(ROT * c * 0.021 + 8.1));
#endif
}
vec2 rippleSlope(vec2 w, vec2 cx, vec2 cy) {
  // turned, then stretched (uRipScale < 1 widens them: AoM's are broad chevrons)
  mat2 MA = mat2(0.035, 0.0, 0.0, 0.13) * RIPA * uRipScale, MB = mat2(0.03, 0.0, 0.0, 0.11) * RIPB * uRipScale;
  vec3 q1 = normNT(MA * w + vec2(0.0, 0.05) * uTime, MA * cx, MA * cy, 7.1);
  // the second weave drifts slowly too: at 0.31 uv/s (about 19 units/s) its ripples outran the frame rate on the
  // faces and flickered back and forth
  vec3 q2 = normNT(MB * w + vec2(0.08, 0.04) * uTime, MB * cx, MB * cy, 1.9);
  return vec2(q1.x * 0.27, q1.y) * RIPA + vec2(q2.x * 0.27, q2.y) * RIPB;
}
// a bubble glint in each cell of sp that twinkles: at least about a pixel wide, dimmed as it widens, and gone where
// the cells would shimmer (fw = the cells' screen footprint, from outside any branch)
float sparkle(vec2 sp, float fw) {
  if (fw >= 0.6) return 0.0;
  vec2 hs = hash2(floor(sp));
  float rad = max(0.14, 0.7 * fw);
  float tw = pow(max(sin(uTime * (1.5 + 2.5 * hs.x) + 6.2831 * hs.y), 0.0), 6.0);
  float sd = length(fract(sp) - 0.5 - 0.6 * (hs.yx - 0.5));
  return 9.0 * smoothstep(rad, 0.0, sd) * (0.0196 / (rad * rad)) * tw * (1.0 - smoothstep(0.3, 0.6, fw));
}

void main() {
#ifdef FACETS
  vec3 N = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
  if (dot(N, cameraPosition - vWorld) < 0.0) N = -N; // toward the eye, as the flipped vertex normal below
#else
  vec3 N = normalize(vNrm);
  if (!gl_FrontFacing) N = -N;
#endif
  vec3 Ng = N; // geometric normal, before the detail normal map
  vec3 toCam = cameraPosition - vWorld;
  float dist = length(toCam);
  vec3 V = toCam / dist;

  // The foam texture, its glints and the detail normals are mapped on the world xz (the open sea) or the rest grid
  // (foam), both of which climb a steep face. Where the face is steep or breaking (weight wK) they come instead from
  // the breaker's own frame (vBrk, see surfPos), whose second coordinate runs down the face and the hanging curtain
  // at VFALL m/s, the way the water falls there. Tq and Bq are the surface gradients of its two coordinates (from
  // the screen derivatives, Schueler's cotangent frame; capped where the frame is squeezed): they turn the slopes
  // of the normal maps from that frame into the world.
  float wK = vBrk.z < 0.01 ? 0.0 : (vBrk.z > 0.99 ? 1.0 : vBrk.z);
  vec2 qb = vec2(vBrk.x, vBrk.y + 3.5 * uTime), qx = dFdx(qb), qy = dFdy(qb); // VFALL = 3.5
  vec3 dpx = dFdx(vWorld), dpy = dFdy(vWorld);
  vec3 cq1 = cross(dpy, N), cq2 = cross(N, dpx);
  float dq = dot(dpx, cq1), idq = dq / max(dq * dq, 1e-30);
  vec3 Tq = (cq1 * qx.x + cq2 * qy.x) * idq, Bq = (cq1 * qx.y + cq2 * qy.y) * idq;
  Tq *= min(1.0, 1.5 * inversesqrt(dot(Tq, Tq) + 1e-12));
  Bq *= min(1.0, 1.5 * inversesqrt(dot(Bq, Bq) + 1e-12));

  // freshly broken water is full of bubbles (see the body colour below); the ripples and the detail normals are
  // mostly smoothed out of it, so its white does not flicker with them
  float aer = smoothstep(0.7, 1.3, vFoam) * (1.0 - vAge);
  // and any foam film stills the ripples under it (a film of bubbles, like a slick, damps the capillary waves): the
  // lace on the wash lies on smooth water, which otherwise shimmered through it and in its holes
  float calm = max(aer, 0.9 * smoothstep(0.1, 0.5, vFoam));
  // detail normals
  vec2 uv = vWorld.xz, ux = dFdx(uv), uy = dFdy(uv);
  // The mesh is fixed over the bed, so a rising face slides the world xz under each pixel: mvPx is how far, in
  // pixels per frame (at 60 fps, a design constant), from the vertical speed through the face's slope (the ray
  // meets the face displaced by vSpd / dt along it). Where it passes a few tenths of a pixel the ripples, mapped on
  // that xz, jump between frames: the trembling on the faces.
  float mvPx;
  {
    vec3 Nu = Ng / max(abs(Ng.y), 0.05);
    float mvL = length(V.xz) * abs(vSpd) / 60.0 / max(abs(dot(Nu, V)), 0.05);
    vec2 e = normalize(-V.xz + 1e-6);
    mvPx = mvL / max(max(abs(dot(ux, e)), abs(dot(uy, e))), 1e-4);
  }
  // The foam is mapped on the rest grid (vRest) and the breaker's frame (qb), which the passing crests also carry
  // across the screen. In a frame the water at the pixel moves by vVel.xyz, and its surface by that . Ng along the
  // normal, so the ray meets the surface V (vVel . Ng) / (V . Ng) further along; the water seen there next frame
  // was D = that - vVel away, in the surface plane. D in pixels (along dpx, dpy) gives slR and slB: how far each
  // foam pattern slides under the pixel in a frame (with its own scroll and drift), in its own units
  vec2 slR, slB;
  {
    float vn = dot(V, Ng);
    vec3 D = V * dot(vVel.xyz, Ng) / (vn < 0.0 ? min(vn, -0.05) : max(vn, 0.05)) - vVel.xyz;
    vec2 ab = clamp(vec2(dot(D, cq1), dot(D, cq2)) * idq, -40.0, 40.0);
    slR = ab.x * dFdx(vRest) + ab.y * dFdy(vRest) + vec2(0.0, 2.0 / 60.0 + vVel.w);
    slB = ab.x * qx + ab.y * qy + vDBrk + vec2(0.0, 3.5 / 60.0);
  }
  // cat's paws: the wind roughens the sea in large drifting patches, so the ripples are not one uniform weave
  float paw = smoothstep(0.2, 0.8, 0.6 * vnoise(ROT * uv * 0.0042 + vec2(0.0, 0.02) * uTime) + 0.4 * vnoise(uv * 0.0117 - vec2(0.015, 0.0) * uTime));
  vec2 dn = detailSlope(uv, ux, uy);
  float detail = 0.32 * (0.7 + 0.6 * paw) * (1.0 - smoothstep(250.0, 3500.0, dist)) * (1.0 - calm); // bubbles kill the ripples
  vec3 dN = vec3(dn.x, 0.0, dn.y) * detail;
  if (wK > 0.0) { vec2 db = detailSlope(qb, qx, qy); dN = mix(dN, (Tq * db.x + Bq * db.y) * detail, wK); }
  vec3 Nb = normalize(N + dN); // the surface the ripples ride on: the emboss below shades them relative to it
  // the ripples, which fade out before they would shimmer
  float rk = uRipple * (0.45 + 0.9 * paw) * (1.0 - smoothstep(150.0, 1100.0, dist)) * (1.0 - calm);
  // On the moving faces they are blurred along with the motion (a wider filter footprint, up to 5 times) and
  // weakened (by up to 70 %); and where the finer weave is squeezed past 8 texels a pixel the footprint grows with it,
  // up to 3 times (its own mips still let the fine ripples alias as the swell tilts them). Measured at 1/60 s steps,
  // this more than halves the frame-to-frame shimmer on the faces in front of the player
  float kb;
  {
    mat2 MA = mat2(0.035, 0.0, 0.0, 0.13) * RIPA * uRipScale; // as rippleSlope's finer weave
    float fM = 1024.0 * max(length(MA * ux), length(MA * uy));
    kb = max(clamp(fM / 8.0, 1.0, 3.0), min(1.0 + 5.0 * mvPx, 5.0));
  }
  rk *= 1.0 - 0.7 * smoothstep(0.3, 0.9, mvPx);
  if (rk > 0.0) {
#ifndef SOFT
    rk *= 0.4 + 1.2 * smoothstep(0.15, 0.85, vnoise(ROT * uv * 0.035 + 1.7)); // stronger and weaker in patches a few tens of units across
#endif
    vec2 g = wK < 1.0 ? rippleSlope(ripWarp(uv), ux * kb, uy * kb) : vec2(0.0);
    vec3 gw = vec3(g.x, 0.0, g.y);
    if (wK > 0.0) { vec2 gb = rippleSlope(ripWarp(qb), qx, qy); gw = mix(gw, Tq * gb.x + Bq * gb.y, wK); }
    dN += gw * rk;
  }
  N = normalize(N + dN);

  float NdV = max(dot(N, V), 0.0);
  float F = min((0.02 + 0.98 * pow(1.0 - NdV, 5.0)) * uFresK, uFresMax);
  vec3 R = reflect(-V, N);
  R.y = abs(R.y);
  vec3 sky = mix(uHorizon, uZenith, smoothstep(0.0, 0.35, R.y));
  float sunR = max(dot(R, uSunDir), 0.0);
  sky += vec3(1.0, 0.95, 0.85) * (pow(sunR, 12.0) * 0.25);
  vec3 spec = uSpecCol * (pow(sunR, 60.0) * 0.5 + pow(sunR, 280.0) * 7.0 + pow(sunR, 2500.0) * 45.0);
  // a broad soft glare round the sun's reflection (AoM's specular is a bump-mapped dot product with no sharp
  // exponent, white under the MenuArctic lighting)
  spec += uSpecCol * uGlare * (pow(sunR, 6.0) * 0.25 + pow(sunR, 24.0) * 0.8);

  float shallow = 1.0 - smoothstep(0.5, 14.0, vDepth);
  float NdL = max(dot(N, uSunDir), 0.0);
  // in-scatter colour: turquoise in the waves, a muted sea-green in the last few decimetres over the sand
  // (there the sand seen through the water supplies the colour)
  vec3 inS = mix(uShore, uShallow, smoothstep(2.0, 10.0, vDepth));
  // emboss: ripples facing the sun brighter and the rest darker than the surface they ride on (so a wave face
  // turned away from the sun is not darkened as a whole)
  float lit = (0.65 + 0.5 * NdL) * max(1.0 + uEmboss * 3.0 * (NdL - max(dot(Nb, uSunDir), 0.0)), 0.0);
  vec3 body = mix(uDeep, inS, shallow) * lit;
  float back = pow(max(dot(-V, uSunDir), 0.0), 3.0);
  body += uSSS * vThin * (0.5 + 1.6 * back) * smoothstep(4.0, 14.0, vDepth); // no glow through a low bore front
  // freshly broken water is full of bubbles: milky pale turquoise and nearly opaque, even between the foam patches
  body = mix(body, vec3(0.44, 0.67, 0.71) * (0.7 + 0.45 * NdL), 0.8 * aer);
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
    T = exp(-uSigma * dz * (1.0 / cosT + 1.0 / cosS)) * (1.0 - 0.85 * aer);
    // caustics: two drifting cell networks, focused at a few decimetres of depth, blurred out further down
    vec2 bp = vWorld.xz + Rt.xz * (dz / cosT);
    float c1 = cellWall(bp * 0.21 + vec2(0.0, uTime * 0.12), uTime * 0.8);
    float c2 = cellWall(bp * 0.29 + vec2(uTime * 0.09, 3.7), -uTime * 0.65 + 1.3);
    float cl = exp(-c1 * 9.0) + exp(-c2 * 9.0);
    caus = vec3(1.0, 0.98, 0.9) * (cl * 1.3 * smoothstep(0.6, 3.5, dz) * exp(-dz / 16.0) * (0.4 + 0.6 * NdL));
  }
  vec3 Tw = T * uWetDark; // wet sand is darker than dry
  // AoM's banded seabed: a darker band where the bottom drops away, between the pale shallows and the open water
  Tw *= mix(vec3(1.0), uDropCol, uDrop * smoothstep(3.0, 8.0, vDepth) * (1.0 - smoothstep(16.0, 34.0, vDepth)));
  vec3 P = (1.0 - F) * (body * (1.0 - T) + Tw * caus * BED * (1.0 - uSandDisp)) + F * sky + spec * (1.0 - 0.6 * min(vFoam, 1.0));
  vec3 W = (1.0 - F) * Tw;

  // foam: a sheet of bubbles whose thickness sets how opaque and how white it is; thin foam is a translucent
  // film tinted by the water, thick foam scatters to bright white, with blue-grey crevices between the lumps
  float blot = clamp((0.65 * vnoise(uv * 0.028 + 0.37) + 0.35 * vnoise(ROT * uv * 0.071) - 0.38) / 0.3, 0.0, 1.0); // large-scale break-up
  float fa = vFoam * mix(0.7 + 0.6 * blot, 1.2, aer); // the large-scale break-up is for older foam, not fresh whitewater
  float ft = 0.0, tau = 0.0, dfa = vDFoam * mix(0.7 + 0.6 * blot, 1.2, aer);
  if (fa > 0.01) {
    if (wK < 1.0) tau = foamThick(vRest, fa, vAge, dist, slR, dfa, ft);
    if (wK > 0.0) {
      float ftB;
      float tB = foamThick(qb, fa, vAge, dist, slB, dfa, ftB);
      tau = mix(tau, tB, wK); ft = mix(ft, ftB, wK);
    }
  }
  tau = mix(tau, max(tau, 1.1 + 0.4 * ft), aer); // fresh whitewater is a solid mass: no holes until it ages
  // fresh whitewater churns: billowing lumps, mapped in the crest's own frame (x, height, distance from the crest)
  // and projected along the geometric normal, so the lumps travel with the breaker without stretching on the
  // hanging curtain; they tumble like the roller (down its front, shoreward over its top, up its back) and boil
  float churnA = aer * vCrest.y, churn = 0.33; // (the mean, used far away)
  if (churnA > 0.01 && dist < 900.0) {
    float kf = 1.0 - smoothstep(300.0, 900.0, dist), k3 = 1.0 - smoothstep(120.0, 400.0, dist); // fine detail would shimmer far away
    vec3 cp = vec3(vWorld.x, vWorld.y, vCrest.x) * 0.13;
    float tum = 0.4 * uTime;
    float wz = Ng.z * Ng.z, wy = Ng.y * Ng.y, ws = wz + wy + 1e-3;
    float cF = billow(vec2(cp.x, cp.y - sign(Ng.z) * tum), uTime, k3);
    float cT = billow(vec2(cp.x, cp.z + sign(Ng.y) * tum) + 11.3, uTime, k3);
    churn = mix(0.33, (wz * cF + wy * cT) / ws, kf);
  }
  // relief from the churn and a little from the thickness (surface-gradient bump mapping), faded out with distance:
  // the lace streams down the face at VFALL, so relief from it flickered; the churn is broad and slow
  float bumpK = 0.6 * (1.0 - smoothstep(60.0, 450.0, dist));
  float hgt = (0.4 * min(tau, 1.6) + 1.2 * churnA * churn) * bumpK;
  float hx = dFdx(hgt), hy = dFdy(hgt);
  // (over the geometric normal: the ripple normals under the foam made its light flicker)
  vec3 r1 = cross(dpy, Ng), r2 = cross(Ng, dpx);
  float det = dot(dpx, r1);
  vec3 nb = abs(det) * Ng - sign(det) * (hx * r1 + hy * r2);
  vec3 Nf = dot(nb, nb) > 1e-14 ? normalize(nb) : Ng;
  float af = 1.0 - exp(-3.2 * tau);
  float wrap = clamp(dot(Nf, uSunDir) * 0.35 + 0.65, 0.0, 1.0);
  float thickL = smoothstep(0.05, 1.1, tau);
  // bubbles scatter nearly all the light they get: a matte white, nearly as bright on its shaded side and on a steep
  // face, with no sheen (a sun sheen and deep blue-grey hollows made it look like glossy plastic). AoM's foam sits at
  // the very top of the filmic curve: pinned white (its luminance hardly moves), and the only structure the eye reads
  // in it is a pale cyan in the creases, never grey; so the white is pushed well past the curve's knee (at the old
  // level the whole bore came out a flat light grey, 238 of 255) and the hollows between the lumps tint cyan
  vec3 foamCol = mix(vec3(0.84, 0.91, 0.96), vec3(1.0), thickL) * (2.6 + 0.9 * wrap + 0.4 * back) * (0.95 + 0.05 * ft);
  foamCol = mix(mix(body * 1.6 + 0.3, foamCol, 0.6), foamCol, thickL); // thin films are translucent: they keep some water colour
  // churn shading: white lump tops, pale cyan hollows between them
  float crease = 1.0 - smoothstep(0.08, 0.55, churn);
  foamCol *= mix(vec3(1.0), mix(vec3(1.0), vec3(0.2, 0.72, 0.78), crease), churnA);
  // older foam glitters a little with bubble glints (sparkle); fresh whitewater is matte
  float fwR = length(fwidth(vRest * 2.3)), fwB = 2.3 * length(abs(qx) + abs(qy));
  float spk = wK < 1.0 ? sparkle(vRest * 2.3, fwR) : 0.0;
  if (wK > 0.0) spk = mix(spk, sparkle(qb * 2.3, fwB), wK);
  foamCol += vec3(1.0, 0.97, 0.9) * (0.5 * spk * (1.0 - aer) * thickL * smoothstep(0.1, 0.5, wrap));
  P = mix(P, foamCol, af);
  W *= 1.0 - af;

  float haze = (1.0 - exp(-dist * 0.00024)) * uHazeK;
  P = mix(P, uHazeCol, haze);
  W *= 1.0 - haze;

  // damp sand left by the swash: a dark, transparent layer, mirror-like where the film is still draining
  // (the layer and the dry-sand drop are judged per pixel from the interpolated depth, so the edge is smooth, and
  // so are its damp line and its glassy film from the interpolated distances to the run-up's line and the front)
  float sandL = (1.0 - smoothstep(0.3, 0.7, vDepth)) * vLand;
  if (sandL > 0.0) {
    float edge = max(-vSand.y, 0.0), gl = vSand.w > 0.0 ? exp(-edge * vSand.w) : 0.0;
    float sw = smoothstep(-2.0, 6.0, vSand.x) * (1.0 - smoothstep(-6.0, 2.0, vSand.y)) * vSand.z * (1.0 + gl);
    float damp = min(sw, 1.0), glaze = clamp(sw - 1.0, 0.0, 1.0); // 0..1 damp, then up to 1 glassy film
    vec3 Ns = normalize(vec3(0.0, 1.0, 0.0) + vec3(dn.x, 0.0, dn.y) * 0.03);
    float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(Ns, V), 0.0), 5.0);
    vec3 Rs = reflect(-V, Ns);
    vec3 skyS = mix(uHorizon, uZenith, smoothstep(0.0, 0.35, Rs.y)) + vec3(1.0, 0.95, 0.85) * pow(max(dot(Rs, uSunDir), 0.0), 400.0) * 12.0;
    float refl = glaze * Fs;
    float sandA = clamp(0.4 * damp + refl, 0.0, 1.0);
    vec3 sandCol = mix(uDamp, skyS, refl / max(refl + 0.4 * damp, 1e-3));
    vec3 Ps = mix(sandCol * sandA, foamCol, af);
    vec3 Ws = vec3((1.0 - sandA) * (1.0 - af));
    Ps = mix(Ps, uHazeCol, haze);
    Ws *= 1.0 - haze;
    P = mix(P, Ps, sandL);
    W = mix(W, Ws, sandL);
  }

  // Output. Blending can only weight the sand behind by one alpha, so alpha takes the red weight (the
  // smallest: red is absorbed most) and the rest of the green/blue transmission is added here using the
  // typical sand colour BED. The sum is done in display space (after tone mapping), where blending happens.
  // With uSandDisp (AoM) the sand seen through the water is added in display colour instead, as AoM's water is
  // blended over its terrain: its pale, high-key sand sits so near the top of the filmic curve that in linear light
  // it is an extreme green, which turned all the shallows mint where the water dimmed it
  float alpha = clamp(1.0 - W.r, 0.0, 1.0);
  vec3 bedD = linearToOutputTexel(vec4(toneMapping(BED * 1.55), 1.0)).rgb;
  vec3 tgt = linearToOutputTexel(vec4(toneMapping((P + W * BED * (1.0 - uSandDisp)) * 1.55), 1.0)).rgb;
  // the filmic curve cannot reach AoM's bright, saturated cyan (it desaturates on the way), so in that look the
  // water, not the sand seen through it, is pushed towards it afterwards: more saturation, green raised to blue,
  // a little brighter (uVivid sets how far)
  if (uVivid > 0.0) {
    vec3 v = mix(vec3(dot(tgt, vec3(0.2126, 0.7152, 0.0722))), tgt, 1.0 + 0.15 * uVivid);
    v.g += 0.55 * max(v.b - v.g, 0.0);
    tgt = mix(tgt, clamp(v * (1.0 + 0.04 * uVivid), 0.0, 1.0), min(uVivid, 1.0) * (1.0 - (W.r + W.g + W.b) / 3.0) * (1.0 - af)); // (not the foam: it stays white)
  }
  if (uSandDisp > 0.0) tgt = clamp(tgt + uSandDisp * W * bedD * (1.0 + 0.5 * caus), 0.0, 1.0);
  // the ripples' emboss again, in display space: the cyan sits near the top of the filmic curve, which squeezes
  // the lit/unlit difference in the water's light (above) nearly flat
  if (uEmboss > 0.0) {
    float emb = (NdL - max(dot(Nb, uSunDir), 0.0)) * (1.0 - af) * (1.0 - haze) * (1.0 - sandL) * (1.0 - 0.7 * (W.r + W.g + W.b) / 3.0);
    tgt = clamp(tgt * (1.0 + uEmboss * 1.5 * emb), 0.0, 1.0);
  }
  // the eye under the water: the surface is seen from below, a bright soft blue, brightest in Snell's window
  // straight overhead (outside it the underside mirrors the water below), where the ripples make it shimmer; the
  // foam glows pale through it; and it all fades into the blue with distance, as the sand under it does (scene fog)
  if (uUnder.w > 0.0) {
    float sw = smoothstep(0.6, 0.72, -V.y + 0.6 * length(Nb.xz - Ng.xz));
    vec3 win = mix(uUnder.rgb * 0.9,mix(uUnder.rgb, vec3(0.93, 0.98, 1.0), 0.6), sw);
    win = mix(win, vec3(0.9, 0.96, 1.0), 0.75 * af);
    gl_FragColor = vec4(mix(win, uUnder.rgb, 1.0 - exp(-pow(uUnder.w * dist, 2.0))), 1.0);
    return;
  }
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

// The mesh rows follow the wave crests. Row j is the line of constant wave phase sOf(d) + kx x + wobble(x)
// through (0, zs[j]), so every crest lies along a row at all times: the roller, the bore front and the creases
// of the breaking profile run along the rows instead of obliquely across them (~1.5 rows per column at x 0),
// where the straight grid rendered them as teeth. The surface itself is unchanged (surfPos is sampled at the
// moved rest positions). The rows fade back to straight lines outside the play area (|x| 1000 -> 2000, and
// from z 600 to 2000 offshore), so the far field and the mesh edges stay as they were; the near edge follows
// row 0, which stays under the sand. On the sand the phase lines run obliquely to the shore (d changes by up to
// ~100 along a row in the play area), so the fine rows start at d -245 at x 0 to reach d -146 or further all along
// the beach: the lobed swash runs up to about d -120, and the sand it wetted stays damp up to ~12 further.
// The rows also travel with the crests. Standing still, they were crossed by every crest ~10 times a second, and
// each crossing changed how the mesh caught a bore's sharp top: its edge jumped up and down by a pixel or so all
// the way in. From d -245 to z 460 the rows are evenly spaced in phase, ds apart (the base spacing 200 out, finer
// toward the shore, where the waves shorten), and each one slides toward the next row shoreward by uRowF of the
// way (the step is kept in position.y), which goes 0 -> 1 as the waves advance by ds and starts over: the mesh
// is then the same as it was, one row on, so the crests see the same rows all the time. The rows below stand
// still (the strip next to them shrinks away to nothing), and so do those past z 600, where the swell is smooth;
// the first of those is doubled and its moving copy opens a strip from nothing, so no row pops in at either end
// (one did out there, a ten-a-second flicker along a big swell's top).
function buildGeometry(quality) {
  const f = { high: 1.0, low: 1.8, soft: 2.2 }[quality] || 1.35;
  const xs = gridLines(-4950, 4950, -800, 800, 3.5 * f, 0.0075);
  const sh0 = shoreZ(0), ph0 = wobble(0);
  const ds = 1.3 * f * kOf(200), zs = [];
  const dB = -245, zB = sh0 + dB, nL = Math.ceil(40 / (3.9 * f)); // coarse rows under the sand
  for (let j = 0; j < nL; j++) zs.push(zB - 40 + 40 * j / nL);
  const j0 = zs.length; // the lowest row that moves follows this one
  for (let s = sOf(dB), d = dB; ; s += ds) {
    for (let it = 0; it < 20; it++) d -= (sOf(d) - s) / kOf(d);
    if (sh0 + d > 460) break;
    zs.push(sh0 + d);
  }
  const zE = zs[zs.length - 1];
  zs.push(...gridLines(zE, 4850, zE, zE, 1.3 * f, 0.0145).slice(1));
  const jE = zs.findIndex(z => z > 600); // the first row that stands still again is doubled, and the first copy moves
  zs.splice(jE, 0, zs[jE]);
  const nx = xs.length, nz = zs.length;
  const sh = new Float64Array(nx), ph = new Float64Array(nx), wx = new Float64Array(nx), dRow = new Float64Array(nx);
  const zPrev = new Float64Array(nx);
  for (let i = 0; i < nx; i++) {
    sh[i] = shoreZ(xs[i]);
    ph[i] = SURF.kx * xs[i] + wobble(xs[i]);
    wx[i] = 1 - sstep(1000, 2000, Math.abs(xs[i]));
    dRow[i] = zs[0] - sh[i];
  }
  const pos = new Float32Array(nx * nz * 3);
  let k = 0;
  for (let j = 0; j < nz; j++) {
    const wz = 1 - sstep(600, 2000, zs[j]);
    const sg = sOf(zs[j] - sh0) + ph0;
    const moves = j > j0 && j <= jE;
    for (let i = 0; i < nx; i++) {
      let z = zs[j];
      const w = wx[i] * wz;
      if (w > 0) {
        // d on this row's phase line (Newton from the row below; sOf is increasing with slope kOf)
        let d = dRow[i];
        for (let it = 0; it < 20; it++) {
          const e = sOf(d) - (sg - ph[i]);
          d -= e / kOf(d);
          if (Math.abs(e) < 1e-7) break;
        }
        dRow[i] = d;
        z += w * (sh[i] + d - z);
      }
      pos[k++] = xs[i]; pos[k++] = moves ? zPrev[i] - z : 0; pos[k++] = z;
      zPrev[i] = z;
    }
  }
  // The grid is drawn as tiles (one index buffer, a draw range each) that the camera's frustum culls: about half of
  // it is out of view from the beach, and the vertex shader (surfPos three or four times) is a third of the water's
  // cost. The tiles go shore to sea and left to right, as the one grid did. Their bounds are the rest grid widened by
  // how far the vertices move: the rows slide by one step, a rogue lip is thrown up to ~120 shoreward and its surface
  // spans y -28..83 (evalSurf), so y -60..130 and z -170..+60 leave a margin.
  const cx = [-2000, -800, -400, 0, 400, 800, 2000].map(x => xs.findIndex(v => v >= x));
  const cz = [-125, 100, 250, 460, 1200].map(z => zs.findIndex(v => v >= z));
  const ci = [0, ...cx, nx - 1], cj = [0, ...cz, nz - 1];
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6), tiles = [];
  k = 0;
  for (let tj = 0; tj < cj.length - 1; tj++) for (let ti = 0; ti < ci.length - 1; ti++) {
    const start = k;
    let z0 = Infinity, z1 = -Infinity;
    for (let j = cj[tj]; j < cj[tj + 1]; j++) for (let i = ci[ti]; i < ci[ti + 1]; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b;
      idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    for (let j = cj[tj]; j <= cj[tj + 1]; j++) for (let i = ci[ti]; i <= ci[ti + 1]; i++) {
      const z = pos[(j * nx + i) * 3 + 2], s = pos[(j * nx + i) * 3 + 1];
      z0 = Math.min(z0, z, z + s); z1 = Math.max(z1, z, z + s);
    }
    const box = new THREE.Box3(new THREE.Vector3(xs[ci[ti]], -60, z0 - 170), new THREE.Vector3(xs[ci[ti + 1]], 130, z1 + 60));
    tiles.push({ start, count: k - start, sphere: box.getBoundingSphere(new THREE.Sphere()) });
  }
  const position = new THREE.BufferAttribute(pos, 3), index = new THREE.BufferAttribute(idx, 1);
  const geometries = tiles.map(t => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', position);
    g.setIndex(index);
    g.setDrawRange(t.start, t.count);
    g.boundingSphere = t.sphere;
    return g;
  });
  return { geometries, vertices: nx * nz, ds };
}

// ---------- spray particles ----------
const SPRAY_VERT = /* glsl */`
uniform vec3 uSunDir;
attribute float aSize;
attribute float aAlpha;
attribute float aSeed;
attribute vec3 aVel;
varying float vAlpha;
varying float vSeed;
varying vec3 vSun;
varying vec2 vDir;
varying float vS;
// a drop is drawn as a streak along its motion, vS times longer than wide (1.6x even when it comes straight at the
// camera, up to 3.5x): a 0.15 s trace of its velocity across the screen (the view-space velocity less the part along
// the line of sight, which only changes its size); the point is enlarged to hold the streak, and the fragment draws a
// capsule in it
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float dz = max(-mv.z, 1.0);
  vec3 vv = (viewMatrix * vec4(aVel, 0.0)).xyz;
  vec2 sv = vv.xy + mv.xy * (vv.z / dz);
  float ls = length(sv);
  vS = clamp(1.6 + 0.15 * ls / max(aSize, 0.05), 1.6, 3.5);
  vDir = ls > 1e-4 ? sv / ls : vec2(1.0, 0.0);
  gl_PointSize = aSize * vS * (700.0 / dz);
  vAlpha = aAlpha;
  vSeed = aSeed;
  vSun = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  gl_Position = projectionMatrix * mv;
}`;
const SPRAY_FRAG = /* glsl */`
varying float vAlpha;
varying float vSeed;
varying vec3 vSun;
varying vec2 vDir;
varying float vS;
float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h1(i), h1(i + vec2(1.0, 0.0)), u.x), mix(h1(i + vec2(0.0, 1.0)), h1(i + 1.0), u.x), u.y);
}
// a soft capsule along the drop's motion (a ragged disc when it is slow), broken along its length by noise into
// beads, full and bright at its head and thinning to its tail: a translucent streak of water, white where it is
// thick or the sun catches it, the water's cyan showing through at its edges, a sharp glint where a ball of
// water would mirror the sun to the eye, and its rim lit through when the sun is behind it (Round 17: AoM's
// spray is a few painted streaks elongated along the motion over cyan, never round grey puffs)
void main() {
  vec2 b = (gl_PointCoord - 0.5) * vec2(2.0, -2.0);   // across the point, y up like the view
  float w = 1.0 / vS;                                   // the capsule's half-width; its length spans the point
  float u = dot(b, vDir), v = dot(b, vec2(-vDir.y, vDir.x));
  float t = clamp(u, w - 1.0, 1.0 - w);
  vec2 off = (b - vDir * t) / w;                        // offset from the capsule's axis, in half-widths
  float head = (u + 1.0) * 0.5;                         // 0 at the tail, 1 at the head
  float thin = (1.0 - head) * (1.0 - w);                // a stretched drop narrows and fades towards its tail
  float r = length(off) * (1.0 + 0.8 * thin);
  vec2 nq = vec2(u * 2.0 * sqrt(vS), v * 2.0 * vS) + vSeed * 17.0;
  float n = 0.6 * vn(nq) + 0.4 * vn(nq * 2.3 + 3.1);
  float a = smoothstep(1.0, 0.15, r + 0.55 * (n - 0.5)) * vAlpha * (1.0 - 0.5 * thin);
  if (a < 0.01) discard;
  vec3 nb = vec3(off, sqrt(max(1.0 - dot(off, off), 0.0)));
  float dif = clamp(dot(nb, vSun) * 0.6 + 0.4, 0.0, 1.0);
  float core = 1.0 - smoothstep(0.35, 1.0, r);
  vec3 wht = mix(vec3(0.76, 0.94, 0.97), vec3(1.0), clamp(0.2 + 0.6 * dif + 0.3 * head, 0.0, 1.0));
  vec3 col = mix(vec3(0.60, 0.87, 0.92), wht, clamp(0.55 + 0.9 * core + 0.2 * (n - 0.5), 0.0, 1.0));
  vec3 hv = normalize(vSun + vec3(0.0, 0.0, 1.0));
  float glint = pow(max(dot(nb, hv), 0.0), 48.0);
  float rim = clamp(-vSun.z, 0.0, 1.0) * (0.3 + 0.7 * smoothstep(0.3, 1.0, length(off)) * clamp(dot(off, vSun.xy) * 3.0 + 0.3, 0.0, 1.0));
  col = min(col + vec3(1.0, 0.97, 0.9) * (0.3 * glint + 0.35 * rim), vec3(1.0));
  gl_FragColor = vec4(col, a * (0.75 + 0.25 * n));
}`;

class Spray {
  constructor(scene, count, sunDir) {
    this.count = count;
    this.pos = new Float32Array(count * 3);
    this.vel = new Float32Array(count * 3);
    this.life = new Float32Array(count);
    this.maxLife = new Float32Array(count).fill(1);
    this.size = new Float32Array(count);
    this.alpha = new Float32Array(count);
    this.drag = new Float32Array(count);
    this.alphaMul = new Float32Array(count);
    this.grow = new Float32Array(count); // size growth per second (the old puffs swell 60 %/s; drops do not)
    this.y0 = new Float32Array(count); // the height it was emitted at, and ...
    this.fadeH = new Float32Array(count); // ... when > 0, it fades out over this height as it sinks below that
    this.seed = new Float32Array(count).map(() => Math.random());
    this.next = 0;
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.velAttr = new THREE.BufferAttribute(this.vel, 3).setUsage(THREE.DynamicDrawUsage);
    this.sizeAttr = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.alphaAttr = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('aVel', this.velAttr);
    g.setAttribute('aSize', this.sizeAttr);
    g.setAttribute('aAlpha', this.alphaAttr);
    g.setAttribute('aSeed', new THREE.BufferAttribute(this.seed, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({
      vertexShader: SPRAY_VERT, fragmentShader: SPRAY_FRAG,
      uniforms: { uSunDir: sunDir },
      transparent: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 2;
    scene.add(this.points);
  }
  // grow: size growth per second (negative shrinks); fadeH > 0: it also fades out as it sinks below the height it
  // was emitted at, over fadeH units (a stand-in for a soft contact with the water, which has no depth read-back)
  emit(x, y, z, vx, vy, vz, life, size, drag, alpha = 0.9, grow = 0.6, fadeH = 0) {
    const i = this.next; this.next = (this.next + 1) % this.count;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.life[i] = life; this.maxLife[i] = life; this.size[i] = size; this.drag[i] = drag; this.alphaMul[i] = alpha;
    this.grow[i] = grow; this.y0[i] = y; this.fadeH[i] = fadeH;
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
      let al = Math.min(1, a * 1.6) * this.alphaMul[i];
      if (this.fadeH[i] > 0) al *= Math.max(0, Math.min(1, 1 - (this.y0[i] - this.pos[i * 3 + 1]) / this.fadeH[i]));
      this.alpha[i] = al;
      this.size[i] *= 1 + this.grow[i] * dt;
    }
    this.posAttr.needsUpdate = this.velAttr.needsUpdate = this.sizeAttr.needsUpdate = this.alphaAttr.needsUpdate = true;
  }
}

// ---------- foam decals ----------
// AoM-style foam left by things in the water: rings spreading round a body or a splash, soft puffs trailing
// behind a moving body, and a churned patch where something drops in. Each decal is a small flat grid laid on
// the water by its vertex shader (the water's own surfPos), so it rides and tilts with the waves; its whole life
// is worked out on the GPU from its birth time, so the CPU writes each decal once.
const DECAL_VERT = /* glsl */`
${GLSL_COMMON}
attribute vec4 aA; // centre x, z, radius, rotation
attribute vec4 aB; // birth time, life, kind (0 ring, 1 puff, 2 churned patch, 3 collar), alpha
attribute vec4 aC; // stretch along the rotation, seed, drift speed in x and z (units per second)
varying vec2 vQ;
varying float vP, vKind, vAlpha, vSeed;
void main() {
  float p = (uTime - aB.x) / aB.y;
  if (p < 0.0 || p > 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; } // dead: beyond the far plane
  vQ = position.xy;
  vec2 q = position.xy * vec2(aC.x, -1.0) * aA.z; // y flipped onto z: the quad faces up (front side)
  float c = cos(aA.w), s = sin(aA.w);
  vec2 xz = aA.xy + aC.zw * (uTime - aB.x) + vec2(c * q.x - s * q.y, s * q.x + c * q.y);
  float f, th, wt, ag;
  vec4 sw;
  gFlat = true; // on the water at (x, z) itself, where the splash or the body is (the mesh bunches its points at crests)
  vec3 P = surfPos(xz, f, th, wt, sw, ag);
  // gone where the water is too shallow to hold foam (the swash draining off the sand)
  float bed = max(0.5 + landH(xz.y) - SLOPE * max(xz.y - shoreZ(xz.x), 0.0), -70.0);
  vAlpha = aB.w * smoothstep(0.3, 1.2, P.y - bed);
  vP = p; vKind = aB.z; vSeed = aC.y;
  // The water's triangles bunch at crests and stand up to ~1.2 above this flat evaluation on big waves, which buried
  // the foam from steep views. Draw it nearer the camera along its own view ray (same pixel, no parallax) by as far
  // as a 1.6 rise of the water would take that ray: near-coplanar water never covers it, a lip further in front still does
  vec3 fW = vec3(P.x, P.y + 0.3, P.z), fTc = cameraPosition - fW;
  float fD = length(fTc), fB = min(1.6 / max(fTc.y / fD, 0.12), 0.5 * fD);
  vec4 fMv = viewMatrix * vec4(fW, 1.0);
  fMv.xyz *= 1.0 - fB / fD;
  gl_Position = projectionMatrix * fMv;
}`;
const DECAL_FRAG = /* glsl */`
varying vec2 vQ;
varying float vP, vKind, vAlpha, vSeed;
float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h1(i), h1(i + vec2(1.0, 0.0)), u.x), mix(h1(i + vec2(0.0, 1.0)), h1(i + 1.0), u.x), u.y);
}
void main() {
  float p = vP, r = length(vQ), a;
  vec3 col = vec3(0.97, 0.99, 1.0);
  vec2 o = vec2(37.0, 91.0) * vSeed + 1.3 * p; // each decal its own pattern, slowly churning
  float n = 0.6 * vn(vQ * 5.0 + o) + 0.4 * vn(vQ * 11.0 - o);
  if (vKind < 0.5) {
    // ring: a soft white band that spreads fast, then slows, thins and fades, leaving milky water inside
    float R = mix(0.22, 0.9, 1.0 - (1.0 - p) * (1.0 - p));
    float w = mix(0.2, 0.08, p), e = (r + 0.12 * (n - 0.5) - R) / w;
    a = exp(-e * e) * (0.7 + 0.3 * n) + 0.35 * n * smoothstep(R, 0.15 * R, r) * (1.0 - p);
    a *= 1.0 - p;
  } else if (vKind < 1.5) {
    // puff: a soft, ragged blob that spreads and thins (stretched along the motion in the vertex shader), streaked
    // along the motion like the milky trail behind a wading unit in AoM
    float R = mix(0.5, 0.92, sqrt(p)), st = vn(vec2(vQ.x * 1.5, vQ.y * 9.0) + o);
    a = smoothstep(R, 0.2 * R, r + 0.3 * (n - 0.5) * R) * (0.6 + 0.4 * n) * pow(1.0 - p, 0.8) * min(p * 10.0, 1.0)
      * (0.35 + 0.65 * smoothstep(0.3, 0.7, st));
  } else if (vKind < 2.5) {
    // churned patch: a white disc that breaks up into ragged lumps as it fades
    float R = mix(0.55, 0.92, sqrt(p));
    a = smoothstep(R, 0.5 * R, r + 0.25 * (n - 0.5)) * smoothstep(0.8 * p - 0.1, 0.8 * p + 0.2, n) * (1.0 - p * p);
  } else {
    // collar: AoM's ring at a wading unit's feet. A crisp bright rim just past the body's edge round milky water
    // streaked in rings, over a dark blob on the side away from the sun (its +x). Short-lived and laid often, but
    // carried along with the body, so the overlapping ones stay one sharp ring
    float e = r + 0.06 * (n - 0.5), env = sin(3.14159 * p);
    float f = (0.6 * exp(-pow((e - 0.8) / 0.06, 2.0))
      + 0.17 * smoothstep(0.84, 0.6, e) * (0.6 + 0.4 * sin(r * 38.0 + 6.0 * n))) * env;
    float sh = 0.15 * smoothstep(1.0, 0.3, length((vQ - vec2(0.3, 0.0)) / vec2(0.62, 0.45))) * env * (1.0 - f);
    a = f + sh;
    col = (col * f + vec3(0.05, 0.25, 0.32) * sh) / max(a, 1e-4); // the foam over the shadow
  }
  a = min(a * vAlpha, 0.95);
  if (a < 0.01) discard;
  gl_FragColor = vec4(col, a);
}`;

class Decals {
  constructor(scene, uniforms, count) {
    this.count = count;
    this.hi = -1; // the highest slot in use: only slots 0..hi are drawn
    this.now = 0;
    const plane = new THREE.PlaneGeometry(2, 2, 12, 12); // fine enough that its chords barely sag under a crest
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.setAttribute('position', plane.getAttribute('position'));
    const attr = (n, init) => new THREE.InstancedBufferAttribute(new Float32Array(count * n).map((_, i) => init[i % n]), n)
      .setUsage(THREE.DynamicDrawUsage);
    this.a = attr(4, [0, 0, 1, 0]);
    this.b = attr(4, [-1e9, 1, 0, 0]); // born long ago: dead
    this.c = attr(4, [1, 0, 0, 0]);
    g.setAttribute('aA', this.a); g.setAttribute('aB', this.b); g.setAttribute('aC', this.c);
    g.instanceCount = 0;
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: DECAL_VERT, fragmentShader: DECAL_FRAG,
      uniforms: { uTime: uniforms.uTime, uRogue: uniforms.uRogue }, // shared with the water: the same waves
      transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2; // after the water and the ghosts, before the spray (made later, same order)
    scene.add(this.mesh);
  }
  add(x, z, size, rot, birth, life, kind, alpha, stretch = 1, vx = 0, vz = 0) {
    // the lowest free slot, so the live decals stay packed at the start of the pool and only those are drawn; a
    // crowd of wading ghosts lays more foam than the pool holds, and then the one ending soonest gives way
    const A = this.a.array, B = this.b.array, C = this.c.array;
    let i = -1, soonest = 0, end = Infinity;
    for (let j = 0; j <= this.hi; j++) {
      const e = B[j * 4] + B[j * 4 + 1];
      if (e <= this.now) { i = j; break; }
      if (e < end) { end = e; soonest = j; }
    }
    if (i < 0) i = this.hi + 1 < this.count ? this.hi + 1 : soonest;
    if (i > this.hi) { this.hi = i; this.mesh.geometry.instanceCount = i + 1; }
    A[i * 4] = x; A[i * 4 + 1] = z; A[i * 4 + 2] = size; A[i * 4 + 3] = rot;
    B[i * 4] = birth; B[i * 4 + 1] = life; B[i * 4 + 2] = kind; B[i * 4 + 3] = alpha;
    C[i * 4] = stretch; C[i * 4 + 1] = Math.random(); C[i * 4 + 2] = vx; C[i * 4 + 3] = vz;
    this.a.needsUpdate = this.b.needsUpdate = this.c.needsUpdate = true;
  }
  // drop the dead slots at the top of the pool from the draw
  update(time) {
    this.now = time;
    const B = this.b.array;
    let hi = this.hi;
    while (hi >= 0 && B[hi * 4] + B[hi * 4 + 1] <= time) hi--;
    if (hi !== this.hi) { this.hi = hi; this.mesh.geometry.instanceCount = hi + 1; }
  }
  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose(); this.mesh.material.dispose();
  }
}

// ---------- splash plumes ----------
// The idea of AoM's meteor splash: a few big painted plumes of white water on billboards that shoot up, spread
// and fall back, which reads as a real splash at almost no cost. Here a line of them goes up where the lip of a
// breaking wave lands, where a shore dump slams down, and (smaller) off the tumbling bore front.
// The plume pictures are drawn once at start-up (four variants in a 2x2 atlas, each tile N x N): R the plume's
// opacity, G the order it dissolves in (thin spray first, the dense core last), B how open it is to the light (dark
// in the creases between its lumps), mottled a little by the grain. A second atlas holds its relief, so that the
// shader lights it as a heap of lumps rather than a flat picture: RG the slope of its surface (its normal across and
// up), B its height.
// Each is a broad sheet of spray across its upper part with a torn outline, piled with round lumps of two sizes (the
// cauliflower of a wave's white water), a fan of streaks falling back out of its underside and loose drops round it,
// all made of a fine grain, near-white with a pale blue-grey in the thin parts. The billboards are about ASP times
// wider than tall, so the picture is drawn squeezed by that much across, and its grain and lumps come out round.
function plumeAtlas(N) {
  const S = 2 * N, out = new Uint8Array(S * S * 4), rel = new Uint8Array(S * S * 4), ASP = 1.5;
  const lat = new Float32Array(256 * 256), Dd = new Float32Array(N * N);
  const Hh = new Float32Array(N * N), Bn = new Float32Array(N * N), Bw = new Float32Array(N * N), Bt = new Float32Array(N * N);
  const Ac = new Float32Array(N * N), Gc = new Float32Array(N * N), Lc = new Float32Array(N * N);
  const vn = (x, y) => { // smooth value noise on a 256-periodic lattice
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const i0 = xi & 255, i1 = (xi + 1) & 255, j0 = (yi & 255) << 8, j1 = ((yi + 1) & 255) << 8;
    const a = lat[j0 + i0], b = lat[j0 + i1], c = lat[j1 + i0], d = lat[j1 + i1];
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  const fbm = (x, y) => 0.5 * vn(x, y) + 0.3 * vn(2.03 * x + 5.2, 2.03 * y + 1.3) + 0.2 * vn(4.1 * x + 9.1, 4.1 * y + 3.7);
  // a round drop at (X, Y) (X -0.5..0.5 across the width, Y 0..1 up the height), rad heights across
  const drop = (X, Y, rad, amp) => {
    const cx = (X + 0.5) * N, cy = Y * N, R = rad * N, Rx = R / ASP, kx = 1 / (Rx * Rx), ky = 1 / (R * R);
    for (let py = Math.max(0, Math.floor(cy - R)); py <= Math.min(N - 1, Math.ceil(cy + R)); py++) {
      const dy = py + 0.5 - cy;
      for (let px = Math.max(0, Math.floor(cx - Rx)); px <= Math.min(N - 1, Math.ceil(cx + Rx)); px++) {
        const dx = px + 0.5 - cx, q = 1 - dx * dx * kx - dy * dy * ky;
        if (q > 0) Dd[py * N + px] = Math.max(Dd[py * N + px], amp * Math.min(1, 3 * q));
      }
    }
  };
  // packed round lumps at (x, y) (in heights): sphere caps up to ~1 high on a jittered grid of cells c across
  const lumps = (x, y, c, salt) => {
    const gx = Math.floor(x / c), gy = Math.floor(y / c);
    let m = 0;
    for (let j = gy - 1; j <= gy + 1; j++) for (let i = gx - 1; i <= gx + 1; i++) {
      const h = hashU(Math.imul(i, 73856093) ^ Math.imul(j, 19349663) ^ salt), h2 = hashU(h);
      const dx = x - (i + 0.15 + 0.7 * hash01(h)) * c, dy = y - (j + 0.15 + 0.7 * hash01(h2)) * c;
      const R = c * (0.6 + 0.35 * hash01(hashU(h2))), q = 1 - (dx * dx + dy * dy) / (R * R);
      if (q > 0) m = Math.max(m, Math.sqrt(q) * R / c);
    }
    return m;
  };
  // a box blur of a tile's src into dst, r pixels each way (across, then up; clamped at the tile's edges)
  const blur = (src, dst, r) => {
    const k = 1 / (2 * r + 1), cl = i => Math.min(Math.max(i, 0), N - 1);
    for (let py = 0; py < N; py++) {
      let s = 0;
      for (let j = -r; j <= r; j++) s += src[py * N + cl(j)];
      for (let px = 0; px < N; px++) { Bt[py * N + px] = s * k; s += src[py * N + cl(px + r + 1)] - src[py * N + cl(px - r)]; }
    }
    for (let px = 0; px < N; px++) {
      let s = 0;
      for (let j = -r; j <= r; j++) s += Bt[cl(j) * N + px];
      for (let py = 0; py < N; py++) { dst[py * N + px] = s * k; s += Bt[cl(py + r + 1) * N + px] - Bt[cl(py - r) * N + px]; }
    }
  };
  for (let t = 0; t < 4; t++) {
    let s = hashU(t * 7919 + 17);
    const r = () => hash01(s = hashU(s + 0x9e3779b9));
    for (let i = 0; i < lat.length; i++) lat[i] = r();
    // the mass (in widths across, heights up): a broad sheet of spray across nearly the whole width of the upper
    // part, centred at height cy, ax across and ay up and down from it; squarish, with a low dome for a top, its
    // outline torn by a warped noise and the grain
    const cy = 0.6 + 0.03 * r(), ax = 0.44 + 0.03 * r(), ay = 0.24 + 0.03 * r(), sx = 200 * r(), sy = 200 * r();
    const fy = cy + 0.5; // the streaks under it fan out from a point this high up
    Dd.fill(0);
    for (let i = 0; i < 30; i++) { // drops flung up and out of its top and sides
      const ang = Math.PI * (-0.1 + 1.2 * r()), d = 1.02 + 0.25 * r();
      drop(ax * d * Math.cos(ang), cy + ay * d * Math.sin(ang), 0.003 + 0.005 * r(), 0.5 + 0.5 * r());
    }
    for (let i = 0; i < 40; i++) drop(0.9 * (r() - 0.5), 0.05 + (cy - 0.15) * r(), 0.003 + 0.004 * r(), 0.6); // and falling
    const ox = (t & 1) * N, oy = (t >> 1) * N, salt = hashU(s), salt2 = hashU(salt);
    for (let py = 0; py < N; py++) {
      const Y = (py + 0.5) / N;
      for (let px = 0; px < N; px++) {
        const X = (px + 0.5) / N - 0.5, x = ASP * X; // x: X in heights, for noise that comes out round
        // the grain: fine droplets, clumps of them and broad patches
        const gf = fbm(x * 60 + sy, Y * 60 + sx), gm = fbm(x * 17 + sx, Y * 17 + sy), gb = fbm(x * 6 + sy, Y * 6 + sx);
        const w1 = fbm(x * 2.2 + sx, Y * 2.2 + sy), w2 = fbm(x * 2.2 + sy + 31, Y * 2.2 + sx + 17);
        const ex = Math.abs(X + 0.12 * (w1 - 0.5)) / ax;
        let ey = (Y - cy + 0.14 * (w2 - 0.5)) / ay;
        if (ey > 0) ey += 0.3 * ex * ex; // the dome: lower at the sides
        const e2 = ex * ex, f2 = ey * ey;
        const rr = Math.sqrt(Math.sqrt(e2 * e2 + f2 * f2)) + 0.45 * (gb - 0.5) + 0.3 * (gm - 0.5) + 0.3 * (gf - 0.5);
        const mass = sstep(1.0, 0.65, rr), thick = sstep(0.85, 0.25, rr);
        // the spray falling out of its underside, fanning out from the point above: th the angle off the vertical.
        // Thin spray all across, thickened into streaks of many widths (two octaves of a wavering noise across th),
        // each ending at its own length; v runs 0 in the mass's lower part to 1 at the foot
        let fan = 0;
        const yv = cy - 0.5 * ay;
        if (Y < yv + 0.1) {
          const dy = fy - Y, th = Math.atan2(x, dy), rho = Math.sqrt(x * x + dy * dy), v = Math.max((yv - Y) / yv, 0);
          const q = th * 9 + 0.8 * (gb - 0.5) + sx;
          const band = 0.65 * vn(q, sy + 2.5 * rho) + 0.35 * vn(2.3 * q + 7.7, sy + 5 * rho + 3.1);
          const len = 0.55 + 0.5 * vn(th * 9 + sx + 17.3, sy + 7.1);
          fan = (0.45 + 0.55 * sstep(0.36, 0.66, band)) * sstep(len, 0.55 * len, v) * sstep(0.95, 0.65, Math.abs(th)) * (1 - 0.3 * v);
        }
        // thinned towards the sides and the top of the tile before the grain is applied, so that the grain tears it
        // open there (the mass and the fan reach past the tile, whose edge would cut them in straight lines)
        const D = Math.max(mass, fan) * sstep(0.5, 0.3, Math.abs(X)) * sstep(0.98, 0.74, Y);
        const edge = sstep(0.5, 0.45, Math.abs(X)) * sstep(1.0, 0.9, Y) * sstep(0.0, 0.08, Y);
        // mottled all through: the grain eats holes into the thin parts and thins the core in patches
        // (the core nearly solid, so the face behind does not tint it)
        const a = Math.max(sstep(0.12, 0.9, D * (0.2 + 0.5 * gm + 0.45 * gf + 0.5 * thick)), Dd[py * N + px]) * edge;
        // the order it dissolves in: thin spray first, the core last, grain by grain
        const dis = Math.min(Math.max(0.1 + 0.3 * gf + 0.2 * gm + 0.3 * thick + 0.08 * (1 - Y), 0), 1);
        // its shading by the grain and, more gently, in broad patches: white on the dense clumps, a blue-grey in the
        // thin parts (the light and shade across the whole plume come from its rounded normal in the shader)
        const lit = Math.min(Math.max(0.55 + 0.3 * thick + 0.5 * (gb - 0.5) + 0.8 * (gm - 0.5) + 0.5 * (gf - 0.5), 0), 1);
        // its relief, in heights: a low heap over the mass piled with big and small lumps, the streaks raised a
        // little (and lumpy) and the drops as beads
        const l2 = lumps(x, Y, 0.05, salt2);
        const hh = Math.max(0.2 * Math.sqrt(sstep(1.05, 0.2, rr)) + sstep(1.1, 0.55, rr) * (0.075 * lumps(x, Y, 0.14, salt) + 0.014 * l2)
          + 0.001 * (gf - 0.5), fan * (0.025 + 0.012 * l2), 0.015 * Dd[py * N + px]);
        const i = py * N + px;
        Ac[i] = a; Gc[i] = dis; Lc[i] = lit; Hh[i] = Math.max(hh, 0) * edge;
      }
    }
    // how open each point is to the light: how far it lies below its surroundings, near and wider
    blur(Hh, Bn, Math.max(1, Math.round(0.03 * N)));
    blur(Hh, Bw, Math.max(2, Math.round(0.09 * N)));
    for (let py = 0; py < N; py++) for (let px = 0; px < N; px++) {
      const i = py * N + px, o = ((oy + py) * S + ox + px) * 4;
      const ao = Math.min(Math.max(1 - 9 * (0.6 * (Bn[i] - Hh[i]) + 0.4 * (Bw[i] - Hh[i])), 0.3), 1);
      // the slope, per height across and up (a pixel is ASP / N heights across, 1 / N up)
      const hx = (Hh[py * N + Math.min(px + 1, N - 1)] - Hh[py * N + Math.max(px - 1, 0)]) * N / (2 * ASP);
      const hy = (Hh[Math.min(py + 1, N - 1) * N + px] - Hh[Math.max(py - 1, 0) * N + px]) * N / 2;
      const nl = 1 / Math.sqrt(hx * hx + hy * hy + 1);
      out[o] = Math.round(Ac[i] * 255); out[o + 1] = Math.round(Gc[i] * 255); out[o + 2] = Math.round(ao * (0.8 + 0.2 * Lc[i]) * 255); out[o + 3] = 255;
      rel[o] = Math.round((0.5 - 0.5 * hx * nl) * 255); rel[o + 1] = Math.round((0.5 - 0.5 * hy * nl) * 255);
      rel[o + 2] = Math.round(Math.min(Hh[i] / 0.32, 1) * 255); rel[o + 3] = 255;
    }
  }
  const mk = d => {
    const tex = new THREE.DataTexture(d, S, S, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  };
  return { tex: mk(out), rel: mk(rel) };
}
// The foam curtain's picture (see FoamCurtain), in the plume atlas's layout and style: one strip CURTAIN_ASP heights
// across and one up that wraps round seamlessly across (its noise, lumps and drops all repeat), drawn in square
// pixels. Soft white water as AoM draws it rather than a row of cauliflowers: a slab along its foot heaped up into
// billows of all sizes, unevenly spaced, that run into one another without creases, feathered at its edges, under a
// thin veil of spray rising out of it in wisps, with a few soft jets and loose drops in the veil.
const CURTAIN_ASP = 3;
function curtainTex(NV) {
  const ASP = CURTAIN_ASP, NU = ASP * NV, NN = NU * NV;
  const out = new Uint8Array(NN * 4), rel = new Uint8Array(NN * 4);
  const lat = new Float32Array(1024 * 256), Dd = new Float32Array(NN);
  const Hh = new Float32Array(NN), Bn = new Float32Array(NN), Bw = new Float32Array(NN), Bt = new Float32Array(NN);
  const Ac = new Float32Array(NN), Gc = new Float32Array(NN), Lc = new Float32Array(NN);
  let s = hashU(4241);
  const r = () => hash01(s = hashU(s + 0x9e3779b9));
  for (let i = 0; i < lat.length; i++) lat[i] = r();
  const wrapI = (i, P) => ((i % P) + P) % P;
  const vn = (x, y, P) => { // smooth value noise, repeating every P cells across (P <= 1024)
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
    const i0 = wrapI(xi, P), i1 = wrapI(xi + 1, P), j0 = (yi & 255) << 10, j1 = ((yi + 1) & 255) << 10;
    const a = lat[j0 + i0], b = lat[j0 + i1], c = lat[j1 + i0], d = lat[j1 + i1];
    return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
  };
  // three octaves at (U 0..1 across the strip, Y up), P cells across it for the coarsest; o moves it up the lattice
  // so that the different noises are unrelated
  const fbm = (U, Y, P, o) => {
    const y = Y * P / ASP + o;
    return 0.5 * vn(U * P, y, P) + 0.3 * vn(2 * U * P, 2 * y + 13.7, 2 * P) + 0.2 * vn(4 * U * P, 4 * y + 29.3, 4 * P);
  };
  // a round drop at (X, Y) in heights, rad heights across (wrapped round across)
  const drop = (X, Y, rad, amp) => {
    const cx = X * NV, cy = Y * NV, R = rad * NV, k = 1 / (R * R);
    for (let py = Math.max(0, Math.floor(cy - R)); py <= Math.min(NV - 1, Math.ceil(cy + R)); py++) {
      const dy = py + 0.5 - cy;
      for (let qx = Math.floor(cx - R); qx <= Math.ceil(cx + R); qx++) {
        const dx = qx + 0.5 - cx, q = 1 - (dx * dx + dy * dy) * k;
        if (q > 0) { const i = py * NU + wrapI(qx, NU); Dd[i] = Math.max(Dd[i], amp * Math.min(1, 3 * q)); }
      }
    }
  };
  // packed round lumps at (x, y) in heights on a jittered grid of n cells across the strip (as in plumeAtlas)
  const lumps = (x, y, n, salt) => {
    const c = ASP / n, gx = Math.floor(x / c), gy = Math.floor(y / c);
    let m = 0;
    for (let j = gy - 1; j <= gy + 1; j++) for (let i = gx - 1; i <= gx + 1; i++) {
      const h = hashU(Math.imul(wrapI(i, n), 73856093) ^ Math.imul(j, 19349663) ^ salt), h2 = hashU(h);
      const dx = x - (i + 0.15 + 0.7 * hash01(h)) * c, dy = y - (j + 0.15 + 0.7 * hash01(h2)) * c;
      const R = c * (0.6 + 0.35 * hash01(hashU(h2))), q = 1 - (dx * dx + dy * dy) / (R * R);
      if (q > 0) m = Math.max(m, Math.sqrt(q) * R / c);
    }
    return m;
  };
  // a box blur of src into dst, r pixels each way (wrapped round across, clamped at the foot and the top)
  const blur = (src, dst, r) => {
    const k = 1 / (2 * r + 1), cl = i => Math.min(Math.max(i, 0), NV - 1);
    for (let py = 0; py < NV; py++) {
      const row = py * NU;
      let a = 0;
      for (let j = -r; j <= r; j++) a += src[row + wrapI(j, NU)];
      for (let px = 0; px < NU; px++) { Bt[row + px] = a * k; a += src[row + wrapI(px + r + 1, NU)] - src[row + wrapI(px - r, NU)]; }
    }
    for (let px = 0; px < NU; px++) {
      let a = 0;
      for (let j = -r; j <= r; j++) a += Bt[cl(j) * NU + px];
      for (let py = 0; py < NV; py++) { dst[py * NU + px] = a * k; a += Bt[cl(py + r + 1) * NU + px] - Bt[cl(py - r) * NU + px]; }
    }
  };
  // a smooth union of two signed distances and a smooth maximum of two heights, k wide
  const smin = (a, b, k) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k / 4; };
  const smax = (a, b, k) => -smin(-a, -b, k);
  // the billows (x, y, radius, the height its relief starts from), in heights: big and small ones, unevenly spaced and
  // overlapping along the top of the slab (the bigger the higher), a few crowned with a smaller one
  const C = [], NB = 13, gap = [];
  for (let i = 0; i < NB; i++) gap.push(0.4 + r());
  const gs = gap.reduce((a, b) => a + b, 0);
  for (let i = 0, X = 0; i < NB; X += ASP * gap[i++] / gs) {
    const R = 0.11 + 0.2 * Math.pow(r(), 1.5), cy = 0.38 + R * (0.2 + 0.4 * r());
    C.push(X, cy, R, 0);
    if (r() < 0.4) {
      const a = Math.PI * (0.3 + 0.4 * r());
      C.push(X + 0.75 * R * Math.cos(a), cy + 0.75 * R * Math.sin(a), R * (0.4 + 0.15 * r()), 0.35 * R);
    }
  }
  // soft jets of spray rising out of it: x, half-width at the slab, top, lean (heights across per height up)
  const J = [];
  for (let i = 0; i < 4; i++) J.push(ASP * (i + 0.2 + 0.6 * r()) / 4, 0.04 + 0.04 * r(), 0.8 + 0.15 * r(), 0.3 * (r() - 0.5));
  for (let i = 0; i < 35; i++) drop(ASP * r(), 0.6 + 0.35 * r(), 0.003 + 0.004 * r(), 0.4 + 0.4 * r());
  for (let j = 0; j < J.length; j += 4) for (let i = 0; i < 5; i++) {
    const t = r(), y = J[j + 2] + 0.04 * (r() - 0.3);
    drop(J[j] + J[j + 3] * (y - 0.45) + 3 * J[j + 1] * (t - 0.5), y, 0.003 + 0.004 * r(), 0.6);
  }
  const salt = hashU(s), salt2 = hashU(salt), sj = 1000 * r();
  for (let py = 0; py < NV; py++) {
    const Y = (py + 0.5) / NV;
    for (let px = 0; px < NU; px++) {
      const U = (px + 0.5) / NU, X = U * ASP;
      // the grain: fine droplets, clumps of them and broad patches; and a warp that tears the outline
      const gf = fbm(U, Y, 180, 0), gm = fbm(U, Y, 51, 61), gb = fbm(U, Y, 18, 122);
      const Xw = X + 0.05 * (fbm(U, Y, 7, 151) - 0.5), Yw = Y + 0.05 * (fbm(U, Y, 7, 173) - 0.5);
      const yb = 0.36 + 0.1 * fbm(U, 0, 7, 197);
      // the mass's signed distance (in heights, negative inside): the slab and the billows run together, torn by the
      // grain; and its heaped height
      let dO = Yw - yb, hd = 0.08 * Math.sqrt(sstep(0.05, -0.25, Y - yb));
      for (let c = 0; c < C.length; c += 4) {
        let dx = Xw - C[c];
        dx -= ASP * Math.round(dx / ASP);
        const dy = Yw - C[c + 1], R = C[c + 2], q = R * R - dx * dx - dy * dy;
        dO = smin(dO, Math.sqrt(dx * dx + dy * dy) - R, 0.1);
        if (q > 0) hd = smax(hd, C[c + 3] + 0.6 * Math.sqrt(q), 0.06);
      }
      dO += 0.06 * (gb - 0.5) + 0.05 * (gm - 0.5) + 0.05 * (gf - 0.5);
      const mass = sstep(0.1, -0.08, dO), thick = sstep(0, -0.2, dO);
      // the veil: spray rising off the mass in wisps (streaks up the picture, bent a little), thinning out above it
      const Uw = U + 0.012 * (fbm(U, Y, 5, 351) - 0.5);
      const st = 0.6 * vn(60 * Uw, 2.5 * Y + 311, 60) + 0.4 * vn(21 * Uw, 1.2 * Y + 337, 21), wisp = sstep(0.35, 0.75, st);
      const veil = sstep(0.42, 0, dO) * (0.2 + 0.5 * wisp) * sstep(1.0, 0.7, Y) * (0.8 + 0.4 * (gf - 0.5));
      // the jets: widening as they rise and fading out well under their tops, streaked along their length
      let jet = 0;
      for (let j = 0; j < J.length; j += 4) {
        const t = (Y - 0.45) / (J[j + 2] - 0.45);
        if (t < 0 || t > 1) continue;
        let dx = X - J[j] - J[j + 3] * (Y - 0.45);
        dx -= ASP * Math.round(dx / ASP);
        const w = J[j + 1] * (1 + 2 * t), e = Math.abs(dx) / w;
        if (e >= 1) continue;
        const stj = vn(3 * dx / w + sj + 7 * j, 25 * Y + sj, 1024);
        jet = Math.max(jet, 0.7 * sstep(1, 0.4, e) * (0.4 + 0.6 * sstep(0.3, 0.7, stj)) * sstep(1, 0.6, t));
      }
      const i = py * NU + px;
      // the mass nearly even (only faintly mottled) and the veil, jets and drops translucent; faded out under its top
      Ac[i] = Math.max(mass * (0.85 + 0.15 * thick) * (0.92 + 0.16 * (gm - 0.5)), veil, jet, 0.8 * Dd[i]) * sstep(1.0, 0.94, Y);
      // the order it dissolves in: the veil, jets and drops first, then the mass from its outline inwards, grain by
      // grain (so that it shrinks as one and never breaks up into separate billows)
      Gc[i] = Math.min(Math.max(0.45 - 1.6 * dO + 0.25 * (gf - 0.5) + 0.15 * (gm - 0.5), 0), 1);
      Lc[i] = Math.min(Math.max(0.7 + 0.2 * thick + 0.3 * (gb - 0.5) + 0.3 * (gm - 0.5) + 0.2 * (gf - 0.5), 0), 1);
      // its relief: the heaped billows with broad, low lumps on them, the jets raised a little and the drops as beads
      const l2 = lumps(X, Y, 48, salt2);
      Hh[i] = Math.max(hd + sstep(0.1, -0.1, dO) * (0.04 * lumps(X, Y, 16, salt) + 0.01 * l2) + 0.001 * (gf - 0.5),
        jet * (0.02 + 0.01 * l2), 0.012 * Dd[i], 0);
    }
  }
  blur(Hh, Bn, Math.max(1, Math.round(0.03 * NV)));
  blur(Hh, Bw, Math.max(2, Math.round(0.09 * NV)));
  for (let py = 0; py < NV; py++) for (let px = 0; px < NU; px++) {
    const i = py * NU + px, o = i * 4;
    // shut out of its hollows only a little: soft white water, not deep creases
    const ao = Math.min(Math.max(1 - 6 * (0.6 * (Bn[i] - Hh[i]) + 0.4 * (Bw[i] - Hh[i])), 0.6), 1);
    // the slope, per height across and up (a pixel is 1 / NV heights each way)
    const hx = (Hh[py * NU + wrapI(px + 1, NU)] - Hh[py * NU + wrapI(px - 1, NU)]) * NV / 2;
    const hy = (Hh[Math.min(py + 1, NV - 1) * NU + px] - Hh[Math.max(py - 1, 0) * NU + px]) * NV / 2;
    const nl = 1 / Math.sqrt(hx * hx + hy * hy + 1);
    out[o] = Math.round(Ac[i] * 255); out[o + 1] = Math.round(Gc[i] * 255); out[o + 2] = Math.round(ao * (0.8 + 0.2 * Lc[i]) * 255); out[o + 3] = 255;
    rel[o] = Math.round((0.5 - 0.5 * hx * nl) * 255); rel[o + 1] = Math.round((0.5 - 0.5 * hy * nl) * 255);
    rel[o + 2] = Math.round(Math.min(Hh[i] / 0.32, 1) * 255); rel[o + 3] = 255;
  }
  const mk = d => {
    const tex = new THREE.DataTexture(d, NU, NV, THREE.RGBAFormat, THREE.UnsignedByteType);
    tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  };
  return { tex: mk(out), rel: mk(rel) };
}
const SPLASH_VERT = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir;
attribute vec4 aA; // base x, y, z (at the water), birth time
attribute vec4 aB; // full width, full height, life, alpha (negative: a jet, thrown up off a bore's top)
attribute vec4 aC; // variant 0..3 (4..7: one of the bore's line), flip (+-1), lean (top thrown shoreward, per unit
                   // height), drift (z units per s)
attribute vec2 aD; // the crest's horizontal normal (x, z), seaward
varying vec2 vUv, vM;
varying vec3 vL;
varying float vT, vAlpha, vBack, vQy, vDist, vClip, vJet, vJp;
void main() {
  float age = uTime - aA.w, p = age / aB.z;
  if (p < 0.0 || p > 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; } // dead: beyond the far plane
  // bursts up to its full height by p 0.4 and keeps spreading; then its top falls back and it sinks into the
  // water as it dissolves, so it never hangs over the water the wave has left behind. A jet (the bore's) is
  // thrown up whole out of the bore's top (aA.y) and falls back into it, fast at first, slowing to its height by
  // p 0.38, then falling faster and faster; only the part of its picture over the top shows (vClip: how much is
  // under it), so it rises out of the white water and sinks back in. (Round 21: the bore's plumes stood steady on
  // its front, many at once, and their soft fringes hanging over it read as clouds or vapour)
  float jt = step(aB.w, 0.0);
  // one of the dense line along a bore's front (Round 22): it falls back further, sinking into the white water it
  // rose from, and stays dense as it goes (the bore's thin dissolving fringes read as cloud or vapour)
  float bl = step(3.5, aC.x), va = aC.x - 4.0 * bl;
  float rise = 1.0 - (1.0 - min(p * 2.5, 1.0)) * (1.0 - min(p * 2.5, 1.0));
  float pj = p < 0.38 ? (0.38 - p) / 0.38 : (p - 0.38) / 0.62, clip = jt * pj * pj;
  float h = aB.y * mix((0.3 + 0.7 * rise) * (1.0 - mix(0.4, 0.55, bl) * smoothstep(0.4, 1.0, p)), 1.0, jt);
  // (its atlas tile thins out towards its sides)
  float w = 1.15 * aB.x * mix((0.55 + 0.45 * sqrt(p)) * (1.0 + 0.15 * p), 1.2 + 0.8 * sqrt(p), jt);
  vec3 base = aA.xyz + vec3(0.0, -mix(0.35, 0.6, bl) * aB.y * p * p * (1.0 - jt), aC.w * age);
  // upright, and turned from the camera most of the way round to stand along its crest: turned square to the
  // camera, it would cross the breaking face behind it at a slant towards the sides of the view (more so where the
  // shore runs at an angle), and the face would cut it in slanting lines; it still never goes edge-on. Leant back
  // half-way towards a camera looking down.
  vec3 toC = cameraPosition - base;
  float lh = length(toC.xz);
  vec2 hc = lh > 1e-3 ? toC.xz / lh : aD;
  vec2 hd = normalize(hc + 3.0 * dot(hc, aD) * aD);
  float b = 0.5 * atan(toC.y, lh);
  vec3 up = vec3(-hd.x * sin(b), cos(b), -hd.y * sin(b));
  vec3 right = vec3(hd.y, 0.0, -hd.x) * aC.y;
  vec2 q = position.xy; // x -1..1, y 0..1
  // bowed out towards the camera in the middle, so that it has some depth as the view moves
  vec3 fw = vec3(hd.x, 0.0, hd.y);
  vec3 P = base + right * (0.5 * w * q.x) + up * (h * (q.y - clip)) - vec3(aD.x, 0.0, aD.y) * (aC.z * h * q.y * q.y)
    + fw * (0.12 * w * (1.0 - q.x * q.x));
  vUv = (vec2(0.5 + 0.5 * q.x, q.y) + vec2(mod(va, 2.0), floor(va * 0.5))) * 0.5;
  vBack = pow(max(dot(normalize(P - cameraPosition), uSunDir), 0.0), 3.0);
  // the sun in the plume's own frame (x across its picture, y up it, z out of it towards the camera), and the slope
  // of its rounded shape (up at its top and out at its sides), which bends the relief round
  vL = vec3(dot(uSunDir, right), dot(uSunDir, up), dot(uSunDir, vec3(hd.x * cos(b), sin(b), hd.y * cos(b))));
  vM = vec2(0.6 * q.x, 0.8 * q.y - 0.2);
  vQy = q.y;
  // a jet's own pattern (1..2; -1..-2 for the bore's line, 0 for the rest), its place across its picture in its
  // heights, and its age (see jet() and sline())
  float pat = 1.0 + fract(sin(aA.w * 12.9898 + aA.x * 0.7823) * 43758.5453);
  vJet = jt * pat - bl * (1.0 - jt) * pat;
  if (jt + bl > 0.5) vM = vec2(0.5 * w / max(h, 1e-3) * q.x, q.y);
  vJp = p;
  vDist = length(P - cameraPosition);
  // (the bore's line fades in and out more slowly: many overlap, and popping in within a few frames each they made
  // its white twinkle)
  vAlpha = abs(aB.w) * mix(smoothstep(0.0, 0.06 + 0.16 * bl, p), 1.0, jt) * (1.0 - smoothstep(mix(0.85 - 0.15 * bl, 0.8, jt), 1.0, p))
    * (1.0 - smoothstep(2000.0, 3500.0, lh)) * (1.0 - bl * smoothstep(0.1, 0.3, aB.y / max(lh, 1.0)));
  // it dissolves from the thin spray inwards over the later part of its life (a jet less: it is sinking anyway)
  vT = 0.08 + mix(mix(0.95, 0.45, bl) * smoothstep(0.35, 1.0, p), 0.5 * smoothstep(0.45, 1.0, p), jt);
  vClip = clip;
  vec4 cp = projectionMatrix * viewMatrix * vec4(P, 1.0);
  // its depth is taken a few units nearer the camera (less when looking down, where the water would stop hiding
  // its sunk foot): the breaking face it stands against leans past its plane here and there, and would cut it in
  // straight lines
  vec3 toP = P - cameraPosition;
  float dP = length(toP);
  vec4 cb = projectionMatrix * viewMatrix * vec4(P - toP * (min(0.3 * aB.y, 0.5 * dP) * (1.0 - 0.75 * abs(toP.y) / dP) / dP), 1.0);
  gl_Position = vec4(cp.xy, cb.z / cb.w * cp.w, cp.w);
}`;
// (shared by the plumes and the foam curtain: vT is how far it has dissolved, uStep one shadow step across the
// picture, 0.04 of its height, vClip how much of the picture is hidden under the water at its foot)
const SPLASH_FRAG = /* glsl */`
uniform sampler2D uPlume, uPlumeR;
uniform vec3 uHazeCol;
uniform float uHazeK;
uniform vec2 uStep;
varying vec2 vUv, vM;
varying vec3 vL;
varying float vT, vAlpha, vBack, vQy, vDist, vClip, vJet, vJp;
vec3 haze(vec3 col) {
  vec3 hz = linearToOutputTexel(vec4(toneMapping(uHazeCol * 1.55), 1.0)).rgb;
  return mix(col, hz, (1.0 - exp(-vDist * 0.00024)) * uHazeK);
}
// A jet (the bore's) is drawn here, not from the plume's picture, whose heaps of white lumps standing alone on the
// bore's top read as little clouds (Round 21): a fan of tapered streaks of water thrown up out of its foot, each
// ending in a drop, spreading as it rises and breaking up into drops as it falls back in. Its place in its heights
// (vM: x across, y up from its foot)
float jh(float n) { return fract(sin(n * 12.9898 + vJet * 78.233) * 43758.5453); }
// how much of a pixel at distance d from a line or drop of half-width r it covers (thinner than a pixel, it fades
// rather than breaking up into dashes)
float jcov(float d, float r, float aa) { return smoothstep(r + aa, max(r - aa, 0.0), d) * min(1.0, 2.0 * r / aa); }
vec4 jet() {
  float X = vM.x, Y = vM.y;
  float aa = 1.2 * max(fwidth(X), fwidth(Y)), a = 0.0;
  float spread = 0.7 + 0.9 * vJp, brk = smoothstep(0.35, 0.9, vJp);
  for (int i = 0; i < 9; i++) {
    float fi = float(i), s = (fi - 4.0) / 4.0 + 0.3 * (jh(fi) - 0.5);
    float top = 0.97 - 0.35 * abs(s) - 0.25 * jh(fi + 7.0), yt = clamp(Y / top, 0.0, 1.0);
    // its half-thickness, tapering up it; and a little wobble
    float th = mix(0.075, 0.013, pow(yt, 0.7)) * (1.0 - 0.3 * abs(s)) * (0.7 + 0.6 * jh(fi + 11.0));
    float xc = s * spread * (0.3 * Y + 0.6 * Y * Y) + 0.02 * yt * sin(Y * 17.0 + 6.283 * jh(fi + 5.0));
    float r = jcov(abs(X - xc), th, aa) * smoothstep(top, top - 0.06, Y) * (1.0 - 0.4 * yt);
    // breaking up into drops along its upper part as it falls
    r *= 1.0 - brk * smoothstep(0.25, 0.75, 0.5 + 0.5 * sin(Y * 40.0 + 6.283 * jh(fi + 3.0))) * smoothstep(0.15, 0.5, yt);
    a = max(a, r);
    // and drops flying on past its end
    for (int k = 0; k < 2; k++) {
      float yk = top + (0.04 + 0.08 * float(k)) * (0.5 + jh(fi + 13.0 + float(k)));
      float xk = s * spread * (0.3 * yk + 0.6 * yk * yk) + 0.05 * (jh(fi + 17.0 + float(k)) - 0.5);
      float dr = (0.014 + 0.012 * jh(fi + 19.0 + float(k))) * step(0.3, jh(fi + 23.0 + float(k)));
      a = max(a, 0.8 * jcov(length(vec2(X - xk, Y - yk)), dr, aa));
    }
  }
  // the sheet of white water it leaves the bore as, parting into its streaks
  float sw = 0.8 * spread * (0.3 * Y + 0.6 * Y * Y) + 0.07;
  a = max(a, jcov(abs(X), sw, aa) * (1.0 - smoothstep(0.08, 0.35, Y)));
  a *= vAlpha * smoothstep(vClip, vClip + 0.1, Y);
  if (a < 0.01) discard;
  // white water, a little paler on the side turned from the sun, glowing against it
  vec3 col = mix(vec3(0.8, 0.94, 0.97), vec3(1.0), clamp(0.75 + 0.25 * vL.y + 0.3 * sign(X) * vL.x, 0.0, 1.0));
  col = min(col + vec3(1.0, 0.95, 0.85) * vBack * 0.45, vec3(1.0));
  return vec4(haze(col), a);
}
// One of the dense line along a bore's front (Round 22), drawn as AoM's splash picture is painted: a ragged sheet of
// white water thrown up, crisp along its edge and flinging drops off it, with streaks fanning down from it into the
// white water it rose from; as it falls back the sheet tears and the streaks break into drops. (The plume's picture,
// a heap of soft lumps, read as a row of little clouds along the bore's top)
float h2(vec2 i) { return fract(sin(dot(i, vec2(127.1, 311.7)) + vJet * 7.13) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), f.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + 1.0), f.x), f.y);
}
vec4 sline() {
  float X = vM.x, Y = vM.y;
  float aa = 1.2 * max(fwidth(X), fwidth(Y)), brk = smoothstep(0.4, 0.95, vJp);
  // small on screen (far off), its tears and breaking streaks are only a pixel or two across and would twinkle as it
  // moves: they fade to their mean
  float lod = smoothstep(0.03, 0.09, aa);
  // the sheet: a low lumpy dome, crisp along its top, thinning out below into the streaks, torn more and more
  float yt = 0.94 - 1.1 * X * X + 0.05 * sin(X * 23.0 + 6.283 * jh(1.0)) + 0.035 * sin(X * 47.0 + 6.283 * jh(2.0));
  float th = 0.2 + 0.07 * sin(X * 17.0 + 6.283 * jh(3.0));
  float nv = vn(vec2(X * 9.0, Y * 7.0)), nw = fwidth(nv);
  // (Round 23) nothing is drawn beyond the sheet's dome and the drops over it, so those pixels go at once; and of the
  // eleven streaks (each with its drops) only the five nearest X are drawn: a streak's centre runs from x0 = 0.084
  // (i - 5) (+-0.025) at its top out to 1.45 x0 at its foot, its drops fly at 1.05-1.2 x0 over the sheet. All eleven,
  // with their hashes, for every pixel of hundreds of overlapping sprites cost as much as the water surface itself
  float ax = max(abs(X) - 0.03 - aa, 0.0);
  if (abs(X) > 0.97 + aa || Y > 1.2 - 1.1 * ax * ax + aa) discard;
  float tear = mix(smoothstep(0.2 + 0.6 * brk - nw, 0.3 + 0.6 * brk + nw, nv), 1.0 - smoothstep(0.1, 0.9, 0.25 + 0.6 * brk), lod);
  float a = smoothstep(yt + aa, yt - aa, Y) * smoothstep(yt - th - 0.12, yt - th, Y) * tear;
  float xe = X / 1.1, y0e = 0.86 - 1.1 * xe * xe;
  float m = Y > y0e ? 1.12 : 1.0 + 0.45 * clamp((y0e - Y) / max(y0e - 0.2, 0.05), 0.0, 1.0);
  int ic = int(floor(5.5 + X / (0.084 * m)));
  for (int j = -2; j <= 2; j++) {
    int i = ic + j;
    if (i < 0 || i > 10) continue;
    float fi = float(i), s = (fi - 5.0) / 5.0 + 0.12 * (jh(fi + 30.0) - 0.5);
    // from inside the sheet down to near the foot, fanning out as it falls, tapering, a little wavy
    float x0 = 0.42 * s, y0 = 0.86 - 1.1 * x0 * x0, yb = 0.05 + 0.3 * jh(fi + 31.0);
    float u = clamp((y0 - Y) / (y0 - yb), 0.0, 1.0);
    float xc = x0 * (1.0 + 0.45 * u) + 0.012 * sin(Y * 19.0 + 6.283 * jh(fi + 32.0));
    float tk = mix(0.032, 0.009, u) * (0.7 + 0.6 * jh(fi + 33.0));
    float r = jcov(abs(X - xc), tk, aa) * step(Y, y0) * smoothstep(yb - 0.04, yb + 0.04, Y);
    r *= 1.0 - brk * mix(smoothstep(0.25, 0.75, 0.5 + 0.5 * sin(Y * 45.0 + 6.283 * jh(fi + 34.0))), 0.5, lod) * smoothstep(0.15, 0.5, u);
    a = max(a, r);
    // and drops flung up off the sheet's edge above it
    for (int k = 0; k < 2; k++) {
      float xk = x0 * (1.05 + 0.15 * float(k)) + 0.06 * (jh(fi + 35.0 + float(k)) - 0.5);
      float yk = 0.94 - 1.1 * xk * xk + (0.03 + 0.07 * float(k)) * (0.5 + jh(fi + 37.0 + float(k))) + 0.08 * vJp;
      float dr = (0.012 + 0.012 * jh(fi + 39.0 + float(k))) * step(0.3, jh(fi + 41.0 + float(k)));
      a = max(a, 0.85 * jcov(length(vec2(X - xk, Y - yk)), dr, aa));
    }
  }
  a *= vAlpha * smoothstep(0.0, 0.25, Y);
  if (a < 0.01) discard;
  vec3 col = mix(vec3(0.8, 0.94, 0.97), vec3(1.0), clamp(0.8 + 0.2 * vL.y + 0.3 * sign(X) * vL.x, 0.0, 1.0));
  col = min(col + vec3(1.0, 0.95, 0.85) * vBack * 0.45, vec3(1.0));
  return vec4(haze(col), a);
}
void main() {
  if (vJet > 0.5) { gl_FragColor = jet(); return; }
  if (vJet < -0.5) { gl_FragColor = sline(); return; }
  vec4 t = texture2D(uPlume, vUv);
  // dissolved from the thin spray inwards up to vT, and its foot thinned out grain by grain towards the water,
  // which would otherwise cut it off in a straight line
  // (Round 21: Round 20's crisp edge and clear thin parts on the bore's white water drew an outline round it)
  float foot = smoothstep(vClip, vClip + 0.3 - 0.15 * vClip, vQy + 0.15 * (t.g - 0.5));
  float a = min(1.0, 1.25 * t.r) * smoothstep(vT - 0.12, vT + 0.06, t.g) * vAlpha * foot; // (its core solid white)
  if (a < 0.01) discard;
  // lit as the heap of lumps in its relief, bent round by its rounded shape: the sun wrapped a little round into the
  // side turned away from it, the sky from above, both shut out of the creases. Shaded in display colour, between
  // white and a pale sea-cyan (through the foam's tone curve every shade came out white and the plume flat), and kept
  // light even on its shadowed side, as AoM's foam is
  vec4 rl = texture2D(uPlumeR, vUv);
  vec2 sl = rl.xy * 2.0 - 1.0;
  vec3 n = normalize(vec3(sl + vM, sqrt(max(1.0 - dot(sl, sl), 0.04))));
  vec3 L = normalize(vL);
  float dif = clamp(dot(n, L) * 0.5 + 0.5, 0.0, 1.0);
#ifndef SOFT
  // and shadowed by the lumps between it and the sun: one step towards it across the picture, against how far the
  // sunbeam has risen out of the picture by then
  float lxy = max(length(L.xy), 0.25);
  float hs = texture2D(uPlumeR, vUv + L.xy / lxy * uStep).b;
  dif *= 1.0 - 0.35 * smoothstep(0.0, 0.03, (hs - rl.b) * 0.32 - 0.04 * L.z / lxy);
#endif
  // bright: white over most of it, its creases and shaded side only a little toward the pale cyan (AoM's foam is
  // pure white; shaded as before it came out a milky grey-cyan veil over the water)
  float lit = (0.85 + 0.1 * n.y + 0.4 * dif) * mix(0.6, 1.0, t.b);
  vec3 col = mix(vec3(0.76, 0.94, 0.97), vec3(1.0), clamp(lit - 0.05, 0.0, 1.0));
  // against the sun all of it glows a little with the light scattered through it, and its thin spray, the thin low
  // parts of its relief and the rims of its lumps on the sun's side more; and it takes the water's haze
  float dense = smoothstep(0.4, 0.9, t.r);
  float rim = smoothstep(0.25, 0.85, 1.0 - n.z) * clamp(dot(n.xy, L.xy) * 4.0, 0.0, 1.0);
  col = min(col + vec3(1.0, 0.95, 0.85) * vBack * (0.2 + 0.3 * (1.0 - dense) + 0.2 * (1.0 - rl.b) + 0.4 * rim), vec3(1.0));
  gl_FragColor = vec4(haze(col), a);
}`;
// The foam curtain (see FoamCurtain): one strip per crest slot and layer, position = (column, 0..1 up, slot + NS
// layer). Each column's state is read from uCur (NC columns; rows 2 slot: z, y of its foot, height, dissolve; 2 slot
// + 1: lean, alpha, strips per unit x, picture offset) and run smoothly through the columns (Catmull-Rom).
const CURTAIN_VERT = /* glsl */`
uniform float uTime, uX0, uDX;
uniform vec3 uSunDir;
uniform sampler2D uCur;
varying vec2 vUv, vM;
varying vec3 vL;
varying float vT, vAlpha, vBack, vQy, vDist, vClip, vJet, vJp;
vec4 tapC(int i, int r) { return texelFetch(uCur, ivec2(clamp(i, 0, NC - 1), r), 0); }
vec4 crom(vec4 a, vec4 b, vec4 c, vec4 d, float t) {
  return b + 0.5 * t * ((c - a) + t * ((2.0 * a - 5.0 * b + 4.0 * c - d) + t * (3.0 * (b - c) + d - a)));
}
vec4 cromD(vec4 a, vec4 b, vec4 c, vec4 d, float t) {
  return 0.5 * ((c - a) + 2.0 * t * (2.0 * a - 5.0 * b + 4.0 * c - d) + 3.0 * t * t * (3.0 * (b - c) + d - a));
}
void main() {
  float cc = position.x, v = position.y;
  int sl = int(position.z + 0.5), layer = sl / NS;
  sl -= layer * NS;
  int j = min(int(cc), NC - 2);
  float f = cc - float(j);
  vec4 a = tapC(j - 1, 2 * sl), b = tapC(j, 2 * sl), c = tapC(j + 1, 2 * sl), d = tapC(j + 2, 2 * sl);
  vec4 S = crom(a, b, c, d, f);
  float dzdx = cromD(a, b, c, d, f).x / uDX;
  vec4 Q = crom(tapC(j - 1, 2 * sl + 1), tapC(j, 2 * sl + 1), tapC(j + 1, 2 * sl + 1), tapC(j + 2, 2 * sl + 1), f);
  vClip = 0.0; vJet = 0.0; vJp = 0.0;
  // the crest line's horizontal normal (seaward) and tangent
  vec2 N = normalize(vec2(-dzdx, 1.0));
  vec3 N3 = vec3(N.x, 0.0, N.y), T3 = vec3(N.y, 0.0, -N.x);
  float x = uX0 + cc * uDX, h = S.z, side = 1.0, uO = Q.w;
  vec3 base = vec3(x, S.y, S.x);
  if (layer > 0) { h *= 0.85; side = -1.0; uO += 0.43; base += N3 * (0.3 * h); } // the back layer: mirrored, behind
  // upright along the crest, turned to face the camera's side of it and leant back half-way towards a camera
  // looking down (as the plumes)
  vec3 toC = cameraPosition - base;
  float lh = length(toC.xz);
  vec2 hd = dot(toC.xz, N) < 0.0 ? -N : N;
  float bb = 0.5 * atan(toC.y, lh);
  vec3 up = vec3(-hd.x * sin(bb), cos(bb), -hd.y * sin(bb));
  vec3 P = base + up * (h * v) - N3 * (Q.x * h * v * v);
  // the picture runs along the crest, one strip per 1 / iTW units, and slides slowly (each layer its own way)
  float u = side * (x * Q.z + uO) + side * 0.01 * uTime;
  // (a low curtain shows the picture's upper part, squashed a little, down to the slab that joins its billows)
  vUv = vec2(u, 1.0 - (1.0 - v) * clamp(h * Q.z * CASP, 0.7, 1.0));
  vBack = pow(max(dot(normalize(P - cameraPosition), uSunDir), 0.0), 3.0);
  vL = vec3(dot(uSunDir, T3 * side), dot(uSunDir, up), dot(uSunDir, vec3(hd.x * cos(bb), sin(bb), hd.y * cos(bb))));
  vM = vec2(0.0, 0.7 * v - 0.2);
  vQy = v;
  vDist = length(P - cameraPosition);
  vT = S.w;
  vAlpha = Q.y * smoothstep(0.3, 2.0, h) * (1.0 - smoothstep(2000.0, 3500.0, lh));
  vec4 cp = projectionMatrix * viewMatrix * vec4(P, 1.0);
  // its depth taken nearer the camera, as the plumes', and further: the lumps of the white water rolling in under it
  // would poke through it in grey islands, seen along the crest
  vec3 toP = P - cameraPosition;
  float dP = length(toP);
  vec4 cb = projectionMatrix * viewMatrix * vec4(P - toP * (min(0.7 * h, 0.5 * dP) * (1.0 - 0.5 * abs(toP.y) / dP) / dP), 1.0);
  gl_Position = vec4(cp.xy, cb.z / cb.w * cp.w, cp.w);
}`;

class Splashes {
  constructor(scene, uniforms, count, texSize, soft) {
    this.count = count;
    this.hi = -1; // the highest slot in use: only slots 0..hi are drawn
    this.now = 0;
    const plane = new THREE.PlaneGeometry(2, 1, 4, 2).translate(0, 0.5, 0); // (divided for the bow and the shading)
    const g = new THREE.InstancedBufferGeometry();
    g.index = plane.index;
    g.setAttribute('position', plane.getAttribute('position'));
    const attr = (n, init) => new THREE.InstancedBufferAttribute(new Float32Array(count * n).map((_, i) => init[i % n]), n)
      .setUsage(THREE.DynamicDrawUsage);
    this.a = attr(4, [0, 0, 0, -1e9]); // born long ago: dead
    this.b = attr(4, [1, 1, 1, 0]);
    this.c = attr(4, [0, 1, 0, 0]);
    this.d = attr(2, [0, 1]);
    g.setAttribute('aA', this.a); g.setAttribute('aB', this.b); g.setAttribute('aC', this.c); g.setAttribute('aD', this.d);
    g.instanceCount = 0;
    const { tex, rel } = plumeAtlas(texSize);
    this.tex = tex; this.rel = rel;
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      vertexShader: SPLASH_VERT, fragmentShader: SPLASH_FRAG,
      uniforms: { uTime: uniforms.uTime, uSunDir: uniforms.uSunDir, uHazeCol: uniforms.uHazeCol, uHazeK: uniforms.uHazeK,
        // (0.04 heights; a tile is half the atlas, 1.5 heights across)
        uPlume: { value: tex }, uPlumeR: { value: rel }, uStep: { value: new THREE.Vector2(0.0133, 0.02) } },
      defines: soft ? { SOFT: '' } : {},
      transparent: true, depthWrite: false, side: THREE.DoubleSide, // (a flipped plume is wound the other way)
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3; // over the foam and the spray
    scene.add(this.mesh);
  }
  add(x, y, z, w, h, birth, life, alpha, lean = 0, drift = 0, nx = 0, nz = 1, steady = false, bright = false) {
    // the lowest free slot (as in Decals); when the pool is full, the one ending soonest gives way
    const A = this.a.array, B = this.b.array, C = this.c.array, D = this.d.array;
    let i = -1, soonest = 0, end = Infinity;
    for (let j = 0; j <= this.hi; j++) {
      const e = A[j * 4 + 3] + B[j * 4 + 2];
      if (e <= this.now) { i = j; break; }
      if (e < end) { end = e; soonest = j; }
    }
    if (i < 0) i = this.hi + 1 < this.count ? this.hi + 1 : soonest;
    if (i > this.hi) { this.hi = i; this.mesh.geometry.instanceCount = i + 1; }
    A[i * 4] = x; A[i * 4 + 1] = y; A[i * 4 + 2] = z; A[i * 4 + 3] = birth;
    B[i * 4] = w; B[i * 4 + 1] = h; B[i * 4 + 2] = life; B[i * 4 + 3] = steady ? -alpha : alpha;
    C[i * 4] = Math.floor(Math.random() * 4) + (bright ? 4 : 0); C[i * 4 + 1] = Math.random() < 0.5 ? -1 : 1; C[i * 4 + 2] = lean; C[i * 4 + 3] = drift;
    D[i * 2] = nx; D[i * 2 + 1] = nz;
    this.a.needsUpdate = this.b.needsUpdate = this.c.needsUpdate = this.d.needsUpdate = true;
  }
  update(time) {
    this.now = time;
    const A = this.a.array, B = this.b.array;
    let hi = this.hi;
    while (hi >= 0 && A[hi * 4 + 3] + B[hi * 4 + 2] <= time) hi--;
    if (hi !== this.hi) { this.hi = hi; this.mesh.geometry.instanceCount = hi + 1; }
  }
  dispose(scene) {
    scene.remove(this.mesh);
    this.mesh.geometry.dispose(); this.mesh.material.dispose(); this.tex.dispose(); this.rel.dispose();
  }
}

// The white water a breaking wave throws up, as one unbroken curtain along each crest instead of separate plumes:
// it bursts up where the lip lands, travelling along the crest with the break as it peels, then settles into a
// lower band of tumbling foam riding the bore front all the way in to the shore. Each crest near the camera (up to
// ns at once, in slots by fn mod ns) gets one strip of the curtain picture, sampled every DX units along x round the
// camera and drawn through those samples, with a second, mirrored layer just behind it so that it has depth.
const CURTAIN_DX = 40;
class FoamCurtain {
  constructor(scene, uniforms, { half, ns = 4, sub, rows, layers, texV, soft }) {
    const nc = Math.round(2 * half / CURTAIN_DX) + 1;
    this.half = half; this.nc = nc; this.ns = ns;
    this.data = new Float32Array(nc * 2 * ns * 4);
    this.cur = new THREE.DataTexture(this.data, nc, 2 * ns, THREE.RGBAFormat, THREE.FloatType);
    this.cur.minFilter = this.cur.magFilter = THREE.NearestFilter;
    this.cur.generateMipmaps = false;
    this.cur.needsUpdate = true;
    const { tex, rel } = curtainTex(texV);
    this.tex = tex; this.rel = rel;
    this.material = new THREE.ShaderMaterial({
      vertexShader: CURTAIN_VERT, fragmentShader: SPLASH_FRAG,
      uniforms: { uTime: uniforms.uTime, uSunDir: uniforms.uSunDir, uHazeCol: uniforms.uHazeCol, uHazeK: uniforms.uHazeK,
        uPlume: { value: tex }, uPlumeR: { value: rel }, uStep: { value: new THREE.Vector2(0.04 / CURTAIN_ASP, 0.04) },
        uCur: { value: this.cur }, uX0: { value: 0 }, uDX: { value: CURTAIN_DX } },
      defines: Object.assign({ NC: String(nc), NS: String(ns), CASP: CURTAIN_ASP.toFixed(1) }, soft ? { SOFT: '' } : {}),
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    // one strip per slot and layer, so that they can be drawn far to near (see update)
    const nu = (nc - 1) * sub + 1, idx = [];
    for (let i = 0; i < nu - 1; i++) for (let k = 0; k < rows; k++) {
      const a = i * (rows + 1) + k, b = a + rows + 1;
      idx.push(a, b, a + 1, b, b + 1, a + 1);
    }
    const index = new THREE.BufferAttribute(new Uint16Array(idx), 1);
    this.strips = [];
    for (let l = 0; l < layers; l++) for (let s = 0; s < ns; s++) {
      const pos = new Float32Array(nu * (rows + 1) * 3);
      for (let i = 0, o = 0; i < nu; i++) for (let k = 0; k <= rows; k++, o += 3) {
        pos[o] = i / sub; pos[o + 1] = k / rows; pos[o + 2] = s + ns * l;
      }
      const g = new THREE.BufferGeometry();
      g.setIndex(index);
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      const m = new THREE.Mesh(g, this.material);
      m.frustumCulled = false;
      m.renderOrder = 3;
      m.userData = { s, l };
      scene.add(m);
      this.strips.push(m);
    }
    this.st = {}; this.w = {}; this.bf = {};
    this.far = new Float32Array(ns); // each slot's crest distance at the camera, for the drawing order
  }
  update(time, cx) {
    const { nc, ns, data, st, w, half } = this, x0 = Math.round(cx / CURTAIN_DX) * CURTAIN_DX - half, row = nc * 4;
    this.material.uniforms.uX0.value = x0;
    const jc = Math.round((cx - x0) / CURTAIN_DX);
    for (let j = 0; j < nc; j++) {
      const x = x0 + j * CURTAIN_DX, zs = shoreZ(x);
      const edge = 1 - sstep(half - 300, half - 20, Math.abs(x - cx));
      const nLo = Math.ceil(phaseAt(x, -20, time) / TAU);
      for (let s = 0; s < ns; s++) {
        const fn = nLo + (((s - nLo) % ns) + ns) % ns, dc = crestD(fn, x, time);
        const o = (2 * s * nc + j) * 4;
        if (j === jc) this.far[s] = dc;
        let z = zs + Math.min(Math.max(dc, -20), 640), y = 0, h = 0, T = 1, lean = 0, alpha = 0, iTW = 0.01, uO = 0;
        if (dc >= -20 && dc <= 640) {
          crestState(fn, x, dc, st);
          const tip = lipTip(st, dc), H = Math.min(st.H, 40), pC = st.pC;
          z = zs + tip.d;
          y = evalSurf(x, z, time, false, w).y - 0.12 * H;
          // it bursts up as the lip lands, to well over the crest (less where the shallows have shrunk the curl),
          // then settles into the band riding the bore
          const sigS = sstep(15, 45, dc), rise = sstep(0.8, 1.1, pC), burstW = rise * (1 - sstep(1.15, 2.1, pC));
          const hk = 1.8 * (0.7 + 0.3 * sigS);
          h = rise * H * (0.45 + (hk - 0.45) * (1 - sstep(1.15, 2.1, pC)));
          // where a wave dumps on the shore before its lip can land, the whole front slams down at once
          const dumpW = sstep(0.12, 0.35, pC) * (1 - sstep(1.0, 1.6, pC)) * sstep(0.15, 0.5, 1 - sigS);
          h = Math.max(h, 1.0 * H * dumpW) * sstep(5, 25, dc) * sstep(1.5, 3, H);
          const bw = Math.max(burstW, dumpW);
          T = 0.45 - 0.37 * bw; // thinned to its dense parts once the burst is over
          lean = 0.15 + 0.2 * burstW;
          alpha = (0.75 + 0.25 * bw) * edge;
          // once the roller rides the bore as a solid step the band stands just in front of its face (at the lip tip
          // it stood inside the white water, hidden, and poked through it here and there), from under the water
          // ahead of it to a little over its top: a ragged foam edge instead of the hard line the top drew against
          // the sea beyond
          const bT = sstep(1.4, 1.9, pC) * sstep(1.5, 3, H);
          if (bT > 0 && h > 0) {
            const f = boreFace(x, zs, tip.d, H, time, this.bf);
            const hb = (1.18 * (f.top - f.yb) + 0.12 * H) * sstep(5, 25, dc);
            z += (f.z - 0.6 - z) * bT; y += (f.yb - 0.12 * H - y) * bT; h += (hb - h) * bT;
            // (until the splash line along the bore's top takes over, p 1.9 -> 2.6: from above, the band read as a
            // smooth glassy sheet along the front)
            T += (0.3 - T) * bT; lean += (0.08 - lean) * bT; alpha += (0.92 * edge * (1 - sstep(1.9, 2.6, pC)) - alpha) * bT;
          }
          iTW = 1 / (4.2 * waveBaseHn(fn) * (st.outer ? SURF.outerGain : SURF.innerGain));
          uO = hash01(hashU(fn + 7777));
        }
        data[o] = z; data[o + 1] = y; data[o + 2] = h; data[o + 3] = T;
        data[o + row] = lean; data[o + row + 1] = alpha; data[o + row + 2] = iTW; data[o + row + 3] = uO;
      }
    }
    this.cur.needsUpdate = true;
    // far crests first, and each one's back layer before its front (they do not write depth)
    for (const m of this.strips) {
      const { s, l } = m.userData;
      let rank = 0;
      for (let k = 0; k < ns; k++) if (this.far[k] > this.far[s] || (this.far[k] === this.far[s] && k < s)) rank++;
      m.renderOrder = 3 + 0.01 * (rank * 2 + (l > 0 ? 0 : 1));
    }
  }
  dispose(scene) {
    for (const m of this.strips) { scene.remove(m); m.geometry.dispose(); }
    this.material.dispose(); this.cur.dispose(); this.tex.dispose(); this.rel.dispose();
  }
}

// ---------- looks ----------
// The water's display colour (linear 0..1) of a linear colour c, as drawn at the end of FRAG: c x 1.55 through
// three's ACES filmic curve (at the exposure 0.6, which cancels its /0.6).
function acesDisplay(c) {
  const v = c.map((x) => x * 1.55);
  const a = [0.59719 * v[0] + 0.35458 * v[1] + 0.04823 * v[2], 0.07600 * v[0] + 0.90834 * v[1] + 0.01566 * v[2],
    0.02840 * v[0] + 0.13383 * v[1] + 0.83777 * v[2]];
  const f = a.map((x) => (x * (x + 0.0245786) - 0.000090537) / (x * (0.983729 * x + 0.4329510) + 0.238081));
  return [1.60475 * f[0] - 0.53108 * f[1] - 0.07367 * f[2], -0.10208 * f[0] + 1.10813 * f[1] - 0.00605 * f[2],
    -0.00327 * f[0] - 0.07276 * f[1] + 1.07602 * f[2]].map((x) => Math.min(Math.max(x, 0), 1));
}
// the linear colour that the water draws as the display colour d (sRGB, 0..255): to tie the water's haze and the sand
// seen through it to colours on screen (the sky dome and the beach are drawn in those)
export function fromDisplay(d) {
  const t = d.map((x) => { const u = x / 255; return u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4; });
  let c = t.slice();
  for (let i = 0; i < 80; i++) {
    const o = acesDisplay(c);
    c = c.map((x, k) => Math.max(1e-4, x * (t[k] / Math.max(o[k], 1e-4)) ** 0.8));
  }
  return c.map((x) => +x.toFixed(4));
}
// 'aom' (the default) is the shiny cyan water of the owner's Age of Mythology setup (a water mod under the
// MenuArctic lighting): saturated cyan, clear shallows over pale sand, a darker band where the bottom drops away,
// dense embossed ripples and a broad white sun glare. 'classic' is the earlier natural surf-zone water.
// Colours are linear, before the water's x1.55 and the tone mapping; sigma is the extinction per metre;
// sun is [elevation, azimuth] in degrees (azimuth 0 = straight out to sea, +z); sky holds the Sky uniforms.
// bed is the dry sand as the water sees it (see BED in FRAG). Only in 'aom': skyGrad is the clear gradient sky dome that
// replaces the Sky shader (display sRGB, overhead and at the horizon) and sand the beach's tint (main.js createBeach;
// sand.display is the colour the tinted beach comes out on screen, which bed is derived from).
const AOM_SKY = { zenith: [160, 208, 244], horizon: [240, 247, 252] };
const AOM_SAND = [222, 244, 214];
export const LOOKS = {
  classic: {
    sun: [15, 0], sky: { turbidity: 8, rayleigh: 3, mieCoefficient: 0.005, mieDirectionalG: 0.7 },
    horizon: [0.80, 0.82, 0.82], zenith: [0.18, 0.45, 0.85], deep: [0.01, 0.17, 0.42], shallow: [0.03, 0.50, 0.62],
    shore: [0.05, 0.26, 0.24], sss: [0.06, 0.70, 0.72], sigma: [1.3, 0.75, 0.7],
    hazeCol: [0.80, 0.82, 0.82], hazeK: 0.85, dropCol: [1, 1, 1], drop: 0, specCol: [1.0, 0.97, 0.9],
    fresK: 1, fresMax: 1, glare: 0, ripple: 0, emboss: 0, wetDark: 0.6, vivid: 0, bed: BED_LIN, damp: [0.17, 0.13, 0.08], sandDisp: 0,
    ripScale: 1,
  },
  aom: {
    // the owner's preferred hazy sky and low sun out to sea (Round 10; Round 8-9 had a thin deep blue sky, sun [35, -45])
    sun: [15, 0], sky: { turbidity: 8, rayleigh: 3, mieCoefficient: 0.005, mieDirectionalG: 0.7 },
    // the reflected sky is tinted cyan, like AoM's shiny-water environment map
    horizon: [0.10, 0.75, 1.0], zenith: [0.05, 0.45, 0.9], deep: [0.0, 0.7, 1.05], shallow: [0.10, 0.80, 0.88],
    shore: [0.20, 0.55, 0.50], sss: [0.10, 0.85, 0.85], sigma: [0.55, 0.22, 0.20],
    hazeCol: fromDisplay(AOM_SKY.horizon), hazeK: 0.25, dropCol: [0.35, 0.55, 0.55], drop: 1, specCol: [1, 1, 1],
    // (Round 18: broader, stronger ripples, nearer the dark-teal chevrons of the owner's AoM shots)
    fresK: 0.65, fresMax: 0.55, glare: 1, ripple: 1.0, emboss: 1.0, ripScale: 0.55, wetDark: 0.85, vivid: 1,
    skyGrad: AOM_SKY, sand: { display: AOM_SAND, tint: [1.0, 1.7, 1.0], grade: [0.985, 1.043, 0.98], streak: 0.25 }, bed: fromDisplay(AOM_SAND),
    damp: [0.2, 0.24, 0.14], sandDisp: 1,
  },
};
const LOOK_V3 = { horizon: 'uHorizon', zenith: 'uZenith', deep: 'uDeep', shallow: 'uShallow', shore: 'uShore', sss: 'uSSS',
  sigma: 'uSigma', hazeCol: 'uHazeCol', dropCol: 'uDropCol', specCol: 'uSpecCol', bed: 'uBed', damp: 'uDamp' };
const LOOK_F = { fresK: 'uFresK', fresMax: 'uFresMax', hazeK: 'uHazeK', glare: 'uGlare', ripple: 'uRipple', emboss: 'uEmboss',
  drop: 'uDrop', wetDark: 'uWetDark', vivid: 'uVivid', sandDisp: 'uSandDisp', ripScale: 'uRipScale' };
function applyLook(u, L) {
  for (const [k, n] of Object.entries(LOOK_V3)) if (L[k]) u[n].value.fromArray(L[k]).multiplyScalar(k === 'sigma' ? 1 / 5.9 : 1);
  for (const [k, n] of Object.entries(LOOK_F)) if (L[k] != null) u[n].value = L[k];
}

// ---------- public API ----------
// quality: 'high', 'medium', 'low', or 'soft' for WebGL without a GPU, where the shaders run on the CPU and the
// water is bound by its vertex shader: the coarsest grid, facet normals (the vertex shader evaluates the surface
// once instead of three times) and plain trilinear filtering
export function createSurf(scene, { sunDir, quality = 'medium', rogueIn, look = 'aom' } = {}) {
  const soft = quality === 'soft';
  const loader = new THREE.TextureLoader();
  const normTex = loader.load('./textures/waternormals.jpg');
  normTex.wrapS = normTex.wrapT = THREE.RepeatWrapping;
  // the stretched ripples are sampled at grazing angles (clamped to the GPU's maximum); 4 looks the same as 8
  // here and keeps the de-tiled layers' doubled fetches cheap on GPUs short of texture throughput
  normTex.anisotropy = soft ? 1 : 4;

  const { geometries, vertices, ds: rowDs } = buildGeometry(quality);
  const uniforms = {
    uTime: { value: 0 },
    uRowF: { value: 0 },
    uSunDir: { value: (sunDir || new THREE.Vector3(0, 0.26, 0.97)).clone().normalize() },
    uNormTex: { value: normTex },
    uRogue: { value: new THREE.Vector3(-1e9, 0, 0) },
    uUnder: { value: new THREE.Vector4(0.47, 0.77, 0.94, 0) },
  };
  for (const n of Object.values(LOOK_V3)) uniforms[n] = { value: new THREE.Vector3() };
  for (const n of Object.values(LOOK_F)) uniforms[n] = { value: 0 };
  applyLook(uniforms, typeof look === 'string' ? LOOKS[look] || LOOKS.aom : look);
  const material = new THREE.ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms,
    defines: soft ? { FACETS: '', SOFT: '' } : {},
    side: THREE.DoubleSide,
    transparent: true,
  });
  // the tiles (see buildGeometry), in their order and first of the see-through things (the trails are drawn over it)
  const mesh = new THREE.Group();
  mesh.name = 'surf';
  geometries.forEach((g, k) => {
    const m = new THREE.Mesh(g, material);
    m.renderOrder = -0.5 + 1e-4 * k;
    mesh.add(m);
  });
  scene.add(mesh);

  const decals = new Decals(scene, uniforms, 1024);
  const spray = new Spray(scene, 6000, uniforms.uSunDir);
  // the plumes along a breaking lip (fewer and smaller pictures on the software tier)
  const splashes = new Splashes(scene, uniforms, soft ? 128 : 2048, soft ? 128 : 256, soft);
  // and the white water along the whole break (narrower, coarser and single-layered on the software tier)
  const curtain = new FoamCurtain(scene, uniforms, soft ? { half: 800, sub: 2, rows: 4, layers: 1, texV: 128, soft }
    : { half: 1600, sub: 4, rows: 6, layers: 2, texV: 256, soft });
  const st = {};
  let time = 0, emitAcc = 0;
  const rnd = (a, b) => a + Math.random() * (b - a);
  let nextRogue = rogueIn != null ? rogueIn : rnd(SURF.rogueMin, SURF.rogueMax);
  ROGUE.fn = -1e9; ROGUE.H = 0;
  // pick the crest now ~1400 units offshore (about 30 s out) and make it the rogue
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
        if (r.d > tip.d - 4 && r.d < dc - st.D + 2) { r.lipHit = { fn, H: st.H, kind: 'lip', yTop: 0.8 * st.H }; break; }
      } else if (st.p >= 1.6 && st.H > 4.5 && Math.abs(r.d - (dc - st.D)) < 5) {
        r.lipHit = { fn, H: st.H, kind: 'bore', yTop: 0.8 * st.H }; break;
      }
    }
    return r;
  }

  // spray sources found in one emission tick: kind, x, z, y, H, wanted count (flat, reused)
  const jobs = [];
  const LIFE = [0.6, 0.68, 0.75]; // mean particle life of each kind (lip spray, splash-up, bore drops), s
  // splash plumes found in one tick: kind (0 plunge, 1 shore dump, 2 bore jet, 3 bore line), x, crest fn, wanted count
  const pjobs = [];
  const PLIFE = [1.9, 1.65, 1.35, 1.0]; // mean plume life of each kind, s
  // how many of each kind still come as separate plumes, over the foam curtain (the lip's and the shore dump's
  // are all in the curtain; the bore's jets keep leaping up off its top all the way in, and its line along its front)
  const PACC = [0, 0, 1, 1];
  const _ps = {}, _pw = {}, _pf = {}, _sf = {};
  function emitSpray(dt, cx) {
    emitAcc += dt;
    if (emitAcc < 1 / 30) return;
    const step = emitAcc; emitAcc = 0;
    jobs.length = 0; pjobs.length = 0;
    let want = 0, pwant = 0;
    for (let x = Math.round(cx / 40) * 40 - 1600; x <= cx + 1600; x += 40) {
      const ex = x + (Math.random() - 0.5) * 40;
      const zs = shoreZ(ex);
      const k = step * 30 / (1 + Math.abs(ex - cx) / 700); // distant columns are small on screen: emit fewer
      // plumes are bigger, so they thin out more slowly with distance (on the software tier: only near the camera)
      const pk = soft ? (Math.abs(ex - cx) < 700 ? 0.5 * step : 0) : step / (1 + Math.abs(ex - cx) / 1000);
      const nLo = Math.ceil(phaseAt(ex, 15, time) / TAU), nHi = Math.floor(phaseAt(ex, 620, time) / TAU);
      for (let fn = nLo; fn <= nHi; fn++) {
        const dc = crestD(fn, ex, time);
        crestState(fn, ex, dc, st);
        const lip = st.p > 0.35 && st.p < 1.35, splash = st.p > 0.95 && st.p < 1.7 && st.H > 3 && st.sig > 0.3;
        const tip = lip || splash ? lipTip(st, dc) : null;
        // lip spray, thrown forward off the tip (Round 17: half the drops at 1.5x the size, so the lip stack thins)
        if (lip) { const n = Math.min(15, st.H * 0.45 * (0.5 + Math.random())) * k; jobs.push(0, ex, zs + tip.d, tip.y, st.H, n); want += n * LIFE[0]; }
        // splash-up: the landed lip throws a burst of white water up and forward from the plunge point
        if (splash) { const n = Math.min(9, st.H * 0.4 * (0.5 + Math.random())) * k; jobs.push(1, ex, zs + tip.d, 0, st.H, n); want += n * LIFE[1]; }
        // drops thrown up off the bore's top, arcing shoreward and falling back in (Round 20: in place of Round 17's
        // low sheet skimming its top, whose slow white flecks read as snow); passed its lip tip and speed
        if (st.p > 1.4 && st.p < 3.2 && st.H > 2) {
          const n = Math.min(12, st.H * 0.35 * Math.random() + 0.1) * sstep(1.4, 1.8, st.p) * k;
          jobs.push(2, ex, zs + lipTip(st, dc).d, TAU / kOf(dc) / SURF.period, st.H, n); want += n * LIFE[2];
        }
        // a line of splash plumes where the lip lands; where a wave dumps on the shore before its lip can land
        // (the shallows shrink its curl away: the plumes cover the collapse); and smaller ones off the bore front
        if (pk > 0 && st.H > 1.5) {
          const loss = 1 - sstep(15, 45, dc); // how much of the curl the shallows have taken
          let kind = -1, rate = 0;
          if (st.p > 0.85 && st.p < 1.5 && st.H > 3 && st.sig > 0.25) {
            kind = 0; rate = 5 * sstep(0.85, 0.95, st.p) * (1 - sstep(1.25, 1.5, st.p));
          } else if (st.p > 0.12 && st.p < 1.3 && st.H > 3 && loss > 0.15) {
            kind = 1; rate = 6 * sstep(0.12, 0.35, st.p) * (1 - sstep(1.0, 1.3, st.p)) * sstep(0.15, 0.5, loss);
          } else if (st.pC > 1.5 && dc > 4) {
            kind = 2; rate = 0.6 * sstep(1.5, 1.9, st.pC) * sstep(4, 15, dc) * sstep(1.5, 3, st.H);
          }
          if (kind >= 0) rate *= PACC[kind];
          if (rate > 0) { const n = rate * pk; pjobs.push(kind, ex, fn, n); pwant += n * PLIFE[kind]; }
          // and a dense line of bright plumes all along the bore's front, overlapping, each bursting up and falling
          // back into the white water as the next rises (Round 22: AoM's splash line, its technique only)
          if (st.pC > 1.4 && dc > 4) {
            const n = 12 * sstep(1.4, 1.8, st.pC) * sstep(4, 15, dc) * sstep(1.5, 3, st.H) * PACC[3] * pk;
            if (n > 0) { pjobs.push(3, ex, fn, n); pwant += n * PLIFE[3]; }
          }
        }
      }
    }
    // as with the spray: the plumes alive at once must fit in the pool
    const pscale = Math.min(1, 0.85 * splashes.count * step / Math.max(pwant, 1e-3));
    for (let j = 0; j < pjobs.length; j += 4) {
      const kind = pjobs[j], ex = pjobs[j + 1], fn = pjobs[j + 2];
      const n = Math.floor(pjobs[j + 3] * pscale + Math.random());
      for (let i = 0; i < n; i++) {
        const px = ex + rnd(-20, 20), dcx = crestD(fn, px, time);
        crestState(fn, px, dcx, _ps);
        const H = Math.min(_ps.H, 40), c = TAU / kOf(dcx) / SURF.period;
        let d, h, w, life, lean, drift, alpha;
        if (kind === 0) { // thrown up where the lip lands, higher than the crest, and carried shoreward with the bore
          d = lipTip(_ps, dcx).d + rnd(-1.5, 1.5);
          h = H * rnd(1.6, 2.1) * (0.7 + 0.3 * Math.min(_ps.sig, 1)); w = h * rnd(1.2, 1.6);
          life = rnd(1.5, 2.3); lean = rnd(0.15, 0.45); drift = -c * rnd(0.85, 1.0); alpha = rnd(0.85, 1);
        } else if (kind === 1) { // a shore dump: the whole front slams down just ahead of the crest
          d = dcx - _ps.D - H * rnd(0.2, 0.5);
          h = H * rnd(1.0, 1.4); w = h * rnd(1.3, 1.8);
          life = rnd(1.3, 2.0); lean = rnd(0.1, 0.3); drift = -c * rnd(0.3, 0.55); alpha = rnd(0.85, 1);
        } else if (kind === 2) { // a jet of white water leaping up out of the tumbling bore's top and falling back in, riding with it
          const f = boreFace(px, shoreZ(px), lipTip(_ps, dcx).d, H, time, _pf);
          d = f.z + (f.zt - f.z) * rnd(0.2, 0.6) - shoreZ(px);
          // (few and short-lived, each a splash of its own, breaking the bore's top line here and there)
          h = (f.top - f.yb) * rnd(0.5, 0.9) + 0.05 * H; w = h * rnd(0.9, 1.3);
          life = rnd(1.1, 1.6); lean = rnd(0.05, 0.3); drift = -c * rnd(0.95, 1.05); alpha = rnd(0.85, 1);
        } else { // the bore's line: standing on its face, its foot in the white water, its top over the bore's
          const f = boreFace(px, shoreZ(px), lipTip(_ps, dcx).d, H, time, _pf);
          d = f.z - shoreZ(px) - rnd(0, 1.0);
          // standing from half-way up it to well over its top: the bore's face is as white as they are, so only where
          // they break its top against the water behind it (and its front against the water ahead) do they show
          h = (f.top - f.yb) * rnd(0.6, 1.0) + 0.1 * H; w = h * rnd(0.9, 1.3);
          life = rnd(0.8, 1.2); lean = rnd(0.1, 0.35); drift = -c * rnd(0.95, 1.05); alpha = rnd(0.9, 1);
        }
        const pz = shoreZ(px) + d;
        // it stands along the crest line here: slope dz/dx of z = shoreZ(x) + crestD(fn, x, t)
        const sl = (shoreZ(px + 1) - shoreZ(px - 1) - (wobble(px + 1) - wobble(px - 1)) / kOf(dcx)) / 2 - SURF.kx / kOf(dcx);
        const nl = 1 / Math.sqrt(1 + sl * sl);
        const py = kind === 2 ? _pf.top - 0.04 * H : kind === 3 ? _pf.yb + 0.55 * (_pf.top - _pf.yb) : evalSurf(px, pz, time, false, _pw).y - 0.12 * H;
        splashes.add(px, py, pz, w, h, time, life, alpha, lean, drift, -sl * nl, nl, kind === 2, kind === 3);
      }
    }
    // the particles alive at once (rate x life) must fit in the pool: busy moments such as closeouts
    // thin out evenly instead of recycling particles before they have faded
    const scale = Math.min(1, 0.85 * spray.count * step / Math.max(want, 1e-3));
    for (let j = 0; j < jobs.length; j += 6) {
      const kind = jobs[j], ex = jobs[j + 1], ez = jobs[j + 2], ey = jobs[j + 3], H = jobs[j + 4];
      const n = Math.floor(jobs[j + 5] * scale + Math.random());
      for (let i = 0; i < n; i++) {
        const px = ex + (Math.random() - 0.5) * 40;
        // (Round 17: the drops are translucent streaks that shrink a little and are gone in under a second, not
        // swelling puffs: see SPRAY_FRAG)
        if (kind === 0) {
          spray.emit(px, ey + Math.random() * 2, ez + (Math.random() - 0.5) * 3,
            (Math.random() - 0.5) * 6, 8 + Math.random() * 14, -14 - Math.random() * 18,
            0.4 + Math.random() * 0.4, 1.8 + Math.random() * 2.4, 0.8, 0.75, -0.2);
        } else if (kind === 1) {
          const Hs = Math.min(H, 40);
          const vy = Math.sqrt(60 * Hs * (0.2 + 0.5 * Math.random())); // rises ~0.15-0.45 H (gravity 30, drag 1)
          const vz = Math.random() < 0.25 ? Math.random() * 7 : -6 - Math.random() * 18; // mostly shoreward
          spray.emit(px, Hs * (0.05 + 0.25 * Math.random()), ez + (Math.random() - 0.3) * 8,
            (Math.random() - 0.5) * 8, vy, vz,
            0.45 + Math.random() * 0.45, (3 + 4.5 * Math.random()) * (0.6 + 0.4 * Hs / 14), 1.0, 0.75, -0.2);
        } else { // off the bore's top, a little faster than it, rising 0.08-0.35 H and falling back in, fading as it sinks
          if (i === 0) boreFace(ex, shoreZ(ex), ez - shoreZ(ex), H, time, _sf);
          const Hs = Math.min(H, 40), vy = Math.sqrt(60 * Hs * (0.08 + 0.27 * Math.random()));
          const pz = _sf.z + shoreZ(px) - shoreZ(ex) + Math.random() * 0.4 * Hs;
          const py = _sf.yb + (_sf.top - _sf.yb) * (0.65 + 0.35 * Math.random());
          // (a few bigger, fainter ones: clear blobs of water among the white drops)
          const big = Math.random() < 0.25;
          spray.emit(px, py, pz, (Math.random() - 0.5) * 6, vy, -ey * (1.05 + 0.3 * Math.random()) - 2 * Math.random(),
            Math.min(0.95, 0.3 + 1.6 * vy / 30), big ? 2.6 + 1.6 * Math.random() : 1.2 + 1.4 * Math.random(), 0.4,
            big ? 0.45 : 0.8, -0.25, 0.2 * Hs + 1);
        }
      }
    }
  }

  // ---- foam left by things in the water (AoM-style rings, wakes and splashes) ----
  const _fw = {};
  // the water surface height at (x, z), or null where there is too little water to make foam
  function waterY(x, z) {
    const y = evalSurf(x, z, time, false, _fw).y;
    return y - bedHeight(x, z) > 0.6 ? y : null;
  }
  // something dropping into the water at (x, z): a churned white patch, rings spreading from it and (crown) a
  // ring of drops, a column thrown up and a low blossom of foam; strength ~1 for a spark. False where there is
  // no water. Each drop lives about as long as its flight (up and back down to the water).
  function splash(x, z, strength = 1, crown = true) {
    const y = waterY(x, z);
    if (y == null) return false;
    const s = strength, k = Math.sqrt(s);
    decals.add(x, z, 5 * s, rnd(0, TAU), time, 1.1 + 0.3 * k, 2, 1);
    decals.add(x, z, 10 * s, rnd(0, TAU), time, 1.6 + 0.4 * k, 0, 0.9);
    decals.add(x, z, 15 * s, rnd(0, TAU), time + 0.35, 1.8 + 0.4 * k, 0, 0.5); // a fainter second ring
    if (!crown) return true;
    const n = Math.round(12 + 12 * s);
    for (let i = 0; i < n; i++) {
      const a = (i + Math.random()) / n * TAU, v = rnd(4, 9) * k, vy = rnd(12, 20) * k;
      spray.emit(x + Math.cos(a) * s, y + 0.3, z + Math.sin(a) * s, Math.cos(a) * v, vy, Math.sin(a) * v,
        vy / 15 * rnd(0.8, 1.0), rnd(0.6, 1.2) * k, 0.8, 0.95);
    }
    for (let i = 0; i < 4 + 3 * s; i++) {
      const vy = rnd(20, 32) * k;
      spray.emit(x + rnd(-0.5, 0.5) * s, y + 0.2, z + rnd(-0.5, 0.5) * s, rnd(-1.5, 1.5), vy, rnd(-1.5, 1.5),
        vy / 15 * rnd(0.75, 0.95), rnd(1.2, 2.2) * k, 0.6, 0.95);
    }
    for (let i = 0; i < 3 + 2 * s; i++) {
      const a = rnd(0, TAU), v = rnd(2, 5) * k;
      spray.emit(x, y + 0.5, z, Math.cos(a) * v, rnd(3, 6), Math.sin(a) * v, rnd(0.8, 1.2), rnd(3, 5) * k, 2.5, 0.45);
    }
    return true;
  }
  // foam round a body in the water, called every frame with a state object the caller keeps for that body:
  // a white collar hugs it, rings spread from it now and then, puffs trail behind it as it moves, and a few
  // drops fly off its front at speed. (x, y, z) is where its feet are, r its radius, (vx, vz) its speed in
  // units per second.
  function wake(state, x, y, z, vx, vz, r, dt) {
    state.t = (state.t ?? rnd(0, 0.5)) - dt;
    state.c = (state.c || 0) - dt;
    const sp = Math.hypot(vx, vz), step = Math.max(2.5, 1.2 * r);
    state.d = (state.d || 0) + sp * dt;
    if (state.t > 0 && state.c > 0 && state.d < step) return;
    const wy = waterY(x, z);
    // only where the water surface is between a little below its feet (a ghost glides level while the troughs
    // pass under it) and its top
    if (wy == null || wy < y - 4 || wy > y + 3 * r) { state.t = state.c = 0.15; state.d = 0; return; }
    if (state.c <= 0) { // a white collar of foam round it, carried along at its speed so the four alive at once
      // stay on it, its shadow side (+x) turned away from the sun
      state.c = 0.1;
      const sd = uniforms.uSunDir.value;
      decals.add(x, z, r * 1.6, Math.atan2(-sd.z, -sd.x), time, rnd(0.35, 0.45), 3, 1, 1, vx, vz);
    }
    if (state.t <= 0) {
      state.t = rnd(0.5, 0.75) * (sp > 3 ? 1.6 : 1); // fewer while it moves: the puffs carry the wake
      decals.add(x, z, r * rnd(1.8, 2.3), rnd(0, TAU), time, rnd(1.2, 1.6), 0, 0.8);
    }
    if (state.d >= step) {
      state.d = 0;
      const ux = vx / (sp || 1), uz = vz / (sp || 1), side = rnd(-0.5, 0.5) * r;
      decals.add(x - ux * r * 0.9 - uz * side, z - uz * r * 0.9 + ux * side, r * rnd(1.0, 1.3), Math.atan2(uz, ux), time,
        rnd(1.3, 1.8), 1, 0.5, 1.6);
      if (sp > 6) {
        for (let i = 0; i < 2; i++) {
          spray.emit(x + ux * r * 0.8 + rnd(-1, 1), wy + 0.3, z + uz * r * 0.8 + rnd(-1, 1),
            ux * sp * 0.4 + rnd(-2, 2), rnd(5, 10), uz * sp * 0.4 + rnd(-2, 2), rnd(0.4, 0.7), rnd(0.5, 0.9), 1.2, 0.7);
        }
      }
    }
  }

  return {
    mesh, material, vertices, curtain,
    get time() { return time; },
    update(dt, cameraX = 0) {
      time += dt;
      material.uniforms.uTime.value = time;
      material.uniforms.uRowF.value = (OMEGA * time / rowDs) % 1;
      if (time >= nextRogue) { spawnRogue(cameraX); nextRogue = time + rnd(SURF.rogueMin, SURF.rogueMax); }
      emitSpray(dt, cameraX);
      spray.update(dt);
      decals.update(time);
      splashes.update(time);
      curtain.update(time, cameraX);
    },
    sample, waterY, splash, wake,
    // one foam decal: kind 0 ring, 1 puff (stretched along rot), 2 churned patch, 3 collar; size in units, life in s
    foam(x, z, kind, size, life, alpha = 1, rot = rnd(0, TAU), stretch = 1) { decals.add(x, z, size, rot, time, life, kind, alpha, stretch); },
    // the current rogue wave: crest distance from the shore at x (null when none is on its way in)
    rogue(x = ROGUE.x) {
      if (ROGUE.H <= 0) return null;
      const dc = crestD(ROGUE.fn, x, time);
      return dc > -40 ? { fn: ROGUE.fn, d: dc, H: ROGUE.H, x: ROGUE.x, next: nextRogue - time } : null;
    },
    triggerRogue(cx = 0) { spawnRogue(cx); },
    // the eye is under the water: the underwater fog density (0 above the water) and its colour (display sRGB 0-1)
    setUnder(density, rgb) { const u = material.uniforms.uUnder.value; u.w = density; if (rgb) u.set(rgb[0], rgb[1], rgb[2], density); },
    // switch or tune the look: a LOOKS name, or an object with any of its fields
    setLook(L) { applyLook(material.uniforms, typeof L === 'string' ? LOOKS[L] : L); },
    dispose() {
      scene.remove(mesh); scene.remove(spray.points); decals.dispose(scene); splashes.dispose(scene); curtain.dispose(scene);
      geometries.forEach(g => g.dispose()); material.dispose();
      spray.points.geometry.dispose(); spray.points.material.dispose();
    },
  };
}
