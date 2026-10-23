import * as THREE from 'three';
import { createSurf, shoreZ, SURF, LOOKS } from './surf.js';
import { Sky } from 'Sky';
import { PointerLockControls } from 'PointerLockControls';
import { GLTFLoader } from 'https://unpkg.com/three@0.155.0/examples/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'https://unpkg.com/three@0.155.0/examples/jsm/utils/SkeletonUtils.js';

// === CONSTANTS ===
const MAP_SIZE = 10000;
const BEACH_WIDTH = MAP_SIZE;
const BEACH_HEIGHT = MAP_SIZE * 0.5;
const BEACH_SEGMENTS = 200;
const SEA_LEVEL_OFFSET = 0;

const BORDER_LENGTH_X = 1290;
const BORDER_LENGTH_Z = 750;
const BORDER_HALF_X = BORDER_LENGTH_X / 2;
const BORDER_HALF_Z = BORDER_LENGTH_Z / 2;
const minX = -BORDER_HALF_X;
const maxX = BORDER_HALF_X;
const minZ = -BORDER_LENGTH_Z;
const maxZ = 0;
const SEA_MAX_Z = 430; // the player may swim / skim out past the shorebreak

const FLAT_SAND_WIDTH = 100;
const DUNE_WIDTH = 100;
const DUNE_MAX_HEIGHT = 50;
const DUNE_START = -BORDER_LENGTH_Z + DUNE_WIDTH;
const DUNE_END = -BORDER_LENGTH_Z - DUNE_WIDTH * 2;

const MAX_ACTIVE_SPARKS = 30;
const sparkPool = [];
const trailPool = [];

// === GLOBALS ===
let scene, camera, renderer, character, controls;
let gamePaused = false;
let borders = [];
let wand, wandLight, wandIsAnimating = false, wandAnimTimer = 0;
let wandBasePosition = new THREE.Vector3(2.2, -2.2, -3.2);
let wandBaseRotation = new THREE.Euler(Math.PI / 5, Math.PI / 6, Math.PI / 2);
let wandFlickPosition = new THREE.Vector3(2.2, -2.2, -2.2);
let wandFlickRotation = new THREE.Euler(Math.PI / 4, Math.PI / 6, Math.PI / 2);
let wandWobbleTime = 0;
let isJumping = false, velocityY = 0;
let ghostStates = {};
let survivalTime = 0;
const gravity = -0.02, jumpStrength = 0.5;
const keys = { w: false, a: false, s: false, d: false, space: false, shift: false };
let surf = null;
let softGL = false; // WebGL without a GPU: see softwareGL()
// player-in-water state (velocities in units per frame, like the rest of the movement code)
const sea = { vx: 0, vz: 0, push: 0, tumble: 0, tumbleDur: 1.6, inWater: false, skimming: false, overlay: null, lastHit: -1 };
const sparks = [];
const SPARK_SPEED = 1000, SPARK_MAX_DIST = 1500;

// === GHOST MODELS ===
let npcs = [];
let npcSpawnTimer = 0;
let npcSpawnInterval = 15; // seconds
let npcWave = 1;
let gameActive = false;
let playerAlive = true;
let khaimeraGhostModel = null;
let spectreModel = null; // the basic ghost's skinned mesh and poses (SpectreGhost); null: the Round 18 shade from code

// === GHOST CLASSES ===
class Ghost {
  constructor(modelObj, wave, options = {}) {
    this.HP = options.HP || 1;
    this.speed = options.speed || 1;
    this.size = options.size || 15;
    this.chaseDistance = options.chaseDistance || 150; // Default chase distance
    this.hitboxRadius = (options.hitboxRadius || this.size * 0.5) * 1.3;
    if (options.mesh) {
      // a ghost built from code, already at its size (SpectreGhost)
      this.mesh = options.mesh;
      scene.add(this.mesh);
      this.height = this.size;
    } else {
    this.mesh = SkeletonUtils.clone(modelObj.scene);
    this.mesh.renderOrder = 1; // Ensure ghosts are drawn above the ground


    // Ensure each mesh has its own material instance!
    this.mesh.traverse(child => {
      if (child.isMesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material = child.material.map(mat =>
            mat && typeof mat.clone === 'function' ? mat.clone() : mat
          );
        } else if (typeof child.material.clone === 'function') {
          child.material = child.material.clone();
        }
      }
    });

    // Scale ghost to desired size
    scene.add(this.mesh);
    this.mesh.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(this.mesh);
    let originalHeight = box.max.y - box.min.y;
    let scale = 1;
    if (!isFinite(originalHeight) || originalHeight <= 0) {
      this.mesh.scale.setScalar(0.1);
      this.height = 0.1 * 1; // fallback
    } else {
      scale = this.size / originalHeight;
      this.mesh.scale.setScalar(scale);
      this.height = this.size; // after scaling, height is now this.size
    }
    }

    // Set hitbox radius to cover the whole height
    this.hitboxRadius = this.height / 2;

    // Set hitbox center to the middle of the model
    this.hitboxCenter = new THREE.Vector3(
      this.mesh.position.x,
      this.mesh.position.y + this.height / 2,
      this.mesh.position.z
    );

    // Animation
    if (modelObj && modelObj.animations && modelObj.animations.length > 0) {
      this.mixer = new THREE.AnimationMixer(this.mesh);
      this.action = this.mixer.clipAction(modelObj.animations[0]);
      this.action.play();
    }
  }

  updateFadeAndBlink() { /* base: do nothing */ }
  setOpacity(opacity, transparent) {
    this.mesh.traverse(child => {
      if (child.material && child.material.opacity !== undefined) {
        child.material.transparent = transparent;
        child.material.opacity = opacity;
      }
    });
  }
}

// === SPECTRE: the basic ghost (Round 18, Round 19) ===
// After the old Oblivion ghosts. Oblivion draws its ghosts with a "membrane" effect shader: a translucent fill with a
// bright edge (fresnel) glow and a slowly scrolling texture. Round 19: a gaunt, bald old man's upper body, arms raised
// and clawed, mouth agape, fading at the waist into a tail of glowing mist; a pale green-white membrane with dark eye
// sockets and mouth and more solid yellow-grey claws, inside a soft halo. The body is a skinned mesh made in Blender
// from the CC0 Human Base Meshes (assets/Spectre/spectre.glb: its vertex colour holds the cavities, the waist fade
// and the claws) posed in code by blending three poses (reach, clench, scream). If it fails to load, the Round 18
// hooded shade built from code stands in (pale blue, ragged hem, glowing eyes and hands). Both have wisps, a
// frost-touch reach at the player (claws flare, frost creeps in from the screen edges) and a noise dissolve with a
// bright burning edge when killed.
// Colours are display sRGB (the shaders skip the renderer's tone mapping, like the surf).
const SPECTRE_COL = {
  fill: [0.42, 0.63, 0.90], inner: [0.22, 0.36, 0.64], cowl: [0.05, 0.10, 0.24], face: [0.04, 0.08, 0.2],
  rim: [0.9, 0.98, 1.0], eye: [0.75, 1.0, 1.0], hand: [0.72, 0.93, 1.0], wisp: [0.82, 0.94, 1.0],
  // the mesh (Round 19)
  skin: [0.2, 0.5, 0.43], skinRim: [0.8, 1.0, 0.88], claw: [0.72, 0.68, 0.48], hollow: [0.03, 0.07, 0.06],
  halo: [0.62, 1.0, 0.8], mist: [0.55, 0.8, 0.72], mistWisp: [0.8, 1.0, 0.9],
};
const SPECTRE_S = 12, SPECTRE_WAIST = 5.5; // the mesh (in metres) scaled up, its waist this high over the ground
const SPECTRE_DEATH_S = 0.9;
const SPECTRE_FX = { uTime: { value: 0 }, uHalfH: { value: 540 } }; // shared by every spectre's materials
const spectreBuf = new THREE.Vector2();
let SPECTRE_GEO = null; // geometry, built once and shared by every spectre
const dyingGhosts = []; // spectres playing their death

