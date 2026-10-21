# v14: depth-flow water with ballistic breaking lips

Codex, 21 October 2026. Local successor to published v13 `b5adf5a` on `codex/breaking-surf`. No push or publication authorized for this revision. Original and Claude branches and the shared Pages workflow are untouched.

## Decision and research

Replace the expensive narrow FLIP section and contour extraction with a small depth-averaged water solver, plus connected ballistic sheets for the overhanging lips. This is an approximation intended for playable surf, not a full 3D fluid simulation.

Primary sources consulted:

- [Thurey et al., Real-time Breaking Waves for Shallow Water Simulations (2007)](https://matthias-research.github.io/pages/publications/breakingWaves.pdf): use an inexpensive depth field for the bulk flow and launch connected sheets where steep fronts break. Integrate the sheets under gravity until impact. Our implementation uses independent transects and its own launch rule; it is not a reproduction of the paper. Unlike the paper's stated nonconservative sheet transfer, emitted mass here is removed from the depth field and returned on impact. This does not make the entire model energy-conserving.
- [Chentanez and Muller, Real-time Simulation of Large Bodies of Water with Small Scale Details (2010)](https://matthias-research.github.io/pages/publications/hfFluid.pdf): wet/dry heightfields, particle detail, exchange of mass/momentum and body coupling motivate a hybrid model. We do not implement their full solver.
- [Crest foam documentation](https://docs.crest.waveharmonic.com/Manual/Appearance/Foam.html): separate advected foam concentration from its texture-based appearance and dissipation. Ours uses a scalar on the water grid and bounded instanced visual particles.
- [GPU Gems, Effective Water Simulation from Physical Models](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models): separate large geometry from small normal detail. Startup-generated noise supplies inexpensive, rotated, mixed-scale detail.

Searches did not establish the exact Age of Mythology meteor-splash implementation. The new 12-frame crown/fan atlas is original procedural code inspired by the requested silhouette. No AoM files, textures, models, shaders, extracted particles, or owner screenshots were used or copied into this repository.

## What is simulated

- Seventeen cross-shore transects, 384 cells each: **6,528 cells**, at 1/240 s. Hydrostatic reconstruction and a local Lax-Friedrichs flux evolve depth and cross-shore momentum; wet/dry land and friction allow swash and return flow. The offshore relaxation inlet supplies an approximately 8 s swell with slow grouping and alongshore phase variation.
- Steepness measured in the evolving water triggers a breaking event. A bounded release window and cooldown are empirical stabilizers. Launch velocity is estimated from crest flow and potential energy. Each lip parcel subsequently follows integrated gravity, never a replayed loop or prescribed curl path. Launching and impact exchange mass; impact returns horizontal momentum and generates whitewater. Two bounded sheets per transect suffice.
- The 3D surface interpolates the transects along the existing curved Praia de Mira shore. The main water grid and two lip strips use fixed topology and two interpolated GPU data textures; no contour extraction or per-frame geometry rebuilding. Alongshore simulation is **independent**, not a 2D pressure/flow solve.
- Character buoyancy, relative-flow drag and limited planing lift query depth and finite-thickness sheet occupancy on the CPU. Empty air underneath a lip stays empty. Cross-shore drag has an equal-and-opposite reaction in the depth-field momentum. There is no full rigid-body fluid displacement, lateral fluid reaction, or vertical momentum reaction. Camera roll/pitch remains independent of body tumble.
- Water is shiny cyan with a hazy sky, small embossed wavelets, broad glare, advected whitewater, contact rings and instanced splash crowns. Software detection retains half pixel ratio, a coarse grid, cheap normals, anisotropy 1 and a 128-instance cap (640 hardware).
- A genuine `ambient-worker.mjs` initialization module fetches the compact warm state. There is now only one simulation worker; the existing published module/asset paths still work. The warm state is 265,368 bytes, down from 875,856 bytes.

## Measured before and after

Governed, serial headless Edge, RTX 5070 Ti, 1920x1080. Twelve-second captures spanning more than one breaking period. GPU disjoint timer queries sample every fourth frame; results read back only after the capture. Tables give per-draw time and observed draw counts, not an unsupported full-game FPS claim. The game uses unmodified display pacing during these comparisons.

| Measurement | Published v13 | v14 |
|---|---:|---:|
| Water worker step, mean (per 1/60 s) | 12.280 ms | 0.953 ms |
| Surface/body preparation diagnostic, mean | 1.392 ms | 0.860 ms |
| Main-thread frame work, mean | 0.194 ms | 0.188 ms |
| Water GPU per draw (2 draws) | 0.151 ms | 0.133 ms |
| Foam GPU per draw | 0.159 ms | 0.152 ms |
| Foam draws per frame, mean | 1.000 | 0.983 |
| Estimated water + foam GPU per frame | 0.461 ms | 0.415 ms |
| Coast vertices | 24,576 | 18,432 |
| Water index references per frame | 151,014 | 121,266 |
| Mean frame interval (headless refresh cap) | 16.681 ms | 16.681 ms |
| Simulation time advanced in 12 s capture | 12.000 s | 12.033 s |

Water-step CPU decreased about **92%**. The new worker step also includes the active character; v13's character work lived in its other worker. Preparation diagnostics differ in their implementation and are reported separately. Snapshot objects and browser/Three.js internals still allocate; fixed solver arrays, mesh buffers and particle pools do not imply a wholly allocation-free application.

Evidence: `verification/v14/before/gpu.json`, `profile/gpu.json`. `intermediate/gpu.json` records the earlier prototype stage (0.213 ms main work and approximately 0.470 ms water/foam GPU); it is not substituted for the corrected final comparison.

Installed software tier at 1280x800, internal **640x400**, SwiftShader: **18.480 ms** mean frame interval, **0.181 ms** main frame work, two water draws at **2.534 ms** each plus approximately 0.982 foam draws at **0.546 ms** each. Screenshot **90 ms**, no page/shader errors or failed asset requests. The simulation advanced **12.017 s** during the 12 s capture, with zero reported dropped simulation time. See `profile/software.json`.

A separate timer-paced 120 Hz headless workload averaged **8.333 ms**, p95 **9.200 ms**, p99 **9.600 ms**. Main work averaged **0.130 ms**. It demonstrates headroom for 120 Hz rendering, but **does not prove consistently presented 120 fps on the user's display**. Normal headless requestAnimationFrame was capped around 60 Hz. Do not mix GPU timing between the capped and timer-paced runs; scheduling and GPU clocks differ. See `paced/gpu.json`.

## Validation and corrections

All heavy runs used `aiwork.py run --assistant codex --slots 1`, with 0.3 GB reservations for physics experiments or 1 GB for headless browser jobs, one job at a time. Fresh governor status was OK. No native browser window or OS mouse automation was used. The production mouse guard in `js/main.js` is unchanged. Automated pointer-lock requests were intercepted and asserted to remain zero.

- **120 s physics soak passed:** finite nonnegative water across every transect, finite body state, bounded immersion, normalized body rotation, repeated breaking, skim, swash/backwash and occupied-water/empty-air probes. Central breaks settled to 7.85-8.28 s apart. Largest central lip-to-water air gap was **1.943 m**. Surface extrema over the entire run span 2.675 m; this is an envelope, **not** a simultaneous measured wave height. Wet run-up reached z=-15.15 m. Rest-state flow was under 1.2e-14 and mass drift zero. Sheet transfer accounting error was below 4e-15 per unit alongshore length.
- **Character fixtures passed:** four encounters include skimming, physical shoreward flow forces, reversal of offshore motion and a wipeout. Maximum tested shoreward force was approximately 2.09 kN. A separate conservation assertion checks the opposite cross-shore drag impulse deposited into the water. These validate this simplified interaction model, not a complete body-fluid solver.
- **Eight high-resolution phase screenshots passed**, at 24.8-26 s and the next breaker at 33.4 s, including two full-scene tube views. Mesh edge audit: exactly 1,044 expected strip boundary edges, no unexpected interior boundaries or nonmanifold edges, finite surface data. This is an index-topology test, not proof that every rendered seam or intersection is eliminated. No cutaway is used to manufacture the tube screenshots.
- **Codex-prefix publishing smoke passed** in SwiftShader: menu/game, actual worker creation, initializer module, binary state, moving simulation, restart advancing without an extra resume command, whole-beach/shorebreak views, 90 s screenshot timeout, no failed assets or browser/shader errors. Main's stable v8/v7 gate entry points now call v14 physics/contact tests. No edit to the shared main publisher, no claim of a new deployment or retesting Claude's unrelated game.
- Startup atlas/noise built once; all spray and decal animation runs on GPU instance attributes, capped and drawn only up to the highest live slot. No GPU readbacks in the production render loop.

Development failures were corrected rather than counted as passes: inactive lip strips initially stretched toward stale geometry; they now borrow a neighboring profile with zero coverage. Zero-length lip normals caused black triangles; fallback normals removed those in the saved close view. Fast warm-state reset initially left the worker paused; reset now preserves playing state and guards the asynchronous reset interval. An early software performance result was frozen at t=24 and is **invalid**. It remains only in chat scratch, excluded from these measured results. The first corrected comparison also measured across an asynchronous restart; the fixture now waits for reset and records simulation start/delta explicitly. The installed publishing smoke separately tests natural restart, without forcing resume.

## Remaining limits and next visual work

This is a substantially cheaper hybrid approximation. It still has broad smooth bands, a visible lip attachment/flattened far opening in some views, and relatively uniform alongshore structure. Foam crowns are small and bounded to control overdraw; not every breaking phase looks like a large opaque explosion. The visual quality is improved in specific respects, **not photoreal or owner-approved**.

Backwash is physically evolved with friction, but peak sampled return flow reached 3.58 m/s; describing all return flow as calm would be inaccurate. The empirical sheet-launch rule and independent transects cannot reproduce all plunging/surging waves, lateral turbulence, or arbitrary wave collisions. The next useful work is visual review in motion, calmer shallow return flow without spoiling run-up, and better lip attachment shading. Re-measure after changing these.

Current runtime and evidence are local on the Codex branch. Ask the owner before every push. Keep main and Claude independent. Source and results can be read by Claude under the owner's existing bridge authorization; an unanswered bridge message is not independent approval.
