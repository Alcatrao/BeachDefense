import * as THREE from 'three';
import { Water } from 'Water';
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

const FLAT_SAND_WIDTH = 100; // Flat for 100 units from the sealine
const DUNE_WIDTH = 100; // Dune region width
const DUNE_MAX_HEIGHT = 50;
const DUNE_START = -BORDER_LENGTH_Z + DUNE_WIDTH; 
const DUNE_END = -BORDER_LENGTH_Z - DUNE_WIDTH * 2;   

const MAX_ACTIVE_SPARKS = 30;
            

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


// === INIT FUNCTIONS ===
function initScene() {
  scene = new THREE.Scene();
  character = new THREE.Object3D();

  // Spawn at center of playable area, slightly above ground
  const spawnZ = -300; // 100 units inland from the sealine
  const spawnX = 0;
  const groundY = getGroundHeightAt(spawnX, spawnZ);
  character.position.set(spawnX, groundY + 10, spawnZ); // +10 to spawn slightly above ground


  scene.add(character);

  camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 1, 20000);
  character.add(camera);

  renderer = new THREE.WebGLRenderer();
  renderer.setSize(window.innerWidth, window.innerHeight);
  document.body.appendChild(renderer.domElement);

  controls = new PointerLockControls(character, renderer.domElement);

  // Listen for pointer lock change
  controls.addEventListener('lock', () => {
    const hint = document.getElementById('focusHint');
    if (hint) hint.style.display = 'none';
    gamePaused = false;
    document.getElementById('pauseMenu').style.display = 'none';
  });
  controls.addEventListener('unlock', () => {
    // Only show pause menu if game is active and player is alive
    if (gameActive && playerAlive) {
      gamePaused = true;
      document.getElementById('pauseMenu').style.display = 'flex';
    }
    const hint = document.getElementById('focusHint');
    if (hint) hint.style.display = 'none';
  });

  // Only lock pointer on canvas click, not on every click
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
  // Only cover the sea (z >= 0)
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
  // Position so front edge is at z = -100, extending to positive z
  water.position.set(0, 0, MAP_SIZE / 4 - 150); // y = 0, z = (MAP_SIZE/4 - 109)
  scene.add(water);

  // Manipulate vertices for waves
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

// Set repeat and wrapping for all maps
[sandColorMap, sandNormalMap, sandRoughnessMap, sandAoMap, sandHeightMap].forEach(tex => {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(100, 100);
});

// Use MeshStandardMaterial for PBR
const beachMaterial = new THREE.MeshStandardMaterial({
  map: sandColorMap,
  normalMap: sandNormalMap,
  roughnessMap: sandRoughnessMap,
  aoMap: sandAoMap,
  displacementMap: sandHeightMap,
  displacementScale: 2, // Adjust for effect strength
  roughness: .5, // Default, can tweak
  metalness: 0.0, // Sand is not metallic
});

  const beachGeometry = new THREE.PlaneGeometry(BEACH_WIDTH, BEACH_HEIGHT, BEACH_SEGMENTS, BEACH_SEGMENTS);

  // Parameters for the wavy sealine
  const SEALINE_WAVE_AMPLITUDE = 30; // How far the sealine moves inland/outland
  const SEALINE_WAVE_FREQUENCY = 2;  // Number of waves across the beach width

  const positionAttribute = beachGeometry.attributes.position;
  const SEALINE_EXTENSION = 10; // How far to extend sand under the water (in units)

const SAND_HEIGHT_OFFSET = 0.5; // Always keep sand above y=0

for (let i = 0; i < positionAttribute.count; i++) {
  const x = positionAttribute.getX(i);
  const y = positionAttribute.getY(i);

  // Normalize x to [0, 1] across the whole visible beach, shifted 600 units to the left
const nx = ((x + 600) - minX) / (maxX - minX);

// Curvy sealine across the entire width, with large, gentle curves and negative bias
let sealineOffset =
  Math.sin(nx * Math.PI * 1) * 60 +   // One big, smooth curve
  Math.sin(nx * Math.PI * 2) * 20     // Gentle secondary undulation
  + 50;                               // Negative bias to keep shoreline always inland      // Negative bias to keep shoreline always inland

// Example: bay in the rightmost 40% of the visible area (optional)
if (nx >= 0.6 && nx <= 1.0) {
  const t = (nx - 0.6) / 0.4;
  const smoothT = t * t * (3 - 2 * t);
  const bay = Math.sin(t * Math.PI) * 100;
  sealineOffset += smoothT * bay;
}
  // === End bay logic ===

  const zRaw = - (y + BEACH_HEIGHT / 2) - sealineOffset;

  // Clamp so sand never goes above z = -SEALINE_EXTENSION (always fills under water)
  const z = Math.max(zRaw, -BEACH_HEIGHT); // Don't go further inland than -BEACH_HEIGHT
const zClamped = Math.min(z, 0); // Don't go in front of the water (z > 0)

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
    const groundY = getGroundHeightAt(character.position.x, character.position.z);
    if (character.position.y <= groundY) {
      character.position.y = groundY;
      isJumping = false;
      velocityY = 0;
    }
  } else {
    character.position.y = getGroundHeightAt(character.position.x, character.position.z);
  }

  // Clamp to box
  character.position.x = Math.max(minX, Math.min(maxX, character.position.x));
  character.position.z = Math.max(minZ, Math.min(maxZ, character.position.z));
}

