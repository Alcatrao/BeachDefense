# BeachDefense — Claude shorebreak waves (17 October 2026, Claude Opus 5.5)

Worktree: E:\AI_Workspaces\BeachDefense\branches\claude, git branch `claude/shorebreak-waves`
(base c2e9869). Commits and pushes: see Tooling. Codex's separate work (branch `codex/breaking-surf`
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

## Round 4 (18 Oct 2026, owner: "feel free to try even newer approaches or techniques")
Targets from the round 3 shots: polygonal "cracked tile" foam lace, white crack lines on faces,
opaque teal swash water.
- Transparent shallow water: Beer-Lambert absorption over depth (SIGMA = (1.3, 0.75, 0.7)/5.9 per
  unit, view + sun path), caustics (drifting cell networks at the refracted bed position), and
  display-space compositing: each layer is written as P + W*bed with alpha = 1 - W.r; the extra
  green/blue transmission is baked in using the typical sand colour. Limits: blending cannot
  refract the bed, and the per-channel part is exact only for that sand colour.
- Muted in-scatter colour in very shallow water; no subsurface glow on low bores (removed a cyan
  band at the bore front).
- Foam: coverage-based multi-scale lace. Signed round holes at three scales; target coverage
  C ~ foam amount, each scale's hole density from -ln(C)/0.33; foam age shifts weight from small
  to large holes; thickness rises away from the holes, soft translucent rims; scales fade to their
  mean with distance (no shimmer). Bump-mapped foam lighting via the surface gradient (Mikkelsen);
  opacity 1 - exp(-3.2 tau); brighter wrap lighting.
- Foam coordinates on the rest grid (Lagrangian-style), drifting shoreward and riding the swash
  (gDrift, foam only, no JS mirror needed). The drift ramp is at least 4r long so the pattern
  never folds over (that caused radial streaks) and stretches at most ~1.6x.
- Procedural value noise replaces textures/foam.avif, which does not tile (edge jump 42 levels vs
  1.8 between neighbouring pixels) and made seams at world x = 0 and regular z lines. The file is
  untouched but no longer used by surf.js.
- Spray: ragged, soft-edged puffs with a per-particle seed instead of round discs; whitewash mist
  at alpha 0.4.
- Verified: shots r4-*.jpg. step() tests: 3 wipeouts / 90 s held at z 21, 4 / 60 s at z -64,
  0 / 60 s at z 100; rogue lifts the player to y 46.8 at z 400 (same as round 3). Render
  (readPixels timing, same session A/B against HEAD e55afdb): 0.42-0.54 ms vs 0.42-0.47 ms.
  Console: only pointer-lock errors. Not hand-play-tested.
- Sources: https://80.lv/articles/real-time-shoreline-simulation-in-custom-c-coastal-renderer ,
  https://80.lv/articles/breakdown-back-approaches-to-realtime-foam-rendering/ ,
  https://www.wetafx.co.nz/assets/Uploads/PDFs/2022-Guided-Bubbles-and-Wet-Foam-for-Realistic-Whitewater-Simulation.pdf ,
  https://cgweb.informatik.uni-freiburg.de/publications/2013_WSCG_foamRendering.pdf ,
  https://gamedev.net/shaderlab/53-foam-with-flow-mapping/ , https://github.com/ivdstudios/crest-oceanrender ,
  https://www.old.cescg.org/CESCG-2008/papers/BratislavaC-Mihalik-Andrej.pdf

## Round 5 (18 Oct 2026, owner: a crashing wave makes only a little foam "and then they roll back into
## the tube, instead of kinda disappearing in foam and coming water")
Cause: the curl angle followed the wave height, so when the height fell after the break the lip rotated
back into a tube; impact foam covered only the landing tip. Changes in js/surf.js (JS mirror = GLSL):
- The lip never unrolls: thetaMax only grows with the break stage p (2.7 by p 1.15, +0.35 by p 1.9).
- Collapse: the curl keeps the shape of the wave that threw it (Hc) and is squashed to the falling height H;
  the roller shrinks (size sig 1 -> 0.4 over p 1.0-1.9) to a low roller riding the bore front and fades before
  the sand. The outer-bar roller shrinks away over the trough before the inner bar curls. The bore reaches its
  height by p ~2 (was 2.6).
