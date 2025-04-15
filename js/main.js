import * as THREE from 'three';
import { Water } from 'Water';
import { Sky } from 'Sky';
import { PointerLockControls } from 'PointerLockControls';

// Create scene
const scene = new THREE.Scene();

// Create a character object and add it to the scene
const character = new THREE.Object3D();
character.position.set(0, 0, 0);
scene.add(character);

// Create camera and attach it to the character (e.g. at eye level)
const camera = new THREE.PerspectiveCamera(
  55,
  window.innerWidth / window.innerHeight,
  1,
  20000
);
camera.position.set(0, 10, 0);
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
  const moveDistance = 1.0; // Doubled movement speed
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
    velocityY = jumpStrength; // Apply upward velocity
    //console.log("Jump triggered!"); // Log when the jump is triggered
  }

  // Apply gravity and update vertical position
  if (isJumping) {
    velocityY += gravity; // Apply gravity to vertical velocity
    character.position.y += velocityY;

    // Stop jumping when the character lands
    if (character.position.y <= 0) {
      character.position.y = 0; // Reset to ground level
      isJumping = false;
      velocityY = 0; // Reset vertical velocity
      //console.log("Landed!"); // Log when the character lands
    }
  }
}

// Add Sky
const sky = new Sky();
sky.scale.setScalar(10000);
scene.add(sky);
const skyUniforms = sky.material.uniforms;
skyUniforms['turbidity'].value = 0; // Lower turbidity for a clearer sky
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
  const mapSize = 2000; // Assuming the map is a square of size 2000x2000
  const beachWidth = mapSize; // The beach spans the entire width of the map (edge a)
  const beachHeight = mapSize / 2; // The beach occupies half of the map
  const beachSegments = 200; // Number of segments for finer detail
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

  // Create the beach mesh
  const beach = new THREE.Mesh(beachGeometry, beachMaterial);
  beach.rotation.x = -Math.PI / 2; // Rotate to lie flat
  beach.position.set(0, 0, -mapSize / 4); // Position the beach to touch the water at the halfline

  // Add the beach to the scene
  scene.add(beach);
}

// Call the function to create the beach
createBeach();



// Animate / render loop
function animate() {
  requestAnimationFrame(animate);
  
  // Update character movement with keyboard input
  updateMovement();
  
  // Animate water (update time uniform)
  water.material.uniforms['time'].value += 1.0 / 60.0;
  
  renderer.render(scene, camera);
}

animate();