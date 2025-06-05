import * as THREE from 'three';
import { Water } from 'Water';
import { Sky } from 'Sky';
import { PointerLockControls } from 'PointerLockControls';
import { GLTFLoader } from 'https://unpkg.com/three@0.155.0/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'https://unpkg.com/three@0.155.0/examples/jsm/loaders/FBXLoader.js';
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
const keys = { w: false, a: false, s: false, d: false, space: false };
const sparks = [];
const SPARK_SPEED = 1000, SPARK_MAX_DIST = 1500;

// === GHOST MODELS ===
let npcs = [];
let npcSpawnTimer = 0;
let npcSpawnInterval = 15; // seconds
let npcWave = 1;
let gameActive = false;
let playerAlive = true;
let halloweenGhostModel = null;
let khaimeraGhostModel = null;

// === GHOST CLASSES ===
class Ghost {
  constructor(modelObj, wave, options = {}) {
    this.HP = options.HP || 1;
    this.speed = options.speed || 1;
    this.size = options.size || 15;
    this.chaseDistance = options.chaseDistance || 150; // Default chase distance
    this.hitboxRadius = (options.hitboxRadius || this.size * 0.5) * 1.3;
    this.mesh = SkeletonUtils.clone(modelObj.scene);
    

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

    // Set hitbox radius to cover the whole height
    this.hitboxRadius = this.height / 2;

    // Set hitbox center to the middle of the model
    this.hitboxCenter = new THREE.Vector3(
      this.mesh.position.x,
      this.mesh.position.y + this.height / 2,
      this.mesh.position.z
    );

    // Animation
    if (modelObj.animations && modelObj.animations.length > 0) {
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

// Halloween Ghost (fading, blinking, air/ground)
class HalloweenGhost extends Ghost {
  constructor(modelObj, wave) {
    super(modelObj, wave, {
      HP: 1,
      speed: 0.9,
      size: 15,
      chaseDistance: 150
    });

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
  renderer.setSize(window.innerWidth, window.innerHeight);
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

function initSkyAndLights() {
  const sky = new Sky();
  sky.scale.setScalar(10000);
  scene.add(sky);
  const skyUniforms = sky.material.uniforms;
  skyUniforms['turbidity'].value = 8;
  skyUniforms['rayleigh'].value = 3;
  skyUniforms['mieCoefficient'].value = 0.005;
  skyUniforms['mieDirectionalG'].value = 0.7;
  const sun = new THREE.Vector3();
  const phi = THREE.MathUtils.degToRad(90 - 15);
  const theta = THREE.MathUtils.degToRad(0);
  sun.setFromSphericalCoords(1, phi, theta);
  sky.material.uniforms['sunPosition'].value.copy(sun);

  scene.add(new THREE.AmbientLight(0xffffff, 2.9));
  const directionalLight = new THREE.DirectionalLight(0xffffff, 2);
  directionalLight.position.set(-1000, 1000, 1000);
  scene.add(directionalLight);
}

function createWater() {
  const waterGeometry = new THREE.PlaneGeometry(MAP_SIZE, MAP_SIZE / 2, 200, 100);
  const water = new Water(waterGeometry, {
    textureWidth: 512,
    textureHeight: 512,
    waterNormals: new THREE.TextureLoader().load('./textures/waternormals.jpg', function (texture) {
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    }),
    sunDirection: new THREE.Vector3(),
    sunColor: 0xfff8e7,
    waterColor: 0x46bcec,
    distortionScale: 4.5,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.set(0, 0, MAP_SIZE / 4 - 150);
  scene.add(water);

  const waterPosition = waterGeometry.attributes.position;
  for (let i = 0; i < waterPosition.count; i++) {
    const x = waterPosition.getX(i);
    const y = waterPosition.getY(i);
    if (y > 0) {
      const waveHeight = (y / 5000) * Math.sin((x / 500) * Math.PI * 2);
      waterPosition.setZ(i, waveHeight);
    } else {
      waterPosition.setZ(i, 0);
    }
  }
  waterPosition.needsUpdate = true;
  return water;
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

    const zRaw = - (y + BEACH_HEIGHT / 2) - sealineOffset;
    const z = Math.max(zRaw, -BEACH_HEIGHT);
    const zClamped = Math.min(z, 0);

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

    positionAttribute.setY(i, height);
    positionAttribute.setZ(i, zClamped);
  }
  positionAttribute.needsUpdate = true;

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
  });
  borders = [
    new THREE.Mesh(new THREE.BoxGeometry(BORDER_LENGTH_X, borderHeight, borderThickness), edgeMaterial.clone()),
    new THREE.Mesh(new THREE.BoxGeometry(BORDER_LENGTH_X, borderHeight, borderThickness), edgeMaterial.clone()),
    new THREE.Mesh(new THREE.BoxGeometry(borderThickness, borderHeight, BORDER_LENGTH_Z), edgeMaterial.clone()),
    new THREE.Mesh(new THREE.BoxGeometry(borderThickness, borderHeight, BORDER_LENGTH_Z), edgeMaterial.clone()),
  ];
  borders[0].position.set(0, borderHeight / 2 + borderYOffset, maxZ);
  borders[1].position.set(0, borderHeight / 2 + borderYOffset, minZ);
  borders[2].position.set(minX, borderHeight / 2 + borderYOffset, (minZ + maxZ) / 2);
  borders[3].position.set(maxX, borderHeight / 2 + borderYOffset, (minZ + maxZ) / 2);
  for (const mesh of borders) scene.add(mesh);
}

// === MOVEMENT & INPUT ===
function setupInput() {
  document.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();
    if (key === " " || key === "space") keys.space = true;
    else if (keys.hasOwnProperty(key)) keys[key] = true;
  });
  document.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    if (key === " " || key === "space") keys.space = false;
    else if (keys.hasOwnProperty(key)) keys[key] = false;
  });
}