- The tube closes: over p 1.05-1.5 the inner wall (from where the face reaches the pivot height up to the lip
  tip) is pulled onto the straight chord between those points, so the air pocket fills into one solid mass.
  Then lumps push out from the roller axis (rollerLumps, wavelengths >= ~8 grid cells).
- Whitewater: impact foam (p 0.9 -> 5) spreads from the landing tip over the whole curtain by p ~1.2; fresh
  whitewater is solid (holes only as it ages), milky aerated turquoise between patches, with churning billows
  mapped in the crest's frame so they travel and tumble with the breaker. Bore face white down to its toe.
- Particles: splash-up burst from the plunge point and mist off the bore; emission is scaled to the pool so
  closeouts thin out evenly. Normals use offsets near the grid spacing (1.8, 1.0).
- Spike fix: below roller size 0.8 the roller's front and back are widened (kw), so it never spans fewer grid
  rows than at 0.8. The crest runs obliquely across the grid (~1.5 rows per column), and a narrower roller
  rendered as triangular spikes.
- Verified (headless preview, 1280x720): shaders compile, no GL errors; JS mirror matches the GLSL to 3e-15.
  Crash of one crest (fn 49), shots r9-h0..h3-{beach,front}: p 1.13 -> 1.92, H 18 -> 3.5, bore 0.08 -> 0.98;
  the peeling barrel becomes a white roller, then a white bore rushing in. Before (round 4 code):
  r5-front-0..7, a teal curtain that rolls back into a tube. Spikes before the fix: r9-g0..g3-front.
- Physics, same harness and start time (T 20) against HEAD 1d4415f in the same session: wipeouts 2 at z 21
  (2700 steps), 2 at z -64 and 1 at z 100 (1800 steps each) in both; rogue lift y 32.8 at the clamped z 430 in
  both. Max water at z -64 10.7 vs 11.9 (faster bore decay). One step is 1/60 s, so 2700/1800 steps are
  45/30 s; earlier rounds labelled the same step counts 90/60 s, which was wrong (their 46.8 rogue lift was at
  z 400). Render (readPixels timing, settled): 0.46-0.51 ms vs 0.44-0.50 ms at HEAD (0.28-0.34 without the
  surf); surf.update 0.14-0.19 ms vs 0.11-0.15 ms. Console: only pointer-lock errors.
- Limits: small teeth on the crest silhouette and folded-sheet creases at close range on the roller and bore
  once p > ~1.8 (the grid undersamples the tight roller on the oblique crest); a crest-aligned mesh would fix
  it. Still a kinematic shape, not a fluid simulation. Not hand-play-tested.
- Sources: https://par.nsf.gov/biblio/10362192-field-observations-evolution-plungingwave-shapes ,
  https://www.cambridge.org/core/services/aop-cambridge-core/content/view/9DA630A5718361A3579618BB022B8F35/S0022112023003798a_hi.pdf/plunging-breakers-part-1-analysis-of-an-ensemble-of-wave-profiles.pdf ,
  https://icce-ojs-tamu.tdl.org/icce/article/download/4073/3755/17180 , https://ar5iv.labs.arxiv.org/html/0910.2580 ,
  https://advances.realtimerendering.com/s2022/SIGGRAPH2022-Advances-Water-Malan.pdf ,
  https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/7561993 ,
  https://image-ppubs.uspto.gov/dirsearch-public/print/downloadPdf/8204725 , https://dspace5.zcu.cz/handle/11025/1025 ,
  https://history.siggraph.org/wp-content/uploads/2022/09/2017-Talks-Byun_Moana-Crashing-Waves.pdf
