# Codex v13 — longer swell, larger physical breakers, display-rate water

21 October 2026. Base bd7de769153a218b9f02fad34584a4d2e4028dc2, own branch codex/breaking-surf. Local work only; no push. Main, Claude and publishing workflows were not edited. The owner's latest target is 120 fps if possible, with larger tubes, a meaningful swell period, better foam and preserved interaction.

## Implemented

- Replaced the runtime orbital particle-position forcing with a moving-wall wavemaker: 8 s period, 5 m maximum stroke, 48 s envelope with 10% variation. The pressure/gravity solve determines overturning. The legacy orbital option remains available for historical experiments, but is not used in the runtime sea state.
- Re-shaped the submerged bed into a 0.06 inner slope and a steeper sandbar beyond 6 m, reaching 3 m depth. The dry beach rises at 0.18. Extended the inland physical boundary from -8 to -18 m after a longer test exposed reflection at the old wall. Contact, surface reconstruction, foam height lookup and visible terrain now cover that runup. Terrain blends back into the existing inland scene beyond the extended beach.
- Re-generated the 24 s physical warm start. It then runs continuously; time never wraps. Fixed 15,640 liquid markers, 60 Hz fluid, 120 Hz body integration. Distant analytic swell uses finite-depth dispersion for the 8 s primary and 10.7 s secondary component.
- Moved density reconstruction/contour extraction into the worker. A 512-point connected profile preserves overhangs. A static, camera-adaptive strip samples two small textures and interpolates them every display frame. Upload is 16,384 bytes per snapshot, versus roughly 886 KB of old mesh attributes/indices. Normals come from the profile; four small normal-filter passes reduce lattice-scale mirror bands without altering the curl geometry.
- Character display interpolates physical snapshots too. The physics remains the v12 21-sample occupied-liquid model: buoyancy, relative-flow drag, wet-foot planing, and air beneath the lip. Corrected the rendered body's shoreline lookup at nonzero x. Camera roll/pitch from water and automated mouse capture remain disabled.
- Smoothed the derivative discontinuity in the shoreline's bay curve. Fixed the offshore density-blend wall by matching height and tangent beyond z=22 m; fixed wetness at the join. The analytic sea stays flat across the small overlap, then acquires swell beyond 28.5 m.
- Original 12-frame procedural splash-crown atlas, instanced alongside existing rings, spray and advected whitewater. No AoM installation assets or screenshots were copied, converted or committed. Pool caps remain 640 hardware / 128 software; 64 px projected-diameter cap bounds each crown sprite. All atlas/noise generation is startup-only.
- Preserved Pages compatibility: initial-state.bin remains the runtime fetch. Existing tooling/v8/verify.mjs and tooling/v7/contact.mjs now delegate to current piston/contact tests and write the filenames the main publisher expects. Old orbital bitwise-equivalence and reciprocal-body tests describe superseded models and remain in Git history; they are not passed off as current runtime evidence.

## Measured stages

Headless Edge/Chromium, RTX 5070 Ti, 1920x1080, display-paced harness. CPU is main-thread RAF callback time, including instrumented submission, not worker simulation or browser compositor time. Water is two draws and effects one draw. GPU timer queries are read after the sampling window, never during the game loop. Values are mean milliseconds. Geometry is the dynamic coast only; the far grid adds vertices. Short runs vary with system load and camera/physical phase.

| Stage | CPU frame | GPU per water draw | GPU effect draw | Water + effects | Coast vertices |
|---|---:|---:|---:|---:|---:|
| v12 fresh baseline | 0.809 | 0.144 | 0.173 | 0.462 | 15,792 |
| Worker profile + GPU interpolation | 0.233 | 0.050 | 0.203 | 0.303 | 24,576 |
| Piston sea + new look/atlas | 0.177 | 0.031 | 0.244 | 0.305 | 24,576 |
| Smooth offshore join + body display | 0.182 | 0.108 | 0.208 | 0.424 | 24,576 |
| Shoreline/normal smoothing | 0.172 | 0.118 | 0.193 | 0.428 | 24,576 |
| Final extended runup domain | 0.181 | 0.156 | 0.227 | 0.538 | 24,576 |

Final hardware main-thread time is about 78% lower than the fresh baseline. Final GPU water/effects time is about 16% higher, because this is a larger, more visible water result; it remains well below the approximately 2 ms target. These are mean draw costs, not a 99th-percentile GPU guarantee. Default headless RAF stays at approximately 60 Hz throughout and does not prove a 120 Hz display.

Final hardware has 2 water draws / 151,014 indexed vertex references per frame, 1 instanced effect draw / about 3,126 references, and about 11.2 other draws / 251,208 references in this surf scene. The fixed coast has 48 columns by 512 samples. Software uses 20 by 256, with half-resolution 640x400 drawing buffer inside the required 1280x800 viewport.

| SwiftShader stage | CPU frame | Frame interval | p95 interval | GPU water draw | GPU effects | Water + effects |
|---|---:|---:|---:|---:|---:|---:|
| Fresh baseline | 1.102 | 21.973 | 33.4 | 3.756 | 0.454 | 7.967 |
| Final | 0.254 | 25.841 | 33.4 | 4.462 | 0.505 | 9.430 |

Software frame delivery is slightly slower in this sample, while main-thread work is much lower. Both remain below the 150 ms smoke-test aim. Do not describe this as a universal software speedup.