function updateMovement() {
  const moveDistance = 1.8;
  const direction = new THREE.Vector3();
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward); forward.y = 0; forward.normalize();
  const left = new THREE.Vector3(); left.crossVectors(camera.up, forward).normalize();

  if (keys.w) direction.add(forward);
  if (keys.s) direction.sub(forward);
  if (keys.a) direction.add(left);
  if (keys.d) direction.sub(left);

  if (direction.length() > 0) {
    direction.normalize().multiplyScalar(moveDistance);
    character.position.add(direction);
  }

  // Jumping
  if (keys.space && !isJumping) {
    isJumping = true;
    velocityY = jumpStrength;
  }
  if (isJumping) {
  velocityY += gravity;
  character.position.y += velocityY;
  const groundY = getGroundHeightAt(character.position.x, character.position.z) + 10;
  if (character.position.y <= groundY) {
    character.position.y = groundY;
    isJumping = false;
    velocityY = 0;
  }
} else {
  character.position.y = getGroundHeightAt(character.position.x, character.position.z) + 10;
}

  // Clamp to box
  character.position.x = Math.max(minX, Math.min(maxX, character.position.x));
  character.position.z = Math.max(minZ, Math.min(maxZ, character.position.z));
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

  // Halloween Ghost (FBX)
  const fbxLoader = new FBXLoader();
  fbxLoader.setPath('./assets/Ghost/');
  fbxLoader.load('Halloween Ghost.fbx', (fbx) => {
    fbx.traverse(child => {
      if (child.isMesh) {
        child.material.transparent = true;
        child.material.opacity = 0.95;
        child.castShadow = true;
      }
    });
    halloweenGhostModel = { scene: fbx, animations: fbx.animations || [] };
    check();
  });

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
  if (!halloweenGhostModel || !khaimeraGhostModel) return;
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
  // Spawn Halloween ghosts for the rest
  for (let i = khaimeraCount; i < count; i++) {
    const ghost = new HalloweenGhost(halloweenGhostModel, npcWave);
    npcs.push(ghost);
  }
  npcWave++;
  npcSpawnTimer = 0;
}

// === NPC UPDATE ===
function updateNPCs(delta) {
  if (!gameActive || !playerAlive) return;
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

    // Fading and blinking
    ghost.updateFadeAndBlink(delta, character.position);

    // Check win condition
    if (pos.z <= -700) {
      endGame(false); // NPCs win
      return;
    }
    // Check kill player
    if (ghost.mesh.userData.state === 'chasePlayer' && dist < 5) {
      endGame(true); // Player killed
      return;
    }
  }
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
  keys.w = keys.a = keys.s = keys.d = keys.space = false;
  ghostStates = {};
  survivalTime = 0;

  for (let i = npcs.length - 1; i >= 0; i--) {
    scene.remove(npcs[i].mesh);
    npcs.splice(i, 1);
  }

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
  };

  document.getElementById('restartButton').onclick = () => {
    if (!ghostModelsLoaded) {
      document.getElementById('loadingMessage').style.display = 'block';
      return;
    }
    startGame();
    showMenu('endMenu', false);
    spawnNPCs();
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
    const water = scene.children.find(obj => obj instanceof Water);
    if (water) water.material.uniforms['time'].value += delta;

    // Animate sparks
    for (let i = sparks.length - 1; i >= 0; i--) {
      const spark = sparks[i];
      const move = spark.direction.clone().multiplyScalar(SPARK_SPEED * delta);
      spark.mesh.position.add(move);
      spark.distance += move.length();

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
      Math.abs(pz - maxZ), Math.abs(pz - minZ),
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
      borders[0].position.y = getGroundHeightAt(0, maxZ) + 1;
      borders[1].position.y = getGroundHeightAt(0, minZ) + 1;
      borders[2].position.y = getGroundHeightAt(minX, (minZ + maxZ) / 2) + 1;
      borders[3].position.y = getGroundHeightAt(maxX, (minZ + maxZ) / 2) + 1;
    }
  }

  // Animate ghost models
  for (const ghost of npcs) {
    if (ghost.mixer) ghost.mixer.update(delta);
  }

  renderer.render(scene, camera);
}

// === MAIN ===
function main() {
  initScene();
  initSkyAndLights();
  createWater();
  createBeach();
  createBorders();
  setupInput();
  setupWand();
  animate();
}