const SPECTRE_NOISE = `
float spH(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float spN(vec3 x) {
  vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(spH(i), spH(i + vec3(1, 0, 0)), f.x), mix(spH(i + vec3(0, 1, 0)), spH(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(spH(i + vec3(0, 0, 1)), spH(i + vec3(1, 0, 1)), f.x), mix(spH(i + vec3(0, 1, 1)), spH(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;
const SPECTRE_VS = `
uniform float uTime, uPhase, uFlutter, uTrail;
varying vec3 vN, vV, vObj;
void main() {
  vec3 p = position;
  // the robe below the chest flaps and trails behind, more toward the hem
  float low = clamp(1.0 - p.y / 8.5, 0.0, 1.0); low *= low * uFlutter;
  float ang = atan(p.z, p.x), t = uTime + uPhase;
  p.xz *= 1.0 + low * (0.11 * sin(t * 3.1 + ang * 3.0) + 0.06 * sin(t * 5.3 - ang * 5.0));
  p.y += low * 0.45 * sin(t * 4.2 + ang * 4.0);
  p.z -= low * uTrail * 1.6;
  vObj = p;
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vV = -mv.xyz;
  vN = normalMatrix * normal;
  gl_Position = projectionMatrix * mv;
}`;
const SPECTRE_FS = `
uniform vec3 uFill, uRim;
uniform float uTime, uPhase, uOpacity, uDissolve, uBase, uHemOn, uRimK;
varying vec3 vN, vV, vObj;
${SPECTRE_NOISE}
void main() {
  float t = uTime + uPhase;
  // death: noise burns through from the weakest spots, with a bright edge
  float d = spN(vObj * 0.9 + 3.7) * 0.75 + spN(vObj * 2.9) * 0.25;
  float burn = uDissolve * 1.25 - d;
  if (burn > 0.0) discard;
  float edge = uDissolve > 0.0 ? smoothstep(-0.14, 0.0, burn) : 0.0;
  // the hem frays into rags of uneven length (noise round the hem, slowly changing)
  float a = atan(vObj.z, vObj.x);
  float rag = spN(vec3(cos(a) * 5.0, sin(a) * 5.0, t * 0.35));
  float hem = mix(1.0, smoothstep(0.0, 2.2, vObj.y - rag * 2.6), uHemOn);
  if (hem <= 0.01) discard;
  // membrane: thin face-on, bright at the edges, with a shimmer rising through it
  float fres = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  fres *= fres * uRimK;
  float sh = spN(vObj * vec3(0.8, 0.45, 0.8) + vec3(0.0, -t * 0.9, 0.0));
  float sh2 = spN(vObj * 2.2 + vec3(0.0, -t * 1.8, t * 0.3));
  vec3 col = mix(uFill, uRim, clamp(fres * 1.3 + (sh2 - 0.5) * 0.4, 0.0, 1.0));
  float alpha = uBase * (0.55 + 0.9 * sh) + fres * 0.75;
  // the robe hangs in vertical folds: darker, denser creases
  float crease = uHemOn * pow(0.5 + 0.5 * sin(a * 9.0 + spN(vObj * vec3(0.5, 0.12, 0.5) + 1.3) * 5.0), 3.0);
  col *= 1.0 - 0.22 * crease;
  alpha += 0.12 * crease;
  col = mix(col, vec3(0.92, 0.99, 1.0), edge);
  alpha = max(alpha, edge);
  if (uRimK < 0.0) alpha *= max(0.0, 1.0 - uDissolve * 2.5); // the dark face goes first, leaving no dark specks
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0) * hem * uOpacity);
}`;
const SPECTRE_GLOW_VS = `
varying vec3 vN, vV;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vV = -mv.xyz;
  vN = normalMatrix * normal;
  gl_Position = projectionMatrix * mv;
}`;
const SPECTRE_GLOW_FS = `
uniform vec3 uGlow;
uniform float uOpacity, uDissolve, uBoost;
varying vec3 vN, vV;
void main() {
  if (uDissolve > 0.55) discard; // the eyes and hands go out partway through the death
  float c = abs(dot(normalize(vN), normalize(vV)));
  vec3 col = mix(uGlow, vec3(1.0), clamp(c * 0.5 + uBoost * 0.45, 0.0, 1.0));
  gl_FragColor = vec4(col, (0.45 + 0.55 * c) * uOpacity);
}`;
const SPECTRE_WISP_VS = `
attribute vec4 aSeed;
uniform float uTime, uPhase, uTrail, uDissolve, uHalfH, uOpacity;
varying float vA;
void main() {
  float t = uTime + uPhase, burst = uDissolve;
  float life = fract(t * (0.35 + 0.25 * aSeed.w) + aSeed.x);
  float a = aSeed.y * 6.2832;
  // born round the hem (anywhere on the body while dying), rising, curling and left behind
  float r = 2.7 * (0.55 + 0.45 * aSeed.z) * (1.0 + burst * life * 1.5);
  float y0 = mix(0.6 + aSeed.z * 1.5, aSeed.z * 13.0, step(0.001, burst));
  vec3 p = vec3(cos(a) * r, y0 + life * (3.5 + 3.0 * aSeed.w) * (1.0 + burst * 2.0), sin(a) * r);
  p.x += sin(life * 5.0 + aSeed.w * 6.28) * 0.9;
  p.z -= life * (2.0 + 5.0 * uTrail);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = (0.45 + 0.8 * aSeed.z) * (1.0 - 0.5 * life) * (1.0 + burst * 2.0);
  gl_PointSize = size * projectionMatrix[1][1] * uHalfH / max(-mv.z, 1.0);
  vA = sin(3.1416 * life) * uOpacity * mix(0.5, 1.0, burst) * (1.0 - burst * burst);
}`;
const SPECTRE_WISP_FS = `
uniform vec3 uCol;
varying float vA;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  gl_FragColor = vec4(uCol, vA * (1.0 - r2) * (1.0 - r2));
}`;
// the mesh: skinned by three's own chunks; aMask is the model's vertex colour (r: lit, dark in the eye sockets and
// mouth; g: the waist fade, 0 at the cut; b: the hands; a: the claws' tips); uInflate swells it for the halo
const SPECTRE_SKIN_VS = `
#include <skinning_pars_vertex>
attribute vec4 aMask;
uniform float uInflate;
varying vec3 vN, vV, vObj;
varying vec4 vMask;
void main() {
  #include <skinbase_vertex>
  #include <beginnormal_vertex>
  #include <skinnormal_vertex>
  #include <begin_vertex>
  #include <skinning_vertex>
  transformed += normalize(objectNormal) * uInflate;
  vObj = position * ${SPECTRE_S.toFixed(1)}; // unposed, in ghost units: the noise stays on the body
  vMask = aMask;
  vec4 mv = modelViewMatrix * vec4(transformed, 1.0);
  vV = -mv.xyz;
  vN = normalMatrix * objectNormal;
  gl_Position = projectionMatrix * mv;
}`;
const SPECTRE_SKIN_FS = `
uniform vec3 uFill, uRim, uClaw, uHollow;
uniform float uTime, uPhase, uOpacity, uDissolve, uReach, uPre;
varying vec3 vN, vV, vObj;
varying vec4 vMask;
${SPECTRE_NOISE}
void main() {
  float t = uTime + uPhase;
  float d = spN(vObj * 0.9 + 3.7) * 0.75 + spN(vObj * 2.9) * 0.25;
  float burn = uDissolve * 1.25 - d;
  if (burn > 0.0) discard;
  float edge = uDissolve > 0.0 ? smoothstep(-0.14, 0.0, burn) : 0.0;
  // the waist frays into the mist: a ragged, drifting edge
  float rag = spN(vec3(vObj.x * 1.4, vObj.z * 1.4, t * 0.5));
  float fade = smoothstep(0.1, 0.8, vMask.g + (rag - 0.5) * 0.45);
  float fres = 1.0 - abs(dot(normalize(vN), normalize(vV)));
  fres *= fres;
  float sh = spN(vObj * vec3(0.9, 0.5, 0.9) + vec3(0.0, -t * 0.9, 0.0)); // a shimmer rising through it
  float lit = smoothstep(0.12, 1.0, vMask.r), hollow = 1.0 - smoothstep(0.18, 0.5, vMask.r);
  vec3 col = mix(uFill, uRim, clamp(fres * 1.4 + (sh - 0.5) * 0.3, 0.0, 1.0)) * mix(0.5, 1.0, lit);
  float alpha = 0.16 + 0.26 * sh + fres * 0.7;
  // the hands are the same membrane, a little denser; only the claws are yellow-grey bone,
  // nearly solid and paler at the tips, flaring as they reach
  alpha += 0.12 * vMask.b;
  float claw = smoothstep(0.45, 0.95, vMask.a);
  col = mix(col, uClaw * mix(0.85, 1.2, claw) * mix(0.7, 1.0, lit), claw * (1.0 - fres * 0.4));
  col = mix(col, vec3(1.0, 0.98, 0.86), claw * uReach * 0.35);
  alpha = mix(alpha, 0.92, claw);
  hollow *= 1.0 - min(1.0, uDissolve * 3.0); // the dark eye sockets and the open mouth, lit up first as it burns
  col = mix(col, uHollow, hollow);
  alpha = max(alpha, hollow * 0.9) * fade;
  col = mix(col, vec3(0.94, 1.0, 0.96), edge);
  alpha = max(alpha, edge * fade);
  // depth only, over the whole body above the frayed waist: the far arm and the halo's back shell stay hidden
  if (uPre > 0.5) { if (fade < 0.5) discard; gl_FragColor = vec4(0.0); return; }
  gl_FragColor = vec4(col, clamp(alpha, 0.0, 1.0) * uOpacity);
}`;
const SPECTRE_HALO_FS = `
uniform vec3 uGlow;
uniform float uOpacity, uDissolve, uReach;
varying vec3 vN, vV, vObj;
varying vec4 vMask;
void main() {
  // the swollen shell's back faces: clear at its outer edge, thickening toward the body
  float c = abs(dot(normalize(vN), normalize(vV)));
  float a = c * c * smoothstep(0.15, 0.85, vMask.g) * (0.5 + 0.3 * uReach) * max(0.0, 1.0 - uDissolve * 1.6);
  gl_FragColor = vec4(uGlow, a * uOpacity);
}`;
// the tail of mist below the waist (on SPECTRE_VS: it flutters and trails like the old robe)
const SPECTRE_MIST_FS = `
uniform vec3 uFill;
uniform float uTime, uPhase, uOpacity, uDissolve, uTop;
varying vec3 vN, vV, vObj;
${SPECTRE_NOISE}
void main() {
  float t = uTime + uPhase;
  float h = clamp(vObj.y / uTop, 0.0, 1.0); // 0 at the tail's tip, 1 at the waist
  float a = atan(vObj.z, vObj.x);
  // streaks pouring down from the waist
  float s = spN(vec3(cos(a) * 2.2, sin(a) * 2.2, vObj.y * 0.45 + t * 1.3));
  float s2 = spN(vObj * 0.9 + vec3(0.0, t * 1.1, 0.0));
  float face = abs(dot(normalize(vN), normalize(vV)));
  float alpha = pow(h, 1.3) * (0.2 + 1.3 * s * s2) * face * face * max(0.0, 1.0 - uDissolve * 1.6); // soft at the outline
  gl_FragColor = vec4(uFill, clamp(alpha * 0.9, 0.0, 1.0) * uOpacity);
}`;

function spectreGeometry() {
  if (SPECTRE_GEO) return SPECTRE_GEO;
  const seg = softGL ? 16 : 28;
  // robe: a lathe from the hem (y 0) up over the shoulders to the neck; the front is +z
  const prof = new THREE.SplineCurve([[3.4, 0], [3.0, 1.4], [2.55, 3.4], [2.15, 5.6], [2.05, 7.4], [2.35, 8.9], [2.6, 9.8],
    [2.2, 10.6], [1.2, 11.1], [0.6, 11.35], [0.05, 11.45]].map(([r, y]) => new THREE.Vector2(r, y))).getPoints(softGL ? 18 : 34);
  const body = new THREE.LatheGeometry(prof, seg);
  // hood: a cowl open at the front, its crown drawn up and back to a peak
  const gap = 1.7, hr = 1.95;
  const hood = new THREE.SphereGeometry(hr, seg, 14, Math.PI / 2 + gap / 2, Math.PI * 2 - gap, 0, Math.PI * 0.7);
  const hp = hood.attributes.position;
  for (let i = 0; i < hp.count; i++) {
    const y = hp.getY(i), u = Math.max(y, 0) / hr;
    hp.setY(i, y * 1.1 + u ** 4 * 1.1);
    hp.setZ(i, hp.getZ(i) - u ** 2.5 * 1.3);
  }
  hood.computeVertexNormals();
  hood.translate(0, 12.5, -0.15);
  const head = new THREE.SphereGeometry(1.05, 18, 14);
  head.scale(0.88, 1.08, 0.92); head.translate(0, 12.4, -0.15); // sunk in the cowl
  const eye = new THREE.SphereGeometry(0.21, 10, 8);
  eye.scale(1.35, 0.6, 0.6);
  const sleeve = new THREE.CylinderGeometry(0.6, 1.15, 5.0, 14, 6, true);
  sleeve.translate(0, -2.5, 0);
  // hand: a thin palm and four long, slightly curled claws (one merged geometry)
  const palm = new THREE.SphereGeometry(0.45, 10, 8);
  palm.scale(0.85, 1.0, 0.45);
  const claws = [[-0.3, 1.15], [-0.1, 1.5], [0.1, 1.45], [0.3, 1.1]].map(([x, h]) => {
    const c = new THREE.ConeGeometry(0.1, h, 6);
    c.rotateX(Math.PI); c.translate(0, -h / 2, 0); c.rotateX(-0.35); c.translate(x, -0.3, 0.05);
    return c;
  });
  const hand = mergeGeometries([palm, ...claws]);
  return (SPECTRE_GEO = { body, hood, head, eye, sleeve, hand, wisp: spectreWispGeometry() });
}

// wisps: random seeds only, the vertex shader moves them
function spectreWispGeometry() {
  const wn = softGL ? 0 : 36;
  const wisp = new THREE.BufferGeometry();
  wisp.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(wn * 3), 3));
  const seeds = new Float32Array(wn * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  wisp.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 4));
  return wisp;
}

// position and normal of several geometries in one (non-indexed) geometry
function mergeGeometries(list) {
  const parts = list.map(g => (g.index ? g.toNonIndexed() : g));
  const n = parts.reduce((s, g) => s + g.attributes.position.count, 0);
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
  let o = 0;
  for (const g of parts) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const m = new THREE.BufferGeometry();
  m.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  m.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return m;
}

function spectreMembrane(U, fill, base, flutter, hemOn, side, depthWrite, rimK = 1) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: SPECTRE_FX.uTime, uPhase: U.uPhase, uOpacity: U.uOpacity, uDissolve: U.uDissolve, uTrail: U.uTrail,
      uFill: { value: new THREE.Vector3(...fill) }, uRim: { value: new THREE.Vector3(...SPECTRE_COL.rim) },
      uBase: { value: base }, uFlutter: { value: flutter }, uHemOn: { value: hemOn }, uRimK: { value: rimK },
    },
    vertexShader: SPECTRE_VS, fragmentShader: SPECTRE_FS, transparent: true, depthWrite, side,
  });
}

function spectreGlow(U, col, boost) {
  return new THREE.ShaderMaterial({
    uniforms: { uOpacity: U.uOpacity, uDissolve: U.uDissolve, uBoost: boost, uGlow: { value: new THREE.Vector3(...col) } },
    vertexShader: SPECTRE_GLOW_VS, fragmentShader: SPECTRE_GLOW_FS, transparent: true, depthWrite: false,
  });
}

function buildSpectre(U) {
  return spectreModel ? buildSpectreMesh(U) : buildSpectreShade(U);
}

// the wisps on their (shared) geometry of random seeds
function spectreWisps(U, g, col) {
  const w = new THREE.Points(g, new THREE.ShaderMaterial({
    uniforms: {
      uTime: SPECTRE_FX.uTime, uHalfH: SPECTRE_FX.uHalfH, uPhase: U.uPhase, uOpacity: U.uOpacity,
      uDissolve: U.uDissolve, uTrail: U.uTrail, uCol: { value: new THREE.Vector3(...col) },
    },
    vertexShader: SPECTRE_WISP_VS, fragmentShader: SPECTRE_WISP_FS, transparent: true, depthWrite: false,
  }));
  w.renderOrder = 1.03;
  w.frustumCulled = false; // the shader moves them off their (zero) positions
  return w;
}

// The loaded model, made ready once: the vertex colour renamed (three would read it as a colour), and per bone its
// rest and each pose's turn and shift away from it, taken from the ends of the model's clips.
function prepareSpectreModel(gltf) {
  let skin = null;
  gltf.scene.traverse(o => { if (o.isSkinnedMesh) skin = o; });
  if (!skin) throw new Error('no skinned mesh');
  const g = skin.geometry;
  g.setAttribute('aMask', g.getAttribute('color'));
  g.deleteAttribute('color');
  g.computeBoundingBox();
  const clips = ['reach', 'clench', 'scream'], bones = {};
  clips.forEach((name, k) => {
    const clip = gltf.animations.find(c => c.name === name);
    if (!clip) throw new Error('no pose ' + name);
    for (const tr of clip.tracks) {
      const [bone, prop] = tr.name.split('.'), n = tr.getValueSize(), v = tr.values, end = v.length - n;
      if (prop !== 'quaternion' && prop !== 'position') continue;
      const b = (bones[bone] ||= { name: bone, dq: [null, null, null], dp: [null, null, null] });
      if (prop === 'quaternion') {
        const r = new THREE.Quaternion().fromArray(v, 0), p = new THREE.Quaternion().fromArray(v, end);
        const dq = r.clone().invert().multiply(p);
        if (Math.abs(dq.w) < 0.99999) b.dq[k] = dq;
      } else {
        const dp = new THREE.Vector3().fromArray(v, end).sub(new THREE.Vector3().fromArray(v, 0));
        if (dp.lengthSq() > 1e-10) b.dp[k] = dp;
      }
    }
  });
  return { scene: gltf.scene, waist: g.boundingBox.min.y, poses: Object.values(bones).filter(b => b.dq.some(Boolean) || b.dp.some(Boolean)) };
}

// pose a spectre: its rest, turned by each pose in turn as far as its weight (a negative weight undoes some of it)
const spectreQ = new THREE.Quaternion();
function poseSpectre(rig, w) {
  for (const b of rig) {
    b.bone.quaternion.copy(b.rq);
    b.bone.position.copy(b.rp);
    for (let k = 0; k < 3; k++) {
      if (!w[k]) continue;
      const P = b.pose;
      if (P.dq[k]) b.bone.quaternion.multiply(spectreQ.identity().slerp(P.dq[k], w[k]));
      if (P.dp[k]) b.bone.position.addScaledVector(P.dp[k], w[k]);
    }
  }
}

// The mesh drawn three times: depth only (so only its nearest skin shows, not the back of the head through the face
// and so the surf's foam behind it stays behind it), the membrane, then a swollen shell's back faces for the halo.
// Then the tail of mist and the wisps.
function buildSpectreMesh(U) {
  const C = SPECTRE_COL, M = spectreModel;
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const model = SkeletonUtils.clone(M.scene);
  model.scale.setScalar(SPECTRE_S);
  model.position.y = SPECTRE_WAIST - M.waist * SPECTRE_S;
  body.add(model);
  let skin = null;
  model.traverse(o => { if (o.isSkinnedMesh) skin = o; });
  const v3 = c => ({ value: new THREE.Vector3(...c) });
  const mat = (fs, extra, opts) => new THREE.ShaderMaterial({
    uniforms: { uTime: SPECTRE_FX.uTime, uPhase: U.uPhase, uOpacity: U.uOpacity, uDissolve: U.uDissolve,
      uReach: U.uReach, uInflate: { value: 0 }, ...extra },
    vertexShader: SPECTRE_SKIN_VS, fragmentShader: fs, transparent: true, ...opts,
  });
  const skinU = { uFill: v3(C.skin), uRim: v3(C.skinRim), uClaw: v3(C.claw), uHollow: v3(C.hollow) };
  const twin = (material, order) => {
    const m = new THREE.SkinnedMesh(skin.geometry, material);
    m.position.copy(skin.position); m.quaternion.copy(skin.quaternion); m.scale.copy(skin.scale);
    skin.parent.add(m);
    m.bind(skin.skeleton, skin.bindMatrix);
    m.renderOrder = order;
    m.frustumCulled = false; // its bounds are the unposed model's
    return m;
  };
  skin.material = mat(SPECTRE_SKIN_FS, { ...skinU, uPre: { value: 1 } }, { colorWrite: false });
  skin.renderOrder = 1;
  skin.frustumCulled = false;
  twin(mat(SPECTRE_SKIN_FS, { ...skinU, uPre: { value: 0 } }, { depthWrite: false }), 1.01);
  twin(mat(SPECTRE_HALO_FS, { uGlow: v3(C.halo), uInflate: { value: 0.045 } }, { depthWrite: false, side: THREE.BackSide }), 1.025);
  // the tail of mist: a lathe from inside the waist down to a point near the ground (geometry shared, made once)
  const W = SPECTRE_WAIST;
  M.tail ||= new THREE.LatheGeometry([[0.9, W + 1.6], [1.55, W + 0.4], [1.6, W - 1.2], [1.3, W - 2.8], [0.85, W - 4.1],
    [0.4, W - 5.0], [0.05, W - 5.4]].map(([r, y]) => new THREE.Vector2(r, y)), softGL ? 14 : 24);
  M.wisp ||= spectreWispGeometry();
  const mist = new THREE.Mesh(M.tail, new THREE.ShaderMaterial({
    uniforms: { uTime: SPECTRE_FX.uTime, uPhase: U.uPhase, uOpacity: U.uOpacity, uDissolve: U.uDissolve, uTrail: U.uTrail,
      uFlutter: { value: 1 }, uFill: v3(C.mist), uTop: { value: W + 1.6 } },
    vertexShader: SPECTRE_VS, fragmentShader: SPECTRE_MIST_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  mist.renderOrder = 1.02;
  body.add(mist);
  if (M.wisp.attributes.position.count) root.add(spectreWisps(U, M.wisp, C.mistWisp)); // left behind, not carried
  const rig = M.poses.map(pose => {
    const bone = model.getObjectByName(pose.name);
    return bone && { bone, pose, rq: bone.quaternion.clone(), rp: bone.position.clone() };
  }).filter(Boolean);
  return { root, body, rig };
}

// The Round 18 shade (if the model fails to load). The parts, drawn inside surfaces first (no depth), then the
// outside (writing depth, so the surf's foam behind a ghost stays behind it), then the glows and the wisps.
function buildSpectreShade(U) {
  const G = spectreGeometry(), C = SPECTRE_COL;
  const root = new THREE.Group(), body = new THREE.Group();
  root.add(body);
  const add = (parent, geo, mat, order, pos) => {
    const m = new THREE.Mesh(geo, mat);
    m.renderOrder = order;
    if (pos) m.position.set(...pos);
    parent.add(m);
    return m;
  };
  add(body, G.body, spectreMembrane(U, C.inner, 0.38, 1, 1, THREE.BackSide, false), 1);
  add(body, G.hood, spectreMembrane(U, C.cowl, 0.62, 0, 0, THREE.BackSide, false, 0.3), 1); // the shadow in the cowl
  add(body, G.body, spectreMembrane(U, C.fill, 0.26, 1, 1, THREE.FrontSide, true), 1.01);
  add(body, G.hood, spectreMembrane(U, C.fill, 0.3, 0, 0, THREE.FrontSide, true), 1.01);
  // a dark face fading out at its edges (negative rim), the eyes alight in it
  add(body, G.head, spectreMembrane(U, C.face, 0.72, 0, 0, THREE.FrontSide, true, -0.9), 1.01);
  const sleeveM = spectreMembrane(U, C.fill, 0.3, 0.35, 0, THREE.DoubleSide, true);
  const eyeM = spectreGlow(U, C.eye, { value: 0.6 }), handM = spectreGlow(U, C.hand, U.uReach);
  const arms = [], hands = [];
  for (const s of [1, -1]) {
    add(body, G.eye, eyeM, 1.02, [s * 0.37, 12.55, 0.78]).rotation.z = -s * 0.3; // slanted
    const arm = new THREE.Group();
    arm.position.set(s * 2.3, 9.9, 0.1);
    body.add(arm);
    arms.push(arm);
    add(arm, G.sleeve, sleeveM, 1.01);
    hands.push(add(arm, G.hand, handM, 1.02, [0, -5.5, 0.1]));
  }
  if (G.wisp.attributes.position.count) root.add(spectreWisps(U, G.wisp, C.wisp)); // left behind, not carried
  return { root, body, arms, hands };
}

// frost creeping in from the screen edges while a spectre reaches for the player (full on its touch)
let frostEl = null, frostShown = 0;
function frostLevel(v) {
  if (!frostEl) {
    frostEl = document.createElement('div');
    frostEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:4;opacity:0;transition:opacity 0.2s;' +
      'background:radial-gradient(ellipse at center, rgba(210,240,255,0) 42%, rgba(160,215,255,0.45) 72%, rgba(235,248,255,0.92) 100%);';
    document.body.appendChild(frostEl);
  }
  if (Math.abs(v - frostShown) > 0.01 || (v === 0 && frostShown !== 0)) {
    frostShown = v;
    frostEl.style.opacity = v.toFixed(2);
  }
}

function updateDyingGhosts(delta) {
  for (let i = dyingGhosts.length - 1; i >= 0; i--) {
    const g = dyingGhosts[i];
    g.tick(delta);
    if (g.dying >= 1) {
      scene.remove(g.mesh);
      g.dispose();
      dyingGhosts.splice(i, 1);
    }
  }
}

// Spectre (fading, blinking, air/ground)
class SpectreGhost extends Ghost {
  constructor(wave) {
    // uniforms shared by all of this ghost's materials
    const U = { uPhase: { value: Math.random() * 100 }, uOpacity: { value: 1 }, uDissolve: { value: 0 },
      uTrail: { value: 1 }, uReach: { value: 0 } };
    const parts = buildSpectre(U);
    super(null, wave, {
      HP: 1,
      speed: 0.9,
      size: 15,
      chaseDistance: 150,
      mesh: parts.root,
    });
    this.isSpectre = true;
    this.U = U;
    this.body = parts.body;
    this.arms = parts.arms;
    this.hands = parts.hands;
    this.rig = parts.rig; // the mesh's posed bones (else the shade's arms and hands)
    this.w = [0, 0, 0]; // how far into each pose: reach, clench, scream
    this.t = Math.random() * 10;
    this.reach = 0;
    this.reachTarget = 0;
    this.dying = -1;

    // AIR GHOST LOGIC
    this.isAirGhost = Math.random() < 0.5;
    let y;
    if (this.isAirGhost) {
      y = 15 + Math.random() * 45; // 15 to 60
      this.airTargetY = 40 + Math.random() * 20; // 40 to 60
    } else {
      y = getGroundHeightAt(0, 0);
      this.airTargetY = null;
    }

    // Set position
    const x = minX + Math.random() * (maxX - minX);
    const z = 300 + Math.random() * 50;
    this.mesh.position.set(x, this.isAirGhost ? y : getGroundHeightAt(x, z), z);

    // Set target
    this.mesh.userData.target = this.isAirGhost
      ? { x: x, z: -740, y: this.airTargetY }
      : { x: x, z: -740 };

    // Fading and blinking
    const fadeProb = Math.min(0.15 + 0.12 * (wave - 1), 0.29);
    this.shouldFade = Math.random() < fadeProb;
    this.blinkTimer = Math.random() * 1.5;
    this.lastOpacity = 1;
  }

  updateFadeAndBlink(delta, playerPos) {
    if (!this.shouldFade) {
      this.setOpacity(1, false);
      return;
    }
    // Distance to player
    const dx = playerPos.x - this.mesh.position.x;
    const dz = playerPos.z - this.mesh.position.z;
    const distToPlayer = Math.sqrt(dx * dx + dz * dz);

    // Fade calculation
    let fadeT = 0;
    if (distToPlayer >= 400) fadeT = 1;
    else if (distToPlayer <= 150) fadeT = 0;
    else fadeT = (distToPlayer - 150) / (400 - 150);

    let baseOpacity = 1 - fadeT;
    let targetOpacity = baseOpacity;

    // Blinking if faded
    if (baseOpacity < 1) {
      this.blinkTimer += delta;
      const cycle = this.blinkTimer % 1.5;
      const blinkVisible = cycle < 0.1 || (cycle >= 0.2 && cycle < 0.3);
      if (blinkVisible) targetOpacity = 1;
    }

    this.setOpacity(targetOpacity, true);
    this.lastOpacity = targetOpacity;
  }

  setOpacity(opacity) {
    this.U.uOpacity.value = opacity;
  }

  // hover, bob, sway; reach for the player (reachTarget, set by updateNPCs); fling up the arms and rise while dying
  tick(delta) {
    this.t += delta;
    const t = this.t, die = Math.max(this.dying, 0);
    this.reach += (this.reachTarget - this.reach) * Math.min(1, delta * 6);
    this.U.uReach.value = this.reach;
    this.U.uTrail.value += ((gameActive && playerAlive ? 1 : 0.25) - this.U.uTrail.value) * Math.min(1, delta * 2);
    const b = this.body;
    b.position.y = 1.2 + Math.sin(t * 1.9) * 0.55 + die * 4;
    b.rotation.x = 0.1 + this.reach * 0.25 + Math.sin(t * 1.3) * 0.03 - die * 0.45; // leans into its glide
    b.rotation.z = Math.sin(t * 0.9) * 0.05;
    if (this.rig) {
      // claws raised, drifting; thrust out and grasping when it reaches; the mouth moaning open and shut (a
      // negative scream closes it), gaping as it reaches and screaming as it dies
      const r = this.reach, w = this.w;
      w[0] = r * (1 - die) + 0.08 * Math.sin(t * 1.7);
      w[1] = Math.max(r * (0.55 + 0.45 * Math.sin(t * 9)), 0.25 + 0.25 * Math.sin(t * 1.3 + 1));
      w[2] = Math.min(1, 0.45 * Math.sin(t * 0.8) - 0.05 + r * 0.5) * (1 - die) + die;
      poseSpectre(this.rig, w);
    } else {
      this.arms.forEach((arm, k) => {
        const s = k ? -1 : 1, sway = Math.sin(t * 1.7 + k * 1.3);
        arm.rotation.x = -0.35 + sway * 0.12 - this.reach * (1.1 + 0.15 * Math.sin(t * 9 + k * 2)) - die * 2.2;
        arm.rotation.z = s * (0.2 + 0.05 * sway - this.reach * 0.1 + die * 0.5);
      });
      for (const h of this.hands) h.scale.setScalar(1 + this.reach * 0.25 * (1 + Math.sin(t * 14)));
    }
    if (this.dying >= 0) {
      this.dying = Math.min(1, this.dying + delta / SPECTRE_DEATH_S);
      this.U.uDissolve.value = Math.max(0.02, this.dying);
    }
  }

  die() {
    this.dying = 0;
    this.reachTarget = 0;
    this.U.uOpacity.value = 1;
  }

  dispose() { // the geometry is shared
    this.mesh.traverse(o => { if (o.material) o.material.dispose(); });
  }
}

// Khaimera Ghost (tank, ground only, no fade)
class KhaimeraGhost extends Ghost {
  constructor(modelObj, wave) {
    super(modelObj, wave, {
      HP: 20,
      speed: 1.2,
      size: 20,
      chaseDistance: 400
    });

    this.isAirGhost = false;
    this.airTargetY = null;
    this.dead = false;
    this.deathTimer = 0;
    this.hasStoodUp = false;
    this.canMove = false;
    this.isAttacking = false;
    this.attackAnimEndTime = 0;

    // Set position (ground only)
    const x = minX + Math.random() * (maxX - minX);
    const z = 300 + Math.random() * 50;
    const y = getGroundHeightAt(x, z);
    this.mesh.position.set(x, y, z);

    // Set target
    this.mesh.userData.target = { x: x, z: -740 };

    // Animation setup
    this.animations = {};
    if (modelObj.animations) {
      for (const clip of modelObj.animations) {
        this.animations[clip.name] = clip;
      }
    }
    this.mixer = new THREE.AnimationMixer(this.mesh);
    this.currentAction = null;
    this.playAnimation('StandUp', false);
  }

playAnimation(name, loop = true, fadeDuration = 0.1) {
  if (!this.animations[name]) return;
  if (this.currentAnimName === name && this.currentAction && this.currentAction.isRunning()) return;

  const prevAction = this.currentAction;
  const nextAction = this.mixer.clipAction(this.animations[name]);
  nextAction.reset();

  // Set loop mode
  if (name === 'Walk') {
    nextAction.setLoop(THREE.LoopRepeat, Infinity);
  } else {
    nextAction.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, 1);
  }
  nextAction.clampWhenFinished = true;

  // Speed up attack animations from 0.5x to 0.8x (0.5 / 0.8 = 0.625)
  if (['Punch', 'Punching', 'Swiping'].includes(name)) {
    nextAction.timeScale = 0.8;
  } else {
    nextAction.timeScale = 1;
  }

  nextAction.play();

  if (prevAction && prevAction !== nextAction) {
    prevAction.crossFadeTo(nextAction, fadeDuration, false);
  }

  this.currentAction = nextAction;
  this.currentAnimName = name;

  // Adjust attack durations to match new speed (multiply by 0.625)
  if (name === 'Punch') {
    this.isAttacking = true;
    this.attackAnimEndTime = performance.now() + Math.round(1200 * 0.625); // 750 ms
  } else if (name === 'Swiping') {
    this.isAttacking = true;
    this.attackAnimEndTime = performance.now() + Math.round(2850 * 0.625); // 1781 ms
  } else if (name === 'Punching') {
    this.isAttacking = true;
    this.attackAnimEndTime = performance.now() + Math.round(3100 * 0.625); // 1938 ms
  } else {
    this.isAttacking = false;
  }
}

  updateFadeAndBlink() {
    this.setOpacity(1, false);
  }
}

function getGridKey3D(x, y, z, cellSize) {
  const gx = Math.floor(x / cellSize);
  const gy = Math.floor(y / cellSize);
  const gz = Math.floor(z / cellSize);
  return `${gx},${gy},${gz}`;
}

function getSparkMesh() {
  let mesh = sparkPool.pop();
  if (mesh) {
    mesh.visible = true;
    return mesh;
  }
  // Create new if pool is empty
  return new THREE.Mesh(
    new THREE.SphereGeometry(2, 12, 12),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
}

function getTrailMesh(color, size, opacity) {
  let mesh = trailPool.pop();
  if (!mesh) {
    console.warn('Trail pool exhausted! color:', color, 'size:', size, 'opacity:', opacity);
    mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 6, 6),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
    );
  }
  mesh.material.color.set(color);
  mesh.material.opacity = opacity;
  mesh.scale.setScalar(size); // Use size directly
  mesh.visible = true;
  mesh.position.set(0, 0, 0);
  mesh.rotation.set(0, 0, 0);
  mesh.updateMatrixWorld();
  return mesh;
}

function releaseSparkMesh(mesh) {
  mesh.visible = false;
  sparkPool.push(mesh);
}

function releaseTrailMesh(mesh) {
  mesh.visible = false;
  trailPool.push(mesh);
}

function clearMeshPool(pool, maxSize = 100) {
  while (pool.length > maxSize) {
    const mesh = pool.pop();
    if (mesh.geometry) mesh.geometry.dispose();
    if (mesh.material) mesh.material.dispose();
  }
}

function preloadPools() {
  for (let i = 0; i < 100; i++) sparkPool.push(getSparkMesh());
  for (let i = 0; i < 500; i++) { // 10x more!
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(1, 6, 6),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1, depthWrite: false })
    );
    mesh.visible = false;
    trailPool.push(mesh);
  }
}



// === INIT FUNCTIONS ===
function initScene() {
  scene = new THREE.Scene();
  character = new THREE.Object3D();

  // Spawn at center of playable area, slightly above ground
  const spawnZ = -300;
  const spawnX = 0;
  const groundY = getGroundHeightAt(spawnX, spawnZ);
  character.position.set(spawnX, groundY + 10, spawnZ);
  character.rotation.set(0, 180, 0);

  scene.add(character);

  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 20000);
  character.add(camera);

  renderer = new THREE.WebGLRenderer();
  softGL = softwareGL(renderer);
  // without a GPU every pixel is shaded on the CPU: draw a quarter of them (the browser scales the canvas up)
  if (softGL) renderer.setPixelRatio(0.5);
  renderer.setSize(window.innerWidth, window.innerHeight);
  // filmic tone mapping keeps the Sky shader from washing out to white
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.6;
  document.body.appendChild(renderer.domElement);

  controls = new PointerLockControls(character, renderer.domElement);

  controls.addEventListener('lock', () => {
    const hint = document.getElementById('focusHint');
    if (hint) hint.style.display = 'none';
    gamePaused = false;
    document.getElementById('pauseMenu').style.display = 'none';
  });
  controls.addEventListener('unlock', () => {
    if (gameActive && playerAlive) {
      gamePaused = true;
      document.getElementById('pauseMenu').style.display = 'flex';
    }
    const hint = document.getElementById('focusHint');
    if (hint) hint.style.display = 'none';
  });

  renderer.domElement.addEventListener('click', () => {
    if (!controls.isLocked) {
      controls.lock();
    }
  });
}

// ?look=classic: the earlier natural water and hazy sky; the default is the AoM-like look (see LOOKS in surf.js)
const LOOK = new URLSearchParams(location.search).get('look') === 'classic' ? 'classic' : 'aom';
function sunDirection() {
  const [elev, azim] = LOOKS[LOOK].sun;
  return new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elev), THREE.MathUtils.degToRad(azim));
}

// AoM's clear sky (Round 18, the owner's request): very light blue overhead, nearly white at the horizon, no clouds.
// Drawn straight in display colours (no tone mapping), with a soft white glow round the sun and a little dither
// against banding.
function gradientSky(g, sun) {
  const c = (a) => new THREE.Vector3(...a.map((v) => v / 255));
  const material = new THREE.ShaderMaterial({
    uniforms: { uTop: { value: c(g.zenith) }, uHor: { value: c(g.horizon) }, uSun: { value: sun.clone() } },
    vertexShader: `varying vec3 vDir;
      void main() { vec4 w = modelMatrix * vec4(position, 1.0); vDir = w.xyz - cameraPosition; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform vec3 uTop, uHor, uSun; varying vec3 vDir;
      void main() {
        vec3 d = normalize(vDir);
        vec3 c = mix(uHor, uTop, pow(clamp(d.y / 0.55, 0.0, 1.0), 0.7));
        float s = max(dot(d, uSun), 0.0);
        c = mix(c, vec3(1.0), clamp(pow(s, 900.0) + 0.35 * pow(s, 40.0) + 0.12 * pow(s, 6.0), 0.0, 1.0));
        c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
        gl_FragColor = vec4(c, 1.0);
      }`,
    side: THREE.BackSide, depthWrite: false,
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(9000, 48, 24), material);
  dome.renderOrder = -1;
  dome.frustumCulled = false;
  return dome;
}

function initSkyAndLights() {
  const sun = sunDirection();
  if (LOOKS[LOOK].skyGrad) scene.add(gradientSky(LOOKS[LOOK].skyGrad, sun));
  else {
    const sky = new Sky();
    sky.scale.setScalar(10000);
    scene.add(sky);
    const skyUniforms = sky.material.uniforms;
    for (const [k, v] of Object.entries(LOOKS[LOOK].sky)) skyUniforms[k].value = v;
    sky.material.uniforms['sunPosition'].value.copy(sun);
  }

  scene.add(new THREE.AmbientLight(0xffffff, 2.9));
  const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
  directionalLight.position.set(-1000, 1000, 1000);
  scene.add(directionalLight);
}

// Software WebGL (SwiftShader, llvmpipe, WARP: no GPU, as in the headless browser of the Pages smoke test) runs the
// shaders on the CPU: the medium water took ~0.4 s a frame there and Round 8 stalled the smoke test's screenshot.
// There the water takes the 'soft' quality (see createSurf; a quarter of the cost) and the canvas is drawn at half
// resolution. ?soft=1 forces this, ?soft=0 turns it off.
function softwareGL(renderer) {
  const q = new URLSearchParams(location.search).get('soft');
  if (q != null) return q !== '0';
  const gl = renderer.getContext(), d = gl.getExtension('WEBGL_debug_renderer_info');
  return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(String(gl.getParameter(d ? d.UNMASKED_RENDERER_WEBGL : gl.RENDERER)));
}

function createWater() {
  const params = new URLSearchParams(location.search);
  const quality = params.get('surf') || (softGL ? 'soft' : 'medium');
  const rogueIn = params.has('rogue') ? Number(params.get('rogue')) || 0 : undefined; // ?rogue=N: first rogue wave after N s
  surf = createSurf(scene, { sunDir: sunDirection(), quality, rogueIn, look: LOOK });
  return surf;
}

// AoM's pale sand (Round 18): the photo's brown is replaced by a pale cream-green tint that keeps a little of the
// photo's grain, crossed by fine wind-ripple streaks along the shore (faded out where they would shimmer). The sand
// under the water is drawn by surf.js with the matching colour (LOOKS bed). The filmic curve pulls red up with
// green near white, so the last bit of AoM's green comes from a small grade in display colour (sand.grade).
function tintSand(material, sand) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uSandTint = { value: new THREE.Vector3(...sand.tint) };
    sh.uniforms.uSandGrade = { value: new THREE.Vector3(...sand.grade) };
    sh.uniforms.uSandStreak = { value: sand.streak };
    material.userData.shader = sh;
    sh.vertexShader = 'varying vec2 vSandW;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  vSandW = position.xz;');
    sh.fragmentShader = `uniform vec3 uSandTint, uSandGrade; uniform float uSandStreak; varying vec2 vSandW;
float sandN(vec2 p) {
  vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
  vec2 k = vec2(127.1, 311.7);
  return mix(mix(fract(sin(dot(i, k)) * 43758.5453), fract(sin(dot(i + vec2(1.0, 0.0), k)) * 43758.5453), u.x),
    mix(fract(sin(dot(i + vec2(0.0, 1.0), k)) * 43758.5453), fract(sin(dot(i + 1.0, k)) * 43758.5453), u.x), u.y);
}
` + sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
  {
    float l = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
    vec3 c = uSandTint * mix(1.0, l / 0.3, 0.35);
    // streaks: short dashes stretched along the shore (turned ~25 degrees), in two sizes
    vec2 w = mat2(0.906, 0.423, -0.423, 0.906) * vSandW;
    vec2 a = w * vec2(0.09, 0.9), b = w * vec2(0.16, 1.7) + 7.3;
    float fw = max(length(fwidth(a)), 0.5 * length(fwidth(b)));
    float st = 0.6 * smoothstep(0.55, 0.9, sandN(a)) + 0.4 * smoothstep(0.5, 0.9, sandN(b));
    c *= 1.0 - uSandStreak * st * (1.0 - smoothstep(0.25, 0.7, fw));
    diffuseColor.rgb = c;
  }`).replace('#include <colorspace_fragment>', `#include <colorspace_fragment>
  gl_FragColor.rgb = min(gl_FragColor.rgb * uSandGrade, 1.0);`);
  };
}