The explicit 120 Hz timer-paced workload averaged 8.331 ms between frames (approximately 120.0 fps), p95 9.10 ms, p99 9.80 ms, 99.93% of intervals within 10 ms. CPU averaged 0.129 ms. The comparable v12 workload already averaged 8.334 ms, with 0.423 ms CPU. The important improvement is render/body interpolation and less main-thread work, not an invented jump from 60 to 120 fps. This headless stress harness is not physical display-presentation proof, and the tail is not a perfectly steady 8.33 ms. A manual 120+ Hz full-game session, including heavier combat, remains unverified. An earlier wholly uncapped experiment produced incorrect frame grouping; its results are retained as rejected evidence only.

## Physical and browser evidence

The regenerated 56 s run observed a connected crest up to 2.125 m above still water and 1.292 m of forward-folded contour. The subsequent 120 s continuation (t=24 to 144) passed finite state, velocity <30 m/s, runup short of the inland wall, and repeated overturning in every 24 s window. Observed peak particle speed was 13.03 m/s; minimum cross-shore position -10.662 m, leaving more than 7 m before the new wall. Folded-contour length reached 1.794 m in later windows. These are sampled geometric maxima, not a guaranteed air-gap diameter, significant wave height, or calibrated real Praia de Mira sea state.

The initial longer soak failed because swash reached the old -8 m wall. We fixed the domain and regenerated the state rather than weakening the wall-distance check. Development failure receipt is retained.

The current 24 s body regression found shoreward water force down to -445 N and returning force up to +338 N; the body remained finite with unit quaternion and bounded immersion. It found 107 sampled empty-under-liquid locations. Independent contact fixtures check dry air under a roof, partial head hits, both flow directions, wet-foot planing, submerged non-planing, and spatial-hash agreement with brute-force density. One-way coupling is explicit and tested; no reciprocal water momentum is claimed.

Final installed checks passed through aiwork, serially:
- Exact publishing physics entry points, including current body/contact assertions.
- Hardware profile, SwiftShader profile, 120 Hz paced workload.
- Hardware 15-shot game/menu/wide/tube/rider smoke, 33 asset paths, finite states, upright camera, no browser/shader errors and zero pointer-lock attempts.
- Connected-strip topology check: no interior boundary or nonmanifold edges, expected outer boundary, finite samples and bounded neighbouring profile spacing.
- Codex portion of the actual main-branch publishing smoke in SwiftShader at 1280x800, 90 s screenshot timeout: game, nested workers, initial-state fetch, evolving physics and eight beach inspection screenshots. Its assertions passed. It uses the current canonical Codex files under the exact /BeachDefense/codex/ prefix; main and Claude were not rebuilt or retested, since their files are unchanged. No live publication was performed.
- Separate close shorebreak/cutaway captures, with incremental advance to give the foam pool a real recent history instead of spawning everything at screenshot time.

Evidence: verification/v13/release (final profiles and browser captures), physics-result.json, contact-fixtures.json, soak-result.json and regenerated-swell/metrics.json. Earlier comparisons and rejected attempts are in development/. Installed pre-domain captures are retained under installed*/. Test browser and server cleanup runs in finally blocks. Heavy work used fresh governor admission, bounded 0.5–1.5 GB reservations and disposable jobs; no governor kill or bypass occurred.

## Research used

- [NVIDIA GPU Gems, Effective Water Simulation from Physical Models](https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models): separate large geometric motion from fine normal detail, evaluate geometric waves and derivatives efficiently. Its approximate wave models are not proof of overturning physics.
- [Cem Yuksel, Wave Particles](https://www.cemyuksel.com/research/waveparticles/): multiscale representation and efficient water/body interaction. A heightfield with horizontal warp alone is insufficient for this cavity/contact requirement; retained the physical overturning section.
- [Jeschke and Wojtan, Generalizing Shallow Water Simulations with Dispersive Surface Waves](https://research.nvidia.com/labs/prl/shallow-water-simulation/): separates bulk flow from dispersive surface waves. Informed the separation between nearshore physical flow and inexpensive distant swell; no code or assets copied, and the paper's solver was not implemented here.
- [TU Delft, Coastal Dynamics (Bosboom and Stive)](https://books.open.tudelft.nl/home/catalog/book/202): primary coastal-wave reference located for dispersion, shoaling and breaking. The finite-depth linear relation is used offshore; the nonlinear breaker still comes from the numerical liquid solve. No claim of oceanographic calibration.
- Claude's authorized cooperation brief and R12/R13 research informed occupied-liquid contact, persistent flow-carried foam and compact surface representations. No fresh answer to the v12 review had arrived at the startup/status checks. No Claude code or branch edits were merged.

## Limits and next useful work

A single narrow physical section is extended across the beach. Alongshore uniformity and residual broad bands are still visible; it is not a full 3D ocean simulation. The offshore Hermite join beyond 22 m is a visual approximation and can disagree with contact there. Foam sprites/envelope placement cannot reproduce every overlapping water sheet. The fluid does not receive the character's reaction momentum. Particle resolution, atmospheric-air treatment and the finite wavemaker tank limit realism; trapped air and spray are not separately simulated. The result is a larger, faster-to-render physical surf prototype, not a completed photorealistic coast or a guaranteed locked 120 fps game.

Next useful work is owner play/visual feedback at 120+ Hz, then alongshore variation with matching contact, more faithful offshore inflow/absorption, and localized reciprocal body reaction if it fits the budget. Ask before any push; publication is intentionally pending.

Final visual inspection: tube-53.png confirms an open overturning section; shore-53.8.png confirms dense whitewater. The same captures still show unnatural alongshore uniformity and parallel bands. This is recorded as an unresolved visual limitation, not a passed realism judgment.
