import * as THREE from 'three';
import { Water } from 'Water';
import { Sky } from 'Sky';
import { PointerLockControls } from 'PointerLockControls';
import { GLTFLoader } from 'https://unpkg.com/three@0.155.0/examples/jsm/loaders/GLTFLoader.js';


// Create scene
const scene = new THREE.Scene();

// Create a character object and add it to the scene
const character = new THREE.Object3D();
character.position.set(0, 10, 0);
scene.add(character);

// Box border for testing boundaries
const BOX_SIZE = 1000;
const BOX_HALF = BOX_SIZE / 2;
const BORDER_WARNING_DIST = 5;

// Border dimensions
const BORDER_LENGTH_X = 1290; // Length parallel to the sea (front/back)
const BORDER_LENGTH_Z = 600;  // Length perpendicular to the sea (left/right)

const BORDER_HALF_X = BORDER_LENGTH_X / 2;
const BORDER_HALF_Z = BORDER_LENGTH_Z / 2;

// The box front edge (sealine) is at z = 0, so the box extends from z = 0 to z = -BORDER_LENGTH_Z
const boxCenter = new THREE.Vector3(0, 0, -BORDER_HALF_Z);

// Create border geometry (square)
const borderGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(-BOX_HALF, 0.5, -BOX_HALF),
  new THREE.Vector3( BOX_HALF, 0.5, -BOX_HALF),
  new THREE.Vector3( BOX_HALF, 0.5,  BOX_HALF),
  new THREE.Vector3(-BOX_HALF, 0.5,  BOX_HALF),
  new THREE.Vector3(-BOX_HALF, 0.5, -BOX_HALF),
]);
const borderMaterial = new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: 4 });


// Clamp player to box (after updating position)
  const minX = -BORDER_HALF_X;
  const maxX =  BORDER_HALF_X;
  const minZ = -BORDER_LENGTH_Z;
  const maxZ = 0; // Sealine, do not allow z > 0 (sea)



// Create thick border edges as meshes
const borderThickness = 8; // Thickness of the border edges
const borderHeight = 2; // Make it even taller for visibility

const edgeMaterial = new THREE.MeshPhongMaterial({
  color: 0xffffff,
  emissive: 0xffffff,
  emissiveIntensity: 1,
});

const borders = [
  // Front (sealine, z = 0)
  new THREE.Mesh(
    new THREE.BoxGeometry(BORDER_LENGTH_X, borderHeight, borderThickness),
    edgeMaterial.clone()
  ),
  // Back (inland, z = -BORDER_LENGTH_Z)
  new THREE.Mesh(
    new THREE.BoxGeometry(BORDER_LENGTH_X, borderHeight, borderThickness),
    edgeMaterial.clone()
  ),
  // Left (x = minX)
  new THREE.Mesh(
    new THREE.BoxGeometry(borderThickness, borderHeight, BORDER_LENGTH_Z),
    edgeMaterial.clone()
  ),
  // Right (x = maxX)
  new THREE.Mesh(
    new THREE.BoxGeometry(borderThickness, borderHeight, BORDER_LENGTH_Z),
    edgeMaterial.clone()
  ),
];

// Position borders
const borderYOffset = 0; // Try a higher value for more visibility

borders[0].position.set(0, borderHeight / 2 + borderYOffset, maxZ); // front
borders[1].position.set(0, borderHeight / 2 + borderYOffset, minZ); // back
borders[2].position.set(minX, borderHeight / 2 + borderYOffset, (minZ + maxZ) / 2); // left
borders[3].position.set(maxX, borderHeight / 2 + borderYOffset, (minZ + maxZ) / 2); // right

// When creating borders, make them transparent
for (const mesh of borders) {
  mesh.visible = true; // Always visible, but faded
  mesh.material.transparent = true;
  mesh.material.opacity = 0; // Start fully transparent
  scene.add(mesh);
}




// Create camera and attach it to the character (e.g. at eye level)
const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  1,
  20000
);
//camera.position.set(0, 0, 0);
// Tilt the camera slightly upward (negative X rotation)
//camera.rotation.x = -Math.PI / 12; // About -15 degrees upward
character.add(camera);

// Create the renderer and append it
const renderer = new THREE.WebGLRenderer();
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);


// Request pointer lock on click (hides pointer and locks it at the center)
const controls = new PointerLockControls(character, document.body); // Apply controls to the character

// Add event listener to enable pointer lock on click
document.addEventListener('click', () => {
    controls.lock();
});