function createBeach() {
  const sandColorMap = new THREE.TextureLoader().load('./textures/ground_0024_color_1k.jpg');
  const sandNormalMap = new THREE.TextureLoader().load('./textures/ground_0024_normal_opengl_1k.png');
  const sandRoughnessMap = new THREE.TextureLoader().load('./textures/ground_0024_roughness_1k.jpg');
  const sandAoMap = new THREE.TextureLoader().load('./textures/ground_0024_ao_1k.jpg');
  const sandHeightMap = new THREE.TextureLoader().load('./textures/ground_0024_height_1k.png');

  [sandColorMap, sandNormalMap, sandRoughnessMap, sandAoMap, sandHeightMap].forEach(tex => {
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(100, 100);
  });

  const beachMaterial = new THREE.MeshStandardMaterial({
    map: sandColorMap,
    normalMap: sandNormalMap,
    roughnessMap: sandRoughnessMap,
    aoMap: sandAoMap,
    displacementMap: sandHeightMap,
    displacementScale: 2,
    roughness: .5,
    metalness: 0.0,
  });

  const beachGeometry = new THREE.PlaneGeometry(BEACH_WIDTH, BEACH_HEIGHT, BEACH_SEGMENTS, BEACH_SEGMENTS);

  const SEALINE_WAVE_AMPLITUDE = 30;
  const SEALINE_WAVE_FREQUENCY = 2;
  const positionAttribute = beachGeometry.attributes.position;
  const SEALINE_EXTENSION = 10;
  const SAND_HEIGHT_OFFSET = 0.5;

  for (let i = 0; i < positionAttribute.count; i++) {
    const x = positionAttribute.getX(i);
    const y = positionAttribute.getY(i);

    const nx = ((x + 600) - minX) / (maxX - minX);

    let sealineOffset =
      Math.sin(nx * Math.PI * 1) * 60 +
      Math.sin(nx * Math.PI * 2) * 20
      + 50;

    if (nx >= 0.6 && nx <= 1.0) {
      const t = (nx - 0.6) / 0.4;
      const smoothT = t * t * (3 - 2 * t);
      const bay = Math.sin(t * Math.PI) * 100;
      sealineOffset += smoothT * bay;
    }

    // the plane now extends ~900 units out under the sea (seabed)
    const zClamped = - (y + BEACH_HEIGHT / 2) + 900;
    const seaD = zClamped + sealineOffset; // distance seaward of the shoreline

    let height = SEA_LEVEL_OFFSET;
    if (zClamped >= -FLAT_SAND_WIDTH) {
      height = SEA_LEVEL_OFFSET;
    } else if (zClamped < -FLAT_SAND_WIDTH && zClamped >= DUNE_START) {
      const t = (zClamped + FLAT_SAND_WIDTH) / (DUNE_START + FLAT_SAND_WIDTH);
      height = t * 20 + SEA_LEVEL_OFFSET;
    } else if (zClamped < DUNE_START && zClamped >= DUNE_END) {
      const t = (DUNE_START - zClamped) / (DUNE_START - DUNE_END);
      const smooth = t * t * (3 - 2 * t);
      height = SEA_LEVEL_OFFSET + 20 + smooth * DUNE_MAX_HEIGHT;
    } else if (zClamped < DUNE_END) {
      height = SEA_LEVEL_OFFSET + 20 + DUNE_MAX_HEIGHT;
    }

    height += SAND_HEIGHT_OFFSET;
    if (seaD > 0) height = Math.max(height - SURF.slope * seaD, -70);

    positionAttribute.setY(i, height);
    positionAttribute.setZ(i, zClamped);
  }
  positionAttribute.needsUpdate = true;
  beachGeometry.computeVertexNormals();
  beachMaterial.displacementBias = -1;
  if (LOOKS[LOOK].sand) tintSand(beachMaterial, LOOKS[LOOK].sand);

  const beach = new THREE.Mesh(beachGeometry, beachMaterial);
  beach.position.set(0, 0, 0);
  beach.receiveShadow = true;
  scene.add(beach);
}

