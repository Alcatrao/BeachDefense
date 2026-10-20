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
  o.bore = sstep(0.95, 2.0, p); // the crash spends the wave's height quickly: bore height by p ~ 2
  // ... and near the sand in any case: a closeout that broke late (db ~ 40) would still be ~9 high when its crest
  // reaches the waterline, where the land clamp cuts its face off into a wall standing on the sand
  o.bore = 1 - (1 - o.bore) * (1 - sstep(16, 3, dc));
  o.H = Hpre + (Hbore - Hpre) * o.bore;
  // the landed lip keeps the shape of the wave that threw it (Hc) and is squashed down to the bore height H,
  // so it collapses into a low roller; the shape relaxes to the bore's own over p 2.6..5
  o.Hc = o.H + (Hpre - o.H) * (1 - sstep(2.6, 5.0, p));
  o.steep = sstep(-1.6, 0.9, p);
  // the lip only ever rolls further: after landing it turns over into the roller and never unrolls into a tube again
  o.thetaMax = 2.7 * sstep(0, 1.15, p) + 0.35 * sstep(1.1, 1.9, p);
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
  o.H = m(A.H, B.H); o.Hc = Math.max(m(A.Hc, B.Hc), 1e-3); o.bore = m(A.bore, B.bore); o.steep = m(A.steep, B.steep);
  o.pc = m(A.pc, B.pc);
  // the outer whitewater roller keeps rolling and shrinks away over the trough (sig = roller size, crest d 226 -> 199)
  // before the inner bar's own curl can start (that needs dc < innerMax + 12 = 197)
  const sA = A.p > 0 ? sstep(SURF.reform1 - 1, SURF.reform0 - 2, dc) : 0;
  const cur = sA > 0 ? A : B; // the stage whose curl is in charge
  o.thetaMax = cur.thetaMax;
  // once the lip has landed the tube collapses: the roller shrinks to a small one riding the bore front
  // (p 1.0 -> 1.9), and shrinks away before reaching the sand
  const sAp = sA > 0 ? sA : 1, sigS = sstep(15, 45, dc), sigP = 1 - 0.6 * sstep(1.0, 1.9, cur.p);
  o.sig = sAp * sigS * sigP;
  o.imp = m(impOf(A.p), impOf(B.p));
  // and the tube's air pocket closes (p 1.05 -> 1.5): the roller becomes one solid tumbling mass (see evalSurf)
  o.fill = sstep(1.05, 1.5, cur.p);
  o.pC = cur.p; // the stage of the curl in charge
  o.D = surgeOf(o, sAp * Math.min(Math.max((dc + 15) / 60, 0), 1), sigS * sigP, TAU / kOf(dc));
  return o;
}
// How far the wave is carried forward while it breaks (mirrored in GLSL). Rotating past its turn-over angle
// (atan2(Y, X) from straight back) and the roller shrinking (sigS sigP) would pull the lip tip back towards the
// crest, which reads as the breaking wave rolling backwards: the wave moves forward by that much instead (evalSurf
// shifts it by D), so the tip keeps its furthest reach and the front never slows below the crest's own speed.
// keep: how much of that reach is kept; it is let go evenly over crest d 45 -> -15, much slower than the crest
// moves, so the bore still meets the swash at the shoreline. The outer roller's own fade (sA) is not carried.
function surgeOf(w, keep, shrink, L) {
  const sh = Math.max(w.steep, w.bore), Hc = w.Hc;
  const wc = Math.min(L * (0.13 - 0.095 * sh), 0.32 * Hc);
  const X = 0.5 * wc + 0.12 * Hc * w.pc, Y = 0.62 * Hc; // the lip tip from the pivot, before it turns
  const th = Math.max(w.thetaMax, Math.PI - Math.atan2(Y, X));
  return Math.min(keep * (shrink * (-X * (1 - Math.cos(th)) - Y * Math.sin(th)) + X + Math.hypot(X, Y)), 0.2 * L);
}
// impact whitewater of one stage: from the moment the lip lands (p ~ 0.9) until the bore has taken over
function impOf(p) { return sstep(0.9, 1.2, p) * (1 - sstep(3, 5, p)); }
// lumps of the tumbling whitewater mass, about -1..1 (mirrored in GLSL)
function rollerLumps(x, u, fn, t) {
  return 0.5 * Math.sin(x * 0.043 + u * 0.12 + 2.2 * t + fn * 1.7) + 0.35 * Math.sin(-x * 0.079 + u * 0.19 + 3.1 * t + fn * 0.9)
    + 0.25 * Math.sin(x * 0.131 - u * 0.09 + 4.3 * t) + 0.2 * Math.sin(x * 0.17 + u * 0.21 + 5.2 * t + fn);
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
  const bump = s2 < 0 ? nGauss(s2, wf, L) : nGauss(s2, wb, L);
  // trough level: towards a crest-independent level near psi = +-0.5, so the trough behind one wave
  // meets the trough ahead of the next without a step (each crest's own -0.2 H differs)
  const tw = sstep(0.25, 0.5, Math.abs(psi));
  const tgt = 0.45 * SURF.Hbase * sstep(20, 120, d);
  const Ht = H + (tgt - H) * tw;
  let y = H * bump - 0.2 * Ht;
  let dA = dc + s2;

  // curl, shaped at the height Hc and squashed to H (see stageState); a roller of relative size sig is the
  // full-size curl displacement taken at u = s2 / sig and scaled by sig, so it shrinks without unrolling.
  // Below 0.8 of full size its front and back are widened in u (kw), so it never spans fewer mesh rows than at
  // 0.8: a narrower roller spans too few rows and renders as spikes where the crest crosses the rows obliquely
  // (the mesh rows follow the crests only inside |x| 1000, see buildGeometry).
  const Hc = w.Hc, Htc = Hc + (tgt - Hc) * tw, sig = w.sig;
  const pivY = 0.18 * Hc, topY = 0.8 * Hc, wc = Math.min(wf, 0.32 * Hc);
  const u = s2 / Math.max(sig, 1e-3);
  const kw = Math.max(1, 0.8 / Math.max(sig, 0.05)), wfk = wf * kw;
  const yv = Hc * (u < 0 ? nGauss(u, wfk, L) : nGauss(u, wb, L)) - 0.2 * Htc;
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

// ---------- GLSL ----------
const GLSL_COMMON = /* glsl */`
#define TAU 6.28318530718
float gDrift; // set by surfPos: how far the swash has carried its foam up the beach (for foam texturing only)
vec2 gCrest;  // set by surfPos: position across the crest (s2) and a mask that is 1 near the crest (foam texturing only)
vec3 gBrk;    // set by surfPos: the breaker's own texture frame and its weight (see the end of surfPos)
bool gFlat = false; // set before surfPos: no crest bunching and no curl, so (x, z) stays put (JS evalSurf with curl false)
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
struct WS { float H; float Hc; float p; float bore; float steep; float th; float pc; float l1; float l2; float cap; float chop; };
WS stageS(float Hn, float db, float db0, float boreK, float dc) {
  WS w;
  float p = (db - dc) / BSPAN;
  float shoal = 0.55 + 0.45 * sstep(db0 + 420.0, db0, dc);
  float Hpre = Hn * shoal * (1.0 + 0.12 * sstep(0.0, 1.0, p));
  float depthC = max(SLOPE * dc - 0.5, 0.3);
  float Hbore = min(Hn, boreK * depthC + 0.8);
  w.p = p;
  w.bore = 1.0 - (1.0 - sstep(0.95, 2.0, p)) * (1.0 - sstep(16.0, 3.0, dc)); // a bore by the sand in any case
  w.H = mix(Hpre, Hbore, w.bore);
  w.Hc = mix(w.H, Hpre, 1.0 - sstep(2.6, 5.0, p)); // shape height of the collapsing curl (see stageState)
  w.steep = sstep(-1.6, 0.9, p);
  w.th = 2.7 * sstep(0.0, 1.15, p) + 0.35 * sstep(1.1, 1.9, p); // never unrolls
  w.pc = clamp(p, 0.0, 1.0);
  w.l1 = sstep(0.25, 0.9, p); w.l2 = sstep(0.9, 1.6, p); w.cap = sstep(-3.0, -1.0, p); w.chop = sstep(-0.5, 0.5, p);
  return w;
}
float nGauss(float x, float w, float L) {
  float e = exp(-pow(0.5 * L / w, 2.0));
  return (exp(-pow(x / w, 2.0)) - e) / (1.0 - e);
}
// impact whitewater of one stage: from the moment the lip lands (p ~ 0.9) until the bore has taken over
float impOf(float p) { return sstep(0.9, 1.2, p) * (1.0 - sstep(3.0, 5.0, p)); }
// lumps of the tumbling whitewater mass, about -1..1 (mirrored in JS): they roll forward over the roller and boil;
// wavelengths of at least ~8 grid cells so the mesh can follow them
float rollerLumps(float x, float u, float fn) {
  float t = uTime;
  return 0.5 * sin(x * 0.043 + u * 0.12 + 2.2 * t + fn * 1.7) + 0.35 * sin(-x * 0.079 + u * 0.19 + 3.1 * t + fn * 0.9)
    + 0.25 * sin(x * 0.131 - u * 0.09 + 4.3 * t) + 0.2 * sin(x * 0.17 + u * 0.21 + 5.2 * t + fn);
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
  float Hc = max(mix(A.Hc, B.Hc, wB), 1e-3);
  float bore = mix(A.bore, B.bore, wB);
  float steep = mix(A.steep, B.steep, wB);
  // the outer roller shrinks away over the trough without unrolling, then the inner bar's curl takes over
  float sA = A.p > 0.0 ? sstep(REF1 - 1.0, REF0 - 2.0, dc) : 0.0;
  float thetaMax = sA > 0.0 ? A.th : B.th;
  float pC = sA > 0.0 ? A.p : B.p; // the stage of the curl in charge
  float sAp = sA > 0.0 ? sA : 1.0, sigS = sstep(15.0, 45.0, dc), sigP = 1.0 - 0.6 * sstep(1.0, 1.9, pC);
  float sig = sAp * sigS * sigP; // collapsing tube
  float fillT = sstep(1.05, 1.5, pC); // ... whose air pocket closes into a solid roller
  float pc = mix(A.pc, B.pc, wB);
  float lip1 = mix(A.l1, B.l1, wB), lip2 = mix(A.l2, B.l2, wB), capP = mix(A.cap, B.cap, wB), chopP = mix(A.chop, B.chop, wB);
  float dbz = outer ? mix(dbA, db0, wB) : db0;
  float sh = max(steep, bore);
  { // the breaking wave carried forward by D, near its crest (surgeOf / evalSurf in JS)
    float Ls = TAU / kOf(dc), wcD = min(Ls * mix(0.13, 0.035, sh), 0.32 * Hc);
    float X = 0.5 * wcD + 0.12 * Hc * pc, Y = 0.62 * Hc, th = max(thetaMax, atan(Y, -X));
    float keep = sAp * clamp((dc + 15.0) / 60.0, 0.0, 1.0);
    float D = min(keep * (sigS * sigP * (-X * (1.0 - cos(th)) - Y * sin(th)) + X + length(vec2(X, Y))), 0.2 * Ls);
    s += D * (1.0 - sstep(0.1, 0.45, abs(psi)));
    psi = s / L; dc = d - s;
  }

  float ah = min(QQ * (0.6 + 0.4 * sh) * L / TAU, 1.5 * H);
  float s2 = gFlat ? s : s - ah * sin(TAU * psi);
  gCrest = vec2(s2, 1.0 - sstep(0.3, 0.42, abs(psi))); // 0 where the crest index changes (no seam)
  float wf = L * mix(0.13, 0.035, sh);
  float wb = L * mix(0.2, 0.32, bore);
  float bump = s2 < 0.0 ? nGauss(s2, wf, L) : nGauss(s2, wb, L);
  float tgt = 0.45 * HBASE * sstep(20.0, 120.0, d), tw = sstep(0.25, 0.5, abs(psi));
  float Ht = mix(H, tgt, tw);
  float y = H * bump - 0.2 * Ht;
  float dA = dc + s2;

  // curl shaped at Hc, squashed to H; a roller of size sig = full-size curl displacement at u = s2 / sig, times sig.
  // Below sig 0.8 its front and back widen in u (kw): a roller spanning fewer mesh rows spikes where the crest crosses them obliquely
  float Htc = mix(Hc, tgt, tw);
  float pivY = 0.18 * Hc, topY = 0.8 * Hc, wc = min(wf, 0.32 * Hc);
  float u = s2 / max(sig, 1e-3);
  float kw = max(1.0, 0.8 / max(sig, 0.05)), wfk = wf * kw;
  float yv = Hc * (u < 0.0 ? nGauss(u, wfk, L) : nGauss(u, wb, L)) - 0.2 * Htc;
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
    y += (ym - y) * k; dA += (d - dA) * k * hm * (1.0 - wm); // pulling the step back to rest would lean it
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
  // the bore: a solid white tumbling front down to the toe of its face, thick foam for a while behind it, then lace
  float fBore = bore * (0.18 + 0.32 * (1.0 - sstep(0.0, 0.9 * L, s2))
    + 0.85 * sstep(-2.4 * wf, -1.0 * wf, s2) * (1.0 - sstep(0.05 * L, 0.35 * L, s2)));
  // impact: once the lip lands, the roller, the face it plunged into and the splash-up over the back turn white
  // (above 1 the foam is thicker and fully opaque; the roller zone shrinks with the roller, sig, while the face
  // stays white down to its toe).
  // The whitewater spreads from the landing tip up over the whole curtain by p ~ 1.2, so no clear water is left
  // on the collapsing roller.
  float spread =mix(sstep(0.88, 1.22, A.p), sstep(0.88, 1.22, B.p), wB);
  float roll = sstep(0.75 * (1.0 - spread), 0.75 * (1.0 - spread) + 0.25, sqrt(hw) * bw);
  float fImp = imp * max(1.5 * max(roll, s2 < 0.0 ? sstep(-2.4 * wf, -1.0 * wf, s2) : 0.0),
    s2 > 0.0 ? 0.9 * (1.0 - sstep(0.0, 0.4 * L, s2)) : 0.0);
  // a closeout near the sand: its roller shrinks away with the depth (sig, crest d 45 -> 15) before or just after
  // its lip lands, which in clear water reads as the curl rolling back. So the shrinking roller turns to
  // whitewater, which spills down the face as the roller goes (down to the toe once it is gone): the curl
  // collapses into foam
  float loss = 1.0 - sstep(15.0, 45.0, dc);
  float fCol = sstep(0.08, 0.35, loss) * sstep(0.05, 0.4, pC) * (1.0 - sstep(3.0, 5.0, pC))
    * max(1.5 * sstep(0.3, 0.65, sqrt(hw) * bw), s2 < 0.0 ? 1.3 * sstep(-(0.5 + 1.6 * loss) * wf - 3.0, -(0.5 + 1.6 * loss) * wf, s2) : 0.0);
  float fZone = 0.22 * sstep(dbz + 30.0, dbz - 60.0, d) * (0.5 + 0.5 * sin(x * 0.013 + z * 0.021 + fn));
  float fCap = 0.25 * sstep(0.85, 1.0, bump) * capP;
  // residual foam left behind by broken waves: thins out as it ages (behind this crest, or the previous one)
  float ageB = s2 > 0.0 ? s2 / L : 1.0 + s2 / L;  // ~time since a crest passed, in wave periods
  float zoneIn = max(sstep(dbz + 10.0, dbz - 50.0, d), 0.7 * sstep(BAROUT + 10.0, BAROUT - 50.0, d) * sstep(REF1 - 40.0, REF0, d));
  float broke = s2 > 0.0 ? max(bore, lip2) : 1.0;
  float fRes = zoneIn * broke * (0.14 + 0.6 * exp(-3.0 * ageB));
  foam = clamp(max(max(max(fLip, fFace), max(fBore, fZone)), max(max(fCap, fRes), max(fImp, fCol))) * filmP, 0.0, 1.6);
  foam = max(foam, wet);
  float young = max(max(max(fLip, fBore * (1.0 - sstep(0.0, 0.3 * L, s2))), fFace), max(fImp, fCol));
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
varying float vSand;
varying float vAge;
varying float vLand;
varying vec2 vRest;
varying vec2 vCrest;
varying vec3 vBrk;
void main() {
  float f, th, wt, sw, ag, f1, t1, w1, s1, a1;
  vec2 xz = position.xz;
  vec3 P = surfPos(xz, f, th, wt, sw, ag);
  float drift = gDrift;
  vCrest = gCrest;
  vBrk = gBrk;
#ifdef FACETS
  vNrm = vec3(0.0, 1.0, 0.0); // unused: the fragment shader takes each facet's own normal
#else
  // normal from offsets near the grid spacing (x 4.7, z 1.75): no shading detail the mesh cannot follow
  vec3 P1 = surfPos(xz + vec2(1.8, 0.0), f1, t1, w1, s1, a1);
  vec3 P2 = surfPos(xz + vec2(0.0, 1.0), f1, t1, w1, s1, a1);
  vec3 n = cross(P2 - P, P1 - P);
  vNrm = length(n) > 1e-6 ? normalize(n) : vec3(0.0, 1.0, 0.0);
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
uniform vec3 uHorizon, uZenith, uDeep, uShallow, uShore, uSSS, uSigma, uHazeCol, uDropCol, uSpecCol;
uniform float uFresK, uFresMax, uHazeK, uGlare, uRipple, uEmboss, uDrop, uWetDark, uVivid;
varying vec3 vWorld;
varying vec3 vNrm;
varying float vFoam;
varying float vThin;
varying float vDepth;
varying float vSand;
varying float vAge;
varying float vLand;
varying vec2 vRest;
varying vec2 vCrest;
varying vec3 vBrk;

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
  float C = clamp(fa * (0.75 + 0.5 * ft), 0.04, 0.97 + 0.025 * smoothstep(1.0, 1.5, fa)); // target coverage, lumpier with the texture; thick foam closes up
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
// billowing lumps (sum of |noise| octaves, with a soft fold so the creases are not black hairlines),
// boiling as the octaves drift apart; k3 fades the finest octave to its mean
float sabs(float v) { return sqrt(v * v + 0.02); }
float billow(vec2 q, float t, float k3) {
  float b1 = sabs(2.0 * vnoise(q + vec2(0.0, 0.17 * t)) - 1.0);
  float b2 = sabs(2.0 * vnoise(ROT * q * 2.1 + vec2(3.7 + 0.31 * t, 1.3)) - 1.0);
  float b3 = sabs(2.0 * vnoise(ROT * ROT * q * 4.4 + vec2(5.1, 2.6 - 0.5 * t)) - 1.0);
  return 0.5 * b1 + 0.32 * b2 + 0.18 * mix(0.33, b3, k3);
}

const vec3 BED = vec3(${BED_LIN.map((v) => v.toFixed(4)).join(', ')}); // the dry sand as rendered (linear, before the x1.55)
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
  mat2 MA = mat2(0.035, 0.0, 0.0, 0.13) * RIPA, MB = mat2(0.03, 0.0, 0.0, 0.11) * RIPB; // turned, then stretched
  vec3 q1 = normNT(MA * w + vec2(0.0, 0.05) * uTime, MA * cx, MA * cy, 7.1);
  vec3 q2 = normNT(MB * w + vec2(0.31, 0.04) * uTime, MB * cx, MB * cy, 1.9);
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

  // detail normals
  vec2 uv = vWorld.xz, ux = dFdx(uv), uy = dFdy(uv);
  // cat's paws: the wind roughens the sea in large drifting patches, so the ripples are not one uniform weave
  float paw = smoothstep(0.2, 0.8, 0.6 * vnoise(ROT * uv * 0.0042 + vec2(0.0, 0.02) * uTime) + 0.4 * vnoise(uv * 0.0117 - vec2(0.015, 0.0) * uTime));
  vec2 dn = detailSlope(uv, ux, uy);
  float detail = 0.32 * (0.7 + 0.6 * paw) * (1.0 - smoothstep(250.0, 3500.0, dist));
  vec3 dN = vec3(dn.x, 0.0, dn.y) * detail;
  if (wK > 0.0) { vec2 db = detailSlope(qb, qx, qy); dN = mix(dN, (Tq * db.x + Bq * db.y) * detail, wK); }
  vec3 Nb = normalize(N + dN); // the surface the ripples ride on: the emboss below shades them relative to it
  // the ripples, which fade out before they would shimmer
  float rk = uRipple * (0.45 + 0.9 * paw) * (1.0 - smoothstep(150.0, 1100.0, dist));
  if (rk > 0.0) {
#ifndef SOFT
    rk *= 0.4 + 1.2 * smoothstep(0.15, 0.85, vnoise(ROT * uv * 0.035 + 1.7)); // stronger and weaker in patches a few tens of units across
#endif
    vec2 g = wK < 1.0 ? rippleSlope(ripWarp(uv), ux, uy) : vec2(0.0);
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
  float aer = smoothstep(0.7, 1.3, vFoam) * (1.0 - vAge);
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
  vec3 P = (1.0 - F) * (body * (1.0 - T) + Tw * caus * BED) + F * sky + spec * (1.0 - 0.6 * min(vFoam, 1.0));
  vec3 W = (1.0 - F) * Tw;

  // foam: a sheet of bubbles whose thickness sets how opaque and how white it is; thin foam is a translucent
  // film tinted by the water, thick foam scatters to bright white, with blue-grey crevices between the lumps
  float blot = clamp((0.65 * vnoise(uv * 0.028 + 0.37) + 0.35 * vnoise(ROT * uv * 0.071) - 0.38) / 0.3, 0.0, 1.0); // large-scale break-up
  float fa = vFoam * mix(0.7 + 0.6 * blot, 1.2, aer); // the large-scale break-up is for older foam, not fresh whitewater
  float ft = 0.0, tau = 0.0;
  if (fa > 0.01) {
    if (wK < 1.0) tau = foamThick(vRest, fa, vAge, dist, ft);
    if (wK > 0.0) {
      float ftB;
      float tB = foamThick(qb, fa, vAge, dist, ftB);
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
    vec3 cp = vec3(vWorld.x, vWorld.y, vCrest.x) * 0.2;
    float tum = 0.5 * uTime;
    float wz = Ng.z * Ng.z, wy = Ng.y * Ng.y, ws = wz + wy + 1e-3;
    float cF = billow(vec2(cp.x, cp.y - sign(Ng.z) * tum), uTime, k3);
    float cT = billow(vec2(cp.x, cp.z + sign(Ng.y) * tum) + 11.3, uTime, k3);
    churn = mix(0.33, (wz * cF + wy * cT) / ws, kf);
  }
  // relief from the thickness and the churn (surface-gradient bump mapping), faded out with distance
  float bumpK = 1.5 * (1.0 - smoothstep(60.0, 450.0, dist));
  float hgt = (min(tau, 1.6) + 1.3 * churnA * churn) * bumpK;
  float hx = dFdx(hgt), hy = dFdy(hgt);
  vec3 r1 = cross(dpy, N), r2 = cross(N, dpx);
  float det = dot(dpx, r1);
  vec3 nb = abs(det) * N - sign(det) * (hx * r1 + hy * r2);
  vec3 Nf = dot(nb, nb) > 1e-14 ? normalize(nb) : N;
  float af = 1.0 - exp(-3.2 * tau);
  float wrap = clamp(dot(Nf, uSunDir) * 0.6 + 0.4, 0.0, 1.0);
  float thickL = smoothstep(0.05, 1.1, tau);
  // bubbles scatter nearly all the light they get, so even the shaded side of the foam stays a bright white
  vec3 foamCol = mix(vec3(0.80, 0.88, 0.94), vec3(1.0), thickL) * (0.98 + 0.8 * wrap + 0.3 * back + 0.3 * Nf.y) * (0.95 + 0.05 * ft);
  foamCol = mix(mix(body * 1.6 + 0.3, foamCol, 0.6), foamCol, thickL); // thin films are translucent: they keep some water colour
  // churn shading: lump tops catch the light, the hollows between the lumps in a light blue shadow
  float ao = 0.8 + 0.28 * smoothstep(0.02, 0.62, churn);
  foamCol *= mix(vec3(1.0), ao * mix(vec3(0.78, 0.87, 0.95), vec3(1.0), smoothstep(0.05, 0.5, churn)), churnA);
  // foam is wet: its lumps catch the sun as a soft sheen, and fresh foam glitters with bubble glints (sparkle)
  float sunF = max(dot(reflect(-V, Nf), uSunDir), 0.0);
  float fresh = max(aer, 1.0 - vAge);
  float glint = (pow(sunF, 20.0) * 0.5 + pow(sunF, 160.0) * 2.5) * (0.4 + 0.6 * fresh);
  float fwR = length(fwidth(vRest * 2.3)), fwB = 2.3 * length(abs(qx) + abs(qy));
  float spk = wK < 1.0 ? sparkle(vRest * 2.3, fwR) : 0.0;
  if (wK > 0.0) spk = mix(spk, sparkle(qb * 2.3, fwB), wK);
  glint += spk * fresh * thickL * smoothstep(0.1, 0.5, wrap);
  foamCol += vec3(1.0, 0.97, 0.9) * glint;
  P = mix(P, foamCol, af);
  W *= 1.0 - af;

  float haze = (1.0 - exp(-dist * 0.00024)) * uHazeK;
  P = mix(P, uHazeCol, haze);
  W *= 1.0 - haze;

  // damp sand left by the swash: a dark, transparent layer, mirror-like where the film is still draining
  // (the layer and the dry-sand drop are judged per pixel from the interpolated depth, so the edge is smooth)
  float sandL = (1.0 - smoothstep(0.3, 0.7, vDepth)) * vLand;
  if (sandL > 0.0) {
    float damp = min(vSand * 2.0, 1.0), glaze = clamp(vSand * 2.0 - 1.0, 0.0, 1.0);
    vec3 Ns = normalize(vec3(0.0, 1.0, 0.0) + vec3(dn.x, 0.0, dn.y) * 0.03);
    float Fs = 0.02 + 0.98 * pow(1.0 - max(dot(Ns, V), 0.0), 5.0);
    vec3 Rs = reflect(-V, Ns);
    vec3 skyS = mix(uHorizon, uZenith, smoothstep(0.0, 0.35, Rs.y)) + vec3(1.0, 0.95, 0.85) * pow(max(dot(Rs, uSunDir), 0.0), 400.0) * 12.0;
    float refl = glaze * Fs;
    float sandA = clamp(0.4 * damp + refl, 0.0, 1.0);
    vec3 sandCol = mix(vec3(0.17, 0.13, 0.08), skyS, refl / max(refl + 0.4 * damp, 1e-3));
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
  float alpha = clamp(1.0 - W.r, 0.0, 1.0);
  vec3 tgt = linearToOutputTexel(vec4(toneMapping((P + W * BED) * 1.55), 1.0)).rgb;
  // the filmic curve cannot reach AoM's bright, saturated cyan (it desaturates on the way), so in that look the
  // water, not the sand seen through it, is pushed towards it afterwards: more saturation, green raised to blue,
  // a little brighter (uVivid sets how far)
  if (uVivid > 0.0) {
    vec3 v = mix(vec3(dot(tgt, vec3(0.2126, 0.7152, 0.0722))), tgt, 1.0 + 0.15 * uVivid);
    v.g += 0.55 * max(v.b - v.g, 0.0);
    tgt = mix(tgt, clamp(v * (1.0 + 0.04 * uVivid), 0.0, 1.0), min(uVivid, 1.0) * (1.0 - (W.r + W.g + W.b) / 3.0) * (1.0 - af)); // (not the foam: it stays white)
  }
  // the ripples' emboss again, in display space: the cyan sits near the top of the filmic curve, which squeezes
  // the lit/unlit difference in the water's light (above) nearly flat
  if (uEmboss > 0.0) {
    float emb = (NdL - max(dot(Nb, uSunDir), 0.0)) * (1.0 - af) * (1.0 - haze) * (1.0 - sandL) * (1.0 - 0.7 * (W.r + W.g + W.b) / 3.0);
    tgt = clamp(tgt * (1.0 + uEmboss * 1.5 * emb), 0.0, 1.0);
  }
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

// The mesh rows follow the wave crests. Row j is the line of constant wave phase sOf(d) + kx x + wobble(x)
// through (0, zs[j]), so every crest lies along a row at all times: the roller, the bore front and the creases
// of the breaking profile run along the rows instead of obliquely across them (~1.5 rows per column at x 0),
// where the straight grid rendered them as teeth. The surface itself is unchanged (surfPos is sampled at the
// moved rest positions). The rows fade back to straight lines outside the play area (|x| 1000 -> 2000, and
// from z 600 to 2000 offshore), so the far field and the mesh edges stay as they were; the near edge follows
// row 0, which stays under the sand (d < -125, the swash reaches about -90).
function buildGeometry(quality) {
  const f = { high: 1.0, low: 1.8, soft: 2.2 }[quality] || 1.35;
  const xs = gridLines(-4950, 4950, -800, 800, 3.5 * f, 0.0075);
  const zs = gridLines(-260, 4850, -260, 350, 1.3 * f, 0.0145);
  const nx = xs.length, nz = zs.length;
  const sh = new Float64Array(nx), ph = new Float64Array(nx), wx = new Float64Array(nx), dRow = new Float64Array(nx);
  for (let i = 0; i < nx; i++) {
    sh[i] = shoreZ(xs[i]);
    ph[i] = SURF.kx * xs[i] + wobble(xs[i]);
    wx[i] = 1 - sstep(1000, 2000, Math.abs(xs[i]));
    dRow[i] = zs[0] - sh[i];
  }
  const sh0 = shoreZ(0), ph0 = wobble(0);
  const pos = new Float32Array(nx * nz * 3);
  let k = 0;
  for (let j = 0; j < nz; j++) {
    const wz = 1 - sstep(600, 2000, zs[j]);
    const sg = sOf(zs[j] - sh0) + ph0;
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
      pos[k++] = xs[i]; pos[k++] = 0; pos[k++] = z;
    }
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
uniform vec3 uSunDir;
attribute float aSize;
attribute float aAlpha;
attribute float aSeed;
varying float vAlpha;
varying float vSeed;
varying vec3 vSun;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (700.0 / max(-mv.z, 1.0));
  vAlpha = aAlpha;
  vSeed = aSeed;
  vSun = normalize((viewMatrix * vec4(uSunDir, 0.0)).xyz);
  gl_Position = projectionMatrix * mv;
}`;
const SPRAY_FRAG = /* glsl */`
varying float vAlpha;
varying float vSeed;
varying vec3 vSun;
float h1(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vn(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h1(i), h1(i + vec2(1.0, 0.0)), u.x), mix(h1(i + vec2(0.0, 1.0)), h1(i + 1.0), u.x), u.y);
}
// a ragged, soft-edged puff (each particle its own shape) rather than a round disc, lit as a little ball of
// droplets: white on its sunward side, a pale blue-grey away from it, and its rim glowing when the sun is behind it
void main() {
  vec2 c = gl_PointCoord - 0.5;
  vec2 q = c * 4.0 + vSeed * 17.0;
  float n = 0.6 * vn(q) + 0.4 * vn(q * 2.3 + 3.1);
  float r = length(c) * 2.0;
  float a = smoothstep(1.0, 0.15, r + 0.55 * (n - 0.5)) * vAlpha;
  if (a < 0.01) discard;
  vec2 b = vec2(c.x, -c.y) * 2.0;
  vec3 nb = vec3(b, sqrt(max(1.0 - dot(b, b), 0.0)));
  float dif = clamp(dot(nb, vSun) * 0.6 + 0.4, 0.0, 1.0);
  vec3 col = mix(vec3(0.62, 0.75, 0.82), vec3(1.0), clamp(0.45 + 0.7 * dif + 0.2 * (n - 0.5), 0.0, 1.0));
  float rim = clamp(-vSun.z, 0.0, 1.0) * (0.3 + 0.7 * smoothstep(0.3, 1.0, r) * clamp(dot(b, vSun.xy) * 3.0 + 0.3, 0.0, 1.0));
  col = min(col + vec3(1.0, 0.95, 0.85) * 0.5 * rim, vec3(1.0));
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
      uniforms: { uSunDir: sunDir },
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
  float f, th, wt, sw, ag;
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
const SPLASH_VERT = /* glsl */`
uniform float uTime;
uniform vec3 uSunDir;
attribute vec4 aA; // base x, y, z (at the water), birth time
attribute vec4 aB; // full width, full height, life, alpha
attribute vec4 aC; // variant 0..3, flip (+-1), lean (top thrown shoreward, per unit height), drift (z units per s)
attribute vec2 aD; // the crest's horizontal normal (x, z), seaward
varying vec2 vUv, vM;
varying vec3 vL;
varying float vP, vAlpha, vBack, vQy, vDist;
void main() {
  float age = uTime - aA.w, p = age / aB.z;
  if (p < 0.0 || p > 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; } // dead: beyond the far plane
  // bursts up to its full height by p 0.4 and keeps spreading; then its top falls back and it sinks into the
  // water as it dissolves, so it never hangs over the water the wave has left behind
  float rise = 1.0 - (1.0 - min(p * 2.5, 1.0)) * (1.0 - min(p * 2.5, 1.0));
  float h = aB.y * (0.3 + 0.7 * rise) * (1.0 - 0.4 * smoothstep(0.4, 1.0, p));
  float w = 1.15 * aB.x * (0.55 + 0.45 * sqrt(p)) * (1.0 + 0.15 * p); // (its atlas tile thins out towards its sides)
  vec3 base = aA.xyz + vec3(0.0, -0.35 * aB.y * p * p, aC.w * age);
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
  vec3 P = base + right * (0.5 * w * q.x) + up * (h * q.y) - vec3(aD.x, 0.0, aD.y) * (aC.z * h * q.y * q.y)
    + fw * (0.12 * w * (1.0 - q.x * q.x));
  vUv = (vec2(0.5 + 0.5 * q.x, q.y) + vec2(mod(aC.x, 2.0), floor(aC.x * 0.5))) * 0.5;
  vBack = pow(max(dot(normalize(P - cameraPosition), uSunDir), 0.0), 3.0);
  // the sun in the plume's own frame (x across its picture, y up it, z out of it towards the camera), and the slope
  // of its rounded shape (up at its top and out at its sides), which bends the relief round
  vL = vec3(dot(uSunDir, right), dot(uSunDir, up), dot(uSunDir, vec3(hd.x * cos(b), sin(b), hd.y * cos(b))));
  vM = vec2(0.6 * q.x, 0.8 * q.y - 0.2);
  vQy = q.y;
  vDist = length(P - cameraPosition);
  vAlpha = aB.w * smoothstep(0.0, 0.06, p) * (1.0 - smoothstep(0.85, 1.0, p)) * (1.0 - smoothstep(2000.0, 3500.0, lh));
  vP = p;
  vec4 cp = projectionMatrix * viewMatrix * vec4(P, 1.0);
  // its depth is taken a few units nearer the camera (less when looking down, where the water would stop hiding
  // its sunk foot): the breaking face it stands against leans past its plane here and there, and would cut it in
  // straight lines
  vec3 toP = P - cameraPosition;
  float dP = length(toP);
  vec4 cb = projectionMatrix * viewMatrix * vec4(P - toP * (min(0.3 * aB.y, 0.5 * dP) * (1.0 - 0.75 * abs(toP.y) / dP) / dP), 1.0);
  gl_Position = vec4(cp.xy, cb.z / cb.w * cp.w, cp.w);
}`;
const SPLASH_FRAG = /* glsl */`
uniform sampler2D uPlume, uPlumeR;
uniform vec3 uHazeCol;
uniform float uHazeK;
varying vec2 vUv, vM;
varying vec3 vL;
varying float vP, vAlpha, vBack, vQy, vDist;
void main() {
  vec4 t = texture2D(uPlume, vUv);
  // dissolves from the thin spray inwards over the later part of its life
  float T = 0.08 + 0.95 * smoothstep(0.35, 1.0, vP);
  // and its foot thins out grain by grain towards the water, which would otherwise cut it off in a straight line
  float foot = smoothstep(0.0, 0.3, vQy + 0.15 * (t.g - 0.5));
  float a = t.r * smoothstep(T - 0.12, T + 0.06, t.g) * vAlpha * foot;
  if (a < 0.01) discard;
  // lit as the heap of lumps in its relief, bent round by its rounded shape: the sun wrapped a little round into the
  // side turned away from it, the sky from above, both shut out of the creases. Shaded in display colour, between
  // white and a cool sea-grey (through the foam's tone curve every shade came out white and the plume flat)
  vec4 rl = texture2D(uPlumeR, vUv);
  vec2 sl = rl.xy * 2.0 - 1.0;
  vec3 n = normalize(vec3(sl + vM, sqrt(max(1.0 - dot(sl, sl), 0.04))));
  vec3 L = normalize(vL);
  float dif = clamp(dot(n, L) * 0.65 + 0.35, 0.0, 1.0);
#ifndef SOFT
  // and shadowed by the lumps between it and the sun: one step towards it across the picture (0.04 heights; a
  // tile is half the atlas, 1.5 heights across), against how far the sunbeam has risen out of the picture by then
  float lxy = max(length(L.xy), 0.25);
  float hs = texture2D(uPlumeR, vUv + L.xy / lxy * vec2(0.0133, 0.02)).b;
  dif *= 1.0 - 0.6 * smoothstep(0.0, 0.03, (hs - rl.b) * 0.32 - 0.04 * L.z / lxy);
#endif
  float lit = (0.72 + 0.2 * n.y + 0.6 * dif) * t.b;
  vec3 col = mix(vec3(0.58, 0.72, 0.8), vec3(1.0), clamp(lit - 0.1, 0.0, 1.0));
  // against the sun its thin spray, the thin low parts of its relief and the rims of its lumps on the sun's side
  // glow; and it takes the water's haze
  float dense = smoothstep(0.4, 0.9, t.r);
  float rim = smoothstep(0.25, 0.85, 1.0 - n.z) * clamp(dot(n.xy, L.xy) * 4.0, 0.0, 1.0);
  col = min(col + vec3(1.0, 0.95, 0.85) * vBack * (0.35 * (1.0 - dense) + 0.25 * (1.0 - rl.b) + 0.45 * rim), vec3(1.0));
  vec3 hz = linearToOutputTexel(vec4(toneMapping(uHazeCol * 1.55), 1.0)).rgb;
  gl_FragColor = vec4(mix(col, hz, (1.0 - exp(-vDist * 0.00024)) * uHazeK), a);
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
        uPlume: { value: tex }, uPlumeR: { value: rel } },
      defines: soft ? { SOFT: '' } : {},
      transparent: true, depthWrite: false, side: THREE.DoubleSide, // (a flipped plume is wound the other way)
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3; // over the foam and the spray
    scene.add(this.mesh);
  }
  add(x, y, z, w, h, birth, life, alpha, lean = 0, drift = 0, nx = 0, nz = 1) {
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
    B[i * 4] = w; B[i * 4 + 1] = h; B[i * 4 + 2] = life; B[i * 4 + 3] = alpha;
    C[i * 4] = Math.floor(Math.random() * 4); C[i * 4 + 1] = Math.random() < 0.5 ? -1 : 1; C[i * 4 + 2] = lean; C[i * 4 + 3] = drift;
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

// ---------- looks ----------
// 'aom' (the default) is the shiny cyan water of the owner's Age of Mythology setup (a water mod under the
// MenuArctic lighting): saturated cyan, clear shallows over pale sand, a darker band where the bottom drops away,
// dense embossed ripples and a broad white sun glare. 'classic' is the earlier natural surf-zone water.
// Colours are linear, before the water's x1.55 and the tone mapping; sigma is the extinction per metre;
// sun is [elevation, azimuth] in degrees (azimuth 0 = straight out to sea, +z); sky holds the Sky uniforms.
export const LOOKS = {
  classic: {
    sun: [15, 0], sky: { turbidity: 8, rayleigh: 3, mieCoefficient: 0.005, mieDirectionalG: 0.7 },
    horizon: [0.80, 0.82, 0.82], zenith: [0.18, 0.45, 0.85], deep: [0.01, 0.17, 0.42], shallow: [0.03, 0.50, 0.62],
    shore: [0.05, 0.26, 0.24], sss: [0.06, 0.70, 0.72], sigma: [1.3, 0.75, 0.7],
    hazeCol: [0.80, 0.82, 0.82], hazeK: 0.85, dropCol: [1, 1, 1], drop: 0, specCol: [1.0, 0.97, 0.9],
    fresK: 1, fresMax: 1, glare: 0, ripple: 0, emboss: 0, wetDark: 0.6, vivid: 0,
  },
  aom: {
    // the owner's preferred hazy sky and low sun out to sea (Round 10; Round 8-9 had a thin deep blue sky, sun [35, -45])
    sun: [15, 0], sky: { turbidity: 8, rayleigh: 3, mieCoefficient: 0.005, mieDirectionalG: 0.7 },
    // the reflected sky is tinted cyan, like AoM's shiny-water environment map
    horizon: [0.10, 0.75, 1.0], zenith: [0.05, 0.45, 0.9], deep: [0.0, 0.7, 1.05], shallow: [0.10, 0.80, 0.88],
    shore: [0.20, 0.55, 0.50], sss: [0.10, 0.85, 0.85], sigma: [0.55, 0.22, 0.20],
    hazeCol: [0.58, 0.82, 0.90], hazeK: 0.25, dropCol: [0.35, 0.55, 0.55], drop: 1, specCol: [1, 1, 1],
    fresK: 0.65, fresMax: 0.55, glare: 1, ripple: 0.8, emboss: 0.8, wetDark: 0.85, vivid: 1,
  },
};
const LOOK_V3 = { horizon: 'uHorizon', zenith: 'uZenith', deep: 'uDeep', shallow: 'uShallow', shore: 'uShore', sss: 'uSSS',
  sigma: 'uSigma', hazeCol: 'uHazeCol', dropCol: 'uDropCol', specCol: 'uSpecCol' };
const LOOK_F = { fresK: 'uFresK', fresMax: 'uFresMax', hazeK: 'uHazeK', glare: 'uGlare', ripple: 'uRipple', emboss: 'uEmboss',
  drop: 'uDrop', wetDark: 'uWetDark', vivid: 'uVivid' };
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

  const { geometry, vertices } = buildGeometry(quality);
  const uniforms = {
    uTime: { value: 0 },
    uSunDir: { value: (sunDir || new THREE.Vector3(0, 0.26, 0.97)).clone().normalize() },
    uNormTex: { value: normTex },
    uRogue: { value: new THREE.Vector3(-1e9, 0, 0) },
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
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.name = 'surf';
  scene.add(mesh);

  const decals = new Decals(scene, uniforms, 1024);
  const spray = new Spray(scene, 6000, uniforms.uSunDir);
  // the plumes along a breaking lip (fewer and smaller pictures on the software tier)
  const splashes = new Splashes(scene, uniforms, soft ? 128 : 1024, soft ? 128 : 256, soft);
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
        if (r.d > tip.d - 4 && r.d < dc - st.D + 2) { r.lipHit = { fn, H: st.H, kind: 'lip', yTop: 0.8 * st.H }; break; }
      } else if (st.p >= 1.6 && st.H > 4.5 && Math.abs(r.d - (dc - st.D)) < 5) {
        r.lipHit = { fn, H: st.H, kind: 'bore', yTop: 0.8 * st.H }; break;
      }
    }
    return r;
  }

  // spray sources found in one emission tick: kind, x, z, y, H, wanted count (flat, reused)
  const jobs = [];
  const LIFE = [0.95, 1.35, 1.6]; // mean particle life of each kind (lip spray, splash-up, mist), s
  // splash plumes found in one tick: kind (0 plunge, 1 shore dump, 2 bore), x, crest fn, wanted count
  const pjobs = [];
  const PLIFE = [1.9, 1.65, 1.3]; // mean plume life of each kind, s
  const _ps = {}, _pw = {};
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
      const nLo = Math.ceil(phaseAt(ex, 15, time) / TAU), nHi = Math.floor(phaseAt(ex, 440, time) / TAU);
      for (let fn = nLo; fn <= nHi; fn++) {
        const dc = crestD(fn, ex, time);
        crestState(fn, ex, dc, st);
        const lip = st.p > 0.35 && st.p < 1.35, splash = st.p > 0.95 && st.p < 1.7 && st.H > 3 && st.sig > 0.3;
        const tip = lip || splash ? lipTip(st, dc) : null;
        // lip spray, thrown forward off the tip
        if (lip) { const n = Math.min(30, st.H * 0.9 * (0.5 + Math.random())) * k; jobs.push(0, ex, zs + tip.d, tip.y, st.H, n); want += n * LIFE[0]; }
        // splash-up: the landed lip throws a burst of white water up and forward from the plunge point
        if (splash) { const n = Math.min(18, st.H * 0.8 * (0.5 + Math.random())) * k; jobs.push(1, ex, zs + tip.d, 0, st.H, n); want += n * LIFE[1]; }
        // whitewash mist rising off the bore / landing lip
        if (st.p > 0.9 && st.p < 3.2 && st.H > 2) {
          const n = Math.min(20, st.H * 0.4 * Math.random() + 0.1) * k; jobs.push(2, ex, zs + dc - st.D, 0, st.H, n); want += n * LIFE[2];
        }
        // a line of splash plumes where the lip lands; where a wave dumps on the shore before its lip can land
        // (the shallows shrink its curl away: the plumes cover the collapse); and smaller ones off the bore front
        if (pk > 0 && st.H > 2.5) {
          const loss = 1 - sstep(15, 45, dc); // how much of the curl the shallows have taken
          let kind = -1, rate = 0;
          if (st.p > 0.85 && st.p < 1.5 && st.H > 3 && st.sig > 0.25) {
            kind = 0; rate = 5 * sstep(0.85, 0.95, st.p) * (1 - sstep(1.25, 1.5, st.p));
          } else if (st.p > 0.12 && st.p < 1.3 && st.H > 3 && loss > 0.15) {
            kind = 1; rate = 6 * sstep(0.12, 0.35, st.p) * (1 - sstep(1.0, 1.3, st.p)) * sstep(0.15, 0.5, loss);
          } else if (st.p > 1.5 && st.p < 3) {
            kind = 2; rate = 1.5 * (1 - sstep(2.4, 3, st.p));
          }
          if (rate > 0) { const n = rate * pk; pjobs.push(kind, ex, fn, n); pwant += n * PLIFE[kind]; }
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
        } else { // puffs off the tumbling bore front, riding with it
          d = dcx - _ps.D - rnd(0, 2);
          h = H * rnd(0.55, 0.9); w = h * rnd(1.3, 1.9);
          life = rnd(1.0, 1.6); lean = rnd(0.2, 0.4); drift = -c * rnd(0.8, 1.0); alpha = rnd(0.6, 0.85);
        }
        const pz = shoreZ(px) + d;
        // it stands along the crest line here: slope dz/dx of z = shoreZ(x) + crestD(fn, x, t)
        const sl = (shoreZ(px + 1) - shoreZ(px - 1) - (wobble(px + 1) - wobble(px - 1)) / kOf(dcx)) / 2 - SURF.kx / kOf(dcx);
        const nl = 1 / Math.sqrt(1 + sl * sl);
        splashes.add(px, evalSurf(px, pz, time, false, _pw).y - 0.12 * H, pz, w, h, time, life, alpha, lean, drift, -sl * nl, nl);
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
        if (kind === 0) {
          spray.emit(px, ey + Math.random() * 2, ez + (Math.random() - 0.5) * 3,
            (Math.random() - 0.5) * 6, 8 + Math.random() * 14, -14 - Math.random() * 18,
            0.6 + Math.random() * 0.7, 1.2 + Math.random() * 1.6, 0.8);
        } else if (kind === 1) {
          const Hs = Math.min(H, 40);
          const vy = Math.sqrt(60 * Hs * (0.3 + 0.8 * Math.random())); // rises ~0.2-0.7 H (gravity 30, drag 1)
          const vz = Math.random() < 0.25 ? Math.random() * 7 : -6 - Math.random() * 18; // mostly shoreward
          spray.emit(px, Hs * (0.05 + 0.25 * Math.random()), ez + (Math.random() - 0.3) * 8,
            (Math.random() - 0.5) * 8, vy, vz,
            0.9 + Math.random() * 0.9, (2 + 3 * Math.random()) * (0.6 + 0.4 * Hs / 14), 1.0, 0.85);
        } else {
          spray.emit(px, 0.5 * H + Math.random() * 2, ez - 4 + Math.random() * 8,
            (Math.random() - 0.5) * 4, 3 + Math.random() * 6, -H * 0.8 - Math.random() * 6,
            1.0 + Math.random() * 1.2, 3 + Math.random() * 4, 1.5, 0.4); // thin mist
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
    mesh, material, vertices,
    get time() { return time; },
    update(dt, cameraX = 0) {
      time += dt;
      material.uniforms.uTime.value = time;
      if (time >= nextRogue) { spawnRogue(cameraX); nextRogue = time + rnd(SURF.rogueMin, SURF.rogueMax); }
      emitSpray(dt, cameraX);
      spray.update(dt);
      decals.update(time);
      splashes.update(time);
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
    // switch or tune the look: a LOOKS name, or an object with any of its fields
    setLook(L) { applyLook(material.uniforms, typeof L === 'string' ? LOOKS[L] : L); },
    dispose() {
      scene.remove(mesh); scene.remove(spray.points); decals.dispose(scene); splashes.dispose(scene);
      geometry.dispose(); material.dispose();
      spray.points.geometry.dispose(); spray.points.material.dispose();
    },
  };
}