- Intermediate and debug shots were moved out of the repo (session scratchpad), not committed.

## Round 6 (19 Oct 2026, lead Claude session's task: remove the small teeth and creases on the collapsing
## roller and bore at close range late in the break, p > ~1.8, by making the mesh follow the crest)
Cause: the straight x/z grid. The crests cross its rows obliquely (~1.5 rows per column at x 0; sampled crest
slopes dz/dx from -0.28 to +0.57), so the triangles cut across each tight fold of the roller and bore and
rendered it as teeth, facets and diagonal creases. Change in js/surf.js, buildGeometry only (surfPos/evalSurf,
the shaders and the physics are unchanged; two comments updated):
- Crest rows: row j is the line of constant wave phase sOf(z - shoreZ(x)) + kx x + wobble(x) through
  (0, zs[j]), solved per vertex by Newton on sOf, so every crest lies along a row at all times. Same vertex
  count and index buffer, built once (no per-frame cost). The rows fade back to straight lines over
  |x| 1000 -> 2000 and z 600 -> 2000, so the far field and the mesh edges are as before; the near edge follows
  row 0 at d <= -125, under the sand (the swash reaches about -90), so the wet-sand line is unchanged.
- Chosen by measurement: a CPU metric on crest fn 49 (evalSurf with the curl, x 0 +-60, rest band
  |d - dc| < 35); per triangle the distance from its centroid to the true surface, the angle between its face
  normal and the true normal, and flips (faces pointing the wrong way). mean/p90/p99, straight grid -> rows:
    p 1.13  err .369/.918/1.79 -> .101/.244/.446  angle 12.8/34.3/91.4 -> 2.5/5.3/17.8 deg  flips 21 -> 0
    p 1.55  err .294/.892/1.42 -> .091/.248/.494  angle 10.9/32.7/103 -> 3.0/6.0/37.9       flips 26 -> 1
    p 1.92  err .231/.718/1.81 -> .077/.259/.487  angle 9.0/25.5/112 -> 3.3/5.7/51.7        flips 38 -> 9
    p 2.20  err .213/.712/2.09 -> .065/.242/.504  angle 9.3/22.0/132 -> 2.8/5.5/53.2        flips 67 -> 8
    p 2.60  err .201/.682/2.20 -> .056/.187/.535  angle 8.5/16.0/140 -> 4.9/3.3/132         flips 69 -> 38
  At x +-400 and +-645 the rows are as good as or better than the grid (one exception: x -645 at p 1.3,
  angle p99 58 vs 26 deg, 5 vs 2 flips). Rejected: twice the z rows (2x vertices) stayed poor (p 1.92 err
  .164/.545/1.35, 51 flips; 116 flips at p 2.6); rows parallel to the shoreline matched at x 0 but run against
  the crests near x +-400 and +-645 (p 1.92: angle p99 143 and 141 deg, 26 flips each); a rotated grid can
  match only one crest direction; a separate band mesh along each crest would add seams and a per-frame
  update that the static rows do not need.
- Verified (headless preview, 1280x720), A/B shots with the straight grid (9dd2038) on top and the crest rows
  below: r10-ab-h3-close and r10-ab-h4-close (p 1.92 and 2.2, close range), r10-ab-h3-front (p 1.92) and
  r10-ab-h5-beach (p 2.6). The teeth, facets and diagonal creases on the roller and bore are gone, and so is
  the sawtooth on the next crest; the beach join, the wet-sand edge and the far field are unchanged. Geometry
  at low/medium/high: same vertex counts (363568/531566/797568), rows never cross (smallest gap
  2.25/1.68/1.25), near edge d <= -125.1, far field and sides identical to the straight grid.