function createBorders() {
  const borderThickness = 8, borderHeight = 2, borderYOffset = 0;
  const edgeMaterial = new THREE.MeshPhongMaterial({
    color: 0xffffff,
    emissive: 0xffffff,
    emissiveIntensity: 1,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    depthTest: false
  });

  // Top and bottom borders (parallel to sea line, flat)
  const borderTop = new THREE.Mesh(new THREE.BoxGeometry(BORDER_LENGTH_X, borderHeight, borderThickness), edgeMaterial.clone());
  const borderBottom = new THREE.Mesh(new THREE.BoxGeometry(BORDER_LENGTH_X, borderHeight, borderThickness), edgeMaterial.clone());

  borderTop.position.set(0, 1, SEA_MAX_Z);
  borderBottom.position.set(0, getGroundHeightAt(0, minZ) + 1, minZ);

  // Left and right borders (perpendicular to sea line, inclined)
  const borderLeft = new THREE.Mesh(new THREE.BoxGeometry(borderThickness, borderHeight, BORDER_LENGTH_Z), edgeMaterial.clone());
  const borderRight = new THREE.Mesh(new THREE.BoxGeometry(borderThickness, borderHeight, BORDER_LENGTH_Z), edgeMaterial.clone());

  // For each, sample ground height at both ends (z = minZ and maxZ)
  const leftY1 = getGroundHeightAt(minX, minZ); // dunes
  const leftY2 = getGroundHeightAt(minX, maxZ); // sealine
  const rightY1 = getGroundHeightAt(maxX, minZ); // dunes
  const rightY2 = getGroundHeightAt(maxX, maxZ); // sealine

  // Midpoints
  const leftMidY = (leftY1 + leftY2) / 2;
  const rightMidY = (rightY1 + rightY2) / 2;
  const midZ = (minZ + maxZ) / 2;

  // Set positions
  borderLeft.position.set(minX - 4, leftMidY, midZ);
  borderRight.position.set(maxX - 4, rightMidY, midZ);

  // Calculate inclination (rotation around X axis)
  const dz = maxZ - minZ;
  const leftDeltaY = leftY2 - leftY1;   // sealine - dunes
  const rightDeltaY = rightY2 - rightY1; // sealine - dunes
  borderLeft.rotation.x = -Math.atan2(leftDeltaY, dz);
  borderRight.rotation.x = -Math.atan2(rightDeltaY, dz);

  borders = [borderTop, borderBottom, borderLeft, borderRight];
  for (const mesh of borders) {
    mesh.renderOrder = 0;
    scene.add(mesh);
  }
}