// Update character movement state and add jump functionality
const keys = { w: false, a: false, s: false, d: false, space: false };
let isJumping = false; // Track if the character is currently jumping
let velocityY = 0; // Vertical velocity for jumping
const gravity = -0.02; // Gravity effect
const jumpStrength = 0.5; // Jump strength

document.addEventListener('keydown', (event) => {
  const key = event.key.toLowerCase();
  if (key === " " || key === "space") { // Handle both "space" and " " for the spacebar
    keys.space = true;
  } else if (keys.hasOwnProperty(key)) {
    keys[key] = true;
  }
});

document.addEventListener('keyup', (event) => {
  const key = event.key.toLowerCase();
  if (key === " " || key === "space") { // Handle both "space" and " " for the spacebar
    keys.space = false;
  } else if (keys.hasOwnProperty(key)) {
    keys[key] = false;
  }
});

// Update character movement based on key input
function updateMovement() {
  const moveDistance = 1.8;
  const direction = new THREE.Vector3();

  // Get the camera's forward direction (ignoring vertical component)
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward);
  forward.y = 0;
  forward.normalize();

  // Left vector is computed via cross product (camera.up x forward)
  const left = new THREE.Vector3();
  left.crossVectors(camera.up, forward).normalize();

  if (keys.w) direction.add(forward);
  if (keys.s) direction.sub(forward);
  if (keys.a) direction.add(left);
  if (keys.d) direction.sub(left);

  if (direction.length() > 0) {
    direction.normalize().multiplyScalar(moveDistance);
    character.position.add(direction);
  }

  // Handle jumping
  if (keys.space && !isJumping) {
    isJumping = true;
    velocityY = jumpStrength;
  }

  // Apply gravity and update vertical position
  if (isJumping) {
    velocityY += gravity;
    character.position.y += velocityY;

    // Get ground height at current position
    const groundY = getGroundHeightAt(character.position.x, character.position.z);

    // Stop jumping when the character lands
    if (character.position.y <= groundY) {
      character.position.y = groundY;
      isJumping = false;
      velocityY = 0;
    }
  } else {
    // Not jumping: stick to ground
    const groundY = getGroundHeightAt(character.position.x, character.position.z);
    character.position.y = groundY;
  }

  

  // Prevent going into the water (assume water is at z < boxCenter.z)
  character.position.x = Math.max(minX, Math.min(maxX, character.position.x));
  character.position.z = Math.max(minZ, Math.min(maxZ, character.position.z));
}

// Add Sky
const sky = new Sky();
sky.scale.setScalar(10000);
scene.add(sky);
const skyUniforms = sky.material.uniforms;
skyUniforms['turbidity'].value = 8; // Lower turbidity for a clearer sky
skyUniforms['rayleigh'].value = 3; // Increase Rayleigh scattering for a brighter sky
skyUniforms['mieCoefficient'].value = 0.005;
skyUniforms['mieDirectionalG'].value = 0.7; // Adjust for softer light scattering

const sun = new THREE.Vector3();
const phi = THREE.MathUtils.degToRad(90 - 15); // Low sunset angle
const theta = THREE.MathUtils.degToRad(0);    // Opposite side of the horizon
sun.setFromSphericalCoords(1, phi, theta);
sky.material.uniforms['sunPosition'].value.copy(sun);

// Add ambient light for general illumination
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6); // Increase ambient light intensity
scene.add(ambientLight);

// Add directional light to simulate sunlight
const directionalLight = new THREE.DirectionalLight(0xffffff, 2); // Increase directional light intensity
directionalLight.position.set(-1000, 1000, 1000); // Position the light opposite to the beach
scene.add(directionalLight);

// Add Water
const waterGeometry = new THREE.PlaneGeometry(10000, 10000, 200, 200); // Increase segments for finer wave detail
const water = new Water(waterGeometry, {
  textureWidth: 512,
  textureHeight: 512,
  waterNormals: new THREE.TextureLoader().load('./textures/waternormals.jpg', function (texture) {
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  }),
  sunDirection: new THREE.Vector3(),
  sunColor: 0xfff8e7, // Brighter sun color for reflections
  waterColor: 0x46bcec, // Slightly lighter water color
  distortionScale: 4.5, // Increase distortion for more dynamic reflections
});
water.rotation.x = -Math.PI / 2;
water.material.uniforms['sunDirection'].value.copy(sun).normalize();
scene.add(water);

// Manipulate vertices to create waves in the second half of the water
const waterPosition = waterGeometry.attributes.position;
for (let i = 0; i < waterPosition.count; i++) {
  const x = waterPosition.getX(i);
  const y = waterPosition.getY(i);

  // Divide the water into two halves
  if (y > 0) {
    // Second half: progressively larger waves
    const waveHeight = (y / 5000) * Math.sin((x / 500) * Math.PI * 2); // Adjust wave height and frequency
    waterPosition.setZ(i, waveHeight);
  } else {
    // First half: flat water
    waterPosition.setZ(i, 0);
  }
}
waterPosition.needsUpdate = true;

