# Codex v10 — connected tubes and less repetitive whitewater

20 October 2026, Europe/Lisbon. Own branch codex/breaking-surf, starting at 68520b4. Local work only; every push still requires owner approval. Original/main, publisher and Claude branch/source untouched. This follows v9; it does not change or restore reciprocal character/water coupling.

## Changes

The v9 surface-net profile averaged all edge crossings in a cell into one vertex. In a saddle cell that can join two separate contour strands, producing a pinch. The replacement uses connected marching squares, one shared vertex per grid-edge crossing and a bilinear asymptotic decider for the two saddle cases. Each strand is faired independently with eight bounded Taubin pairs, never by averaging triangles across the alongshore mesh or across a tube air gap. Maximum permitted displacement from the extracted physical contour is 7 cm (Float32 tolerance 1e-6 m). Normals follow the finished curve and bisect adjacent edge directions, avoiding bias from unequal segment lengths. Contour/fairing buffers and attribute lists are reused. A final refinement increased two pairs to eight after wide screenshots still showed particle-scale corrugation; it also reuses the existing coarse texture sample to vary hardware wavelet normals alongshore, without another lookup.

The same fluid density kernel, bed mask, connected-liquid filter, offshore blend and adaptive alongshore grid remain. The costly full alongshore density copies, unused second-volume reconstruction path and triangle-wide fairing passes are removed. A second fluid volume is rejected explicitly by this renderer rather than silently showing the wrong surface; the current height/flow runtime has none.

Original generated-once stochastic spectral wavelets replace the two dominant periodic ridge waves. An independent multiscale noise channel breaks up foam edges alongshore, rather than only adding detail inside a straight coverage band. UVs blend rotated, incommensurate scales with low-frequency warping. Hardware retains three texture samples. The software shader compiles a separate one-sample version with geometric normals and one broad glare term. No per-pixel fbm or extra draw call. Foam coverage still depends on simulated foam tracers; there is no scripted tube trajectory or phase-based mask.

## Matched physical-state checks

Six identical live-fluid states were rendered with the archived 68520b4 contour code and the new code. Shader changes are not part of these geometry metrics. Each reconstruction timing is the mean of five updates in one headless browser; the first phase includes cold/JIT effects. These are not whole-frame GPU timings.

| Physical time | Reconstruction before/after ms | Mean tangent/normal mismatch before/after degrees | Crest-height change m |
|---|---:|---:|---:|
| 28 | 11.98 / 3.86 | 5.877 / 4.088 | +.00254 |
| 30 | 2.02 / 2.08 | 5.431 / 3.783 | +.01678 |
| 31.5 | 2.20 / 1.64 | 4.737 / 3.135 | +.04033 |
| 33.5 | 1.96 / 1.64 | 5.279 / 3.148 | -.00584 |
| 36 | 2.20 / 1.66 | 5.894 / 3.360 | +.00052 |
| 40 | 2.12 / 1.60 | 4.657 / 2.771 | -.01062 |

All new meshes had zero nonmanifold edges, zero unexpected interior boundary edges and zero contour vertices of degree above two. At 30 s the old section had one branch vertex; the new section resolves the saddle without merging strands. Mean normal mismatch improved by about 30–43% at all six states. The p95 normal jump improved at 30/31.5/33.5/36/40 s but worsened at 28 s (28.71 to 30.80 degrees): **not every sharp crease has been removed**. Highest-crest change stayed below 4.1 cm; no larger wave is fabricated by this rendering change. The reconstruction timing at 30 s was slightly slower; the other five were faster, including a large cold/JIT effect at 28 s.

Synthetic regression: an annulus retains two separate closed strands (288 vertices/segments); normals are finite and normalized, fairing bounded (1.82 cm in this fixture). Both saddle determinant signs retain two segments and four distinct endpoints. These tests validate contour connectivity, not physical fluid correctness.

## Performance protocol

Fresh v9 baseline and each stage were measured through aiwork.py: headless Edge, RTX 5070 Ti 1920x1080; SwiftShader 1280x800 with 640x400 framebuffer. Main CPU means are RAF callback cost, excluding worker CPU. Five-second samples after warmup. Per-draw EXT_disjoint_timer_query_webgl2 results are read after the profile stops, capped at 2500 draws, not read back inside the render loop. Combined water/foam cost is twice the water mean plus the effect mean. Physical phase and competing machine load differ across real-time windows; timing changes are not isolated causal estimates.

| Stage | RTX CPU ms | RTX interval ms | RTX water+foam GPU ms | Software CPU ms | Software interval ms | Software water+foam backend ms |
|---|---:|---:|---:|---:|---:|---:|
| Fresh 68520b4 baseline | 1.203 | 16.681 | .344 | 1.879 | 138.353 | 51.984 |
| Connected contour, two fairing pairs | .885 | 16.681 | .108 | 1.173 | 79.430 | 33.447 |
| Stochastic wavelets/foam, three texture samples | 1.039 | 16.682 | .113 | 1.533 | 144.058 | 55.800 |
| Edge-angle normals and one-sample software shader | .691 | 16.680 | .228 | 1.464 | 87.951 | 29.826 |
| Final eight-pair fairing/coarse normal variation | .678 | 16.679 | .219 | 1.537 | 74.934 | 24.362 |

Final hardware is about 60 fps, p95=16.8 ms. Main-thread callback cost is 44% below the fresh baseline, but this is a short varying-phase/load sample, not a sustained performance guarantee. Hardware water/foam were already under the requested 2 ms GPU budget before this work. Final SwiftShader p95=133.5 ms (baseline183.4 ms); intermediate p95 values166.9/233.5/150.2 ms show substantial scheduling/load variance. Final mean and p95 meet the approximate150 ms target in this sample, not every future frame. Measurement screenshots took320/480 ms hardware/software; final smoke screenshot maxima were362/511 ms.