// === MOVEMENT & INPUT ===
function setupInput() {
  document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (event.key === "Shift") keys.shift = true;
    if (key === " " || key === "space") keys.space = true;
    else if (keys.hasOwnProperty(key)) keys[key] = true;
  });
  document.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    if (event.key === "Shift") keys.shift = false;
    if (key === " " || key === "space") keys.space = false;
    else if (keys.hasOwnProperty(key)) keys[key] = false;
  });
}

function seaOverlay() {
  if (!sea.overlay) {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;opacity:0;transition:opacity 0.12s;';
    document.body.appendChild(el);
    sea.overlay = el;
  }
  return sea.overlay;
}

function updateMovement() {
  const pos = character.position;
  const x0 = pos.x, z0 = pos.z;
  const direction = new THREE.Vector3();
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
  const left = new THREE.Vector3(); left.crossVectors(camera.up, forward).normalize();

  const tumbling = sea.tumble > 0;
  if (!tumbling) {
    if (keys.w) direction.add(forward);
    if (keys.s) direction.sub(forward);
    if (keys.a) direction.add(left);
    if (keys.d) direction.sub(left);
  }

  const ground = getSeabedHeightAt(pos.x, pos.z);
  const w = surf ? surf.sample(pos.x, pos.z) : null;
  const depth = w ? w.y - ground : 0;
  const inWater = depth > 1.2;
  sea.inWater = inWater;
  sea.skimming = inWater && keys.shift && !tumbling;

  // --- horizontal movement ---
  let moveDistance = 1.8;
  if (inWater) {
    const deep = Math.min(depth / 8, 1);
    moveDistance = sea.skimming ? 2.4 : 1.8 - 0.9 * deep; // wading/swimming is slower, skimming faster
    // the water drags the player along with it (shoreward under a passing crest, seaward in the backwash)
    const uz = w.u / 60;
    const k = (sea.skimming ? 0.025 : 0.07) * deep + 0.02;
    sea.vz += (uz - sea.vz) * k;
    // skimming: slide down the wave face (towards lower water)
    if (sea.skimming) sea.vz -= w.dydz * 0.09;
    sea.vx *= 0.97;
    sea.vz *= 0.99;
    // broken wave / landing lip: pushed back towards the beach (no tumble of the view, hardly any lift)
    if (w.lipHit && !tumbling && w.lipHit.fn !== sea.lastHit && pos.y < w.lipHit.yTop + 10) {
      const H = Math.min(w.lipHit.H, 40);
      sea.lastHit = w.lipHit.fn;
      sea.tumble = sea.tumbleDur = 0.8 + H * 0.03;
      sea.push = -(1.6 + H * 0.14);
      if (w.lipHit.kind === 'lip') { velocityY = 0.12 + H * 0.006; isJumping = true; }
    }
    // the push builds over the first quarter second instead of snapping the view back
    if (tumbling && sea.tumbleDur - sea.tumble < 0.25) sea.vz += (sea.push - sea.vz) * 0.3;
  } else {
    sea.vx *= 0.85; sea.vz *= 0.85; // sand friction
  }

  if (direction.length() > 0) {
    direction.normalize().multiplyScalar(moveDistance);
    pos.add(direction);
  }
  pos.x += sea.vx; pos.z += sea.vz;

  // --- vertical: land, water surface, jump ---
  const landEye = getSeabedHeightAt(pos.x, pos.z) + 10;
  let restEye = landEye;
  if (w) {
    const w2 = (pos.x === w.x && pos.z === w.z) ? w : surf.sample(pos.x, pos.z);
    const d2 = w2.y - (landEye - 10);
    const float = sea.skimming ? 9.5 : 4.0;          // skim on top, or swim with the head above water
    const t = Math.min(Math.max((d2 - 1.2) / 6, 0), 1);
    restEye = Math.max(landEye, landEye + (w2.y + float - landEye) * t);
  }

  if (keys.space && !isJumping && !tumbling) {
    isJumping = true;
    velocityY = jumpStrength;
  }
  if (isJumping) {
    velocityY += gravity;
    pos.y += velocityY;
    if (pos.y <= restEye) {
      if (inWater && velocityY < -0.05 && !tumbling) {
        // landing in the water: foam spreads round the player (no crown of drops: it would fill the view)
        if (velocityY < -0.25 && surf) surf.splash(pos.x, pos.z, Math.min(-velocityY * 2, 1.5), false);
        velocityY *= -0.15; // small splash bounce
      }
      pos.y = restEye;
      if (Math.abs(velocityY) < 0.06 || !inWater || tumbling) { isJumping = false; velocityY = 0; }
    }
  } else if (inWater) {
    // follow the surface: a rising wave lifts the player, and a fast lift launches them
    const dy = restEye - pos.y;
    const rise = dy * 0.3;
    pos.y += rise;
    if (rise > 0.6 && sea.skimming) { isJumping = true; velocityY = rise * 0.5; }
  } else {
    pos.y = restEye;
  }

  // --- wave push: the controls come back when it ends ---
  if (sea.tumble > 0) sea.tumble -= 1 / 60;

  // underwater / whitewash overlay
  if (w) {
    const ov = seaOverlay();
    const camY = pos.y;
    const under = camY < w.y + 0.5;
    const hit = sea.tumbleDur - sea.tumble; // seconds since the wave hit
    if (sea.tumble > 0 && hit < 0.6) {
      // a light, brief veil of spray, clearest in the middle of the view
      ov.style.background = 'radial-gradient(circle, rgba(240,250,248,0.25), rgba(215,238,234,0.85))';
      ov.style.opacity = String(0.75 * (1 - hit / 0.6) ** 1.5);
    } else if (under) {
      ov.style.background = 'linear-gradient(rgba(40,110,110,0.55), rgba(10,50,60,0.8))';
      ov.style.opacity = '1';
    } else {
      ov.style.opacity = '0';
    }
  }

  // Clamp to box (the sea side extends past the old waterline)
  pos.x = Math.max(minX, Math.min(maxX, pos.x));
  if (pos.z > SEA_MAX_Z) { pos.z = SEA_MAX_Z; sea.vz = Math.min(sea.vz, 0); }
  if (pos.z < minZ) { pos.z = minZ; sea.vz = Math.max(sea.vz, 0); }

  // foam rings and a wake round the player in the water (eye 10 above the feet; moves once per frame)
  if (surf) surf.wake(sea.foam ||= {}, pos.x, pos.y - 10, pos.z, (pos.x - x0) * 60, (pos.z - z0) * 60, 2.5, 1 / 60);
}

