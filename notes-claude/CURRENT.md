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
  `step(n)` to advance physics without rAF; Round 8 added npcs, shootSpark and paused).

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

## Round 7 (19 Oct 2026, lead Claude session's task: remove the crest-parallel seam left on the collapsing
## roller and bore at close range, p ~1.9-2.6, render-only; the follow-up named in Round 6's limits)
Cause (CPU profiles of crest fn 49 through the curl branch): after the collapse the roller is still drawn as a
closed loop. Its inner wall (u uT..0, the chord from the lip back down to the face) carries the rag lumps and
poked up through the face (by up to 0.51 m at x 0, p 1.92 and 0.10 m at p 2.2; 0.41 and 0.07 m at x -645,
p 1.90 and 2.3), and the loop's underside, seen nearly edge-on from close range, rendered as the thin line.
Change in js/surf.js, the curl branch of surfPos (GLSL) and its mirror evalSurf(curl = true), kept identical
(crestState also returns pC, the stage of the curl in charge). Physics samples evalSurf(curl = false), which
never enters the new code; the crest rows, the far field, the beach join and the wet-sand line are untouched.
- The collapsed roller rides the bore as a solid step, blended in by wallT = fill * sstep(1.5, 1.9, pC): its
  front (u 0..uN, up to the nose, its most forward point, which keeps its own rotation and rag lumps) is a
  straight ramp down to a toe at most 0.6 m ahead of the nose and (0.25 H + 0.8) m under the face; the inner
  wall (u uT..0) is the straight chord from the toe back to the face, without lumps. The toe depth fades out
  as sig drops from 0.3 to 0.1 near the shore, so no vertical drop is left as the roller flattens.
- uN = 0.3 * uB * wb / (uB^4 + wb^4)^(1/4), 0.3 times a soft minimum of uB and wb, so the nose stays on the
  roller's front at any size (tied to uB alone it fell behind the front at small sig).
- The swash's pull back to rest (dA) is masked over the step (wm); otherwise it leans the wall.
- Ramp run chosen by measurement: a vertical front showed as a grey backlit band at p 3.0; a 0.6 m run keeps
  the chord at most 0.006 m above the face for p >= 1.9; 1.2 m poked 2-4 cm through it again. Step height at
  x 0: 1.46 m at p 2.6, 1.11 at 2.75, 0.55 at 2.9, 0.39 at 3.0, 0.17 at 3.1.
- Verified (headless preview, 1280x720 per panel, spray hidden, rogue off), A/B shots with 7e4ddc3 on the left
  and Round 7 on the right: r11-ab-p192-close and r11-ab-p220-close (x 0, p 1.92 and 2.2, close range),
  r11-ab-p260-front (p 2.6), r11-ab-x-645-p220-close (outer bar) and r11-zoom-p300-toe (p 3.0, zoomed). The seam
  is gone at p 1.92, 2.2 and 2.6, close and front, and so is the crease between roller and bore on the outer
  bars (also x -400 at p 1.92 and 2.6). At p 3.0 the base's dark dashed line becomes a faint light edge at the
  toe. Beach views (p 1.92, 2.6, 3.2), a high view (p 2.2), the far field and the wet-sand line are unchanged
  apart from the seam. GPU vertex positions read back from the shader (wind chop off) match
  evalSurf(curl = true) within 3.3 mm over 17 cases.
- Physics, the Round 6 harness on a fresh page: identical to 7e4ddc3 (wipeouts 2 at z 21, 2 at z -64, 1 at
  z 100; maximum heights 18.1/15.3/17.7, water 14.4/10.7/13.7; rogue lift 32.8 at z 430, water 40.8); only the
  randomly drawn next rogue differed (162). Spray: 4949 of 6000 particles alive after 2 s of updates. Render
  (readPixels timing, A/B alternated twice on one page, ms per frame, Round 7 vs 7e4ddc3): beach 0.49-0.52 vs
  0.49-0.52, high 0.54 vs 0.53, close 0.59-0.61 vs 0.58-0.61 (0.22-0.31 without the surf); surf.update
  0.08-0.12 ms. Console: only pointer-lock errors.
