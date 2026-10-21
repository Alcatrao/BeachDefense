# Round 13 research: owner-supplied water links (21 Oct 2026, Claude subagent)

Status: complete (about 31 searches/fetches). Web reading only (WebSearch/WebFetch); nothing installed, downloaded or run.
Builds on notes-claude/research-r12-breaking-waves.md (not repeated here).

Owner-reported problems used to judge each source:
- P1: the bore (white water riding to the shore) looks like a "plastic wall"; its top flickers.
- P2: foam sometimes clips with the wave surface.
- P3: owner idea: foam sprites spawning continuously to cover the bore.

Method note: Reddit and two news sites refused fetches; the video was identified via oEmbed only.

## 1. 80.lv "Major update released for this three.js ocean rendering system"

URL: https://80.lv/articles/major-update-released-for-this-three-js-ocean-rendering-system
(80 Level news post, 5 Jun 2026, no technical detail of its own).

What it is: **Three.js Water Pro** v3 by Dan Greenheck (Three.js Roadmap; DRG Software Solutions
LLC). Closed commercial asset, no public repo. Demo: https://threejswaterpro.com/ ; docs and
changelog: https://docs.threejswaterpro.com/changelog.html ; store page:
https://threejsroadmap.com/assets/threejs-water-pro (sold in a Water + Sky bundle listed at $239;
standalone price not shown; "Commercial License, All Rights Reserved"; source code included for
buyers; redistribution terms not read).

Technique (from changelog, store page, docs landing/API page):
- FFT ocean, JONSWAP spectrum, three FFT bands (swell / waves / ripples), per-cascade power-of-two
  resolution; geometry clipmap LOD; quality tiers low/medium/high/ultra(/max). Gerstner swells
  existed in v2 and were removed in v3.3. Built on three.js WebGPURenderer + TSL, r181+.
  WebGL backend exists (noise-based waves fallback; spray is WebGPU only).
- Foam in three layers: Jacobian whitecaps with a **persistent crest-foam buffer** (whitecaps
  linger and roll off the back of the wave, then decay; `foam.waves.persistence`,
  `windwardStrength`), ambient surface foam, and **depth-based shoreline foam** around coasts and
  objects. Sea-spray emitters attached to objects fire when water velocity passes a threshold.
- Determinism: fixed-step sim + tick sync for multiplayer. Wakes with foam on breaking crests.
- Breaking waves / overturning: **none**. "Breaking" means Jacobian whitecaps on a height field.
  Shore interaction is only depth-difference foam; no shoaling, no surf.
- Performance: no fps or GPU numbers published (UNVERIFIED either way). Notes only relative wins
  (non-blocking readback saves ~2 ms CPU; SSR cost made independent of coverage).

Verdict for this project:
- Physics: nothing for breakers or bores; deep-water FFT is the wrong domain for a shorebreak.
- Look: two transferable ideas. (i) Foam as an **accumulated, decaying field** instead of a
  per-frame function: crest foam that lingers and trails behind the wave reads as real white
  water. (ii) Depth-difference shoreline foam (soft contact band where water meets sand/rocks).
  Its realistic dark-blue PBR look is not the AoM target.
- Performance: WebGPU/TSL-only for the good path; our soft tier is SwiftShader WebGL2, so the asset
  itself cannot be dropped in. Commercial and closed, so code cannot be copied.
- P1 (plastic bore): indirectly; a foam *field* that persists behind the front would replace the
  hard-edged curtain look with a trailing, decaying foam sheet. P2 (clipping): depth-based contact
  foam is the standard fix for foam meeting geometry. P3 (spawned sprites): its spray emitters are
  velocity-threshold spawners, which is the same idea as P3, but for spray not for the bore body.
- Verdict: inspiration only (do not buy; no breaking waves; WebGPU-first).

## 2. Babylon.js playground YX6IB8#758 ("Incredible WebGPU Ocean Demo")

URL: https://playground.babylonjs.com/?webgpu#YX6IB8#758 ; code read via
https://snippet.babylonjs.com/YX6IB8/758 (JSON, ~190 kB).