// === GROUND HEIGHT ===
function getGroundHeightAt(x, z) {
  let height = SEA_LEVEL_OFFSET;
  if (z >= -FLAT_SAND_WIDTH) {
    height = SEA_LEVEL_OFFSET;
  } else if (z < -FLAT_SAND_WIDTH && z >= DUNE_START) {
    const t = (z + FLAT_SAND_WIDTH) / (DUNE_START + FLAT_SAND_WIDTH);
    height = t * 20 + SEA_LEVEL_OFFSET;
  } else if (z < DUNE_START && z >= DUNE_END) {
    const t = (DUNE_START - z) / (DUNE_START - DUNE_END);
    const smooth = t * t * (3 - 2 * t);
    height = SEA_LEVEL_OFFSET + 20 + smooth * DUNE_MAX_HEIGHT;
  } else if (z < DUNE_END) {
    height = SEA_LEVEL_OFFSET + 20 + DUNE_MAX_HEIGHT;
  }
  return height;
}

// Sand or seabed under (x, z): same as the ground on land, sloping down under the sea.
function getSeabedHeightAt(x, z) {
  const d = z - shoreZ(x);
  const h = getGroundHeightAt(x, z);
  return d > 0 ? Math.max(h - SURF.slope * d, -70) : h;
}

// === WAND & SPARKS ===
function setupWand() {
  const gltfLoader = new GLTFLoader();
  gltfLoader.setPath('./assets/');
  gltfLoader.load('/Yew_Wand.glb', (gltf) => {
    wand = gltf.scene;
    wand.scale.set(1.2, 1.2, 1.2);
    wand.position.copy(wandBasePosition);
    wand.rotation.copy(wandBaseRotation);
    camera.add(wand);
    wandLight = new THREE.PointLight(0xffffff, 0, 10);
    wandLight.position.set(0, 0, 0);
    wand.add(wandLight);
  });
  document.addEventListener('mousedown', (event) => {
    if (
      event.button === 0 &&
      !gamePaused &&
      gameActive &&
      playerAlive
    ) {
      shootSpark();
    }
  });
}

function shootSpark() {
  if (!wand) return;
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  const wandTip = new THREE.Vector3();
  wand.localToWorld(wandTip.set(0, 0, -2.5));
  const spark = getSparkMesh();
  spark.position.copy(wandTip);
  scene.add(spark);

  let enableTrail = sparks.length < MAX_ACTIVE_SPARKS;

  sparks.push({
    mesh: spark,
    direction: dir.clone(),
    distance: 0,
    trail: enableTrail ? [] : null,
    enableTrail: enableTrail
  });

  wandIsAnimating = true;
  wandAnimTimer = 0.18;
  if (wandLight) {
    wandLight.intensity = 2.5;
    wandLight.distance = 8;
  }
}

// === GHOST MODEL LOADING ===
function loadAllGhostModels(callback) {
  let loaded = 0;
  const check = () => { loaded++; if (loaded === 2) callback(); };

  // the basic ghost's skinned mesh (SpectreGhost; if it fails, the shade built from code stands in)
  new GLTFLoader().load('./assets/Spectre/spectre.glb', (gltf) => {
    try { spectreModel = prepareSpectreModel(gltf); } catch (e) { console.error('Spectre model unusable:', e); }
    check();
  }, undefined, (e) => { console.error('Spectre model failed to load:', e); check(); });

  // Khaimera Ghost (GLTF)
  const gltfLoader = new GLTFLoader();
  gltfLoader.setPath('./assets/Khaimera Ghost/');
  gltfLoader.load('ghost.gltf', (gltf) => {
    gltf.scene.traverse(child => {
      if (child.isMesh) {
        child.material.transparent = true;
        child.material.opacity = 0.95;
        child.castShadow = true;
      }
  });
  khaimeraGhostModel = { scene: gltf.scene, animations: gltf.animations || [] };

  // Log available animation names
  if (gltf.animations && gltf.animations.length > 0) {
    console.log("Khaimera Ghost Animations:");
    gltf.animations.forEach((clip, idx) => {
      console.log(`[${idx}] ${clip.name} duration: ${clip.duration}s`);
    });
  } else {
    console.log("No animations found for Khaimera Ghost.");
  }
  check();
});
}

