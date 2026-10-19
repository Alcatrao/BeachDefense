// Round 8 visual test harness (Claude, 19 Oct 2026). Not part of the game: paste it into the console of
// http://localhost:<port>/?debug (or run it through a browser tool). It works in a hidden browser pane, where
// requestAnimationFrame never fires and innerWidth is 0:
// - a setInterval rAF shim drives the game loop at ~60 Hz;
// - it clicks Start Game, hides the end/pause menus (a hidden #endMenu also hides game over: the run goes on);
// - it parks every ghost far away (|x| >= 350, z 300 -> -740) except one, __T, that wades along z = 25;
// - __fcam follows __T at __camOff = [dx, y, dz, lookY] and is forced into every render through a wrapper
//   on renderer.render (window.__shotCam wins over the game camera; set it to null to restore the game view).
//   The follow loop re-sets __shotCam every frame, so set your own camera right before a synchronous render;
// - __snap(name) renders 960x540 and POSTs the JPEG bytes to shot_sink.py on 127.0.0.1:8790 (start that first).
// __setShot computes its aspect from innerWidth, which is 0 in a hidden pane: set cam.aspect = 960 / 540 and
// call updateProjectionMatrix() before snapping, or the frame comes out blank (~4 KB).
// Clean up: clearInterval(__keep, __loopG, __rafShim), cancelAnimationFrame(__fr), __shotCam = null, reload.

const HELPERS = () => {
  window.B = window.__beach; const B = window.B;
  window.cam = window.cam || new B.camera.constructor(55, innerWidth / innerHeight, 1, 20000); const cam = window.cam;
  B.scene.traverse(o => { if (o.material && o.material.uniforms && o.material.uniforms.turbidity) window.__sky = o; });
  if (!document.getElementById('__hideMenus')) { const st = document.createElement('style'); st.id = '__hideMenus'; st.textContent = '#endMenu,#pauseMenu,#focusHint{display:none!important}'; document.head.appendChild(st); }
  const r = B.renderer; if (!r.__orig) { r.__orig = r.render.bind(r); r.render = (s, c) => r.__orig(s, window.__shotCam || c); }
  window.__setShot = (x, y, z, tx, ty, tz, fov = 55) => { cam.fov = fov; cam.position.set(x, y, z); cam.lookAt(tx, ty, tz); cam.aspect = innerWidth / innerHeight; cam.updateProjectionMatrix(); window.__shotCam = cam; };
  window.__R = () => B.renderer.render(B.scene, window.__shotCam);
  window.__show = async () => { __R(); await new Promise(res => setTimeout(res, 120)); __R(); await new Promise(res => setTimeout(res, 60)); };
  // mean sRGB of (2n+1)^2 pixels round each [fx, fy] (fractions of the frame, y down)
  window.__px = (pts, n = 3) => { const gl = B.renderer.getContext(); __R(); const W = gl.drawingBufferWidth, H = gl.drawingBufferHeight; const buf = new Uint8Array(4 * (2*n+1) ** 2); return pts.map(([fx, fy]) => { const x = Math.round(fx * W), y = Math.round((1 - fy) * H); gl.readPixels(x - n, y - n, 2*n+1, 2*n+1, gl.RGBA, gl.UNSIGNED_BYTE, buf); let r = 0, g = 0, b = 0, k = (2*n+1) ** 2; for (let i = 0; i < k; i++) { r += buf[4*i]; g += buf[4*i+1]; b += buf[4*i+2]; } return [Math.round(r/k), Math.round(g/k), Math.round(b/k)]; }); };
  window.__pxs = (pts) => __px(pts).map(p => p.join(',')).join(' | ');
  window.__sun = (e, a) => { const v = new B.camera.position.constructor().setFromSphericalCoords(1, (90 - e) * Math.PI / 180, a * Math.PI / 180); B.surf.material.uniforms.uSunDir.value.copy(v); __sky.material.uniforms.sunPosition.value.copy(v); return v; };
  window.__OBL = () => __setShot(-250, 260, -450, 50, 0, -50, 50); // oblique overview of the break
  window.__FP = () => __setShot(0, 13, -175, 0, 2, 300);           // first person on the beach, facing the sea
};

(async () => {
  await new Promise(r => setTimeout(r, 1500));
  if (!window.__rafShim) { const q = new Map(); let id = 0; window.requestAnimationFrame = cb => { const k = ++id; q.set(k, cb); return k; }; window.cancelAnimationFrame = k => q.delete(k); window.__rafShim = setInterval(() => { const cbs = [...q.values()]; q.clear(); const t = performance.now(); for (const cb of cbs) { try { cb(t); } catch (e) { console.error(e); } } }, 16); }
  [...document.querySelectorAll('button')].find(b => /Start Game/.test(b.textContent))?.click();
  await new Promise(r => setTimeout(r, 1200));
  HELPERS();
  const B = window.__beach;
  window.__keep = setInterval(() => { B.paused = false; }, 100);
  window.__T = null;
  window.__loopG = setInterval(() => { for (const g of B.npcs) { if (g === window.__T) continue; const p = g.mesh.position; if (p.z < 45 || Math.abs(p.x) < 200) { p.z = 300; p.x = (p.x < 0 ? -1 : 1) * Math.max(Math.abs(p.x), 350); if (!g.isAirGhost) { g.mesh.userData.target = {x: p.x, z: -740}; g.foamState = {}; } } } }, 30);
  let T = null; for (let i = 0; i < 60 && !T; i++) { T = B.npcs.find(n => !n.isAirGhost); if (!T) await new Promise(r => setTimeout(r, 250)); }
  window.__T = T;
  if (T) { T.chaseDistance = 0; T.speed = 0.15; T.mesh.userData.state = 'toDunes'; T.mesh.userData.target = {x: -600, z: 25}; T.mesh.position.set(80, 0, 25); T.foamState = {}; }
  B.character.position.set(0, 20, -66);
  B.renderer.setPixelRatio(1); B.renderer.setSize(960, 540, false);
  window.__snap = async (name, q = 0.85) => { const r = B.renderer; r.render(B.scene, window.__shotCam || B.camera); const url = r.domElement.toDataURL('image/jpeg', q); const blob = await (await fetch(url)).blob(); const res = await fetch('http://127.0.0.1:8790/' + name + '.jpg', {method: 'POST', body: blob}); return [res.status, blob.size, r.domElement.width, r.domElement.height]; };
  const cam = B.camera.clone(); cam.fov = 55; window.__fcam = cam;
  window.__camOff = window.__camOff || [10, 26, -18, 2];
  const step = () => { const p = window.__T.mesh.position, o = window.__camOff; cam.position.set(p.x + o[0], o[1], p.z + o[2]); cam.lookAt(p.x, o[3], p.z); cam.aspect = 960 / 540; cam.updateProjectionMatrix(); cam.updateMatrixWorld(); window.__shotCam = cam; window.__fr = requestAnimationFrame(step); };
  if (T) step();
  // resolves once the water at __T is between lo and hi (or after tmax ms)
  window.__waitPhase = (lo, hi, tmax = 30000) => new Promise((res) => { const t0 = performance.now(); const id = setInterval(() => { const p = window.__T.mesh.position; const wy = B.surf.waterY(p.x, p.z); if ((wy != null && wy >= lo && wy <= hi && p.x < 60) || performance.now() - t0 > tmax) { clearInterval(id); res([wy, p.x]); } }, 50); });
  window.__ready = true;
})();