What it is: a Babylon.js port of Ivan Pensionerov's Unity FFT ocean (the code header credits "the
great Unity project"; assets hosted on popov72.github.io, i.e. the port is very likely by Evgeni
Popov of the Babylon team, UNVERIFIED). Boat/buoy meshes from Sketchfab.

Technique (read from the code):
- Three FFT cascades (length scales 250 / 17 / 5, 256x256 each), JONSWAP "local" + "swell"
  spectra with TMA shallow-water correction and a tanh depth dispersion (depth constant 3).
- WGSL compute shaders: `calculateInitialSpectrum`, `calculateAmplitudes`,
  `horizontalStepInverseFFT` / `verticalStepInverseFFT`, `permute`, `fillResultTextures`
  (workgroup 8x8). Falls back to WebGL engine but requires compute support.
- Geometry clipmap: centre + 8 rings/trims + skirt, snapped to the camera grid to stop shimmer;
  three material LOD variants by distance.
- Shading: PBRCustomMaterial with injected GLSL; normals from derivative textures; SSS term.
- Foam: Jacobian J = (1+L*Dxx)(1+L*Dzz) - L^2*Dxz^2. A ping-pong **turbulence texture** adds
  `dt*0.5/max(J,0.5)` each frame and is clamped by `min(J, turbulence)`; per-LOD foam bias
  (0.84/1.83/2.72), `_FoamScale` 2.4. Plus **contact foam from the depth buffer**:
  `max(0, (sceneDepth - waterDepth) - 0.5)` masked by a scrolling circular foam texture.
- CPU buoyancy from a half-float readback of cascade 0.
- Breaking/overturning: none. Shore: none (only depth-contact foam around the buoy).
- Licence: the Unity original (github.com/gasgiant/FFT-Ocean) is MIT per its repo (checked below);
  the playground snippet itself carries no licence text (UNVERIFIED).
- Performance: none stated; three 256^2 FFTs per frame is cheap on desktop WebGPU but impossible
  on SwiftShader (no compute in WebGL2).

Verdict for this project:
- Physics: deep-water FFT, no breaking, no shoaling bore. Not the domain.
- Look: the **depth-buffer contact foam** recipe is directly portable to our WebGL2 ShaderMaterial
  (render scene depth once, then in the foam/water fragment shader fade by the distance between
  the fragment and what lies behind it). This is the classic answer to P2: foam sprites and decals
  fade softly where they meet the wave surface or the sand instead of cutting a hard line
  ("soft particles"). The Jacobian-based crest foam is not applicable (our field is analytic, we
  know the crest directly).
- Performance: contact foam costs one depth pre-pass (or reuse of an existing depth texture) and
  one texture read per foam fragment; cheap on the GPU; on SwiftShader a full-res depth target is
  measurable, so use it on the GPU tier only or at half resolution.
- P1: no. P2: yes (soft depth fade). P3: no.
- Verdict: adopt the soft-depth fade only (see ranking); the rest inspiration only.
- Licence check: github.com/gasgiant/FFT-Ocean is MIT, labelled a prototype by its author; video
  https://youtu.be/kGEqaX4Y4bQ .

## 3. YouTube short RC7ij8OWPbM

URL: https://www.youtube.com/shorts/RC7ij8OWPbM . oEmbed: title "3D Breaking Waves with Blender
3D", channel **FLIP Fluids** (https://www.youtube.com/@FLIPFluids). Video content itself not
watched (no transcript available here); described from the channel/product.

What it is: a showcase render from the **FLIP Fluids addon for Blender** (Ryan Guy and Dennis
Fassbaender; https://github.com/rlguy/Blender-FLIP-Fluids ; addon code GPL-3.0, engine MIT, paid
build with example scenes on Superhive/Blender Market and Gumroad). An offline CPU FLIP solver
(64-bit multi-core CPU, 8-16 GB RAM; no GPU solve), meshed and path-traced in Blender.