// === NPC SPAWNING ===
function spawnNPCs() {
  if (!khaimeraGhostModel) return;
  const count = Math.ceil(npcWave * 1.3);

  // Restore original Khaimera spawn logic: only spawn starting at wave 5
  let khaimeraCount = 0;
  if (npcWave >= 5) {
    if (npcWave % 5 === 0) khaimeraCount = 1;
    for (let i = khaimeraCount; i < count; i++) {
      if (Math.random() < 0.05) khaimeraCount++;
    }
    khaimeraCount = Math.min(khaimeraCount, count);
  }

  // Spawn Khaimera ghosts
  for (let i = 0; i < khaimeraCount; i++) {
    const ghost = new KhaimeraGhost(khaimeraGhostModel, npcWave);
    npcs.push(ghost);
  }
  // Spawn spectres for the rest
  for (let i = khaimeraCount; i < count; i++) {
    const ghost = new SpectreGhost(npcWave);
    npcs.push(ghost);
  }
  npcWave++;
  npcSpawnTimer = 0;
}

// === NPC UPDATE ===
function updateNPCs(delta) {
  if (!gameActive || !playerAlive) return;
  let frost = 0; // the nearest reaching spectre's frost
  for (let i = npcs.length - 1; i >= 0; i--) {
    const ghost = npcs[i];
    const pos = ghost.mesh.position;
    let target = ghost.mesh.userData.target;
    if (!target) {
      target = ghost.isAirGhost
        ? { x: pos.x, z: -740, y: ghost.airTargetY }
        : { x: pos.x, z: -740 };
      ghost.mesh.userData.target = target;
    }
    ghost.hitboxCenter.set(
      ghost.mesh.position.x,
      ghost.mesh.position.y + ghost.height / 2,
      ghost.mesh.position.z
    );

    // Khaimera death handling
    if (ghost instanceof KhaimeraGhost && ghost.dead) {
      ghost.deathTimer -= delta;
      if (ghost.deathTimer <= 0) {
        scene.remove(ghost.mesh);
        npcs.splice(i, 1);
      }
      ghost.mixer.update(delta);
      continue;
    }

    // Check player proximity
const dx = character.position.x - pos.x;
const dz = character.position.z - pos.z;
const dist = Math.sqrt(dx * dx + dz * dz);

// --- State logic: set chasePlayer if within chaseDistance ---
if (dist < ghost.chaseDistance) {
  ghost.mesh.userData.state = 'chasePlayer';
  target = ghost.isAirGhost
    ? { x: character.position.x, z: character.position.z, y: character.position.y + 10 }
    : { x: character.position.x, z: character.position.z };
} else if (ghost.mesh.userData.state === 'chasePlayer') {
  ghost.mesh.userData.state = 'toDunes';
  target = ghost.isAirGhost
    ? { x: pos.x, z: -800, y: ghost.airTargetY }
    : { x: pos.x, z: -800 };
}
if (ghost.isSpectre) {
  const chasing = ghost.mesh.userData.state === 'chasePlayer';
  ghost.reachTarget = chasing && dist < 30 ? 1 : 0;
  if (chasing) frost = Math.max(frost, 1 - dist / 45);
}

// Animation state logic for Khaimera
if (ghost instanceof KhaimeraGhost) {
  // StandUp only once at spawn, immobile during StandUp
  if (!ghost.hasStoodUp && ghost.currentAnimName === 'StandUp') {
    ghost.mixer.update(delta);
    if (ghost.currentAction.time >= ghost.currentAction._clip.duration - 0.1) {
      ghost.hasStoodUp = true;
      ghost.canMove = true;
      ghost.playAnimation('Walk');
    }
    continue; // Don't move or animate further until StandUp is done
  } else if (ghost.hasStoodUp) {
    // If currently attacking, let the attack animation finish
    if (ghost.isAttacking) {
  ghost.mixer.update(delta);

  // --- PLAYER KILL CHECK: ---
if (
  ghost.mesh.userData.state === 'chasePlayer' &&
  dist < 50
) {
  const action = ghost.currentAction;
  if (action && action._clip && action._clip.duration > 0) {
    const progress = action.time / action._clip.duration;
    // Debug output:
    console.log('Khaimera attack progress:', progress, 'isAttacking:', ghost.isAttacking, 'dist:', dist);
    if (progress >= 0.4 && progress < 0.5) {
      const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(ghost.mesh.quaternion).normalize();
      const toPlayer = new THREE.Vector3(
        character.position.x - ghost.mesh.position.x,
        0,
        character.position.z - ghost.mesh.position.z
      ).normalize();
      const dot = forward.dot(toPlayer);
      // Debug output:
      console.log('dot:', dot);
      if (dot > 0.5) {
        console.log('Player killed by Khaimera Ghost!');
        endGame(true);
        return;
      }
    }
  }
}

  // Check if attack animation finished
  if (performance.now() >= ghost.attackAnimEndTime) {
    ghost.isAttacking = false;
    ghost.playAnimation('Walk');
  }
  continue; // Don't switch to walk or attack again until finished
}
    // If in attack range and not already attacking, start a random attack
    if (ghost.mesh.userData.state === 'chasePlayer' && dist < 30) {
      if (
        !ghost.isAttacking &&
        !['Punch', 'Punching', 'Swiping'].includes(ghost.currentAnimName)
      ) {
        const attacks = ['Punch', 'Punching', 'Swiping'];
        const attackAnim = attacks[Math.floor(Math.random() * attacks.length)];
        ghost.playAnimation(attackAnim, false);
      }
    } else {
      // Only play walk if not already walking
      if (ghost.currentAnimName !== 'Walk') {
        ghost.playAnimation('Walk');
      }
    }
  }
}



    // Face movement direction (for all ghosts)
    const tx = target.x - pos.x;
    const tz = target.z - pos.z;
    if (tx !== 0 || tz !== 0) {
      ghost.mesh.rotation.y = Math.atan2(tx, tz);
    }

    // --- Movement ---
    const speed = ghost.speed;
    let ty = 0;
    let len = Math.sqrt(tx * tx + tz * tz);

    if (ghost.isAirGhost) {
      ty = (target.y !== undefined ? target.y : pos.y) - pos.y;
      len = Math.sqrt(tx * tx + tz * tz + ty * ty);

      // If close to ground, "land" and become a ground ghost
      const groundY = getGroundHeightAt(pos.x, pos.z);
      if (pos.y - groundY < 10) {
        ghost.isAirGhost = false;
        pos.y = groundY;
        ghost.mesh.userData.target = { x: pos.x, z: -740 };
      }
    }

    const canMove = !(ghost instanceof KhaimeraGhost) || ghost.canMove;
if (len > 1 && canMove) {
  pos.x += (tx / len) * speed * delta * 60;
  pos.z += (tz / len) * speed * delta * 60;
  if (ghost.isAirGhost) {
    pos.y += (ty / len) * speed * delta * 60;
  } else {
    pos.y = getGroundHeightAt(pos.x, pos.z);
  }
}
    // foam round ground ghosts crossing the sea: rings and a trailing wake
    if (surf && !ghost.isAirGhost) {
      const v = len > 1 && canMove ? speed * 60 / len : 0;
      surf.wake(ghost.foamState ||= {}, pos.x, pos.y, pos.z, tx * v, tz * v, ghost.size * 0.55, delta); // the cloak's footprint
    }

    // Fading and blinking
    ghost.updateFadeAndBlink(delta, character.position);

    // Check win condition
    if (pos.z <= -700) {
      endGame(false); // NPCs win
      return;
    }
    // Check kill player
    if (ghost.mesh.userData.state === 'chasePlayer' && dist < 5) {
      if (ghost.isSpectre) frostLevel(1); // the frost touch
      endGame(true); // Player killed
      return;
    }
  }
  frostLevel(Math.min(frost, 1) * 0.6);
}

// === REMOVE NPC IF HIT BY SPARK ===
function checkSparkHits() {
  const cellSize = 20;
  // 1. Build ghost hash table (now 3D)
  const ghostHash = new Map();
  for (const npc of npcs) {
    const hash = getGridKey3D(npc.hitboxCenter.x, npc.hitboxCenter.y, npc.hitboxCenter.z, cellSize);
    if (!ghostHash.has(hash)) ghostHash.set(hash, []);
    ghostHash.get(hash).push(npc);
  }
  // 2. For each spark, check ghosts in the same and neighboring cells (3x3x3 = 27)
  for (let j = sparks.length - 1; j >= 0; j--) {
    const spark = sparks[j];
    const sx = Math.floor(spark.mesh.position.x / cellSize);
    const sy = Math.floor(spark.mesh.position.y / cellSize);
    const sz = Math.floor(spark.mesh.position.z / cellSize);
    let hit = false;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const hash = getGridKey3D(sx + dx, sy + dy, sz + dz, 1); // 1 because sx,sy,sz are already cell indices
          const ghosts = ghostHash.get(hash);
          if (!ghosts) continue;
          for (let i = ghosts.length - 1; i >= 0; i--) {
            const npc = ghosts[i];
            if (npc.dying >= 0 || (npc.HP <= 0 && !(npc instanceof KhaimeraGhost))) continue; // already killed this frame
            const dx = spark.mesh.position.x - npc.hitboxCenter.x;
            const dz = spark.mesh.position.z - npc.hitboxCenter.z;
            const dy = spark.mesh.position.y - npc.hitboxCenter.y;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist < (npc.hitboxRadius || 15)) {
              npc.HP--;
              if (npc.HP <= 0) {
                if (npc instanceof KhaimeraGhost) {
                  if (!npc.dead) {
                    npc.dead = true;
                    npc.playAnimation('Death', false);
                    npc.deathTimer = npc.animations['Death'] ? npc.animations['Death'].duration : 2.0;
                  }
                } else if (npc.isSpectre) {
                  npcs.splice(npcs.indexOf(npc), 1);
                  npc.die(); // dissolves, then updateDyingGhosts removes it
                  dyingGhosts.push(npc);
                } else {
                  scene.remove(npc.mesh);
                  npcs.splice(npcs.indexOf(npc), 1);
                }
              }
              hit = true;
              break; // Only one hit per spark per frame
            }
          }
          if (hit) break;
        }
        if (hit) break;
      }
      if (hit) break;
    }
  }
}

// === GAME STATE & MENUS ===
function showMenu(id, show) {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? 'flex' : 'none';
}

function startGame() {
  gameActive = true;
  playerAlive = true;
  npcWave = 1;
  npcSpawnTimer = 0;
  isJumping = false;
  velocityY = 0;
  wandIsAnimating = false;
  wandAnimTimer = 0;
  wandWobbleTime = 0;
  keys.w = keys.a = keys.s = keys.d = keys.space = keys.shift = false;
  sea.vx = sea.vz = 0; sea.tumble = 0;
  ghostStates = {};
  survivalTime = 0;

  for (let i = npcs.length - 1; i >= 0; i--) {
    scene.remove(npcs[i].mesh);
    if (npcs[i].dispose) npcs[i].dispose();
    npcs.splice(i, 1);
  }
  for (const g of dyingGhosts) { scene.remove(g.mesh); g.dispose(); }
  dyingGhosts.length = 0;
  frostLevel(0);

  clearMeshPool(sparkPool);
  clearMeshPool(trailPool);
  preloadPools();

  if (sparks && sparks.length) {
  for (let i = sparks.length - 1; i >= 0; i--) {
    scene.remove(sparks[i].mesh);
    releaseSparkMesh(sparks[i].mesh); // Pool it!
    if (sparks[i].trail) {
      for (const t of sparks[i].trail) {
        if (t.mesh) {
          scene.remove(t.mesh);
          releaseTrailMesh(t.mesh); // Pool it!
        }
        if (t.blueMesh) {
          scene.remove(t.blueMesh);
          releaseTrailMesh(t.blueMesh); // Pool it!
        }
      }
    }
    sparks.splice(i, 1);
  }
}

  if (character) {
    const spawnZ = -300;
    const spawnX = 0;
    const groundY = getGroundHeightAt(spawnX, spawnZ);
    character.position.set(spawnX, groundY + 10, spawnZ);
    character.rotation.set(0, 0, 0);
    if (camera) camera.rotation.set(0, 0, 0);
  }

  if (wand) {
    wand.position.copy(wandBasePosition);
    wand.rotation.copy(wandBaseRotation);
  }

  showMenu('startMenu', false);
  showMenu('endMenu', false);
  const scoreEl = document.getElementById('scoreMessage');
  if (scoreEl) scoreEl.style.display = 'none';
}