- Physics, Round 5 harness (T 20, x 0) on a fresh page against 9dd2038: identical wipeouts (2 at z 21, 2 at
  z -64, 1 at z 100), maximum heights and water, rogue lift 32.8 at z 430; only the randomly drawn time of the
  next rogue differed (167 vs 100). Physics never reads the mesh. Render (readPixels timing, settled, both
  meshes on the same page): beach 0.52-0.56 ms vs 0.52-0.55, high 0.58-0.59 vs 0.57-0.59, close 0.73-0.75 vs
  0.76-0.77 (0.28-0.31 without the surf); surf.update 0.13-0.14 ms (code unchanged). The mesh build takes
  16-39 ms once at load (was 4-9 ms). Console: only pointer-lock errors.
- Limits: one crest-parallel seam stays on the bore at p ~1.9-2.6 (lower halves of the close shots). The
  surface itself folds there: at p 1.92, x 0 the curl path makes a micro swallowtail ~0.35 wide just behind the
  crest (d - dc -5..0) and a cusp at the lip tip (+4), so no mesh layout removes it; smoothing that fold in the
  curl branch of surfPos/evalSurf (render-only, mirrored) is the follow-up. A few vertical bands on the far
  curling lip at p 1.13-1.31 (x ~400-645) are the same with every layout. The thin horizontal line across the
  sea is a scene object, there with the surf hidden too. Beyond |x| 1000 the rows return to the straight grid.
  Not hand-play-tested.
- Intermediate and debug shots stay in the session scratchpad, not committed.

## Tooling
.claude/launch.json ("beach-claude": python http.server on 8771 serving this worktree).
notes-claude/_move.js (source of updateMovement), shotserver.py (local POST receiver used to
save renderer.toDataURL captures while the preview pane is hidden).

Committed 4fc714e and pushed to origin/claude/shorebreak-waves on 17 Oct 2026 (owner request).
Round 3 e55afdb pushed 18 Oct 2026 (owner request). Round 4 0400658 pushed 18 Oct 2026 (owner request). No PR.
Round 5 9dd2038 pushed 18 Oct 2026 (owner request), with this notes commit; the push republishes /claude/ (see below).
Round 6 (crest rows) committed 19 Oct 2026 in the commit that adds this line; not pushed (awaiting the owner).

## GitHub Pages (Codex-owned, 18 Oct 2026)
Codex publishes all three versions: https://alcatrao.github.io/BeachDefense/ (main),
/codex/ and /claude/ (this branch). Records:
E:\AI_Workspaces\BeachDefense\records\pages-hosting-20261018\ (pages.yml, build.py, smoke.cjs, PAGES.md).
- Since Codex's e84c564 (owner request, 18 Oct 2026), a push to this branch republishes /claude/ automatically:
  .github/workflows/wave-updated.yml only echoes, and main's publisher picks it up via workflow_run, builds and
  deploys. So every push here is a public deploy; ask the owner before each push. Never dispatch pages.yml by hand;
  Pages stays Codex's. Checked 18 Oct 2026 by HTTP: live versions.json pins claude e84c564 (52 files),
  codex 2770e39, main 116c998; live /claude/index.html loads three@0.186.0.
- Claude's review (HTTP only, a 15 GB memory booking was active): approved. Live /claude/ files match
  0400658. Bridge reply 20261018T195605188303Z-claude-27334501 to Codex's 20261018T194825669923Z-codex-b4463286.
- three.js pinned in this branch (owner approval, 18 Oct 2026): index.html's import map now loads
  cdn.jsdelivr.net/npm/three@0.186.0 instead of unpinned threejs.org. The six mapped/relative files were
  byte-identical (SHA-256) to threejs.org's r186 that day; jsdelivr sends CORS * and application/javascript;
  every addon import resolves ('three' or 200 relative paths). No browser run (15 GB booking, 0 workers admitted).
  main.js still loads GLTFLoader/FBXLoader/SkeletonUtils from unpkg three@0.155.0 (pre-existing, unchanged).
  Live /claude/ got the pin when Codex's e84c564 push triggered the auto-publish.
  main and codex/breaking-surf are still unpinned (not touched).
