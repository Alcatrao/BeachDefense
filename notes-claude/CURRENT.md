# BeachDefense — Claude shorebreak waves (17 October 2026, Claude Opus 5.5)

Worktree: E:\AI_Workspaces\BeachDefense\branches\claude, git branch `claude/shorebreak-waves`
(base c2e9869). Not committed, not pushed. Codex's separate work (branch `codex/breaking-surf`
in E:\AI_Workspaces\BeachDefense, port 8767) was not touched.

Owner request: realistic 3D shorebreak (tubes, lots of foam), light on resources, player
interaction (skim on the surface, lifted by waves, thrown back by a breaking wave),
scene like the Praia de Mira wallpaper without the pier.

## Approach
Analytic GPU wave field instead of a fluid simulation (Codex's FLIP route is separate).
- `js/surf.js` (new): one vertex-displaced grid (medium 531k verts; `?surf=low|medium|high`).
  Shore-relative phase with shoaling, sets of 7 waves, peeling break line, crest profile with
  crowding, height-weighted curl rotation (forms the tube/barrel), bore after the break, swash
  run-up on the sand. Fragment: Fresnel + analytic sky, normal-map glitter, subsurface glow on
  thin lip, foam from textures/foam.avif (contrast-stretched; side-projected on steep faces),
  shallow alpha, ACES tone mapping. 2400 spray points emitted at curling crests.
  `evalSurf` is an exact CPU mirror of the shader (same integer hash), so `sample(x,z)` gives
  height, slope, water velocity and `lipHit` for physics.
- `js/main.js`: old 2D Water removed; seabed slopes under the sea (`SURF.slope`); renderer uses
  ACES (exposure 0.6); new `updateMovement` with swim/wade/skim, current drag, lift, wipeout
  tumble (head-over-heels camera, white overlay), underwater tint; sea limit z = 430.
  `?debug` exposes `window.__beach` (scene, camera, character, renderer, surf, sea, keys,
  `step(n)` to advance physics without rAF).

Controls: Shift = skim while in water; W/A/S/D, Space as before.

## Verified (headless preview, 1024x768, this machine)
- Rendering: barrel/tube, plunging lip with marbled foam, lacy whitewater, natural swash.
  Shots in notes-claude/shots/.
- Cost: whole frame 1.14 ms GPU vs 0.15 ms without the surf; surf.update 0.1 ms CPU.
- Physics (step() tests): shoreward drift ~0.2 u/frame (player swims out at 0.9+);
  swell lift up to ~10-15 units; wipeouts in impact zones (3 per 30 s held at d=15 and d=100),
  thrown shoreward at ~3 u/frame with the white overlay; skimming rides ~9.5 above the surface
  and slides down faces. Console: only the preview's pointer-lock errors.

## Not verified / limits
- Not play-tested by hand with mouse look; frame rate on weaker GPUs unknown (try ?surf=low).
- Lip still shows some faceting/aliasing at medium resolution; tube is a kinematic shape, not
  a fluid simulation. Ghosts still walk at y=0 over the sea (unchanged game logic).

## Round 2 (17 Oct 2026, owner: bright blue shiny water, white foam, bigger waves at ~30 m and
## ~60 m, rogue wave every 3-7 min, ~10 m)
Scale assumed from eye height 10 units = 1.7 m: ~5.9 units per metre.
- Colours: vivid blue/turquoise body (DEEP/SHALLOW/SSS), bluer sky reflection, stronger sun
  glints plus a broad sheen; foam colour boosted to ~1.8 before ACES (reads white); spray white.
- Two bars (SURF.barOuter etc., mirrored JS/GLSL): set waves (Hn > Hbase) break first on an
  outer bar at d ~ 325-360 (~58 m, height 1.5x base, up to ~23 units ~ 4 m); every crest blends
  into a reformed swell over the trough (crest d 228 -> 200) and breaks again on the inner bar
  (d <= 185, ~31 m, 1.15x base) with peeling, then bore and swash as before. Smaller waves pass
  the outer bar unbroken. Curl is faded for crests within 15-45 units of the shore (fixed a
  sawtooth where lips landed on dry sand).
- Rogue: `createSurf().update` picks the crest ~1400 units offshore every 180-420 s
  (`SURF.rogueMin/Max`); it is 60 units tall (~10 m) centred on the player's x (Gaussian width
  900), breaks further out (~d 400), keeps a big bore, reforms at 20 units and runs up the beach
  ~64 units. Uniform `uRogue` (fn, H, x) on the GPU, module `ROGUE` on the CPU.
  `?rogue=N` = first rogue after N s; `surf.rogue(x)` gives its crest distance;
  `surf.triggerRogue(x)` spawns one (debug). Wipeout push is capped at H = 40.
- Verified (step() tests): rogue crest 58 units at d 418, 56 at d 338 (breaking), 25 bore at
  d 259, reformed 20 at d 150. Player outside the break lifted to y ~51; at d 340 wiped out by
  the rogue lip and thrown shoreward at 7 u/frame. Render (readPixels timing, hidden pane)
  0.36 ms with surf vs 0.11 ms without; surf.update 0.13 ms. No shader errors.
  Shots: shots/rogue-from-beach.jpg, rogue-outer-bar.jpg, rogue-whitewash.jpg, blue-shore.jpg.
- Not done: seabed has no actual bar/trough shape (breaking positions are parameters); no HUD
  warning for the rogue; not hand-play-tested.

## Round 3 realism (17 Oct 2026, Claude's own initiative after the owner said "feel free to pursue
## what you think could add more realism to the waves and foam")
- Foam lace: Voronoi cell-wall lace (two scales, drifting) blended with the foam texture and
  thresholded by foam density, after Jeschke/Parberry-style foam patterns. Sources:
  https://ianparberry.com/pubs/GAMEON-NA_GRAPH_04.pdf , https://ianparberry.com/techreports/LARC-2011-05.pdf ,
  https://www.cg.tuwien.ac.at/research/publications/2010/bagar2010/ , https://planetside.co.uk/forums/index.php?msg=252771
  Lace fades to plain texture beyond ~350-1100 units. Low density reads as faint scum (sparse softening).
- Foam ages: residual foam lingers behind the bore and thins out with age (vAge); turbulent lumpy
  bore surface (boreLumps, mirrored JS/GLSL).
- Steep faces: foam is evaluated in both top and side projections and the results blended
  (blending the coordinates gave contour stripes).
- Wet sand: dark damp layer with sky glaze/glints left by the backwash (depth-based, gated by
  the land mask vLand); the damp film drops under the sand only where it is invisible.
- Smooth max between sea surface and swash film (hard max made a grid staircase).
- Fixed a pre-existing height step where one crest's trough met the next (each crest's trough sat
  at -0.2 H of its own height): the trough level now blends to a crest-independent level near
  psi = +-0.5. Max step across crest boundaries 0.01 units (was ~1.4).
- Verified: shots r3-*.jpg; step() tests: 1 wipeout / 30 s held at d~100, 2 at d~15; rogue lifts
  the player to y 46.8 at z 400. Render (readPixels timing) 0.62 ms vs 0.36 ms in round 2.
  Console: only pointer-lock errors. Not hand-play-tested.

## Tooling
.claude/launch.json ("beach-claude": python http.server on 8771 serving this worktree).
notes-claude/_move.js (source of updateMovement), shotserver.py (local POST receiver used to
save renderer.toDataURL captures while the preview pane is hidden).

Committed 4fc714e and pushed to origin/claude/shorebreak-waves on 17 Oct 2026 (owner request). No PR.