function endGame(playerDied) {
  gameActive = false;
  playerAlive = false;
  showMenu('endMenu', true);
  document.getElementById('endMessage').innerText = playerDied
    ? "You were caught! Game Over!"
    : "The ghosts reached the dunes! Game Over!";

  const scoreEl = document.getElementById('scoreMessage');
  if (scoreEl) {
    scoreEl.innerText = `Score: ${Math.floor(survivalTime)} seconds survived`;
    scoreEl.style.display = 'block';
  }

  const endMenu = document.getElementById('endMenu');
  if (endMenu) {
    const buttons = endMenu.querySelectorAll('button');
    buttons.forEach(btn => btn.style.display = 'none');
    const restartBtn = document.getElementById('restartButton');
    if (restartBtn) restartBtn.style.display = 'inline-block';
    const backBtn = document.getElementById('backToMenuButton');
    if (backBtn) backBtn.style.display = 'inline-block';
  }

  const hint = document.getElementById('focusHint');
  if (hint) hint.style.display = 'none';

  if (document.exitPointerLock) {
    document.exitPointerLock();
  } else if (document.mozExitPointerLock) {
    document.mozExitPointerLock();
  }
}

// === BOOT ===
let ghostModelsLoaded = false;

function boot() {
  loadAllGhostModels(() => {
    ghostModelsLoaded = true;
    showMenu('startMenu', true);
    document.getElementById('loadingMessage').style.display = 'none';
  });

  document.getElementById('startButton').onclick = () => {
    if (!ghostModelsLoaded) {
      document.getElementById('loadingMessage').style.display = 'block';
      return;
    }
    startGame();
    showMenu('startMenu', false);
    main();
    spawnNPCs();
    // Automatically lock pointer on start
    if (controls && !controls.isLocked) controls.lock();
  };

  document.getElementById('restartButton').onclick = () => {
    if (!ghostModelsLoaded) {
      document.getElementById('loadingMessage').style.display = 'block';
      return;
    }
    startGame();
    showMenu('endMenu', false);
    spawnNPCs();
    // Automatically lock pointer on restart
    if (controls && !controls.isLocked) controls.lock();
  };

  document.getElementById('exitButton').onclick = () => {
    showMenu('startMenu', true);
    showMenu('endMenu', false);
    document.getElementById('pauseMenu').style.display = 'none';
  };

  document.getElementById('resumeButton').onclick = () => {
    if (controls && !controls.isLocked) {
      controls.lock();
    }
  };

  document.getElementById('backToMenuButton').onclick = () => {
    showMenu('endMenu', false);
    showMenu('startMenu', true);
  };
}

boot();

// === ANIMATION LOOP ===
function animate() {
  requestAnimationFrame(animate);

  const delta = 1.0 / 60.0;

  if (!gamePaused && gameActive && playerAlive) {
    npcSpawnTimer += delta;
    survivalTime += delta;
    if (npcSpawnTimer >= npcSpawnInterval) {
      spawnNPCs();
    }
    updateNPCs(delta);
    checkSparkHits();
  }

  if (!gamePaused) {
    updateMovement();

    // Animate water
    if (surf) surf.update(delta, character.position.x);

    // Animate sparks
    for (let i = sparks.length - 1; i >= 0; i--) {
      const spark = sparks[i];
      const move = spark.direction.clone().multiplyScalar(SPARK_SPEED * delta);
      spark.mesh.position.add(move);
      spark.distance += move.length();
      // a spark diving into the sea splashes where it went in (and is removed below)
      if (surf && spark.direction.y < 0 && spark.mesh.position.y < 40) {
        const p = spark.mesh.position, wy = surf.waterY(p.x, p.z);
        if (wy != null && p.y < wy) {
          const back = Math.min((wy - p.y) / -spark.direction.y, move.length());
          surf.splash(p.x - spark.direction.x * back, p.z - spark.direction.z * back, 1);
          spark.distance = SPARK_MAX_DIST + 1;
        }
      }

      if (spark.enableTrail) {
        if (!spark.lastTrailPos || spark.mesh.position.distanceTo(spark.lastTrailPos) > 4) {
          // Count blue trails in this spark's trail
          let blueTrailCount = 0;
          if (spark.trail) {
            for (const t of spark.trail) {
              if (t.blueMesh) blueTrailCount++;
            }
          }

          let blueTrailSphere = null;
          if (blueTrailCount < 2) {
            blueTrailSphere = getTrailMesh(0x2196f3, 0.18, 0.7);
            blueTrailSphere.position.copy(spark.mesh.position);
            scene.add(blueTrailSphere);
          }

          const trailSphere = getTrailMesh(0xffffff, 0.29, 0.45);
          trailSphere.position.copy(spark.mesh.position);
          scene.add(trailSphere);

          spark.trail = spark.trail || [];
          spark.trail.push({ mesh: trailSphere, blueMesh: blueTrailSphere, life: 0.5 });
          spark.lastTrailPos = spark.mesh.position.clone();
        }

        if (spark.trail) {
          for (let j = spark.trail.length - 1; j >= 0; j--) {
            const t = spark.trail[j];
            t.life -= delta;
            t.mesh.material.opacity = Math.max(0, t.life * 1.4);
            if (t.blueMesh) t.blueMesh.material.opacity = Math.max(0, t.life * 1.2);
            if (t.life <= 0) {
              scene.remove(t.mesh);
              releaseTrailMesh(t.mesh);
              if (t.blueMesh) {
                scene.remove(t.blueMesh);
                releaseTrailMesh(t.blueMesh);
              }
              spark.trail.splice(j, 1);
            }
          }
        }
      }

      if (spark.distance > SPARK_MAX_DIST || spark.mesh.position.y < 0) {
        scene.remove(spark.mesh);
        releaseSparkMesh(spark.mesh); // <-- Pool it after removal

        if (spark.trail) {
          for (const t of spark.trail) {
            scene.remove(t.mesh);
            if (t.mesh) releaseTrailMesh(t.mesh);
            if (t.blueMesh) {
              scene.remove(t.blueMesh);
              releaseTrailMesh(t.blueMesh);
            }
          }
        }
        sparks.splice(i, 1);
      }
    }

    // Animate wand
    if (wand && wandIsAnimating) {
      const t = Math.max(wandAnimTimer / 0.18, 0);
      wand.position.lerpVectors(wandFlickPosition, wandBasePosition, 1 - t);
      wand.rotation.x = wandFlickRotation.x * t + wandBaseRotation.x * (1 - t);
      wand.rotation.y = wandFlickRotation.y * t + wandBaseRotation.y * (1 - t);
      wand.rotation.z = wandFlickRotation.z * t + wandBaseRotation.z * (1 - t);
      wandAnimTimer -= delta;
      if (wandAnimTimer <= 0) {
        wand.position.copy(wandBasePosition);
        wand.rotation.copy(wandBaseRotation);
        wandIsAnimating = false;
      }
    }
    if (wand) {
      if ((keys.w || keys.a || keys.s || keys.d) && !isJumping) {
        wandWobbleTime += delta * 8;
        wand.position.z = wandBasePosition.z + Math.sin(wandWobbleTime) * 0.18;
        wand.position.y = wandBasePosition.y + Math.abs(Math.sin(wandWobbleTime)) * 0.10;
      } else if (isJumping) {
        wandWobbleTime += delta * 8;
        wand.position.z = wandBasePosition.z;
        wand.position.y = wandBasePosition.y + Math.sin(wandWobbleTime) * 0.18;
      } else {
        wand.position.z = wandBasePosition.z;
        wand.position.y = wandBasePosition.y;
        wandWobbleTime = 0;
      }
    }
    if (wandLight && wandLight.intensity > 0) {
      wandLight.intensity -= 8 * delta;
      if (wandLight.intensity < 0) wandLight.intensity = 0;
    }

    const px = character.position.x, pz = character.position.z;
    const FADE_START = 300, FADE_END = 150;
    const dists = [
      Math.abs(pz - SEA_MAX_Z), Math.abs(pz - minZ),
      Math.abs(px - minX), Math.abs(px - maxX),
    ];
    for (let i = 0; i < 4; i++) {
      let dist = dists[i];
      let opacity = 0;
      if (dist <= FADE_END) opacity = 1;
      else if (dist < FADE_START) opacity = 1 - (dist - FADE_END) / (FADE_START - FADE_END);
      else opacity = 0;
      borders[i].material.opacity = opacity;
    }
    if (borders[1]) {
      borders[1].material.opacity = 1;
    }
    if (borders && borders.length === 4) {
      borders[0].position.y = 1;
      borders[1].position.y = getGroundHeightAt(0, minZ) + 1;
      borders[2].position.y = getGroundHeightAt(minX, (minZ + maxZ) / 2) + 1;
      borders[3].position.y = getGroundHeightAt(maxX, (minZ + maxZ) / 2) + 1;
    }
  }

  // Animate ghost models
  if (!gamePaused) {
    SPECTRE_FX.uTime.value += delta;
    SPECTRE_FX.uHalfH.value = renderer.getDrawingBufferSize(spectreBuf).y * 0.5;
    for (const ghost of npcs) if (ghost.tick) ghost.tick(delta);
    updateDyingGhosts(delta);
  }
  for (const ghost of npcs) {
    if (ghost.mixer) ghost.mixer.update(delta);
  }

  renderer.render(scene, camera);
}

// === MAIN ===
function main() {
  // Remove old renderer if it exists
  if (renderer && renderer.domElement && renderer.domElement.parentNode) {
    renderer.domElement.parentNode.removeChild(renderer.domElement);
  }
  // Remove old controls event listeners if needed
  if (controls) {
    controls.dispose && controls.dispose();
    controls = null;
  }
  // Reset globals
  scene = null;
  camera = null;
  renderer = null;
  character = null;
  borders = [];
  wand = null;
  wandLight = null;
  wandIsAnimating = false;
  wandAnimTimer = 0;
  wandWobbleTime = 0;
  isJumping = false;
  velocityY = 0;
  ghostStates = {};
  npcs = [];
  dyingGhosts.length = 0;
  sparks.length = 0;
  if (surf) { surf.dispose(); surf = null; }
  // Now re-initialize everything
  initScene();
  initSkyAndLights();
  createWater();
  createBeach();
  createBorders();
  setupInput();
  setupWand();
  if (new URLSearchParams(location.search).has('debug')) {
    window.__beach = { get scene() { return scene; }, get camera() { return camera; }, get character() { return character; },
      get renderer() { return renderer; }, get surf() { return surf; }, get npcs() { return npcs; }, sea, keys, shootSpark,
      get paused() { return gamePaused; }, set paused(v) { gamePaused = v; }, // the preview has no pointer lock
      SpectreGhost, dyingGhosts, frostLevel, SPECTRE_FX, // for spectre stills
      // advance the player and the sea by n frames without rAF (for headless tests)
      step(n = 1) { for (let i = 0; i < n; i++) { updateMovement(); surf.update(1 / 60, character.position.x); } } };
  }
  animate();
}