// Add a sandy beach with dunes along one border
function createBeach() {
  const mapSize = 10000;
  const beachWidth = mapSize;
  const beachHeight = mapSize * 0.5; // Only 50% as deep as water
  const beachSegments = 200;
  const seaLevelOffset = 1; // Offset to ensure sand is slightly above the sea

  // Load the sand texture
  const sandTexture = new THREE.TextureLoader().load('./textures/sand_1.avif');
  sandTexture.wrapS = THREE.RepeatWrapping; // Repeat the texture horizontally
  sandTexture.wrapT = THREE.RepeatWrapping; // Repeat the texture vertically
  sandTexture.repeat.set(10, 10); // Adjust the repetition for better scaling

  // Create the beach geometry and material
  const beachGeometry = new THREE.PlaneGeometry(beachWidth, beachHeight, beachSegments, beachSegments);
  const beachMaterial = new THREE.MeshPhongMaterial({
    map: sandTexture, // Apply the sand texture
    emissive: 0xffd700, // Change emissive color to a brighter yellow (Gold)
    emissiveIntensity: 0.3, // Increase the intensity of the emissive color
    side: THREE.DoubleSide,
    flatShading: false, // Smooth shading for smoother edges
  });

  // Manipulate vertices to create flat sand near the sea, gradual rise, and dunes
  const positionAttribute = beachGeometry.attributes.position;
  for (let i = 0; i < positionAttribute.count; i++) {
    const x = positionAttribute.getX(i);
    const y = positionAttribute.getY(i);

    // Flat sand near the sea (halfline of the map)
    if (y < 5) {
      positionAttribute.setZ(i, seaLevelOffset); // Slightly above sea level
    } 
    // Gradual rise after the flat area
    else if (y < beachHeight * 0.8) { // Gradual rise up to 80% of the beach height
      const z = (y - 5) / (beachHeight * 0.8 - 5) * 20 + seaLevelOffset; // Smooth slope
      positionAttribute.setZ(i, z);
    } 
    // Dunes near the edge of the map (last 20% of the beach height)
    else {
      const z = Math.sin((x / beachWidth) * Math.PI) * 50 + 30 + seaLevelOffset; // Smooth dune height
      positionAttribute.setZ(i, z);
    }
  }
  positionAttribute.needsUpdate = true;

  // Position the beach so its front edge is at the water's front edge
  // Water goes from z = -5000 to z = +5000, so beach should start at z = -5000 + (mapSize * 0.2) / 2
  const beachZ = -mapSize / 2 + beachHeight / 2;
  const beach = new THREE.Mesh(beachGeometry, beachMaterial);
  beach.rotation.x = -Math.PI / 2; // Rotate to lie flat
  beach.position.set(0, 0, beachZ); // Align with water

  scene.add(beach);
}

// Call the function to create the beach
createBeach();

let wand, wandLight, wandIsAnimating = false, wandAnimTimer = 0;
let wandBasePosition = new THREE.Vector3(2.2, -2.2, -3.2);
let wandBaseRotation = new THREE.Euler(Math.PI / 5, Math.PI / 6, Math.PI / 2);
// Flick: only move forward (Z less negative), Y unchanged
let wandFlickPosition = new THREE.Vector3(2.2, -2.2, -2.2); // Z moves forward, Y unchanged
let wandFlickRotation = new THREE.Euler(Math.PI / 4, Math.PI / 6, Math.PI / 2); // Same rotation, or tweak for thrust
let wandWobbleTime = 0;

// Load the wand model and attach to camera
const gltfLoader = new GLTFLoader();
gltfLoader.setPath('../assets/');
gltfLoader.load('Yew_Wand.glb', (gltf) => {
  wand = gltf.scene;
  wand.scale.set(1.2, 1.2, 1.2);
  wand.position.copy(wandBasePosition);
  wand.rotation.copy(wandBaseRotation);

  camera.add(wand);

  // Add a point light to the wand for illumination effect
  wandLight = new THREE.PointLight(0xffffff, 0, 10);
  wandLight.position.set(0, 0, 0);
  wand.add(wandLight);
});

// Sparks
const sparks = [];
const SPARK_SPEED = 300; // units per second
const SPARK_MAX_DIST = 300;

// Spark geometry/material
const sparkGeometry = new THREE.SphereGeometry(0.15, 8, 8);
const sparkMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });

// Shoot spark function
function shootSpark() {
  if (!wand) return;

  // Get direction camera is facing
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);

  // Start position: wand tip in world space
  const wandTip = new THREE.Vector3();
  wand.localToWorld(wandTip.set(0, 0, -2.5)); // Adjust for wand tip

  // Create spark mesh
  const spark = new THREE.Mesh(sparkGeometry, sparkMaterial.clone());
  spark.position.copy(wandTip);
  scene.add(spark);

  sparks.push({
    mesh: spark,
    direction: dir.clone(),
    distance: 0
  });

  // Animate wand
  wandIsAnimating = true;
  wandAnimTimer = 0.18; // seconds

  // Illuminate wand
  if (wandLight) {
    wandLight.intensity = 2.5;
    wandLight.distance = 8;
  }
}

// Animate / render loop
function animate() {
  requestAnimationFrame(animate);

  updateMovement();
  water.material.uniforms['time'].value += 1.0 / 60.0;

  const delta = 1.0 / 60.0;

  // Animate sparks
  for (let i = sparks.length - 1; i >= 0; i--) {
    const spark = sparks[i];
    const move = spark.direction.clone().multiplyScalar(SPARK_SPEED * delta);
    spark.mesh.position.add(move);
    spark.distance += move.length();
    if (spark.distance > SPARK_MAX_DIST || spark.mesh.position.y < 0) {
      scene.remove(spark.mesh);
      sparks.splice(i, 1);
    }
  }

  // Animate wand (dramatic flick)
  if (wand && wandIsAnimating) {
    const t = Math.max(wandAnimTimer / 0.18, 0); // 0.18 is flick duration
    // Interpolate position
    wand.position.lerpVectors(wandFlickPosition, wandBasePosition, 1 - t);
    // Interpolate rotation
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

  // Wand wobble when moving or jumping
  if (wand) {
    if ((keys.w || keys.a || keys.s || keys.d) && !isJumping) {
      // Running: wobble forward/backward and a bit up/down
      wandWobbleTime += delta * 8;
      wand.position.z = wandBasePosition.z + Math.sin(wandWobbleTime) * 0.18;
      wand.position.y = wandBasePosition.y + Math.abs(Math.sin(wandWobbleTime)) * 0.10;
    } else if (isJumping) {
      // Jumping: wobble up/down only
      wandWobbleTime += delta * 8;
      wand.position.z = wandBasePosition.z;
      wand.position.y = wandBasePosition.y + Math.sin(wandWobbleTime) * 0.18;
    } else {
      // Idle: reset
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

  // Border highlight logic
  const px = character.position.x;
  const pz = character.position.z;

  // Fade settings
  const FADE_START = 300; // Fully transparent at this distance or more
  const FADE_END = 150;    // Fully opaque at this distance or less

  // Calculate distances to each border
  const dists = [
    Math.abs(pz - maxZ), // front (sealine)
    Math.abs(pz - minZ), // back (inland)
    Math.abs(px - minX), // left
    Math.abs(px - maxX), // right
  ];

  for (let i = 0; i < 4; i++) {
    let dist = dists[i];
    // Clamp and map distance to opacity
    let opacity = 0;
    if (dist <= FADE_END) {
      opacity = 1;
    } else if (dist < FADE_START) {
      opacity = 1 - (dist - FADE_END) / (FADE_START - FADE_END);
    } else {
      opacity = 0;
    }
    borders[i].material.opacity = opacity;
  }

  renderer.render(scene, camera);
}

animate();

document.addEventListener('mousedown', (event) => {
  if (event.button === 0) { // Left mouse button
    shootSpark();
  }
});

function getGroundHeightAt(x, z) {
  // Beach is centered at (0,0), lying on X (left/right), Z (forward/back)
  // Convert world X/Z to beach geometry local coordinates
  const mapSize = 10000;
  const beachHeight = mapSize;
  const beachWidth = mapSize;
  const seaLevelOffset = 1;

  // Convert world X/Z to beach local Y/X (since plane is rotated)
  const localX = x + beachWidth / 2;
  const localY = z + beachHeight / 2;

  // Flat sand near the sea (halfline of the map)
  if (localY < 5) {
    return seaLevelOffset;
  } else if (localY < beachHeight * 0.8) {
    const y = localY;
    const zVal = (y - 5) / (beachHeight * 0.8 - 5) * 20 + seaLevelOffset;
    return zVal;
  } else {
    const xVal = localX;
    const zVal = Math.sin((xVal / beachWidth) * Math.PI) * 50 + 30 + seaLevelOffset;
    return zVal;
  }
}