Technique: 3D FLIP liquid with a separate **whitewater particle system**
(https://github.com/rlguy/Blender-FLIP-Fluids/wiki/Domain-Whitewater-Settings):
- Emitters placed where whitewater is likely: wave crests (surface curvature between a min and a
  max threshold), turbulence (min/max), scaled by fluid speed (min/max "energy speed").
- Each particle is classified every step by where it sits relative to a **foam layer** of given
  depth and offset around the liquid surface: inside the layer = foam (advected with the surface
  velocity), below = bubble (advected, rises, becomes foam on reaching the surface), above = spray
  (ballistic under gravity). Lifespan min/max with variance and per-type multipliers.
- This is the established Ihmsen et al. 2012 "unified spray, foam and bubbles" scheme (the wiki
  page does not cite it; attribution is mine).

Breaking/overturning: yes, genuinely simulated (the video's subject); shore interaction is
whatever the scene's obstacle provides. Performance: offline, minutes per frame for a hero wave
(typical for FLIP at render resolution; no figure published on the pages read, UNVERIFIED).

Verdict for this project:
- Physics: not real-time; consistent with research-r12 option (d) being rejected. Usable only as an
  **offline reference generator**: a 2D or thin-3D FLIP run of one breaker would give the lip
  silhouette and the foam/spray timing for option (b) slice baking, and a look reference.
- Look: the whitewater classification is the most useful idea in this round for P1 and P3. The
  bore in reality is not a surface; it is a dense cloud of foam + bubbles riding the front, with
  spray above and a foam sheet left behind. A cheap game version: spawn foam billboards along the
  bore front each frame (rate scaled by bore height/speed), advect them with the analytic surface
  velocity, keep them glued to the surface height (foam layer = offset band around `evalSurf`),
  let a fraction rise as spray, and fade them by lifespan. That is exactly the owner's P3 idea,
  with a recipe for where to emit, where to keep them and when to kill them.
- Performance: the real thing is offline only. The game version is a GPU particle pool (say
  4-16k quads, positions computed analytically from spawn time + spawn position, no simulation
  state) which fits the 2 ms budget; on SwiftShader the pool must shrink to ~1-2k.
- P1: yes (texture the bore with many soft sprites instead of one smooth sheet). P2: partly
  (foam lives in a band around the surface; with soft depth fade it never cuts the surface).
  P3: yes, directly.
- Verdict: inspiration for the particle recipe; FLIP itself not useful at runtime.

## 4. Reddit r/ItsAllAboutGames: "24 years later, a forgotten surfing game is ..."

URL: https://www.reddit.com/r/ItsAllAboutGames/comments/1uvcshe/24_years_later_a_forgotten_surfing_game_is/
Reddit refused fetches (www and old.reddit). Identified from press coverage of the same story:
**Kelly Slater's Pro Surfer** (Treyarch / Activision, 2002; PS2, Xbox, GameCube, PC, GBA), which
went viral in July 2026 after a clip from an Xbox nostalgia account
(https://multiplayer.it/notizie/a-24-anni-dal-lancio-kelly-slaters-pro-surfer-e-diventato-virale-online.html ;
https://www.timeextension.com/news/2026/07/random-the-internet-is-going-crazy-for-this-early-2000s-activision-surfing-game
returned 403 here, title only). Identification of the post itself is UNVERIFIED but the title
and timing match.

How its waves were made: no developer write-up found. Marketing called it a proprietary "wave
engine" / "innovative wave generation system" (PSX Data Center listing
https://psxdatacenter.com/psx2/games2/SLUS-20334.html ; a German preview credits the wave engine
to "Interactive Republic Corporation", UNVERIFIED). The 2026 discussion (as reported by
multiplayer.it) has water-shader developers praising it; one (The Water Museum's developer)
guessed the look comes from hand-authored colour, shifting the water toward turquoise with wave
height, rather than advanced tech. A 2002 NGC Magazine review (search snippet only, UNVERIFIED)
called its surface plastic-looking and its spray weaker than Wave Race.
Era constraints (PS2) imply an animated/procedural mesh wave with vertex colours, textures and
sprite spray, not a simulation (inference, not sourced).

Verdict for this project:
- Physics: nothing documented; at most confirms the authored/procedural wave path (option a).
- Look: the useful lesson is art direction: colour by wave height/thickness (deep blue in the
  trough, bright turquoise in the thin rising face, white on top) sells a wave more than lighting
  does. We can do this analytically (we know local water thickness and crest phase), which also
  helps P1 by giving the bore a translucent turquoise body under the foam instead of a uniform
  opaque white. Note the 2002 "plastic surface" criticism is the same failure as P1: smooth,
  uniformly lit, uniformly coloured surfaces read as plastic; breaking that up with colour
  gradients, foam texture and sprite spray is the fix.
- Performance: trivial (vertex colour / per-fragment ramp).
- P1: yes (height/thickness colour ramp, translucency feel). P2: no. P3: no.
- Verdict: inspiration only (art-direction reference; worth a look at gameplay footage).

## 5. Wave Race 64 (Nintendo EAD, 1996) and Wave Race: Blue Storm (NST, GameCube, 2001)

No developer talk, GDC session, postmortem or decompilation write-up describing the wave
algorithm was found (searches for interviews, Digital Foundry retro coverage, decomp; the WR64
decomp is reported incomplete and a Dreamcast source port by JNMartin exists, July 2026:
https://www.generationamiga.com/2026/07/25/wave-race-64-dreamcast-port-shows-impressive-early-progress/ ).
What is sourced:
- WR64's waves began as one programmer's tech demo on the N64's SGI hardware, which Miyamoto saw
  and the team built a game around (Time 2017, cited by https://en.wikipedia.org/wiki/Wave_Race_64 ;
  original https://time.com/4653977/shinya-takahashi-nintendo/ ).
- The water used the N64's alpha blending to look both transparent and reflective (Next
  Generation No. 23, 1996, via Wikipedia).
- Waves are gameplay: they change the craft's speed, landing angle, steering and timing (reviews;
  generationamiga). Blue Storm's weather sets wave height (reviews); a blog-style source says EAD
  lent NST the WR64 source to reuse its physics engine (UNVERIFIED). "Water uses ~80% of the
  N64's power" is a wiki claim (UNVERIFIED).
- The 2002 NGC review of Kelly Slater's Pro Surfer rated its spray below Wave Race's (snippet,
  UNVERIFIED), i.e. Wave Race's sprite spray was the period benchmark.
Inference (not sourced, era knowledge): a CPU-animated height grid near the player (sums of
moving swells plus local disturbances), textured with scrolling and reflection maps, one height
query shared by the renderer and the jet-ski physics; no breaking waves in either game.

Verdict for this project:
- Physics: the transferable principle is the one we already have: one deterministic height
  function used by both rendering and gameplay (`evalSurf` CPU mirror). Nothing for breakers.
- Look: bright, saturated, translucent water with strong reflections and generous sprite spray
  read well even at very low polygon counts; stylised colour beats physical shading for the AoM
  target. Spray quality, not surface detail, was what reviewers compared.
- Performance: the lesson is budget allocation: cheap surface, rich spray/sprites.
- P1: indirectly (spray and translucency over a smooth surface). P2: no. P3: supports the idea
  that dense sprite spray is what sells moving white water.
- Verdict: inspiration only.

## 6. Unity Discussions: "Realistic Breaking Wave" (thread 748291, Jun 2019 - Oct 2020)

URL: https://discussions.unity.com/t/realistic-breaking-wave/748291
A solo developer wanted a surf-game wave from swell to foam; standard ocean assets (AQUAS, Crest,
SUIMONO, Hydroform, Ceto, Triton) did not break waves. Proposals in the thread:
- Pre-model/animate the wave in a DCC tool (shape keys / Blender wave modifier) and play it back;
  one reply says many surf games use baked waves.
- Gerstner maths plus a breaking term, mesh updated per frame; a rotating-circle approximation of
  the lip; Boussinesq for fidelity ("many weeks" of work). CPU mesh updates in Update() were
  measured by the poster as too costly.
- Mega-Fiers "Bezier Attractor" (paid asset): results unrealistic, **vertices glitch and
  backfaces show when the wave collapses**.
- Bezier splines driving the profile: the thread's best result (a rough plunging wave, Oct 2020);
  shoulder mesh imperfect; no performance figures.
- Links: Surf's Up SIGGRAPH 2007 paper; Virtual Surfing (Steam 993340, praised visuals, a single
  barrel style); Shorebreak blog (https://shorebreakblog.wordpress.com/ , a hobby surf game,
  2016-2020, no technique documented); surfertoday's four breaker types; Crest
  (https://github.com/wave-harmonic/crest).
Nobody showed a benchmarked real-time breaking wave.

Verdict for this project:
- Physics: our GPU analytic profile per crest with Catmull-Rom along the crest is the same idea
  as the thread's best (spline-driven profile), but on the GPU and already further along. The
  thread confirms option (a)/(b) and adds nothing new.
- Look: the reported failure (backfaces and glitching vertices as the lip collapses) is a known
  hazard for us too: when the lip folds, back faces with front-face shading and inverted normals
  read as "plastic" or as foam clipping. Worth checking that the curtain and lip use two-sided
  lighting with flipped normals on back faces, and that the lip fades into foam before it
  self-intersects.
- Performance: confirms GPU vertex displacement over CPU mesh rebuilds.
- P1: weakly (backface check). P2: weakly (collapse self-intersection). P3: no.
- Verdict: not useful beyond confirmation.

## 7. What the sources say about P1-P3 (synthesis; the fixes are my proposals, untested)

Code check (21 Oct): js/surf.js already uses InstancedBufferGeometry (two places) and `fwidth`
in one shader; no depth texture is rendered today.

- P1 "plastic wall" bore: every reference that looks right (FLIP whitewater, Water Pro crest foam,
  Wave Race spray) shows moving white water as **many small soft elements plus a foam trail that
  decays behind the front**, never as one smooth lit sheet. KSPS was criticised in 2002 for
  exactly a "plastic" surface. Proposals: (i) a foam *age* field: since the bore front position
  is analytic, foam coverage at a point = f(time since the front passed) with a world-anchored
  noise threshold that erodes with age, giving a dissolving trail without a render target;
  (ii) colour the bore body by water thickness (turquoise, translucent) under the foam;
  (iii) sprite cover along the front (P3).
- P1 flickering top: no source addresses it directly. Likely causes to check (my inference):
  sub-pixel thin geometry or high-frequency noise along the crest aliasing frame to frame, and
  two coincident surfaces (curtain vs surf mesh) fighting. Fixes: world-space (not screen or
  per-frame random) noise, fade high-frequency detail with `fwidth`, and soft depth fade so the
  curtain's edge does not z-fight with the surface.
- P2 foam clipping: the standard fix in both FFT projects is **depth-difference contact
  fading**: foam alpha *= saturate((sceneDepth - fragDepth) / softness). In three.js this needs
  the opaque pass (surf + sand) rendered with a DepthTexture, then the curtain/plumes/decals read
  it. Alternative for the soft tier: fade foam vertices by their analytic distance to the
  surface computed in the vertex shader (no extra pass; ill-defined inside the tube, so only for
  the bore and decals).
- P3 continuous foam sprites: FLIP Fluids' whitewater rules give a ready recipe. Emit at the bore
  front (rate scaled by bore height and speed), keep foam particles inside a band of given depth
  and offset around the surface (y = surface + offset, advected by the analytic bore velocity),
  promote a fraction to ballistic spray, kill by lifespan with variance. Make particles
  stateless: each instance has (spawn time, spawn along-crest coordinate, seed); the vertex
  shader recomputes position from the analytic bore, so no simulation, determinism kept, CPU
  mirror unnecessary for visuals. Recycle instances in a ring by spawn time.

## Ranked list

Worth adopting:
1. Stateless foam-sprite cover on the bore front (P1, P3): instanced soft billboards, spawn
   pattern hashed from (crest id, along-crest cell, time slot), position from the analytic bore,
   foam-layer offset, lifespan fade, some promoted to spray. Source of the recipe: FLIP Fluids
   whitewater classification (section 3). Effort ~1-2 days; cost estimate 4-16k quads, roughly
   0.2-0.5 ms at 1080p depending on overdraw (keep sprites small, alpha-tested core); soft tier
   1-2k quads. Overdraw is the main risk; measure.
2. Soft contact fade for all foam layers (P2, part of P1 flicker): depth texture from the opaque
   pass, fade by depth difference (sections 1-2). Effort ~0.5-1 day; cost one depth attachment
   plus one texture read per foam fragment (well under 0.1 ms on the RTX 5070 Ti, UNVERIFIED);
   on SwiftShader use the analytic per-vertex fade instead or switch it off.
3. Analytic foam trail behind the bore (P1): coverage from "time since the front passed" with
   eroding world-space noise, the deterministic equivalent of Water Pro's persistent crest foam
   and Babylon's turbulence ping-pong. Effort ~0.5-1 day; cost a few ALU per surf fragment; works
   on the soft tier.
4. Thickness/height colour ramp (P1): turquoise in thin rising water, deep cyan in troughs,
   translucent bore body under the foam (KSPS art direction, Wave Race translucency). Effort
   hours; negligible cost.

Inspiration only:
- Three.js Water Pro (commercial, closed, WebGPU/TSL, no breakers): persistent crest foam,
  depth shoreline foam, velocity-threshold spray emitters.
- Babylon WebGPU ocean playground (MIT Unity origin): turbulence accumulation and contact foam
  code to read; FFT itself is the wrong domain and needs compute.
- FLIP Fluids video: offline look reference, and a possible offline generator for option (b)
  slice profiles.
- Kelly Slater's Pro Surfer and Wave Race: art direction and "rich spray over a cheap surface";
  shared render/physics height function (we already have it).

Not useful:
- Unity "Realistic breaking wave" thread: confirms our approach; only the backface-on-collapse
  warning is worth a check.
- FFT ocean simulation itself (both sources) for the shorebreak; live FLIP at runtime.

## Sources

- https://80.lv/articles/major-update-released-for-this-three-js-ocean-rendering-system
- https://docs.threejswaterpro.com/changelog.html ; https://docs.threejswaterpro.com/api/water-system.html
- https://threejsroadmap.com/assets/threejs-water-pro ; demo https://threejswaterpro.com/
- https://playground.babylonjs.com/?webgpu#YX6IB8#758 ; https://snippet.babylonjs.com/YX6IB8/758
- https://github.com/gasgiant/FFT-Ocean (MIT)
- https://www.youtube.com/shorts/RC7ij8OWPbM (oEmbed) ; https://github.com/rlguy/Blender-FLIP-Fluids ;
  https://github.com/rlguy/Blender-FLIP-Fluids/wiki/Domain-Whitewater-Settings
- https://www.reddit.com/r/ItsAllAboutGames/comments/1uvcshe/24_years_later_a_forgotten_surfing_game_is/ (blocked)
- https://multiplayer.it/notizie/a-24-anni-dal-lancio-kelly-slaters-pro-surfer-e-diventato-virale-online.html
- https://www.timeextension.com/news/2026/07/random-the-internet-is-going-crazy-for-this-early-2000s-activision-surfing-game (403)
- https://psxdatacenter.com/psx2/games2/SLUS-20334.html
- https://en.wikipedia.org/wiki/Wave_Race_64 ; https://time.com/4653977/shinya-takahashi-nintendo/
- https://en.wikipedia.org/wiki/Wave_Race:_Blue_Storm
- https://www.generationamiga.com/2026/07/25/wave-race-64-dreamcast-port-shows-impressive-early-progress/
- https://www.gonintendo.com/contents/34606-digital-foundry-looks-back-at-water-rendering-tech-in-classic-games
- https://discussions.unity.com/t/realistic-breaking-wave/748291 ; https://shorebreakblog.wordpress.com/