// === GROUND HEIGHT ===
function getGroundHeightAt(x, z) {
  let height = SEA_LEVEL_OFFSET;
  if (z >= -FLAT_SAND_WIDTH) {
    // Flat sand near the sea
    height = SEA_LEVEL_OFFSET;
  } else if (z < -FLAT_SAND_WIDTH && z >= DUNE_START) {
    // Gentle rise after flat area, up to the dunes
    const t = (z + FLAT_SAND_WIDTH) / (DUNE_START + FLAT_SAND_WIDTH); // t from 0 (at -FLAT_SAND_WIDTH) to 1 (at DUNE_START)
    height = t * 20 + SEA_LEVEL_OFFSET;
  } else if (z < DUNE_START && z >= DUNE_END) {
    // Dune region (at the back)
    const t = (DUNE_START - z) / (DUNE_START - DUNE_END); // 0 at start, 1 at end
    const smooth = t * t * (3 - 2 * t); // smoothstep
    height = SEA_LEVEL_OFFSET + 20 + smooth * DUNE_MAX_HEIGHT;
  } else if (z < DUNE_END) {
    // Beyond dune: keep at max height
    height = SEA_LEVEL_OFFSET + 20 + DUNE_MAX_HEIGHT;
  }
  return height + 10; // +10 to keep character above ground
}