There remain two water draws plus one instanced foam/effect draw per frame; about12 scene draws. Final per-draw hardware means: scene .03298 ms, water .08051 ms, foam .05832 ms; software scene3.73869 ms, water9.86521 ms, foam4.63183 ms. Final coast snapshots: hardware14,160 vertices/27,636 triangles, software5,660/10,716; renderer totals15 calls and114,636/95,140 triangles, zero points. The far grid remains1,225/231 vertices and2,304/400 triangles. Counts vary with physical phase and effect slot occupancy; this is not a matched-state vertex-reduction claim. Texture sampling fell from three to one only in software; hardware still blends its three scales. Intermediate evidence lives in before/, contour/, look/, final/; **fairing/** and **fairing-comparison/** are the final authority, superseding the earlier directory named final/.

## Preserved behavior and boundaries

Final hardware and software smokes each captured12 screenshots: menu/game, wide views at28/30/31.5/33.5/36/39/40 s, tube cutaways at28/30 s and rider at41.5 s. Maximum screenshot duration362/511 ms versus90 s timeout. All29 observed local paths loaded; explicit checks cover the nested worker/initial-state paths and new section-contour.mjs, each200 under /BeachDefense/codex/. No page/shader errors. Rider state finite, fluid time advanced and phase synchronized. Zero pointer-lock attempts on Start/canvas/Escape/Resume/Restart, no camera roll. Cutaway diagnostic views deliberately hide instanced spray and far water to expose the physical section; they are not full-game foam views.

The earlier four-pass/one-sample pipeline also passed both smokes (330/562 ms maxima), the synthetic/matched-state tests and6 s live character regression. Final repeated checks follow the16-pass refinement. Calm body z=6.5 unchanged, -3 m/s flow carries it to4.89395, +3 to8.10605; real fluid causes shoreward drag/speed down to-3000 N/-6.38923 m/s with15,056 markers and finite normalized state. These remain gameplay approximations, not calibrated human hydrodynamics or reciprocal coupling.

All heavy browser/physics checks ran through Resource_Governor/aiwork.py; final children execute sequentially inside one admitted2-slot/1.5 GB disposable root. A software measurement admission was rejected at11.83 GB available minus7.5 GB registered reservations below5 GB planned headroom. The reservation was not reduced; a legitimate guarded wait subsequently admitted it. No governor policy, other jobs or bookings changed, and no killed work was retried. Final batch admission status was fresh/ok at12.24 GB available; no new governor kill this turn. Local publish-path checks passed; **cloud publisher/live deployment was not run**, because no push was authorized.

Runtime fluid.mjs, ambient-worker.mjs, beach-worker.mjs, height-physics.mjs, beach-bridge.mjs, surf-effects.mjs, quality.mjs, initial-state.bin and main.js have identical Git blob hashes to68520b4 (preserved-runtime.json). The installed three renderer files match their tested staging SHA256 values. Live pressure/gravity/source forcing continues without a replay loop. Character height/flow buoyancy/drag/planing, shoreward interaction and backwash response remain the v9 model. **Coupling remains one-way; the character does not return momentum to water, and its single-valued sampler cannot distinguish barrel air from the roof.** Rendering improvements do not solve that limitation.

The webdriver/automation pointer guard is unchanged. Tests remain headless-only, block requestPointerLock before application scripts and use no native mouse/focus APIs. No Windows cursor settings changed. Original/main and deployment workflow remain unchanged. No installed Age of Mythology assets or owner reference screenshot were read, copied or included.

The fluid section still extends coherently along about 215 m. Large parallel bands intrinsic to that extrusion and real coarse-fluid folds remain; distant waves and visual foam/spray remain approximations. A calibrated clean 2 m barrel, fully three-dimensional alongshore breaking and completely artifact-free shorebreak are unfinished. The mesh follows approximately 30 Hz physical snapshots. No sustained 60 fps or universally sub-150 ms software claim follows from short samples.

## Research

Used the original author's explanation of bilinear saddle ambiguity: https://www.boristhebrave.com/2022/01/03/resolving-ambiguities-in-marching-squares/ (search result; full page fetch timed out). Particle-surface reconstruction literature emphasizes topology, smoothness and temporal coherence as distinct problems: https://www.cs.ubc.ca/tr/2013/tr-2013-02 . This implementation is a lightweight connected section, not the Beta Mesh algorithm. No external implementation or artwork copied.

## Evidence and continuation

tooling/v10 contains the profiling/smoke/contour/geometry harnesses and archived pre-change coast module. verification/v10 contains baseline, intermediate and final JSON/screenshots. Fixed-state comparison has identical fluid input for both renderers. Use local Node/Playwright/Edge and aiwork.py for heavy checks. SURF_ROOT overrides the canonical source root; SURF_OUT and SURF_SMOKE_OUT control outputs. No publishing without fresh owner approval.

Final16-pass sequential governor pipeline exited0: contour regression, six matched-state comparisons, RTX profile, SwiftShader profile, both12-screenshot smokes and unchanged6 s character regression all passed. Intermediate four-pass results are retained separately. No runtime changes followed those tests. No push.

Cleanup: changed-module syntax checks and portable contour tests passed. No v10 harness processes remained; fresh governor status showed 12.0 GB available, admission OK and zero registered Codex jobs. No new governor kill. Local-only checkpoint; no push.