- Limits: a faint soft edge at the toe at p >= 3.0, slightly faceted because the low step spans about one mesh
  row (much fainter than the base's line); a small dark notch on the front at p 2.6 (probably the nose's rag
  lumps); the half-collapsed roller at p 1.55-1.75, before the step takes over, was already partly exposed in
  7e4ddc3 and is slightly more so with the ramp. The square-ish foam pattern on the tall step is the existing
  foam texture (the base's roller has it too). Not hand-play-tested.
- Intermediate and debug shots stay in the session scratchpad, not committed. The page helpers (GPU/CPU parity,
  A/B sheets, crest finder) are outside the repo: C:\Users\joaoa\AppData\Roaming\Claude\side-session-notes\
  local_f261344c-dddd-4e11-9b93-ef3f8fb5ec9e\round7-claude-harness.js.

## Round 8 (19 Oct 2026, owner: keep the Praia de Mira beach but make the game look like the owner's Age of
## Mythology screenshots: shiny cyan water with reflection, and AoM's light foam, splash and particle effects)
References: the owner's 20 screenshots (a water mod under the MenuArctic lighting mod) in
reference/aom-2026-10-19/ with a README on how AoM draws its water (read from the owner's AoM install). That
folder is git-ignored: never commit or publish it. AoM was used for technique and numbers only; no textures,
shaders or other files were copied. MenuArctic sets sunspecular 255 255 255 (the big white glare; the stock
default.lgt has a dim cyan 10 40 50), suninclination 38, sunrotation 243, ambientcolor 115. Measured targets
(sRGB): open water (102, 229, 239) and (96, 222, 233); near shore (174, 253, 250); sandbar (150, 208, 193).
- Looks: `LOOKS` in js/surf.js holds every colour and stylised term, applied as uniforms (the old HORIZON,
  ZENITH, DEEP, SHALLOW, SSS and SIGMA constants are gone). 'aom' is the default; `?look=classic` (main.js) or
  `surf.setLook('classic')` restores the Round 7 water and hazy sky exactly (all stylised terms off). aom: sun
  at elevation 35, azimuth -45; thin deep-blue sky (turbidity 2.5, rayleigh 0.5); cyan reflection and depth
  ramp; extinction (0.55, 0.22, 0.20) per metre so the shallows are clear over the tan sand (kept on purpose);
  Fresnel x0.65 capped at 0.55; haze 0.2 tinted pale cyan; wet sand x0.85.
- Wavelets: two normal-map samples stretched 0.27x across and rotated +-20 degrees (RIPA, RIPB), faded out
  from 150 to 1100 units; anisotropy 8 on the normal map. Embossed: in the water's lighting, the difference
  between the rippled and the underlying normal's N.L brightens one side and darkens the other; the same
  term is applied again after the tone mapping (gated off foam, haze, sand and see-through water).
- Glare: white, pow(sunR, 6) * 0.25 + pow(sunR, 24) * 0.8, broad like AoM's DOT3 specular.
- Drop-off band: the seabed seen through the water is tinted (0.35, 0.55, 0.55), fully at depths 8-16 units,
  fading out by 3 and 34.
- Vivid grade after the tone mapping, because ACES pulls cyan towards grey-blue: saturation +15 %, green
  lifted towards blue, +4 % brightness, weighted by the water's opacity.
- Foam decals (class Decals): one instanced 12x12 quad per decal, a pool of 1024, laid on the water by the
  vertex shader (surfPos with gFlat: no crest bunching or curl, the same surface as evalSurf(curl = false)),
  so they ride and tilt with the waves. The CPU writes each decal once; its life runs on the GPU from its
  birth time. Kinds: 0 ring (spreads, thins, leaves milky water), 1 puff (ragged, streaked trail), 2 churned
  patch (breaks into lumps), 3 collar (AoM's crisp ring at a wading unit's feet over a faint dark blob on the
  side away from the sun). They fade out where the water is shallower than 1.2 units. Transparent, no depth write,
  polygon offset, render order 2 (after the water and ghosts, before the spray).
- API: `surf.waterY(x, z)` (water height, null under 0.6 units of water), `surf.splash(x, z, strength, crown)`
  (sizes for strength s: a churned patch 5s, a ring 10s and a fainter ring 15s born 0.35 s later; crown:
  12 + 12s drops, a column and a low blossom of spray), `surf.wake(state, x, y, z, vx, vz, r, dt)` (a collar every 0.1 s carried at the body's speed, a ring
  every 0.5-0.75 s, puffs behind every max(2.5, 1.2r) of travel, drops off the front above speed 6; only where
  the water is between y - 4 and y + 3r), `surf.foam(...)` (one decal), `surf.setLook(name or fields)`.
- main.js: landing in the water lays a splash without the crown (it would fill the view); the player (r 2.5)
  and ground ghosts (r = 0.55 x size, the cloak's footprint) get wakes; a spark diving into the sea splashes
  where it went in and is removed there (before, it flew on under the water to its maximum range: a small
  gameplay change). `?debug` adds `npcs`, `shootSpark` and `paused` (get/set; the preview has no pointer lock).
- Lessons. (1) The water mesh bunches its points at crests, so its triangles stand up to ~1.2 above the flat
  evaluation on big waves (within ~0.2 on small ones), and a 6x6 decal's chords sagged 1.2-2.25 under crests:
  both buried the foam from steep views. Fix: the 12x12 grid and drawing each decal nearer the camera along
  its own view ray (same pixel) by 1.6 / max(sin a, 0.12), at most half the distance, a = the ray's elevation.
  A constant offset b along the ray clears only a rise of b sin a (~1.5 at 49 degrees, 0.4 at 11 for b = 2).
  Scan, 200 frames per camera on a collar of size 13.2 at a ghost's spot; per frame the share of the decal's
  full contribution (depth test off) that survives the depth test, counting frames where that full
  contribution is > 25 % of its maximum: close camera (49 degrees) without the bias (6x6 or 12x12) 68-69
  frames under 0.9 and 23-24 under 0.5, with it 0; mid (20 degrees) 37-39 of 143 under 0.9 and 15-16 under
  0.5, with it 0; game camera (11 degrees) 8 frames for every variant (a crest really in front). (2) Back-face
  culling rightly hides rings on a crest's far slope. (3) A plain ring buffer of 768 wrapped in ~1.07 s at
  720 adds/s (~43 wading ghosts) and overwrote 250 live decals/s. Now the next slot, or the first free one
  within 32, else the one ending soonest, out of 1024: 45 ghosts 512 adds/s, none cut short, at most 422
  alive; 90 ghosts 1062 adds/s, 5.6/s (0.5 %) cut short with 36 % of their life left, at most 856 alive
  (allocator replaced on 19 Oct 2026: see "Round 8 publish failure" below).
  (4) Collars that stayed where they were laid smeared behind a moving body; carried at its speed, the four
  alive at once stay one sharp ring. (5) A ghost glides level while the troughs pass under it: hence y - 4.
- Verified (headless preview, 960x540): shots r12-aom-obl (oblique overview), r12-aom-fp (first person on the
  beach), r12-aom-wade (a wading ghost's collar and ring) and r12-aom-splash (an open-water splash). Oblique
  view, sRGB: open water (100-130, 225-228, 233-236) against AoM's (96-102, 222-229, 233-239); sand (203-204,
  188-190, 164-166), the Praia de Mira tan. The splash reads from steep and low cameras; `?look=classic` gives
  the Round 7 look. Render (readPixels-synced, ms per frame): 0.37-0.39 with decals vs 0.38 without (noise).
  Console: only pointer-lock errors. The physics harness was not re-run: evalSurf and sample are unchanged
  (the decals' gFlat is GLSL only; waterY reads evalSurf(curl = false)).
- Limits: milky overdraw on a ghost's lowest ~1.6 units (the bias draws the foam over them); ghosts glide
  level over the troughs (game logic, unchanged); no dark blob shadow under units on land as in AoM (decals are
  fire-and-forget; it needs updatable slots: follow-up). Not hand-play-tested.
- Harness: notes-claude/aom-harness.js (paste into the console of ?debug, or eval it after fetching it) with
  notes-claude/shot_sink.py (`python -I shot_sink.py 8790 <outdir>`; JPEG bytes, unlike shotserver.py's data
  URLs). It shims rAF (the hidden pane never fires it), sets 960x540, parks all ghosts but one wading one and
  hides the menus (a hidden #endMenu also hides game over). __setShot takes its aspect from innerWidth, which is
  0 in a hidden pane: set 960 / 540 or the frame is blank. step(n) uses a fixed 1/60 s. Intermediate shots stay
  in the session scratchpad.
- Sources: https://godotshaders.com/shader/stylized-water-for-godot-4-x ,
  https://gamedev.net/shaderlab/37-stylized-water-surface/ ,
  https://80.lv/articles/beautiful-unity-water-shader-affected-by-shoreline-shape-wind ,
  https://store.godotengine.org/asset/emace-art/stylized-water-shader/ , https://wiki.ryzom.dev/postmortem/nel/water ,
  https://community.khronos.org/t/water-question/43367 , https://community.khronos.org/t/bump-map-flitering/40169 ,
  https://tympanus.net/codrops/?p=88608 , https://github.com/jklintan/Procedural-Water

## Round 9 (19-20 Oct 2026, owner: the water sometimes looks 'squared' (one pattern repeating a lot); whiter,
## brighter, watery foam; AoM's meteor splash as a line of splashes where the tube breaks; foam to hide the tube
## rolling back as soon as, or even before, it breaks)
AoM's splash was read from the owner's install for technique only (reference/aom-2026-10-19/README.md, "Meteor
splash (Round 9)"; git-ignored, nothing copied): one particle effect whose texture is a single painted plume (a
mottled white sheet over streaks fanning down, on transparent ground) on a few big billboards that burst up,
spread and fall back. All changes are in js/surf.js.
- Repetition: the tiled normal map lined up into a regular weave over open water. normNT() samples it without
  tiling (iq's technique 3: a smooth noise picks one of 9 random offsets per irregular patch; two offsets blend
  across each border, sharpened by the samples' difference; textureGrad keeps the mip level across the borders)
  on all four layers: the two detail layers (the second now turned ~37 degrees, R37) and both wavelet sets.
  Cat's paws: two drifting noises vary the detail x0.7-1.3 and the wavelets x0.45-1.35 in large patches.
  The soft tier keeps plain fetches (SOFT define).
- Foam: whiter and brighter, on its shaded side too: base (0.80, 0.88, 0.94), was (0.70, 0.80, 0.88), to white
  with thickness; light 0.98 + 0.8 wrap, was 0.74 + 0.95 wrap. Thin films keep a lighter water tint (body x1.6 +
  0.3, was x2). The churn shadow is a light blue (0.78, 0.87, 0.95), was (0.62, 0.73, 0.85), with ao 0.8-1.08,
  was 0.62-1.12. Aerated water (0.44, 0.67, 0.71), was (0.36, 0.60, 0.64). Fresh foam is wet: a soft sheen and
  twinkling bubble glints (hashed cells in rest space, each at least about a pixel wide, gone where the cells
  would shimmer). The vivid grade no longer tints foam.
- Splash plumes (class Splashes, plumeAtlas): billboards drawn from a procedural 2x2 atlas of four plume pictures
  made at start-up (256 px tiles, 128 on the soft tier; R opacity, G dissolve order, B shading): a broad sheet
  with a dome top and a torn outline, a fan of streaks out of its underside, 30 flung and 40 falling drops, fine
  grain. A plume reaches full height by 40 % of its life and widens, then its top falls back, it sinks and it
  dissolves from the thin spray inwards. It stands upright, turned most of the way to lie along its crest (never
  edge-on), leans back half-way towards a camera looking down, and throws its top shoreward. Its depth is taken
  nearer the camera by up to 0.3 of its height (at most half the distance, less from above), so the face behind
  does not cut it in straight lines. It fades out from 2000 to 3500 units. One instanced quad each, a pool of
  1024 (soft 128), the lowest free slot as in Decals, instanceCount trimmed to the highest live slot;
  transparent, no depth write, render order 3. emitSpray emits them crest by crest (H > 2.5) every 1/30 s in
  the 40-unit columns within 1600 of the camera:
  | kind         | where                                            | stage p  | rate /s | height     | life s  |
  | 0 plunge     | where the lip lands (H > 3, sig > 0.25)          | 0.85-1.5 | 5       | 1.6-2.1 H  | 1.5-2.3 |
  | 1 shore dump | just ahead of the crest, curl lost (loss > 0.15) | 0.12-1.3 | 6       | 1.0-1.4 H  | 1.3-2.0 |
  | 2 bore       | off the tumbling bore front                      | 1.5-3    | 1.5     | 0.55-0.9 H | 1.0-1.6 |
  (loss = 1 - sstep(15, 45, dc); H is capped at 40, and kind 0's height is scaled by 0.7 + 0.3 min(sig, 1).)
  Rates thin out as 1 / (1 + |dx| / 1000) (soft: half rate, only within 700 of the camera), scaled so the
  plumes alive at once fit 85 % of the pool.
- Roll-back: a closeout near the sand shrinks its roller away with the depth (sig, crest d 45 -> 15), which in
  clear water read as the curl rolling back. fCol turns the shrinking roller into fresh whitewater that spills
  down the face as the roller goes (down to the toe once it is gone), and the shore-dump plumes cover the
  collapse. The swash's foam age no longer overrides fresh whitewater arriving over it (aged, it opened into a
  lace that a steep face stretched into vertical streaks).
- Ice wall: a closeout that broke late (db ~40) was still ~9 high when its crest reached the waterline, where the
  land clamp cut its face into a wall standing on the sand. Every crest now becomes a bore within 16 of the sand
  (bore = 1 - (1 - bore)(1 - sstep(16, 3, dc)), in stageState and stageS, mirrored). This is the only change to
  evalSurf (physics). Example: crest fn 44 at x 0 has H 12.5 at dc 12.2, 6.7 at 8.6 and 1.9 at 5.1.
- Physics, the Round 6 harness on a fresh page: wipeouts 2/2/1 at z 21/-64/100 (unchanged); maximum heights
  18.2/14.9/17.7 (were 18.1/15.3/17.7); water 14.4/10.5/13.7 (were 14.4/10.7/13.7); rogue lift 32.8 at z 430,
  water 40.8 (unchanged). With the near-sand bore term disabled the harness gives the old numbers exactly, so the
  change at z -64 (the waterline is at z -78.7 at x 0) is that term. GPU vertex positions (wind chop off) match
  evalSurf(curl = true) within 1.6 mm over 10 cases of 901 points, no misses: 9 crests 4-12 from the sand at
  x 0 and -400, plus Round 7's fn 49 at x 0, t 442.9.
- Cost (RTX 5070 Ti through ANGLE D3D11, readPixels-synced medians, ms per water render; "no de-tiling" is this
  round with plain fetches):
  | view            | no de-tiling | anisotropy 8 | anisotropy 4 (committed) |
  | 1080p first     | 0.54         | 0.60         | 0.65 (noise)             |
  | 1080p high      | 0.57         | 0.64         | 0.60                     |
  | 1080p telephoto | 0.49         | 0.54         | 0.54                     |
  | 4K first        | 0.98         | 1.13         | 1.07 (+10 %)             |
  | 4K high         | 1.33-1.39    | 1.58-1.61    | 1.59 (+14-19 %)          |
  Cat's paws and glints are ~0.13 ms of the 4K first-person cost (1.00 without both, at anisotropy 8). The
  normal map's anisotropy is now 4 on the non-soft tiers (Round 8's "anisotropy 8" above is historical): it
  differs from 8 by a mean of 0.73/255 on the high view (p99 6, max 33) and <= 0.04 on the others. Dropped:
  plain fetches for the wavelets (they carry most of the visible de-tiling: the weave comes back), branching
  around the second fetch (bit-exact, no gain), a cheaper hash (slower), clamp variants (no gain).
- SwiftShader (notes-claude/swprobe, now with s8 = 635ef93; 4 CPUs, 1280x800): the soft tier (the CI path) has
  water 93 ms mean and a frame median of 107 ms, against 635ef93's 88 / 100, so the smoke test's margin holds.
  ?soft=0: 515-533 / 569-597 against 379 / 417 (680-748 / 767-847 before anisotropy 4).
- Verified (preview pane, RTX 5070 Ti): aom medium (anisotropy 4, no defines, pixel ratio 1, 12 programs),
  ?look=classic (7 programs) and ?soft=1 (anisotropy 1, FACETS + SOFT, pixel ratio 0.5, 10 programs) compile
  without shader logs and render; console: only pointer-lock errors. Checked on shots of open water, foam, plumes
  along plunging and dumping crests, and the near-shore collapse.
- Limits: plumes are flat pictures; the blocky pattern on collapsed walls is the existing foam texture (Round 7's
  limit); analytic break-time predictions fail while a rogue is in, so the tests stepped frames; not
  hand-play-tested; the CI smoke test runs only after a push.
- Intermediate and debug shots stay in the session scratchpad, not committed. The Round 9 page helpers (shader
  variant timing, A/B sheets, crest finders) are in the worktree's git-ignored reference/ (gpu_wv.js,
  helpers_r9c.js).
- Sources: https://iquilezles.org/articles/texturerepetition/

## Round 10 (20 Oct 2026, owner: sky as before, polished plumes, no roll-back, push without camera roll, patterning)
Owner, on Round 9: the sky and sun had changed (yes: Round 8's aom look moved them) and they preferred the old
sky; the plumes "could be a bit more polished"; waves "still roll back a little just before breaking" and should
keep speed or accelerate down; the hit should only push the character back, without rolling the camera; the
water is still sometimes "patterned". Mid-round they also asked for a prompt to steer Codex (AoM look, its
compute cost); given in chat, summary below.
- Sky and sun: LOOKS.aom is back on Round 7's sky (sun [15, 0]; turbidity 8, rayleigh 3, mie 0.005 / 0.7; Round
  8-9 had [35, -45] and 2.5 / 0.5 / 0.003 / 0.8). The plume haze follows it: hazeCol [0.58, 0.82, 0.90] (was
  [0.45, 0.78, 0.92]), hazeK 0.25 (was 0.2). The cyan water and glare stay.
- Roll-back: surgeOf(w, keep, shrink, L) in crestState (mirrored in GLSL surfPos) is how far the lip tip has
  reached past where the turned-over, shrinking roller would put it; evalSurf moves the wave forward by that D
  near its crest only (s += D (1 - sstep(0.1, 0.45, |psi|))), so the tip keeps its furthest reach. keep = sAp
  clamp((dc + 15) / 60) lets it go over crest d 45 -> -15, so the bore still meets the swash at the shoreline;
  D <= 0.2 L. lipTip, the lip-hit test and plume kinds 1 and 2 subtract D. GPU vs CPU parity <= 0.3 mm over 15
  cases. Front speed / crest speed, the minimum over p 0.5-2.4 (Round 9 -> 10): fn 49 at x 0 0.39 (p 1.59) ->
  0.58; fn 49 at x -400 0.28 (p 1.55) -> 0.58; fn 44 at x 0 (a closeout breaking ~25 m from the sand) 0.85 ->
  0.51-0.58 at p 1.05. In absolute terms no front ever moves seaward, in either round. The fn 44 dip is the
  front reaching the waterline ~0.5 s earlier (D builds from p 0.2) and slowing to ~6 m/s over z 3 -> 1.5 before
  the collapse; its roller is already gone there (sigS), and letting keep go later (dc + 35) or holding it by
  stage made it no better (0.50, 0.45), so it stays as a limit. (The ratio is muddied there: D moves the crest
  itself.)
- Physics harness (fresh page): wipeouts 2/2/1 unchanged; max heights 18.1/16.5/17.7 (Round 9 18.2/14.9/17.7),
  water 14.4/13.0/13.7 (14.4/10.5/13.7): the z -64 rise is D carrying the wave further up near the waterline
  (z -78.7 at x 0). Rogue lift 32.8 at z 430, water 40.8 (unchanged).
- Push: a lip hit no longer rolls or pitches the camera (the rotation.x/z tumble is gone). It sets sea.push =
  -(1.6 + 0.14 H), which sea.vz approaches over ~0.25 s (vz += (push - vz) 0.3), so the character is shoved
  shoreward; lift only for kind 'lip' (0.12 + 0.006 H); tumble 0.8 + 0.03 H s (was 1.2 + 0.04 H); the veil is
  lighter and gone in 0.6 s.
- Plumes: shaded in display space, after the tone curve (through it they saturated to flat white).
  plumeAtlas windows its density (sstep(0.5, 0.3, |X|), sstep(0.98, 0.74, Y)) so no tile edge is hard; billboards
  1.15x wider, PlaneGeometry(2, 1, 4, 2), bowed towards the camera (0.12 w (1 - q.x^2)) with a rounded normal for
  sun shading (vLit) and an up term (vNy). Variant A, chosen on side-by-side shots: dense cores shaded by the
  atlas's B channel plus vLit, thin edges lit from behind (back glow), the foot thinned by grain into the water,
  distance haze 1 - exp(-0.00024 dist) times hazeK.
- Patterning: on the non-soft tiers the ripple layers get amplitude patches (0.4 + 1.2 smoothstep(0.15, 0.85,
  vnoise(...))) and a 9 m domain warp (two more vnoise), on top of Round 9's de-tiling. Cost below noise on the RTX
  5070 Ti (< ~0.05 ms of a 0.35-0.8 ms frame at 1280x720). The soft tier skips it.
- Not done, offered: holes in the swash foam ("leopard spots") as a further pattern breaker.
- SwiftShader (swprobe, now with r9 = 1220921; runs r9a wipa wipb r9b; soft tier, 640x400 at pixel ratio 0.5):
  water mean 160 / 121 / 161 / 220 ms, frame median 108 / 132 / 199 / 296 ms. The governor was throttling Claude
  (scale 0.22) during the runs, so they are about twice Round 9's 93 / 107 and only show no regression against
  Round 9 run alongside; every run reached the game frames.
- Codex prompt (in chat 20 Oct): the AoM look targets (cyan water, glare, embossed wavelets, white foam collars and
  splash rings, splash bursts along the break, no tiling, no roll-back, push without camera roll, hazy sky,
  techniques only from the installed AoM, never its assets or the owner's screenshots); performance budgets
  (under ~2 ms GPU at 1080p on the RTX 5070 Ti; under ~150 ms per frame under SwiftShader for the 90 s smoke
  test); how (measure first, one wave evaluation per vertex with analytic or derivative normals, a view-fitted
  grid, a software tier, instanced particles, textures baked at start-up, no per-frame allocation or readback,
  cheap CPU physics); process (own branch, aiwork.py, notes, ask before each push, not reading this branch).
- Limits: the fn 44 closeout above; plumes are still flat pictures; not hand-play-tested.
- Shots: reference/r10-shots (git-ignored). Page helpers: reference/helpers_r10p.js (plume A/B).

## Round 11 (20-21 Oct 2026, owner: water still climbing the tubes beside the break; 3D-looking foam effects)
Owner, on Round 10: "still some water going backwards (climbing up the wave instead of falling down) on the
tubes, specially in the zones immediately to the side of where the tube is breaking"; and whether the foam effects
(2D sprites, yes: the plumes are billboards) could be higher quality or 3D. Answered in chat: keep billboards but
light them as 3D relief (normal-mapped, self-shadowed, rim-lit), plus lit spray; a soft depth fade and layered
sub-sprites as further steps.
- Cause: the foam texture, glints and detail normals were mapped on world xz (open sea) or the rest grid (foam).
  Both stay put while the wave advances, so on a steep face the pattern slides up it as the face moves through.
- Breaker frame: surfPos sets gBrk = (x + 37 fn, s2 + 51 fn, weight), a texture frame of the crest's own (x and
  the distance along the profile, s2, which runs over the face, round the tip and up the lip's outer side), with
  weight stK sstep(-3 wf, -1.8 wf, s2) (1 - sstep(0.5 uBs, uBs, s2)) gCrest.y sstep(15, 40, d). stK =
  max(sstep(0.6, 0.85, sh), sstep(0.45, 0.7, 0.86 H / wf)): breaking, or a face steeper than ~25 deg (0.86 H / wf
  is its largest slope). The slope term is what covers the unbroken shoulder beside the tube, which the first
  version (sh only) left on world xz; the steep shoulder there is the "zones to the side" the owner saw.
- The fragment shader runs that frame's second coordinate down the face at VFALL = 3.5 m/s and turns slopes from it
  into the world with a cotangent frame from screen derivatives (Schueler; Tq, Bq capped at 1.5 where squeezed).
  Detail normals, ripples, foam and sparkle are sampled in both frames and cross-faded by wK = vBrk.z; the shared
  pieces are now helpers (detailSlope, ripWarp, rippleSlope, sparkle).
- Measured (reference/flow_r11.js: block matching two renders 0.015 s apart at fov 14 on fn 49 at x 100, t 441.9
  and 442.1, masked to wK > 0.5, screen thirds; + = down the screen; "geo" is a pattern painted in the breaker frame
  as the reference): median px r10 -1/0/0 and -1/-2/-4, share moving up 0.55/0.46/0.40 and 0.59/0.65/0.95; r11
  8/6/2 and 8/5/1, up 0.11/0.27/0.30 and 0.10/0.24/0.45; geo 8/8/8, up 0.04-0.16. The shoulder after the slope
  weight was checked on shots (r11-ov4 weight overlay, r11-lit1), not re-measured.
- Plumes (3D-lit billboards): plumeAtlas now also builds a relief atlas uPlumeR (RG slope normal, B height from
  blurred lumps, the fan and the density), and the main atlas's B is ao (0.8 + 0.2 lit). SPLASH_VERT passes the
  sun in the billboard's tangent frame (vL) and a bow tilt (vM); SPLASH_FRAG lights the relief normal with wrapped
  diffuse (0.65 dot + 0.35), one self-shadow step towards the sun (non-SOFT tiers only), a sky term from n.y,
  shades between white and sea-grey (0.58, 0.72, 0.8), and adds a rim and back glow when the sun is behind it,
  then the haze. Built at 1024 instances / 256 texels (soft tier 128 / 128).
- Spray: each point is a lit ball of droplets (view-space sun vSun, wrap diffuse, a rim glow when backlit; Spray
  takes uniforms.uSunDir). Subtle in the beach view, where the sun is behind the waves.
- Cost (RTX 5070 Ti, whole scene, 1080p, timer queries, q25 / median ms): fov 16 none 0.816 / 0.989, r10 1.037 /
  1.105, r11 1.051 / 1.11; fov 7 0.811 / 0.851, 0.854 / 0.894, 0.878 / 0.901. So r11 adds ~0.01-0.02 ms.
  SwiftShader (swprobe r10a r11a r11b r10b; r10 = f4823f8): water mean 1826 / 627 / 717 / 792 ms, frame median
  2612 / 738 / 847 / 952 ms; r10a was contended (steady only at 19 s, water rising to 2.1 s per draw), so against
  r10b r11 is no slower. Both tiers compile with no errors (preview ?debug and ?debug&soft=1, 21 Oct).
- Limits: no soft depth fade where plumes meet the water (needs a depth texture) and no layered sub-sprites; the
  plumes are still billboards; not hand-play-tested.
- Gotcha: a stale window.__shotCam (a fov 55 close-up) overrode every measurement render for a while; set it to
  null before measuring.
- Shots: reference/r11-shots (git-ignored). Page helpers: reference/helpers_r11.js (__seqV, __crestOf, __rep,
  __stripes), helpers_r11p.js (__mkR10 plume A/B, __mkV, __relSheet, __rebuild11, __srcShaders), flow_r11.js
  (__flow).

## Round 12 (21 Oct 2026, owner: outer-bar foam charging to the shore, waves growing before the break, AoM-like foam)
Owner, on Round 11: when a wave breaks farther out, let its foam charge all the way to the shorebreak instead of
turning into another wave; let waves grow slightly as they near the break; make the 2D foam sprites more like AoM's
(reusing or taking inspiration from its assets) and not "disjointed" from each other but a seamless foam explosion
along the tube; and which games/projects use real breaking waves, and whether real physics is an option.
- AoM: technique only, no assets. Nothing from the installed AoM (textures, sprites, particles) or the owner's
  screenshots is used or committed: copyright, and every push is a public deploy. The curtain picture is drawn
  procedurally at start-up (curtainTex).
- Outer bores run to the shore: crestState and surfPos keep an outer-bar wave (o.outer / outer) on its outer stage
  all the way in (wB = 0, cur = A, dbz = dbA), so its bore crosses the trough and meets the shorebreak; the old
  sA roller fade over the trough (reform0 228 -> reform1 200) is gone. Smaller swells still blend into their
  inner-bar break there. The surf-zone foam (fZone, zoneIn) now belongs to the crest that last passed (fn - 1
  ahead of the crest, breakZone in GLSL gives where it broke), so it runs on across the crest-cell edges.
- Growth: Hpre = Hn shoal (1 + 0.16 sstep(-3.5, 1.0, p)) (was 0.12 sstep(0, 1, p)): the wave peaks up by 16 %,
  most of it before the lip starts to throw. JS and GLSL mirrors match.
- Foam curtain (FoamCurtain, CURTAIN_VERT, curtainTex): one unbroken strip per crest slot (ns 4, fn mod ns) along
  the whole break round the camera, sampled every CURTAIN_DX = 40 units of x into a float DataTexture (per column:
  z and y of its foot, height, dissolve; lean, alpha, strips per unit x, picture offset) and joined with
  Catmull-Rom in the vertex shader, so neighbouring parts can never come apart. Upright along the crest, turned to
  the camera's side and leant back half-way towards a camera looking down; a second, mirrored layer 0.3 h behind it
  for depth. It bursts as the lip lands (pC 0.8 -> 1.1) to 1.8 H (less where the shallows shrink the curl), travels
  along the crest with the peel, then settles into a 0.45 H band of tumbling foam riding the bore to the shore;
  on shore dumps (no landed lip) the whole front slams up at once (1.0 H dumpW). Drawn far crest first, back layer
  before front (no depth write). The picture (CURTAIN_ASP 3 heights across, wraps seamlessly): a slab along the
  foot heaped into billows of all sizes (smooth min/max, no creases), feathered edges, a spray veil in wisps, soft
  jets and loose drops; relief atlas as the plumes'. Shares SPLASH_FRAG with the plumes (vT dissolve, uStep).
  Built at half 1600 / 4 sub / 6 rows / 2 layers / 256 texels; soft tier 800 / 2 / 4 / 1 / 128.
- SPLASH_FRAG (plumes and curtain) lighter, as AoM's foam: lit = (0.8 + 0.12 n.y + 0.45 dif) t.b, between white and
  a pale sea-cyan (0.7, 0.84, 0.9), and a 0.2 base back glow against the sun.
- Separate plumes are off (PACC = [0, 0, 0]): with the curtain they read as the "disjointed" sprites. The code stays.
- Grey islands: grey blobs along the crest were the surf mesh's whitewater roll lumps poking through the curtain
  (proven with no-curtain and no-water variants), not the curtain. Fixed by taking the curtain's depth nearer the
  camera: min(0.7 h, 0.5 dist), times 1 - 0.5 |dir.y| (was 0.3 h and 0.75).
- Seen, left alone: a near-oblique "cyan cliff" beside the break is the normal inner-bar peel shoulder (H 6 -> 16
  over ~75 units of x), as before Round 12.
- Verified on shots (reference/r12-shots, git-ignored; c07c_egg the final sequence): the burst is one continuous
  white mass with mist over the tube, then a white roll riding to the shore; no separate sprites. Both tiers
  compile with no errors. Not hand-play-tested.
- Cost (RTX 5070 Ti, whole scene, 1080p, timer queries, mid-burst, q25 / median ms): fp curtain 0.812 / 0.841, none
  0.789 / 0.805; near oblique 0.881 / 1.197 (noisy), none 0.877 / 0.881. So the curtain adds ~0.02-0.04 ms.
- SwiftShader (swprobe, now with r11 = 9fbcd0f; runs r11c wipc wipd r11d, soft tier, 640x400 at pixel ratio 0.5,
  governor scale 1.0): water mean 83.5 / 89.6 / 92.4 / 84.3 ms, game frame median 92 / 97 / 100 / 93 ms (p90 166 /
  185 / 200 / 191). So Round 12 costs ~5-7 ms a frame there (~6 %): the water draw ~6-8 ms more (most likely
  surfPos's extra breakZone), the four curtain strips ~0.5 ms a draw; well under the ~150 ms budget. Every run
  reached the game frames.
- Research (notes-claude/research-r12-breaking-waves.md, web only, 21 Oct): no shipped game simulates plunging
  breakers live; games and films (True Surf, Fluid Flux, Moana, Surf's Up) use authored or analytic profiles, often
  calibrated by an offline 2D sim. Options: (a) keep the analytic model (runtime and soft tier); (b) recommended
  next: bake a small library of offline 2D cross-shore slice sims (e.g. Basilisk or DualSPHysics) into a texture
  and blend them along the peel; (c) height field plus particles for bores and swash, later, desktop only; (d) live
  3D particles: reject (too heavy for the budget and SwiftShader, and unpredictable).
- Page helpers: reference/helpers_r12.js (__run, __cur, __until, __CAMS, __grid, __vars, __vis, __curM, __notCur,
  __nextBurst). Surf time is internal to createSurf: setting uTime does not rewind it; use __nextBurst.

## Round 13 (21 Oct 2026, owner: research links; the bore's "plastic wall", its flickering top, foam clipping)
Owner, on Round 12: research six links (80.lv Three.js Water Pro, a Babylon WebGPU ocean playground, a YouTube
short, a Reddit post on a forgotten surfing game, Wave Race, a Unity "realistic breaking wave" thread) for anything
that helps our water physics, look or performance, and feel free to talk to Codex. And: the rushing white water
"looks like a plastic wall", its top seems to flicker, foam sprites could keep spawning to cover it, and the foam
sometimes clips the wave.
- Diagnosis (shots r13_* and r13b_*): the bore is the surf mesh's collapsed roller riding as a smooth solid step;
  lit as water, its plain face and the sharp line of its top against the sea beyond read as plastic. The curtain's
  bore band stood at the lip tip (lipTip d), which is behind the roller's front once it has collapsed, so the band
  sat inside the white water and poked through it here and there: that is the clipping and most of the flicker at
  the top. The old bore plumes (kind 2, off since Round 12) were short and squarish, so when on they lay on the
  face as blocks; not a depth problem.
- boreFace(x, zs, td, H, t, out): samples the curled surface (evalSurf, 10 points from 0.8 H ahead of to 1.6 H behind
  the lip tip) and returns the face z (the furthest shoreward point above a third of the way up), yb (the water
  1.5 H ahead) and top. CPU only, no GLSL change.
- Curtain bore band: as the roller rides the bore (bT = sstep(1.4, 1.9, pC) sstep(1.5, 3, H)) the band moves to
  0.6 units in front of the face, from 0.12 H under the water ahead of it to 1.18 x the bore's height (+0.12 H,
  less in the last 5-25 units to the shore): a ragged foam edge over the top instead of the hard line. T 0.3,
  lean 0.08, alpha 0.85.
- Continuous bore plumes: PACC = [0, 0, 1] (the lip's and the shore dump's stay in the curtain). Gate H > 1.5 (was
  2.5); kind 2 while pC > 1.5 and dc > 4, rate 1.6 sstep(1.5, 1.9, pC) sstep(4, 15, dc) sstep(1.5, 3, H), so they
  keep billowing up off the face all the way in. Each stands 0.3-1.5 units in front of the face, foot at yb - 0.1 H,
  height (top - yb + 0.1 H) x 1.25-1.6 (so its dome tears the top line), width 1.0-1.4 h, life 1.3-2.0 s, drift
  with the bore (0.95-1.05 c).
- Verified on shots (reference/r12-shots, git-ignored: r13c_fp, r13c_vars, r13c_vars2 the final first-person and
  with/without-curtain/plume variants): a ragged, continuously renewed foam front with no block plumes and no
  band poking through the face. Flicker map (__flick: mean |f(t+1) - 2 f(t) + f(t-1)| of luminance, fp camera,
  1920x1080, rect [240, 420, 1440, 220], from t 125.85): mean 1.543, with only a faint line left at the top. No
  old-code baseline at the same phase (surf time cannot be rewound), so this is not a measured before/after.
  Not hand-play-tested.
- Cost: SwiftShader swprobe (now with r12 = dbd6318; soft tier, 1280x800 CSS, 640x400 at pixel ratio 0.5, 4 CPUs,
  alternating r12a wipe wipf r12b): water draw mean 115.9 / 87.9 / 83.9 / 81.3 ms (r12a is a warm-up outlier),
  game frame median 123 / 94 / 99 / 92 ms, p90 311 / 157 / 188 / 186 ms. So no measurable regression; the medians
  are under the ~150 ms aim, the p90s are over it (as in Round 12, a known tail, not new). CPU surf.update 1.27-1.54 ms in the preview (mixed phases, no Round 12 baseline). No RTX timer query
  this round (the change adds draws only through plumes from the existing pool).
- Research (notes-claude/research-r13-links.md): none of the links offers live breaking-wave physics. Water Pro
  (paid, closed, WebGPU FFT) and the Babylon port of an MIT FFT ocean give ideas, not code: persistent decaying
  crest foam, Jacobian turbulence accumulation, depth-difference contact foam. The YouTube short is an offline
  FLIP Fluids render; its whitewater rules (emit by crest/turbulence and speed; foam / bubble / spray by depth
  around the surface; lifespans) are what carries over. The Reddit game is most likely Kelly Slater's Pro Surfer
  (2002, UNVERIFIED) and, with Wave Race, shows art direction (colour by thickness, rich spray over a cheap
  surface, one height function for graphics and gameplay). The Unity thread confirms spline/analytic profiles and
  warns of back faces when the lip collapses. Ranked for us: (1) foam sprites riding the bore front (done here);
  (2) soft depth-fade contact foam (needs a depth pre-pass, GPU tier only); (3) an analytic foam-age trail behind
  the bore; (4) a thickness colour ramp.
- Codex second opinion (ask_codex round 1, read-only, before the fix; response in
  reviews/codex_bridge/20261021T123946Z-8eef51657c5b/response.txt, git-ignored): keep the analytic model; the
  links give ideas, not a replacement (Water Pro and the Babylon FFT have no shorebreak; it could not watch the
  short). Its code findings, with what Round 13 did: (High) curtain columns derive their slot's crest fn each on
  their own, so neighbouring columns can be joined across two different crests when nLo crosses a slot edge, and
  Catmull-Rom can overshoot height/alpha at active edges: NOT done, the first flicker suspect left; (High) plastic
  look from the straight toe-to-nose bore face plus strong narrow glints on dense foam: covered here by foam over
  the face and top, the rounded face and softer foam glints NOT done; (High) foam anchored off the un-curled
  surface (evalSurf false, decals gFlat) and hidden by depth offsets: the bore band and plumes now anchor on the
  curled surface (boreFace), decals unchanged; (Medium) other flicker suspects to isolate: the curtain's
  camera-side flip (hd), the 40-unit origin snap, slot sort by one column, sparkle; (Medium) bore plumes from
  persistent per-(fn, cell) emitters: done as continuous kind 2 plumes, with random rather than persistent
  emitters; (Medium) the soft tier's p90 is over 150 ms. Not reproduced by Codex; it ran nothing.
- Codex cooperation (owner: Codex left a message at the owner's request so we can collaborate): bridge ask
  20261021T124535192705Z-codex-ec027a9b. Read only pinned blobs of Codex's v11 8d436e9 (tooling/v11/RESULTS.md,
  js/coast/fluid.mjs, js/coast/height-physics.mjs); nothing in Codex's tree checked out, edited or run. Reply:
  notes-claude/cooperation/CLAUDE-TO-CODEX-20261021.md (goals, research, comments on Codex's extruded section,
  coarse cells for 2 m tubes, one-way body coupling and software-tier solver load; proposed split: Codex the
  physical section, peel by delayed section playback, two-way coupling; Claude the runtime look, soft-tier
  performance and option (b) slices; shared cases V1-V6; next step: Codex exports ~30 Hz section contours for one
  breaking cycle and Claude compares them with evalSurf). Sent through the bridge with this commit as its ref.
- Next, if the owner wants more on the flicker: give each curtain strip one crest fn over its whole range (Codex's
  first finding), clamp the interpolated height/alpha, then a rounded bore face mirrored in evalSurf.
- Page helpers: reference/helpers_r12.js gained __crop and __flick (Round 13 blocks).

## Round 14 (21 Oct 2026, owner: the foam wave's top still flickers up and down very fast, all the way to the shore)
- Measured, not guessed: __edges finds the bore's top edge (first white run under cyan) in five screen columns
  (x 760-1160, player view, 1920x1080) every 1/60 s, in three matched variants (all; no plumes; water only), and
  __jit2 scores the longest continuous run: mean |second difference|, RMS and peak of the residual from a 9-frame
  mean. Before: mean |d2| 0.8-1.0 px, RMS ~0.9 px, peak ~2.9 px, the same with plumes and curtain hidden, so the
  water mesh itself was jumping, at ~11 Hz and in step along x (slit-scans r14_slit_pv_b, r14_slit_pv_fix_a in
  reference/r12-shots, git-ignored).
- Two causes. (1) The bore plumes (kind 2, Round 13) burst up and fell back like the lip's; many at once, their
  domes drew arches over the bore's top. Now a steady plume (alpha stored negative, `steady` in Splashes.add) only
  swells 0.8 -> 1.0 and fades in/out slowly, with no fall; kind 2 plumes are all alike (h x 1.3-1.5) and live
  1.8-2.6 s (PLIFE[2] 2.2) so their tops overlap into one ragged line. (2) The mesh rows stood still while the
  crests crossed them: one crest per row every ds/OMEGA ~ 0.09 s, i.e. ~10-11 Hz, which matched the measured
  frequency. Each crossing changed how the rows caught the bore's sharp top, so its edge jumped by a pixel or so.
- Fix for (2): the rows travel with the crests. From d -125 to z 350 they are evenly spaced in phase (ds = 1.3 f
  kOf(200), finer near the shore as before); each slides toward its shoreward neighbour by uRowF (the step is in
  position.y; uRowF = (OMEGA t / ds) mod 1), so after one ds the mesh is the same as before, one row on. Rows
  under the sand (d < -125) stand still, and a strip there shrinks to nothing; rows from z 350 to 600 slide too
  (not exactly at crest speed: the swell is smooth there); past z 600 they stand still, and the first of those is
  doubled so its moving copy opens a strip from nothing. Without the doubling one row popped in there each wrap: a
  1-px, 10 Hz flicker along a big swell's top near the horizon (39 pixels at t 89).
- Results (same procedure): mean |d2| 0.31-0.41 px, RMS 0.28-0.44 px, over runs of 263-339 frames (before, runs
  broke into 40-80-frame pieces). 0.35 is the floor for a steadily sinking edge: a one-pixel step every ~5-6
  frames. Peaks of 1.2-3.7 px are where the edge first enters the column. Zoomed slit-scan r14_slit_pv_fix_zoom:
  the top now sinks as a monotonic staircase. Wrap check (__wrapDiff, uRowF 0 vs 1 at the same instant, water
  only): 0 pixels over 8 in 15 of 16 instants, 1 pixel in one. Medium mesh 883 x 620 = 547460 vertices (was
  883 x 602, +3.0%); all 10 programs compile. Not hand-play-tested; the soft tier (FACETS) was not run (same
  vertex shader; degenerate strips are zero-area triangles); no SwiftShader timing this round.
- Page helpers: reference/helpers_r14.js (git-ignored) as a module: await import('/reference/helpers_r14.js?' +
  Date.now()) after Start Game; it pauses the game and defines __findBore, __slit, __edges, __seg, __jit2,
  __wrapDiff.

## Round 15 (21 Oct 2026, owner: the broken waves' white foam still trembles; the foam looks plastic, not bright
## white and dynamic; the 2D splash should be brighter and whiter, like the AoM screenshots)
- Measured (reference/helpers_r15.js and helpers_r15b.js, git-ignored; player view 1920x1080, water only unless
  said): __tdiff renders 24 frames at 1/60 s from t 12.0 inside a rect and scores, over the pixels at least 215
  bright (or 215 red: only white has red, the cyan water is as luminous) in every frame, the mean |frame difference|
  d1, the RMS residual from a 5-frame mean (hi: the fast part) and the mean |8-frame difference| d8, for the live
  shader and for ablated clones of it that zero one animation source each (sparkle, relief, churn, lace holes, lace
  streaming, bore lumps, chop, ripples and detail normals, or all of them). __stats/__rendStats/__imgStats give
  luminance percentiles (5/25/50/75/95), mean RGB, 10th-percentile RGB and the share of pixels >= 245 of a render
  rect or of a rect of an AoM screenshot served from /reference/.
- Tremble before (band x 400-1500, y 540-700: the bore and its wash): d1 1.20, hi 1.46, d8 3.71; the bore's top edge
  itself was already steady (Round 14, ~0.35 px RMS). What moved: the lumps of the whitewater mass (rollerLumps at
  2.2-5.2 rad/s, boreLumps at 2.3-4.7 rad/s on world z, so they raced through the bore as travelling ripples); the
  wind chop (1.9/2.6 rad/s) running through the white mass, the sea beyond showing through it; the foam relief from
  the lace, which streams down the face at VFALL, so it flickered; the sun sheen and glints on the foam; and in the
  wash, ripples, detail normals and chop seen through the thin foam and in its holes (ablations on the wash,
  pixels R >= 215: no ripples 1.21 -> 0.64, no chop 1.21 -> 0.83, nothing moving 0.34).
- Fixes: boreLumps on the crest-relative s2 at 0.6/0.8/1.1 rad/s (CPU and GLSL alike), rollerLumps 0.7-1.6 rad/s;
  chop damped 85 % over the bore's whitewater (turb) and over the inner surf zone (zoneIn, now computed before the
  chop; the foam block reuses it); ripples and detail normals faded by calm = max(aer, 0.9 smoothstep(0.1, 0.5,
  vFoam)) (bubbles and a film of foam still capillary waves); the relief over the geometric normal, bumpK 1.5 -> 0.6
  with the lace's share 0.4; churn at 0.13 scale, 0.4 uTime; the foam's specular (sunF, glint, fresh) gone, the
  sparkle halved and only on older foam.
- Foam colour, measured against the owner's screenshots: AoM's foam body (aom-03) has luminance percentiles
  [243, 254, 255, 255, 255], 10th-percentile RGB (234, 254, 254), 94 % of pixels >= 245; its edge (198, 253, 252),
  aom-07 (215, 254, 253) with 80 % white, the wash (aom-11) (233, 248, 251). G and B are pinned at ~254 and the only
  structure is red dipping in cyan creases: never grey. Ours before: a flat light grey, median 238 (IQR 236-238,
  8 % white, 10th-percentile 235/238/239). The water is tone-mapped by ACES after x1.55 (linear 2.0 -> 232,
  3.1 -> 241, 6.2 -> 249 sRGB), so the old foam (~1.5-2) sat at the knee, and its sun sheen and blue-grey hollows
  read as glossy plastic. Now foamCol = mix((0.84, 0.91, 0.96), 1, thickL) x (2.6 + 0.9 wrap + 0.4 back), wrap
  0.35 dot + 0.65 (matte: nearly as bright on the shaded side), the hollows between the churn lumps tinted
  (0.2, 0.72, 0.78) by crease = 1 - smoothstep(0.08, 0.55, churn), thin films still keeping water colour. Bore face
  now: median 245-246 (25-75 pct 243-247), 62-73 % white, 10th-percentile (232, 243, 244); with the plumes and the
  curtain 252-253 and 88-95 % white; the wash at its foot median 240-245, 10th-percentile ~(215, 235, 238).
- Splash sprites (SPLASH_FRAG): alpha from min(1, 1.25 t.r) (a solid white core), dif = 0.5 dot + 0.5, the
  lump shadow 0.35 (was 0.6), lit = (0.85 + 0.1 n.y + 0.4 dif) x mix(0.6, 1, t.b), shaded towards a pale cyan
  (0.76, 0.94, 0.97) instead of grey-blue (before, the plumes were a milky grey-cyan veil over the bore); the bore
  curtain's alpha 0.85 -> 0.92.
- Results (same band, water only): d1 0.36, hi 0.70, d8 1.90 (with plumes and curtain 0.35/0.73/1.77). The bore
  face alone (R >= 215, x 600-1320, y 500-595): 0.19/0.45/1.10; its wash (y 598-698): 0.44/0.63/2.18, from
  1.21/1.52/4.40. With everything that moves ablated: 0.10/0.57 (face) and 0.37/0.66 (wash), i.e. what is left is
  the bore's own travel and the slow churn. Difference montages r15f_face, r15f_foot (frame, |d1| x6, hi x6), crops
  r15f_crop_bore(_w), still r15f_pv_all in reference/r12-shots (git-ignored). Colour stats were taken at t 9.9-13.5
  on the first bore (__findBore: strip 2, z 198, h 15.3).
- Limits: the lace on the wash lies on still water now (its holes still drift at 0.25-0.8 rad/s), which can read as
  a net; the foam has no sun sheen at all, and at the top of the curve a low sun will not shade it; chop is nearly
  gone from the whole inner surf zone, not just under foam; not hand-play-tested; the soft tier (SOFT/FACETS) was
  not run.

## Round 16 (21 Oct 2026, owner: waves a bit faster and more spaced (longer period); the broken wave should get
## smaller faster, growing until it breaks and then shrinking until it dissipates at the shoreline)
- Speed and spacing: SURF.period 9 -> 10 s, SURF.L0 230 -> 290. Crests travel at L0 / period / (1 + 0.85 e^(-d/220)):
  29.0 units/s offshore, 25.5 at d 400, 21.6 at 200, 18.8 at 100, 15.7 at the shore (was 25.6 / 22.5 / 19.0 / 16.6 /
  13.8: +13.5 % everywhere), and the crests are 25 % further apart (mid-surf 207-211 units, was 165-170). Both
  constants reach the GLSL by template (K0, OMEGA); the mesh rows are spaced in phase by 1.3 f kOf(200), so their
  spacing in distance (that over kOf(d)) does not depend on L0, and the row slide uRowF reads OMEGA. The broken wave
  is carried forward by the surge D on top of this (evalSurf), so a crest tracker reads 30-45 units/s over its break.
- Bore height (stageState and stageS alike): Hbore = min(Hn, boreK depthC sqrt(depthC / depthB) + 0.5), depthB the depth
  where that stage broke (was boreK depthC + 0.8, linear in the depth). A bore linear in the depth keeps H / dc
  constant, i.e. the same angular size from the beach all the way in, which is what read as "stays big"; depth^1.5
  shrinks on the way in. Profiles (boreK 0.55): a wave that broke at d 185 is 8.9 at 185, 3.7 at 100, 1.5 at 50,
  0.6 at 16 (was 9.2 / 5.2 / 2.9 / 1.3); an outer-bar wave (db ~345) 8.8 at 226, 6.0 at 185, 2.6-2.9 at 100, 1.2 at 50
  (was 9.2 at 185, 5.2 at 100, 2.9 at 50). The plumes (sstep(1.5, 3, H)) now go out around d 50 for a bore that broke
  on the inner bar instead of d ~20. For a wave with no outer stage (dbA = -1e4) that stage's depthB is the floor 0.3,
  but its Hbore is never used: its bore weight is 0 offshore (p << 0) and the stage itself has weight 0 inside d 200
  (wB = sstep(228, 200, dc)), long before the sstep(16, 3, dc) forcing; min(Hn, ..) caps it in any case.
- Measured in the preview (evalSurf with curl, crest minus the lowest point within 60 units shoreward, x 0): the inner
  wave that broke at d ~195: 10.1 at 196, 6.6 at 150, 3.3 at 96, 1.4 at 43, gone by 15; the outer wave behind it:
  16 at 437, 18 at 381, 27 at 328 (its peak-up at the break), 15 at 239, 11.6 at 213, 7.2 at 159, 4.2 at 109, 1.8 at
  64. Consecutive crests pass d 417 every 10.0 s. Player-view stills of that sequence in reference/r12-shots
  (git-ignored): r16-pv-d200/d150/d100/d050/d015 (t 64.2-73.4) and r16-seq-t76/t79/t81/t84; the white bore wall at
  d ~200 becomes a low line at d ~100 and a wash at d ~50 while the next outer wave rises behind it.
- Peel is unchanged: inner waves break at db = max(min(db0, 185) - 0.22 |x - xp| + 12 sin, 40), xp random in +-900,
  so at any one x some waves break late (db 40-100) and keep their unbroken height (~10) until d ~16, then collapse
  by d 3 (the sstep(16, 3, dc) forcing). From the beach those read as a wall that stays big, but they are the
  shorebreak closeouts, not the foam wave; if the owner means those, the fix is a smaller peel or a later minBreakD.
- Soft tier (?surf=soft): all programs compile, no shader errors. Not re-measured: the tremble scores of Round 15
  (the law only lowers H, which scales the lumps down with it); not hand-play-tested.

## Round 17 (21 Oct 2026, owner: the foam sprites sometimes look like snow, or like vapour, rather than water
## spray; check how AoM makes its spray look so good and watery)
Implemented the same day on the owner's yes to the six points below, with one deviation (point 5: the far haze was
measured, not cut). The implementation record follows the proposal. Committed with the code; nothing pushed.
- AoM, the 20 shots re-read one by one (reference/aom-2026-10-19/, git-ignored, with the Round 8-9 README on how the
  game draws its water, read from the owner's install): all 20 are classic AoM: The Titans (Ensemble's BANG engine;
  the in-game shots carry the Titans watermark, aom-14..20 are the classic scenario editor) under the owner's water
  mod and MenuArctic lighting; none is Retold, and the Retold update notes found on the web describe other water.
  AoM's foam is a continuous near-pure-white field (G and B pinned at ~254, Round 15) blended over saturated cyan
  water with the water's own embossed wavelet relief showing through it (white crests, thin cyan creases): that
  relief is what makes it read wet. The shore wash is a wide soft white gradient (aom-02/08/17-19; cream over sand in
  12/13); a breaking band is a cyan face topped by a soft pale band with a brighter zigzag edge; unit rings are soft
  white discs with faint ripple texture; wakes (aom-11, 15) are long soft white tails elongated along the motion.
  The only sprite spray (aom-07, 09, 15) is a few thin curved translucent white streaks or arcs, several times longer
  than wide, elongated along the motion, in small clusters, with the cyan showing through them. No round puffs and
  no discrete dots anywhere in the 20 shots. The only vapour-like sprite is the Water Elemental's pink-white cloud
  (aom-16), a unit effect, not water.
- AoM's technique (README): every effect is a billboard with one painted soft texture. The splash is a few big
  billboards of one painted plume (a mottled white sheet over streaks fanning down, on transparent ground; .prt
  files with white colours) that burst up, spread and fall back. The structure of the spray is in the picture
  (streaks, broken edges), not in the particle count; the colour is white, never grey; the bright glare is
  MenuArctic's white sun specular on the water, not on the sprites. Mist sprites exist but serve the elementals; the
  waterline foam is animated sprites riding the shore and the wakes are decals on the water. No technical source for
  AoM's foam exists on the web (only Bang-engine history pages); the shots and the install are the evidence.
- Ours, measured (aom look, 1920x1080, paused loop stepped by hand, t 9.9-10.7; class Spray is one THREE.Points of
  6000 camera-facing noise discs; the plumes and the curtain are class Splashes): 4727-4861 live; sizes at t 9.9:
  <2: 625, 2-4: 2545, 4-7: 1039, >=7: 652 units; z 162-304, densest at z 270 (the lip); ymax 24. In the player
  view 1921 are on screen: point sizes <4 px: 46, 4-8: 920, 8-16: 861, 16-32: 94, none larger (mean 8.6 px); alpha
  >=0.8: 1712, 0.5-0.8: 916, 0.3-0.5: 1072, <0.3: 1027. The typical visible sprite is a 4-16 px disc at near-full
  alpha, falling: a snowflake. Stills in reference/r12-shots/ (git-ignored): r17-pv with 1:1 crops r17-pv-c1/c2
  (player view), r17-lip, r17-lip2, r17-lipb, r17-lipb2 (the lip from about 80 and 125 units), r17-mist, r17-boreb,
  r17-boreb2 (the inner bore from about 70 and 105 units). They show (a) the break as a solid white wall with a soft
  top, where spray, plumes, curtain and haze stack with no drop, streak or arc structure (only the plumes' faint
  vertical streaks); (b) along the wall's top edge, against the sky, discrete pale-blue round tufts the size of
  cotton balls (kinds 0 and 1: snow); (c) over the mid water in the player view, two or three large faint grey-white
  soft blobs hanging in the air (kind 2 grown to 7-20 units: vapour); (d) the water itself (cyan, foam lace, wavelet
  relief) already reads watery, like AoM's.
- Why snow: kind 0 (lip: size 1.2-2.8, alpha 0.9, life 0.6-1.3 s, vy 8-22 then -30/s^2; emitSpray) and kind 1
  (splash-up: size 2-5 x (0.6 + 0.4 Hs/14), alpha 0.85) are small, bright, near-opaque, round, camera-facing discs
  that fall under gravity with no stretch along their velocity; hundreds at 4-16 px drifting down are snowfall. The
  fragment (SPRAY_FRAG) lights each as a matte ball from a base tint (0.62, 0.75, 0.82), a grey-blue; where the sun is
  not behind it the disc is pale grey-blue on a pale sky, a snowflake or cloud tone, never white-over-cyan.
- Why vapour: kind 2 (mist: size 3-7 growing 60 %/s, alpha 0.4, life 1-2.2 s, rising 3-9/s, drag 1.5) is a large,
  soft, structureless, low-alpha noise disc that rises and swells: a smoke sprite by construction. Every kind grows
  60 %/s (Spray.update) and fades through a 2-octave noise edge, so all spray ends as fog. Within ~30 units of the lip
  the point spray, the bore plumes, the curtain and the far haze all add white, so the lip saturates to a flat
  white wall that hides the curtain's painted structure.
- Research (recorded for the shared notes; the gist agrees with the AoM evidence): alpha-blended soft round sprites
  read as smoke, additive ones glow; water spray wants streak-shaped sprites stretched along the velocity, a painted
  texture with internal streaks and broken droplet edges, translucency with the background showing through (not a
  grey tint), short lives with no growth for drops, depth softening only at the water contact (over-used it turns
  spray into mist), small specular glints, and a few large sprites rather than many small ones.
  https://polycount.com/discussion/comment/2337931 (and 2338118, 2338745, 2338736;
  www.polycount.com/forum/showthread.php?p=2338221), https://fearian.artstation.com/projects/5WWazg,
  https://www.fab.com/listings/a3a05ed3-2654-4730-8d1a-a143332c278c, https://www.sidefx.com/forum/topic/29954/,
  https://developer.download.nvidia.com/whitepapers/2007/SDK10/SoftParticles_hi.pdf,
  https://generalistprogrammer.com/tutorials/game-particle-effects-complete-vfx-programming-guide-2025,
  https://www.trifox-game.com/splash/, https://community.khronos.org/t/good-blendmodes-for-particleeffects/33190,
  https://diglib.eg.org/items/35b0df21-074c-47e6-a266-639d85b42bff/full (Bagar, Scherzer, Wimmer 2010: layered
  particle water, foam by Weber number), https://www.cs.nthu.edu.tw/~chunfa/PG08_1227.pdf,
  https://th.pathofexile.com/forum/view-thread/390, https://seamproof.itch.io/water-splash-vfx,
  https://github.com/z4gon/fire-vfx-unity, https://github.com/DancingPhoenix88/particles-training,
  https://superhivemarket.com/products/sprite-particles-for-realtime-vfx-with-geonodes,
  https://discussions.unity.com/t/stylized-water-2-urp-desktop-mobile-consoles-vr/815355?page=3,
  https://www.elephorm.com/formation/houdini-185-lightning-shading-et-rendu/activation-et-parametrage-des-white-water-dans-le-rendu-3d.
  AoM engine and versions: https://ageofempires.fandom.com/wiki/Bang_Engine, https://en.wikipedia.org/wiki/Age_of_Mythology,
  https://en.wikipedia.org/wiki/Age_of_Mythology:_The_Titans, https://en.wikipedia.org/wiki/Age_of_Mythology:_Retold,
  https://www.thegameengine.org/age-of-mythology/age-of-mythology-square-fog-of-war-and-water-glitch/,
  https://www.ageofempires.com/news/age-of-mythology-retold-update-19-5934/,
  https://www.ageofempires.com/news/age-of-mythology-retold-update-19-12998/,
  https://purexbox.com/reviews/xbox-series-x/age-of-mythology-retold,
  https://steamcommunity.com/app/1934680/discussions/7/592897436326865972.
- Proposal for Round 17 (shader and emission constants only, no new geometry; both looks share the spray shader):
  1. Streaks, not discs: give each point its velocity (new attribute aVel, written at emit and in Spray.update); the
     vertex shader projects it to a 2D screen direction and a stretch s = clamp(|v_screen| k, 1, 4), enlarges
     gl_PointSize to hold the streak and passes dir and s to the fragment, which shapes the alpha as a soft capsule
     along dir (length s, width 1/s) broken along its length by the existing noise (droplets), bright at the leading
     end. Slow particles stay short ovals, so the plume feet and the wash do not change character.
  2. Colour: drop the grey-blue base; col = mix(the water cyan behind, foam white (0.76, 0.94, 0.97) to white, core)
     with a translucent body (peak alpha 0.6-0.7 for drops, white only at the head and where the sun is behind) and a
     tiny sun glint (sharp pow on the ball normal, +0.3 white) so drops sparkle instead of glowing.
  3. Drops do not grow: kinds 0 and 1 keep their size (or shrink 20 %/s), live 0.4-0.9 s and are emitted at half
     the count with 1.5x the size (AoM: a few big billboards); the fade-out is a plain alpha ramp, not a swell.
  4. Airborne mist goes: kind 2 is removed as a rising sprite; its budget becomes a low, flat spray sheet hugging the
     bore's top (short life, no rise, alpha fading with the height above the surface recorded at emission, the cheap
     stand-in for a soft-particle contact fade, since there is no depth read-back), and the thin-spray dissolve stage
     keeps its surface foam wash on the water.
  5. Thin the lip stack: emit lip spray only where the curtain is thin, or at half the count, and cut the far haze's
     white on the lip band, so the curtain's painted structure and the water's relief stay visible.
  6. Keep the plumes and the curtain as they are: they are already AoM's technique (painted billboards) and the owner
     has accepted their look. Verify with the lip and bore cameras, the 1:1 crops and a play test for the motion.
- Limits: no technical source on AoM's foam beyond the owner's install and shots; the stills come from a paused
  loop stepped by hand, so the motion impression (snowfall) is inferred from sizes, alphas and velocities, not
  seen; measured at one time (t 9.9-10.7) and one state; the classic look was not re-measured and the soft tier
  not checked (nothing changed).
- Implemented (js/surf.js: SPRAY_VERT, SPRAY_FRAG, class Spray and the three spray jobs in emitSpray; the unit splash()
  and wake() callers are untouched and keep the old 60 %/s swell through emit's defaults; both looks and all tiers
  share the spray shader, so the classic look and the soft tier got the change too):
  1. Streaks: a per-particle velocity attribute aVel, written at emit and on every update. The vertex shader takes the
     view-space velocity less its part along the line of sight (sv = vv.xy + mv.xy * vv.z / dz, a 0.15 s trace of
     the drop's motion across the screen), stretches the point vS = clamp(1.6 + 0.15 |sv| / size, 1.6, 3.5) along it
     and enlarges gl_PointSize by vS; the fragment draws a capsule of half-width 1/vS along the passed direction,
     broken along its length into beads by the existing two-octave noise, narrowing and fading towards its tail
     (alpha x (1 - 0.5 thin)) and brightest at its head. Slow particles stay ragged ovals, so the unit rings and
     wakes keep their character.
  2. Colour: the grey-blue base (0.62, 0.75, 0.82) is gone. col = mix(cyan (0.60, 0.87, 0.92), white, 0.55 + 0.9 core
     + 0.2 (n - 0.5)) with core = 1 - smoothstep(0.35, 1, r) and white = mix((0.76, 0.94, 0.97), 1, 0.2 + 0.6 diffuse
     + 0.3 head); a sun glint pow(dot(ball normal, half vector), 48) x 0.3 and a 0.35 rim when the sun is behind;
     alpha a (0.75 + 0.25 n). The cyan shows only at the edges, the body is white-over-cyan, translucent.
  3. Drops do not grow: emit() gained grow (size growth per second, default 0.6 so the unit callers are unchanged)
     and fadeH. Lip drops (kind 0): half the count (cap 30 -> 15, H 0.9 -> H 0.45), 1.5x the size (1.8-4.2, was
     1.2-2.8), life 0.4-0.8 s (was 0.6-1.3), alpha 0.75 (was 0.9), shrinking 20 %/s. Splash-up (kind 1): cap 18 -> 9,
     H 0.8 -> H 0.4, size 3-7.5 x (0.6 + 0.4 Hs/14) (was 2-5), life 0.45-0.9 s (was 0.9-1.8), a lower rise (vy^2 =
     60 Hs (0.2-0.7), was 0.3-1.1), alpha 0.75 (was 0.85), shrinking 20 %/s. LIFE (the budget's mean lives)
     0.95/1.35/1.6 -> 0.6/0.68/0.52.
  4. No airborne mist: kind 2 is a flat sheet just over the bore's top, riding with it: emitted 0.3-1.3 units above
     the surface (one evalSurf per particle, over 0.6 H in z) at p 1.2-3.2 (was 0.9-3.2), no growth, rising 1-4/s
     (was 3-9), life 0.35-0.7 s (was 1-2.2), size 3-6 (was 3-7), alpha 0.45 (was 0.4), and fading out over 1.5 units
     as it sinks below its emission height (fadeH, the stand-in for a soft contact fade: there is no depth
     read-back). Cap 20 -> 16.
  5. Thinner lip stack: the lip count is halved and its alpha lowered (point 3). The far haze was measured, not cut:
     its mix at the lip's distance from the player camera, (1 - exp(-336 x 0.00024)) uHazeK, is 6.6 % with the
     classic look's hazeK 0.85 and 1.9 % with aom's 0.25, so it is not what whitens the lip (the curtain, the plumes
     and the water's own foam are) and cutting it would change nothing visible. Deviation from the proposal.
  6. Plumes and curtain untouched.
- First pass and tuning. The first pass (stretch 1.0 + 0.12 |sv| / size, core from r 0.2, cyan (0.45, 0.80, 0.88)
  with mix base 0.25, alphas 0.6 / 0.7 / 0.35) removed the tufts and the blobs but left the spray almost invisible.
  Measured with the Points shown and hidden (a 2D-canvas getImageData diff; share10 = the share of pixels whose
  largest RGB change exceeds 10 levels) at t 10.3: 0.34 % of the player view's break band [0,440,1920,280] (mean
  |delta| 0.15 levels), 0 % of its wash [0,720,1920,360] (the small white ovals on the wash are not sprites), 0.01 %
  of the lip view [0,300,1920,500], 0.52 % of the bore view. Two reasons: white streaks over the white wall vanish
  whatever their colour, and the lip throws most drops straight at the shore cameras, where a physical stretch
  foreshortens them into dots. Tuned: a stretch floor of 1.6 (0.15 |sv|) so a drop coming at the camera still reads
  as a short streak (a painted-look choice: AoM paints arcs whatever the motion), a wider white core (from r 0.35)
  with the cyan only at the rim (mix base 0.55), alphas 0.75 / 0.75 / 0.45. After: break band 0.61 % (mean 0.21) at
  t 9.9 and 0.45 % at 10.3, lip view 0.11 % / 0.03 %, bore view 0.87 % / 1.00 %. Live sprites at t 10.3 (first
  pass): 4666, mean size 4.2 at z >= 200 and 3.3 nearer, max 8.9; in the lip bin x 560-640: 270, densest at z
  250-270 (92 / 137 / 40), highest y 16.2, mean speed 13.7 units/s with 6.2 across the view.
- Stills (reference/r12-shots/, git-ignored, aom look, half scale unless a crop): after the first pass r17b-pv, -lip,
  -lipb, -mist, -boreb (t 9.9), -lip2, -lipb2, -boreb2 (10.3), -pv2 (10.7), the crops r17b-*-c, and the diagnostics
  r17b-spray-* (plumes and curtain hidden), r17b-only-* (water hidden too) and r17b-side* (a camera inside the wave,
  unusable); after the tuning r17c-pv, -lipb, -boreb (9.9), r17c-lipb2 (10.3), the crops r17c-pv-c2, -boreb-c,
  -lipb2-c, -boreb2-c, and r17c-only-lipb2 (the sprites alone); r17c-classic-pv and r17c-soft-pv (same time and
  camera: the classic look and the soft tier both compile and render, with no console errors beyond the pointer-lock
  ones from clicking Start in the preview tab). They show no tufts along the wall's top and no vapour blobs over the
  mid water; above the bore's top edge a few fine pale streaks against the sky (r17c-boreb2-c); the sprites alone as
  short streaks along their motion, cyan-edged white over the sand and faint pale blue against the sky
  (r17c-only-lipb2); and the lip from 120 units still a soft white wall (the curtain, the plumes and the water's
  foam, not the sprites). Sent to the owner: r17-pv / -boreb / -lipb against r17c-pv / -boreb / -lipb, r17c-boreb2-c,
  r17c-only-lipb2 and r17c-classic-pv.
- Limits of the implementation: the spray is subtle by design (AoM: a few streaks) and the measurements come from a
  paused loop stepped by hand at two times and one state, so the streaks in flight were not seen; the wall's white is
  set by the curtain, the plumes and the water's foam, which this round did not touch; the 1.6 stretch floor and the
  colour constants are first values, to be judged in play; the soft tier was checked only for compiling and one
  still; the haze figure is the shader's mix at one distance, not a pixel measurement.

## Round 18 (23 Oct 2026, owner: water, shallow water, brightness and beach like the new AoM shots; a very light blue
## sky, almost white at the horizon, no clouds; the basic ghosts with another mesh, animations and effects, like the
## old Oblivion ghosts)
The owner's 8 new AoM shots are reference/aom-2026-10-23/21-28.webp (git-ignored, never committed or published).
Committed with the code; nothing pushed.
- Sky (aom look only; js/main.js gradientSky, js/surf.js AOM_SKY): the three.js Sky shader is replaced by a clear,
  cloudless dome drawn straight in display sRGB, (160, 208, 244) overhead to (240, 247, 252) at the horizon, with a
  soft white glow round the sun and a 1/255 dither against banding. The water's haze colour is the dome's horizon
  (fromDisplay below). The classic look keeps the Sky shader.
- Beach (main.js tintSand, LOOKS.aom.sand): the photo texture's brown becomes a pale cream-green tint (1.0, 1.7, 1.0)
  that keeps 35 % of the photo's grain, crossed by fine wind-ripple streaks along the shore (two sizes, turned about
  25 degrees, strength 0.25, faded out where they would shimmer), then a small grade in display colour
  (0.985, 1.043, 0.98): the filmic curve pulls red up with green near white, so AoM's green comes back there.
  Measured dry sand on screen (224, 248, 222) for the target AOM_SAND (222, 244, 214).
- Shallow water (surf.js): the sand seen through the water is now the beach's own colour. fromDisplay inverts the
  water's output (x1.55, three's ACES filmic at exposure 0.6, sRGB) to find the linear colour drawn as a given screen
  colour, and bed = fromDisplay(AOM_SAND) replaces the fixed BED (now uniform uBed, per look). With uSandDisp = 1 that
  sand is added in display colour after the tone mapping, as AoM blends its water over its terrain: in linear light
  the pale sand sits near the top of the filmic curve as an extreme green, which turned the dimmed shallows mint. The
  damp sand's colour is per look (uDamp; aom (0.2, 0.24, 0.14), classic unchanged). Broader, stronger ripples nearer
  AoM's dark-teal chevrons: ripple 0.8 -> 1.0, emboss 0.8 -> 1.0 and ripScale 0.55 (new; below 1 widens them).
  Measured side-view water (108, 228, 234). Exposure is unchanged (0.6): the brighter scene comes from the sky, the
  sand and the clearer shallows.
- Spectre, the new basic ghost (main.js SPECTRE block and class SpectreGhost; the Halloween FBX in assets/Ghost/ is
  no longer loaded, the files stay on disk, and class HalloweenGhost is gone). Research: Oblivion draws its ghosts
  with a "membrane" effect shader (a translucent fill, a fresnel edge glow and a slowly scrolling texture) over
  ordinary meshes; its wraiths are hooded robes with glowing eyes. Built from code, geometry shared by all spectres:
  1. Mesh: a lathed robe whose hem frays into rags, a peaked hood (raised and swept back), a recessed dark face with
     two glowing eyes, open sleeves with clawed hands (a palm and four cones, merged), and 36 wisp points. On
     software GL (?soft=1) the robe has fewer segments and no wisps. Height 15; the hitbox is as before.
  2. Shaders (display sRGB, no tone mapping, like the surf): a membrane from a pale-blue fill to a white-blue rim by
     fresnel squared, a rising two-scale shimmer, vertical folds and noise rags round the hem. The back faces (a darker
     inner robe and a dark cowl, render order 1, no depth write) are drawn before the front faces (1.01, writing
     depth); eye and hand glows 1.02, wisps 1.03. The face fades out at its edges (a negative rim factor).
  3. Animation (tick): it hovers and bobs, leans into its glide and sways; the robe below the chest flaps and trails
     behind while it chases (vertex shader); the arms swing. Within 30 units of the player it reaches: the arms rise
     towards the player and the hands flare and pulse.
  4. Effects: wisps born round the hem rise, curl and are left behind. While a spectre chases within 45 units, frost
     creeps in from the screen edges (a fixed radial-gradient overlay, opacity up to 0.6, full on the killing touch).
     On a hit: a 0.9 s noise dissolve with a bright burning edge; the arms fling up and the body rises; the eyes and
     hands go out halfway, the dark face early (no dark specks left); the wisps burst from the whole body. Then
     updateDyingGhosts removes it and disposes its materials.
  5. Gameplay unchanged: HP 1, speed 0.9, the same air/ground split, spawn, fade-and-blink, chase and kill rules as the
     Halloween ghost; spark hits skip ghosts already dying; startGame clears dying ghosts and the frost. Khaimera is
     unchanged.
- Verified (headless preview, 1920x1080 stills saved at half scale, paused loop stepped by hand; reference/r12-shots/,
  git-ignored): r18_before_* (before); r18a-d_* (the look's iterations; r18d_beach, r18d_side, r18d_gm final);
  r18g-i_* (the spectre's iterations); r18j_reach, r18j_die30, r18j_die60; r18k_player, r18k_kill30, r18k_kill70 (the
  player view with spectres at about 30 and 60 units, one reaching, then killed: it dissolves with bright edges and is
  gone at 70 % with faint wisps left); r18l_classic and r18l_soft (the classic look and ?soft=1 both render the
  spectres, with no console errors beyond the preview's pointer-lock ones). The frost overlay's opacity follows
  frostLevel. The removal and dispose steps ran without error or GL error, but by hand: the real animation loop did
  not run (the preview pane was hidden, so requestAnimationFrame never fired). Sent to the owner: r18d_beach,
  r18d_side, r18k_player, r18j_reach, r18k_kill30.
- Research links: https://en.uesp.net/wiki/Oblivion:Ghost, https://www.gamesas.com/post213877.html,
  https://cs.uesp.net/wiki/Effect_Shader, https://content3.uesp.net/wiki/Oblivion:Wraith,
  https://tympanus.net/codrops/?p=86603.
- Limits: not play-tested, so the motion, the chase at speed, the spawn mix and the frost's feel are unseen; the AoM
  shots were matched by eye and a few point measurements; the sand streaks may shimmer at grazing angles on other
  GPUs; the classic look and the soft tier were checked with one still each.

## Round 19 (23 Oct 2026, owner: "Can you do the ghosts more like this?" with 7 Oblivion ghost screenshots; "Feel free
## to try and get the meshes for this as well if they are available online")
The screenshots are reference/oblivion-ghosts-2026-10-23/ (git-ignored, never committed or published). Target: a
translucent pale green-white upper body of a gaunt old man, dark eye sockets and an open mouth, raised arms with bony
yellow-grey claws, no legs (the waist fades into glowing mist), a soft halo and a fresnel rim. Committed with the code;
nothing pushed. The previous session's transcript passed 500 MB and was rotated; its handoff is folded in here.
- Meshes: Oblivion's own ghost meshes are Bethesda's copyrighted assets and cannot go into the public game
  (https://forums.nexusmods.com/topic/692678-importingadding-meshtexture-from-oblivion). assets/Human Ghost/Ghost.gltf
  (IDISI, CC-BY-4.0) is rigged but its scene.bin geometry buffer is missing, so it is unusable. Base used: Blender
  Studio's Human Base Meshes bundle v1.4.1, CC0, downloaded with the owner's permission from
  https://mirror.blender.org/demo/asset-bundles/human-base-meshes/human-base-meshes-bundle-v1.4.1.zip (50,643,039
  bytes, SHA-256 811f43accbb31a88266d932f8f5563b2d13586fca0ba2693aad1f5fe582b3515; kept in reference/downloads/,
  git-ignored; sources https://www.cgchannel.com/2023/06/download-blender-studios-free-human-base-meshes and
  https://www.blender.org/download/demo-files/). Credit line added to assets/credits.txt.
- Build (notes-claude/spectre/build_spectre.py; Blender 5.1.1 run headless through the governor:
  `aiwork.py run --assistant claude --slots 1 -- blender.exe -b -Y <bundle.blend> --python build_spectre.py -- <out.glb>
  <previewdir>`, the bundle opened with auto-run off): GEO-body_male_realistic cut below the hips; made gaunt (thin neck
  and torso, bony arms, hollow cheeks, deep sockets, an open jaw split from the upper lip by geodesic distance so the
  lips do not tear); an armature (hips, spine, chest, neck, head, jaw, clavicles, arms, hands, three-bone fingers,
  two-bone thumbs: 42 joints) with custom finger, thumb and jaw weights; posed into a raised claw pose that becomes
  the rest pose; decimated with the face and hands protected; three pose clips (reach, clench, scream). COLOR_0 holds
  r = cavity AO (sockets and mouth dark), g = waist fade, b = hand mask, a = claw tip. Output assets/Spectre/spectre.glb:
  392,948 bytes, 8,999 triangles, the mesh in metres (front +Z), drawn at x12 (SPECTRE_S) with its waist 5.5 over the
  ground, so about 14.5 tall with the mist tail below, as Round 18's 15.
- js/main.js: loadAllGhostModels loads the GLB; prepareSpectreModel turns each clip into per-bone rest-relative
  rotations and offsets; buildSpectre uses the mesh (buildSpectreMesh) and falls back to Round 18's procedural spectre
  (buildSpectreShade) if the GLB fails to load or parse. One skinned geometry, four passes bound to the same skeleton:
  a depth-only prepass over the body above the frayed waist (render order 1, hides the far arm and the halo's back
  shell), the membrane (1.01: a green-white fill to a mint rim by fresnel, a rising shimmer, the hands a little denser,
  only the claw tips yellow-grey bone and near-opaque, flaring as it reaches; dark sockets and mouth from the AO, lit
  up first when it burns), a BackSide halo shell inflated 0.045 m (1.025), and a lathed mist tail on SPECTRE_VS that
  flutters and trails (1.02, soft at its outline). Wisps as before (1.03; none on ?soft=1). Animation without a mixer
  (poseSpectre): reach follows the reach state, the claws clench (pulsing while reaching), the jaw screams, wider while
  reaching and fully while dying. Gameplay, frost, the 0.9 s dissolve, dying-ghost removal and dispose are Round 18's;
  the wisp and tail geometry are shared, not per ghost.
- Verified (headless preview, 1920x1080 stills at half scale, the loop stepped by hand; reference/r19-shots/,
  git-ignored): a-g (iterations); h_player (two spectres facing the player at about 38 and 67 units), i_close,
  j_reach, k_death and l_death (the dissolve at 0.2 and 0.47 s: burning holes, arms flung up, the last fragments pale);
  m_classic (?look=classic) and n_soft (?soft=1). No console errors beyond the preview's pointer-lock ones. Sent to the
  owner: h_player, i_close, j_reach, k_death, m_classic.
- Limits: not play-tested (the real animation loop did not run; the chase, spawn mix and frost feel are unseen); the
  look was matched by eye against the screenshots; the body is pale against the pale AoM beach (clearer on classic);
  the halo is a shell, not a screen-space bloom; one still each for the classic look and the soft tier.

## Round 20 (24 Oct 2026, owner: "Try to take care of any flickering and trembling in the waves (lots of rapid
## movements in a very short time). The splash effect in the area the tube breaks is amazing, but the splashes the foam
## wave make (after the tube broke) can sometimes look more like snow or vapor than water splashes")
Committed with the code; nothing pushed. The fixes of Rounds 13-15 and 17 are kept; the tube-break splash (the
curtain's burst, spray kinds 0/1, plume kinds 0/1) is untouched.
- Measured first: the paused loop stepped at 1/60 s, 40 frames a window, luminance read back at half scale. hi = RMS of
  each pixel's departure from its 5-frame mean (the jitter), rv = % of frames in which a pixel's change of at least 3
  levels flips sign (back-and-forth), d8 = mean change over 8 frames (the motion itself). Sources: the ripple maps on
  the moving faces (the mesh is fixed over the bed, so a rising face slides world xz under each pixel and the ripples,
  mapped on xz, jump between frames; the second weave also scrolled 0.31 uv/s, about 19 units/s, faster than a frame
  can show); the foam lace sliding under the pixel as the crests carry it, and its holes opening or closing fast on
  the bore's front; and the bore's splashes.
- Vertex shader: vSpd (the crest speed OMEGA / k times the shoreward slope: how fast the surface rises or falls); where
  there is foam, the same surface 1/60 s on (gTs shifts the time in phaseAt, rollerLumps, the bore turbulence and the
  chop): vVel (how far the water moves, and its foam drifts, in a frame), vDFoam (how much its foam grows) and vDBrk (how
  far the breaker's frame moves; clamped across a jump between the crests' cells). Not on the soft tier (all zero).
- Ripples: mvPx, how many pixels a frame the face slides under the pixel; the ripple filter footprint widens with it
  (up to 5 times) and where the finer weave is squeezed past 8 texels a pixel (up to 3 times), and the ripples weaken by
  up to 70 % past 0.3-0.9 px a frame. The second weave drifts at 0.08 uv/s.
- Foam: lace() replaces holes(): each of the three scales is motion-blurred along its slide in a frame (each hole sweeps
  a capsule, and the swept holes thin the foam by their chord's share of the frame). The slide comes from the water's
  screen-space motion (slR on the rest grid, slB on the breaker's frame) carried through the noise warp. Each noise
  octave fades to its mean where it slides fast; a scale sliding more than about a third of a cell a frame, or whose
  holes resize fast, fades towards its mean but keeps 0.4 of its contrast, so fast foam stays a lace, not a haze.
- Bore splashes ("vapour"): the bore's steady plumes (kind 2) and the foam curtain's bore band (vCrisp; a third row of
  the curtain's state texture) get a crisp edge (dissolve width 0.12 to 0.04) and their thin parts (t.r below
  0.22-0.55) turn clear cyan water (0.42, 0.86, 0.9) at 40 % density instead of white haze. Crisp only where the
  picture is sharp: at mip level 0.75-2.25 (from dFdx/dFdy of the uv times the texture size) it returns to the soft
  edge, 40 % fainter, because a crisp cut on a blurred mip made smooth white blobs with a clear rim.
- Bore spray ("snow"): Round 17's low sheet of slow white flecks over the bore is replaced by drops thrown up off the
  bore's top past its lip tip (p 1.4-3.2), a little faster than the bore, rising 0.08-0.35 H and falling back under
  gravity, streaked along their velocity; a quarter are bigger, fainter clear blobs. Mean life 0.75 s (was 0.52), up
  to 12 per emit (was 16).
- Verified (headless preview, 1920x1080, the same seed in a Round 19 copy of HEAD (reference/head19, git-ignored) and in
  this build; hi/rv, Round 19 then Round 20; the waves are deterministic until the break, the spray and plumes are not):
  player view t 25.8 frame 2.96/2.41 to 1.13/0.43, horizon band 5.23/8.02 to 2.18/1.79; t 30.7 frame 3.34/4.64 to
  2.16/1.43, mid 5.11/11.05 to 3.44/3.83; t 32.0 frame 3.88/4.81 to 2.62/2.26, mid 5.84/13.43 to 3.75/7.39, low
  5.39/6.86 to 3.96/3.25; t 34.3 frame 2.19/1.62 to 1.07/0.32. Wide view t 35.5 frame 1.61/0.88 to 0.72/0.12; beach view
  t 36.5 frame 1.33/0.55 to 0.51/0.06. Bore: player view t 40.2 band 3.17/3.79 to 1.85/0.99, t 41.5 band 3.51/4.80 to
  1.73/1.02; wide view t 40.85 mid 2.21/1.90 to 1.19/0.42. The motion itself (d8) falls less (t 25.8 frame 5.06 to
  3.43, t 32.0 6.93 to 5.63): the waves still move, mostly the calmer ripples. Stills in reference/r20-shots/
  (git-ignored): key_jitter_pv_32 and key_jitter_bore_pv (frame and jitter map, before over after), bf_cu_1/bf_cu_2 (the
  bore at the player view, t 40.4-41.0, before/after), bf_pv_1/bf_pv_2 (t 40.3-41.5); the rest are iterations. The soft
  tier (?soft=1) compiles and renders; no shader errors, only the preview's pointer-lock ones.
- Limits: not play-tested (the real loop did not run); mvPx assumes 60 fps, so at lower frame rates the blur covers
  less than the true motion; the jitter is lower, not gone (player view mid at t 32.0 still flips on 7 % of frames);
  the vertex shader evaluates the surface a second time where there is foam (cost not measured); one small soft blob
  can remain over a far bore (t 41.5); the bore's look was judged by eye.

## Tooling
.claude/launch.json ("beach-claude": python http.server on 8771 serving this worktree).
notes-claude/_move.js (source of updateMovement), shotserver.py (local POST receiver used to
save renderer.toDataURL captures while the preview pane is hidden). Round 8: aom-harness.js (page test harness)
and shot_sink.py (POST receiver for JPEG bytes); see Round 8. notes-claude/swprobe/ (software-WebGL timing, see
"Round 8 publish failure"): copy the folder to the session scratchpad and run it there, since it writes logs/,
shots/ and profiles/ next to itself; run it with the governor venv's Python (-I) through aiwork.py.

Committed 4fc714e and pushed to origin/claude/shorebreak-waves on 17 Oct 2026 (owner request).
Round 3 e55afdb pushed 18 Oct 2026 (owner request). Round 4 0400658 pushed 18 Oct 2026 (owner request). No PR.
Round 5 9dd2038 pushed 18 Oct 2026 (owner request), with this notes commit; the push republishes /claude/ (see below).
Round 6 7e4ddc3 (crest rows) pushed 19 Oct 2026 (owner request).
Round 7 c1d874e (collapsed roller as a solid step) is on origin/claude/shorebreak-waves (checked 19 Oct 2026).
Round 8 7b14b70 (AoM look, foam decals) pushed 19 Oct 2026 (owner request, c1d874e..7b14b70). Its auto-publish
failed: the hook run 39318718012 passed, but main's publisher run 39318742626 stopped in Codex's smoke test
("claude page.screenshot: Timeout 90000ms exceeded", software WebGL), so the deploy was skipped and /claude/ kept
serving Round 7. See "Round 8 publish failure" below.
The software-WebGL tier that fixes it, 635ef93, pushed 19 Oct 2026 (owner request, 7b14b70..635ef93): hook run
39326681529 passed, main's publisher run 39326703937 passed the smoke test (original, codex, claude with surf) and
deployed at 21:24:50Z. Checked by HTTP the same evening: live versions.json pins claude 635ef93, and live
/claude/index.html, js/main.js and js/surf.js match 635ef93 (SHA-256). Round 8's look is live at /claude/.
Round 9 1220921 (de-tiled ripples, whiter foam, splash plumes) pushed 20 Oct 2026 at 08:07Z (owner request,
635ef93..1220921): hook run 39391182418 passed; main's publisher run 39391202032 (main 116c998) passed "Test
original and both subfolder versions before publishing" and deployed at 08:10:48Z. Checked by HTTP at 08:11Z: live
versions.json pins claude 1220921, and live /claude/index.html, js/main.js and js/surf.js match 1220921 (SHA-256;
index.html and main.js are unchanged since 635ef93). Round 9's look is live at /claude/.
Round 10 f4823f8 pushed 20 Oct 2026 at 22:34Z (owner request, 1220921..f4823f8): hook run 39509072242 passed;
main's publisher run 39509090645 (main 116c998) passed "Test original and both subfolder versions before
publishing" and deployed at 22:38:57Z. Checked by HTTP at 22:40Z: live versions.json pins claude f4823f8, and live
/claude/index.html, js/main.js and js/surf.js match f4823f8 (SHA-256). Round 10 is live at /claude/.
Round 11 9fbcd0f pushed 21 Oct 2026 at 00:17Z (owner request, f4823f8..9fbcd0f): hook run 39520426301 passed;
main's publisher run 39520438522 (main 116c998) passed "Test original and both subfolder versions before
publishing" and deployed at 00:21:36Z. Checked by HTTP at 10:42Z: live versions.json pins claude 9fbcd0f, and live
/claude/index.html, js/main.js and js/surf.js match 9fbcd0f (SHA-256). Round 11 is live at /claude/.
Round 12 dbd6318 pushed 21 Oct 2026 at 11:59Z (owner request, 9fbcd0f..dbd6318): hook run 39596037500 passed;
main's publisher run 39596055744 (main 116c998) passed "Test original and both subfolder versions before
publishing" and deployed at 12:04:15Z. Checked by HTTP at 12:26Z: live versions.json pins claude dbd6318, and live
/claude/index.html, js/main.js and js/surf.js match dbd6318 (SHA-256). Round 12 is live at /claude/.
Round 13 47d97fc pushed 21 Oct 2026 at 13:07Z (owner request, dbd6318..47d97fc): hook run 39605284694 passed;
main's publisher run 39605319606 (main 116c998) passed (build 13:10:49Z, deploy 13:11:03Z). Checked by HTTP at
13:21Z: live versions.json pins claude 47d97fc (original 116c998, codex 8d436e9 unchanged), and live
/claude/index.html, js/main.js and js/surf.js match 47d97fc (SHA-256). Round 13 is live at /claude/.

## Round 8 publish failure and the software-WebGL tier (19 Oct 2026)
Round 8 did not go live. Main's publisher run 39318742626 failed in Codex's tooling/pages/smoke.cjs (origin/main
116c998): "claude page.screenshot: Timeout 90000ms exceeded". The smoke test runs Playwright's Chromium Headless
Shell 141.0.7390.37 with software WebGL (--use-angle=swiftshader unless GPU is set) at 1280x800 with a 90 s
default timeout; on the claude page it waits for __beach.surf, then 2.5 s, then takes claude-game.png. That step
took 141 s including the 90 s timeout. In earlier passing runs (Round 7) the claude page took 123-143 s, so its
screenshot already took roughly 70-90 s there (inference), close to the limit, against ~3 s on this machine: the
CI runner is ~25-30x slower for a reason not known. Round 8's heavier frames tipped it over. The run's
pages-browser-evidence artifact (5,934,075 bytes) would give exact timings; not downloaded (needs the owner's OK).
- Local repro (notes-claude/swprobe/): headless Edge, ANGLE on SwiftShader (Vulkan, "SwiftShader Device
  (Subzero)"), 4 CPUs by process affinity, 1280x800, serving Round 7, Round 8 (from git) and the working tree.
  cdpshot.py times CDP Page.captureScreenshot the way smoke.cjs takes it; swprobe.py with probe.html times every
  draw call (gl.finish around each); swreport.py summarises. Round 8 here: screenshots 2.8-3.4 s, frame median
  467-484 ms (Round 7: 2.5-3.1 s, 401-417 ms). No timeout here.
- Cost: the water took 376 ms of Round 8's 426 ms frame (median), bound by its vertex shader, which evaluates
  surfPos three times per vertex (two nearby points give the normal); 3,180,492 indices. Skipping the ripples or
  the caustics saved only 1-8 %. Round 8 also drew all 1024 decal slots every frame, dead or alive (1024 x 288
  triangles, each vertex evaluating the waves).
- Fix, only where WebGL has no GPU (the GPU look is unchanged): main.js softwareGL() matches the unmasked
  renderer string (SwiftShader, llvmpipe, softpipe, "Software", "Basic Render" = WARP); `?soft=1` forces it and
  `?soft=0` turns it off. Then the canvas is drawn at pixel ratio 0.5 and the water takes quality 'soft': grid
  factor 2.2 (medium 1.35, low 1.8), the FACETS define (the fragment shader takes each facet's normal from
  dFdx/dFdy of vWorld, so the vertex shader evaluates the surface once: -52 % on the water; three.js 0.186 is
  WebGL2-only, so the derivatives are built in) and anisotropy 1. Grid factor 2.7 saved only ~10 % more.
- Decals, all tiers: add() takes the lowest free slot (else the next unused one, else the one ending soonest)
  and update(time) trims dead slots off the top, so instanceCount = highest live slot + 1 and only those are
  drawn. A live decal now gives way only when all 1024 are alive (Round 8: when none of the 32 slots after its
  cursor was free), so Round 8's cut-short counts are an upper bound. The mesh stays visible at instanceCount 0,
  so three.js compiles its program at startup (first decal draw under SwiftShader 26-27 ms, was 64 ms).
- Results here (SwiftShader, 4 CPUs, 1280x800 viewport; three screenshots after the smoke test's 2.5 s wait):
  | Build                   | Canvas   | Screenshots (s) | Frame median / p90 (ms) | Triangles drawn |
  | Round 7 c1d874e         | 1280x800 | 2.9 / 2.5 / 2.8 | 417 / 901               | 1,142,256       |
  | Round 8 7b14b70         | 1280x800 | 3.4 / 3.0 / 3.0 | 484 / 634               | 1,472,016       |
  | this commit (auto soft) | 640x400  | 0.7 / 0.8 / 0.7 | 100 / 167               | 711,636         |
  | same, second run        | 640x400  | 0.7 / 0.7 / 0.7 | 100 / 150               | 641,940         |
  | this commit, ?soft=0    | 1280x800 | 2.5 / 2.6 / 2.4 | 406 / 784               | 1,144,272       |
  Per draw (soft): water 87 ms mean (Round 8: 376), sky 8 ms. ?soft=0 shows the decal change alone brings the
  medium path back to Round 7's cost; the soft tier adds a ~4x margin on top.
- Verified (preview pane, RTX 5070 Ti through ANGLE D3D11): medium quality (no FACETS, anisotropy 8); a wading
  ghost's collars and rings render (42 slots drawn); the oblique overview matches Round 8; console only
  pointer-lock errors. `?soft=1` on the GPU: the FACETS shader compiles on D3D11 and looks the same apart from
  slightly faceted shading up close. At the game view the soft tier is barely different (slightly streakier
  whitewater).
- CI (after the push): publisher run 39326703937 passed. Its smoke step took 93 s for all three pages, against
  153-172 s in five earlier passing runs (18-19 Oct; a sixth took 97 s) and 172 s in Round 8's failed run. Per-page
  timings are in the run's pages-browser-evidence artifact (not downloaded).
  Not verified: hand play on a software renderer.

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