// === WAND & SPARKS ===
function setupWand() {
  const gltfLoader = new GLTFLoader();
  gltfLoader.setPath('../assets/');
  gltfLoader.load('Yew_Wand.glb', (gltf) => {
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
  // Main spark (always released)
  const spark = new THREE.Mesh(
    new THREE.SphereGeometry(2, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  spark.position.copy(wandTip);
  scene.add(spark);

  // Only add trail/effects if under MAX_ACTIVE_SPARKS
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

// === NPC GHOSTS ===
import { FBXLoader } from 'https://unpkg.com/three@0.155.0/examples/jsm/loaders/FBXLoader.js';

let npcs = [];
let npcSpawnTimer = 0;
let npcSpawnInterval = 10; // seconds
let npcWave = 1;
let gameActive = false;
let playerAlive = true;
let ghostModel = null;

// Load ghost model once
function loadGhostModel(callback) {
  const loader = new FBXLoader();
  loader.setPath('./assets/Ghost/');
  loader.load('Halloween Ghost.fbx', (fbx) => {
    // fbx is a THREE.Group
    let meshCount = 0;
    fbx.traverse(child => {
      if (child.isMesh) {
        child.material.transparent = true;
        child.material.opacity = 0.95;
        child.castShadow = true;
        meshCount++;
        console.log("Found mesh:", child.name, child);
      }
    });
    console.log("Total meshes found:", meshCount);

    // FBXLoader puts animations on the object itself
    let animations = fbx.animations || [];
    if (animations.length > 0) {
      animations.forEach((clip, i) => {
        console.log(i, clip.name);
      });
    }

    ghostModel = { scene: fbx, animations: animations };
    if (callback) callback();
  });
}

// Spawn NPCs
function spawnNPCs() {
  if (!ghostModel) return;
  const count = Math.ceil(npcWave * 1.3);
  for (let i = 0; i < count; i++) {
    const ghost = new Ghost(ghostModel, npcWave);
    npcs.push(ghost);
  }
  npcWave++;
  npcSpawnTimer = 0;
}

// Update NPCs
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

    // Check player proximity
    const dx = character.position.x - pos.x;
    const dz = character.position.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);

    if (dist < 150) {
      ghost.mesh.userData.state = 'chasePlayer';
      target = ghost.isAirGhost
        ? { x: character.position.x, z: character.position.z, y: character.position.y + 10 } // chase player in 3D
        : { x: character.position.x, z: character.position.z };
    } else if (ghost.mesh.userData.state === 'chasePlayer') {
      ghost.mesh.userData.state = 'toDunes';
      target = ghost.isAirGhost
        ? { x: pos.x, z: -800, y: ghost.airTargetY }
        : { x: pos.x, z: -800 };
    }

    // --- Movement ---
    const speed = (0.7 + Math.random() * 0.2) * 1.5;
    const tx = target.x - pos.x;
    const tz = target.z - pos.z;
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

    if (len > 1) {
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

// Remove NPC if hit by spark
function checkSparkHits() {
  for (let i = npcs.length - 1; i >= 0; i--) {
    const npc = npcs[i];
    for (let j = sparks.length - 1; j >= 0; j--) {
      const spark = sparks[j];
      const dx = spark.mesh.position.x - npc.mesh.position.x;
      const dz = spark.mesh.position.z - npc.mesh.position.z;
      const dy = spark.mesh.position.y - npc.mesh.position.y;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (dist < 10) {
        scene.remove(npc.mesh);
        npcs.splice(i, 1);
        break;
      }
    }
  }
}

// === GAME STATE & MENUS ===
function showMenu(id, show) {
  const el = document.getElementById(id);
  if (el) el.style.display = show ? 'flex' : 'none';
}

function startGame() {
  // Reset game state variables
  gameActive = true;
  playerAlive = true;
  npcWave = 1; // Reset wave count
  npcSpawnTimer = 0;
  isJumping = false;
  velocityY = 0;
  wandIsAnimating = false;
  wandAnimTimer = 0;
  wandWobbleTime = 0;
  keys.w = keys.a = keys.s = keys.d = keys.space = false;
  ghostStates = {};
  survivalTime = 0;

  // Remove all ghosts from scene and array
  for (let i = npcs.length - 1; i >= 0; i--) {
    scene.remove(npcs[i].mesh);
    npcs.splice(i, 1);
  }

  // Remove all sparks
  if (sparks && sparks.length) {
    for (let i = sparks.length - 1; i >= 0; i--) {
      scene.remove(sparks[i].mesh);
      if (sparks[i].trail) {
        for (const t of sparks[i].trail) {
          if (t.mesh) scene.remove(t.mesh);
          if (t.blueMesh) scene.remove(t.blueMesh);
        }
      }
      sparks.splice(i, 1);
    }
  }

  // Reset player position and orientation
  if (character) {
    const spawnZ = -300;
    const spawnX = 0;
    const groundY = getGroundHeightAt(spawnX, spawnZ);
    character.position.set(spawnX, groundY + 10, spawnZ);
    character.rotation.set(0, 0, 0); // Reset orientation
    if (camera) camera.rotation.set(0, 0, 0); // Also reset camera if needed
  }

  // Reset wand position and rotation
  if (wand) {
    wand.position.copy(wandBasePosition);
    wand.rotation.copy(wandBaseRotation);
  }

  // Hide menus and score
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


    // Show score
  const scoreEl = document.getElementById('scoreMessage');
  if (scoreEl) {
    scoreEl.innerText = `Score: ${Math.floor(survivalTime)} seconds survived`;
    scoreEl.style.display = 'block';
  }

  // Hide all buttons in endMenu except restart
  const endMenu = document.getElementById('endMenu');
  if (endMenu) {
    // Hide all buttons
    const buttons = endMenu.querySelectorAll('button');
    buttons.forEach(btn => btn.style.display = 'none');
    // Show restart and go back to main menu buttons
    const restartBtn = document.getElementById('restartButton');
    if (restartBtn) restartBtn.style.display = 'inline-block';
    const backBtn = document.getElementById('backToMenuButton');
if (backBtn) backBtn.style.display = 'inline-block';
  }

  // Hide the focus hint if visible
  const hint = document.getElementById('focusHint');
  if (hint) hint.style.display = 'none';

  // Exit pointer lock to free the mouse for menu interaction
  if (document.exitPointerLock) {
    document.exitPointerLock();
  } else if (document.mozExitPointerLock) {
    document.mozExitPointerLock();
  }
}



// Boot function to set up menus and pointer lock
let ghostModelLoaded = false;

function boot() {
  loadGhostModel(() => {
    ghostModelLoaded = true;
    showMenu('startMenu', true);
    document.getElementById('loadingMessage').style.display = 'none';
  });

  document.getElementById('startButton').onclick = () => {
  if (!ghostModelLoaded) {
    document.getElementById('loadingMessage').style.display = 'block';
    return;
  }
  startGame();
  showMenu('startMenu', false);
  main();      // Only called once, on first start
  spawnNPCs();
  // Optionally, disable this button after first use to prevent double main()
};

document.getElementById('restartButton').onclick = () => {
  if (!ghostModelLoaded) {
    document.getElementById('loadingMessage').style.display = 'block';
    return;
  }
  startGame();
  showMenu('endMenu', false);
  spawnNPCs(); // Only reset state and spawn new NPCs
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

// Only call boot() on page load
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

  // --- TRAIL LOGIC ---
  if (spark.enableTrail) {
    if (!spark.lastTrailPos || spark.mesh.position.distanceTo(spark.lastTrailPos) > 4) {
      // Blue trail sphere
      const blueTrailSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.18, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0x2196f3, transparent: true, opacity: 0.7, depthWrite: false })
      );
      blueTrailSphere.position.copy(spark.mesh.position);
      scene.add(blueTrailSphere);

      // White trail sphere
      const trailSphere = new THREE.Mesh(
        new THREE.SphereGeometry(0.29, 6, 6),
        new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.45, depthWrite: false })
      );
      trailSphere.position.copy(spark.mesh.position);
      scene.add(trailSphere);

      spark.trail = spark.trail || [];
      spark.trail.push({ mesh: trailSphere, blueMesh: blueTrailSphere, life: 0.5 });
      spark.lastTrailPos = spark.mesh.position.clone();
    }

    // Animate and fade trail
    if (spark.trail) {
      for (let j = spark.trail.length - 1; j >= 0; j--) {
        const t = spark.trail[j];
        t.life -= delta;
        t.mesh.material.opacity = Math.max(0, t.life * 1.4);
        t.blueMesh.material.opacity = Math.max(0, t.life * 1.2);
        if (t.life <= 0) {
          scene.remove(t.mesh);
          scene.remove(t.blueMesh);
          spark.trail.splice(j, 1);
        }
      }
    }
  }

  // Remove spark if too far or below ground
  if (spark.distance > SPARK_MAX_DIST || spark.mesh.position.y < 0) {
    scene.remove(spark.mesh);
    if (spark.trail) {
      for (const t of spark.trail) {
        scene.remove(t.mesh);
        scene.remove(t.blueMesh);
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
    // Wand wobble
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
    // Fade wand light
    if (wandLight && wandLight.intensity > 0) {
      wandLight.intensity -= 8 * delta;
      if (wandLight.intensity < 0) wandLight.intensity = 0;
    }

    // Border fade logic
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

    // Always show the dune border (back border at minZ)
    if (borders[1]) {
      borders[1].material.opacity = 1;
    }

    // Update border Y positions to follow ground height
if (borders && borders.length === 4) {
  // Top border (sea side)
  borders[0].position.y = getGroundHeightAt(0, maxZ) + 1;
  // Dune border (back)
  borders[1].position.y = getGroundHeightAt(0, minZ) + 1;
  // Left border
  borders[2].position.y = getGroundHeightAt(minX, (minZ + maxZ) / 2) + 1;
  // Right border
  borders[3].position.y = getGroundHeightAt(maxX, (minZ + maxZ) / 2) + 1;
}
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

class Ghost {
  constructor(modelObj, wave) {
    // modelObj: { scene, animations }
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

    // Scale ghost to height 15 units
    scene.add(this.mesh);
    this.mesh.updateMatrixWorld(true);
    let box = new THREE.Box3().setFromObject(this.mesh);
    let originalHeight = box.max.y - box.min.y;
    if (!isFinite(originalHeight) || originalHeight <= 0) {
      this.mesh.scale.setScalar(0.1);
    } else {
      const scale = 15 / originalHeight;
      this.mesh.scale.setScalar(scale);
    }

    // AIR GHOST LOGIC
    this.isAirGhost = Math.random() < 0.5;
    let y;
    if (this.isAirGhost) {
      y = 15 + Math.random() * 45; // 15 to 60
      this.airTargetY = 40 + Math.random() * 20; // 40 to 60
    } else {
      y = getGroundHeightAt(0, 0); // will be set properly below
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

    // Animation
    if (modelObj.animations && modelObj.animations.length > 0) {
      this.mixer = new THREE.AnimationMixer(this.mesh);
      this.action = this.mixer.clipAction(modelObj.animations[0]);
      this.action.play();
    }
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

  setOpacity(opacity, transparent) {
    this.mesh.traverse(child => {
      if (child.material && child.material.opacity !== undefined) {
        child.material.transparent = transparent;
        child.material.opacity = opacity;
      }
    });
  }
}

// In your animate() loop:
for (const ghost of npcs) {
  if (ghost.mixer) ghost.mixer.update(delta);
}


