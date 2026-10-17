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
    // broken wave / landing lip: wipeout
    if (w.lipHit && !tumbling && w.lipHit.fn !== sea.lastHit && pos.y < w.lipHit.yTop + 10) {
      const H = w.lipHit.H;
      sea.lastHit = w.lipHit.fn;
      sea.tumble = sea.tumbleDur = 1.2 + H * 0.04;
      sea.vz = -(1.6 + H * 0.14);              // thrown towards the beach
      sea.vx = (Math.random() - 0.5) * 1.2;
      velocityY = w.lipHit.kind === 'lip' ? 0.35 + H * 0.03 : 0.2;
      isJumping = true;
    }
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
      if (inWater && velocityY < -0.05 && !tumbling) velocityY *= -0.15; // small splash bounce
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

  // --- wipeout tumble ---
  if (sea.tumble > 0) {
    sea.tumble -= 1 / 60;
    const prog = 1 - Math.max(sea.tumble, 0) / sea.tumbleDur;
    const ease = Math.sin(prog * Math.PI);
    camera.rotation.x = -prog * Math.PI * 2 * 1.5;   // head over heels
    camera.rotation.z = ease * 0.9;
    pos.y = Math.min(pos.y, restEye + 4 * ease);
    if (sea.tumble <= 0) { camera.rotation.x = 0; camera.rotation.z = 0; }
  }

  // underwater / whitewash overlay
  if (w) {
    const ov = seaOverlay();
    const camY = pos.y;
    const under = camY < w.y + 0.5;
    if (sea.tumble > 0) {
      const prog = 1 - sea.tumble / sea.tumbleDur;
      ov.style.background = 'radial-gradient(circle, rgba(235,245,242,0.92), rgba(170,215,210,0.97))';
      ov.style.opacity = String(Math.min(1, (1 - prog) * 2.5));
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
}
