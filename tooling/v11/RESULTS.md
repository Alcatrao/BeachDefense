# Codex v11 - fewer shorebreak stripes and coarse bends

21 October 2026, Europe/Lisbon. Starting local commit 9fbb1c3 on codex/breaking-surf. No push. Original/main, publisher and Claude source are outside this change. Prior v9/v10 character model remains one-way particle-height/flow coupling, with no reciprocal fluid impulse and no air-pocket contact resolution.

## Diagnosis and implementation

Matched-state ablations at 28 and 33.5 s disable foam, glare or geometric normal variation separately. Thin bright lines persist without foam and largely disappear with flat normals: reflected light on coarse, beach-wide physical folds is a major source. inspection/ preserves these screenshots; isolated water renders omit the environment and effects deliberately.

The connected marching-squares profile is now reparameterized by physical arc length, independently for each open or closed strand. Original positions, density-gradient orientation, wetness and simulated foam are interpolated together. The same number of vertices and links is retained. Thirty-two bounded Taubin passes follow, versus sixteen in v10. The 7 cm fairing cap applies to the resampled polyline, rather than to the old grid-edge vertex IDs. Resampling can also cut corners between samples, so the cap alone is not a total raw-contour Hausdorff guarantee; matched before/after geometric distances are measured separately. Tube strands are never averaged across an air gap. Reused startup buffers and factory-scoped helpers avoid new update-loop allocations.

New coast-grid.mjs spends the existing 48 hardware / 20 software columns on measured shoreline chord error plus a camera-distance term. It greedily bisects the worst interval, retains the existing extent, caches stationary views and uses fixed buffers. The old power-law camera grid could skip major shoreline bends. No extra columns, triangles, draw calls, particles or shader samples were added.

Water reuses the existing coarse noise lookup to vary wavelet normals and glare alongshore. Whitewater gets dimmer broad specular response; foam coverage is less uniformly solid along an entire wave front. The first candidate used varying specular exponents. Its live profile was more costly, so the final shader uses fixed exponent lobes, with roughness changing their weights. Hardware still uses three texture samples and software one. Procedural textures are generated once; no extra per-pixel fbm or game/reference assets.

## Tests and measurement protocol

All browser/solver batches run through Resource_Governor aiwork.py, slots2, reserve1.5 GB, disposable, bounded admission wait. A reservation-aware wait delayed the isolated baseline; the reservation was not lowered and no booking was changed. First exploratory profiling overlapped the ablation browser and is retained under before/ but is not the authoritative baseline. before-isolated/ ran after that browser exited.

Profiles: headless Edge, RTX5070Ti at1920x1080 and SwiftShader at1280x800 with640x400 framebuffer. Five-second windows after warmup. Main CPU is RAF callback work, excluding solver worker CPU. Per-draw EXT_disjoint_timer_query_webgl2 reads happen after profiling, at most2500 queries. Water+foam = twice the water-draw mean plus one effect-draw mean. Physical phase, machine contention and GPU clocks vary between real-time windows. Short samples do not establish sustained FPS or causally isolate every optimization.

The final matched-state comparison feeds the identical six fluid states to archived v10 and final v11 surfaces. It checks topology, normals, crest heights and bidirectional point-to-polyline distance in the wet physical section. Thirty interleaved timer queries per renderer measure isolated-water draws at each fixed state. These exclude background water, environment and spray and must not be added directly to the integrated-game budget.

## Current limits

Broad bands are reduced, not eliminated. One narrow physical section is still extended coherently along215 m; alongshore geometry is not a fully3D fluid solve. Real coarse-fluid folds and the beach's existing curvature remain. The clearer sky reflection and original cyan look are retained, with a softer glare response. This does not create a calibrated clean2 m barrel, new reciprocal character forces or physically simulated foam bubbles. Render reconstruction follows approximately30 Hz fluid snapshots.

## Research

Primary source: Mark Finch, GPU Gems, Effective Water Simulation from Physical Models: https://developer.nvidia.com/gpugems/gpugems/part-i-natural-effects/chapter-1-effective-water-simulation-physical-models . The useful distinction is geometry for resolved shape and texture normals for detail below mesh resolution. This change keeps the existing fluid solver and uses original procedural detail; it does not replace the breaker with Gerstner animation or copy source artwork/code.

## Evidence

Final batch, measurements, screenshot receipts, preserved-source hashes and cleanup outcome are appended below when complete. candidate* is the intermediate sixteen-pass/dynamic-exponent stage; refined* is the final thirty-two-pass/curvature-grid/fixed-exponent stage. Smoke screenshots include the game, full-beach views, rider and diagnostic tube cutaways; cutaways intentionally hide spray and distant water. No native mouse, focus or pointer-capture API is used by tests. Every push still requires fresh owner approval.

## Final measured results

| Stage | RTX CPU ms | RTX interval ms | RTX water+foam GPU ms | Software CPU ms | Software interval ms | Software water+foam backend ms |
|---|---:|---:|---:|---:|---:|---:|
| before-isolated | 0.823 | 16.680 | 0.138 | 1.657 | 220.805 | 63.120 |
| candidate | 0.984 | 16.681 | 0.927 | 1.680 | 236.030 | 75.749 |
| refined | 1.067 | 16.680 | 0.304 | 1.882 | 169.189 | 60.259 |

Final RTX interval p95=16.9 ms (~60 fps); software p95=216.9 ms. Software mean169.2 ms improved over this baseline220.8 ms, but still misses the150 ms aim. Main CPU and RTX integrated water GPU cost rose versus baseline, while remaining small in the hardware frame budget. Candidate-to-refined improvement cannot be attributed solely to constant powers because the contour/grid and system load also changed. Matched-state isolated GPU queries improve in5/6 states and worsen slightly at30 s; raw timings vary substantially. No sustained or universally sub150 ms claim.

| Time s | Rebuild before/after ms | Normal-jump mean before/after deg | Normal-jump p95 before/after deg | Crest delta m | Sampled wet-skin max delta m |
|---|---:|---:|---:|---:|---:|
| 28 | 4.74 / 6.56 | 7.685 / 6.655 | 30.798 / 27.744 | -0.0233 | 0.0512 |
| 30 | 2.54 / 2.02 | 7.172 / 6.254 | 23.200 / 22.272 | +0.0033 | 0.0426 |
| 31.5 | 1.44 / 1.80 | 5.905 / 5.226 | 17.880 / 16.680 | -0.0296 | 0.0445 |
| 33.5 | 1.42 / 1.76 | 5.957 / 4.972 | 20.045 / 19.370 | -0.0005 | 0.0340 |
| 36 | 1.44 / 1.74 | 6.236 / 5.013 | 17.929 / 16.566 | -0.0016 | 0.0826 |
| 40 | 1.46 / 1.76 | 5.189 / 4.519 | 17.625 / 17.040 | +0.0033 | 0.0575 |

Mean jumps fall11-20%; p95 jumps improve in all6 states. Tangent/normal mismatch means fall13-21%. Crest-height changes remain below3 cm; bidirectional wet vertex-to-polyline distance below8.3 cm. These are rendering differences against the already-faired v10 surface, not exact raw-fluid Hausdorff bounds. Both renderers use identical point/triangle counts at every matched state. All final degree>2, nonmanifold and unexpected interior-boundary counts are zero. First timing includes cold/JIT cost; most warm reconstruction updates cost about0.3 ms more.

Grid fixture: same48 hardware columns reduce sampled maximum shoreline chord error from0.403-1.366 m to0.041-0.050 m across5 camera positions. Same20 software columns reduce0.977-3.175 m to0.196-0.342 m. Measurement covers the visible215 m. This improves the rendered shoreline mapping; the original shore function is unchanged. Synthetic contour fixtures retain two annulus strands and both saddle connections; irregular-curve spacing ratio drops3.36->1.04 without adding points.

| Renderer | Per scene draw ms | Per water draw ms | Per foam draw ms | Coast vertices / triangles at capture | Total draw calls / triangles at capture |
|---|---:|---:|---:|---:|---:|
| gpu | 0.05721 | 0.15055 | 0.00271 | 14928 / 29140 | 15 / 116488 |
| software | 8.03647 | 22.42117 | 15.41682 | 6460 / 12236 | 15 / 96492 |

Whole-game draw budget remains approximately12 scene+2 water+1 effects calls. Snapshot counts differ across real-time stages because physical phase differs; they are not vertex-reduction evidence. Coast upload buffer capacity remains5.6 MB, with bounded active ranges; far grid remains1225 hardware /231 software vertices. Software pixel ratio.5, anisotropy1 and effects caps128/640 remain unchanged. No shader/framebuffer readbacks were added to production.

Final gpu smoke: 12 screenshots, max337 ms; 30 local asset paths200 under /BeachDefense/codex/, including the new grid module, both workers and binary initial state. No page/shader errors, zero pointer-lock attempts, upright camera, finite character and zero phase drift.
Final software smoke: 12 screenshots, max5485 ms; 30 local asset paths200 under /BeachDefense/codex/, including the new grid module, both workers and binary initial state. No page/shader errors, zero pointer-lock attempts, upright camera, finite character and zero phase drift.

Final sequential governed batch exited0: contour, spacing and grid fixtures; six matched-state geometry/GPU/screenshot comparisons; both integrated profiles; both12-shot smokes; unchanged6 s height/flow character regression. Calm body stays atz6.5; flow-3 advects to4.89395 and flow+3 to8.10605. Live breaker min shoreward force-3000 N and speed-6.38923 m/s, finite normalized body. Numeric outcomes match v10. The v10 physics harness wrote its existing identical report; v11 retains a copy and a portable harness with only its output destination changed.

Final evidence contains24 smoke screenshots plus16 paired diagnostic views and2 profile screenshots. Earlier diagnostics/stages remain separate. The isolated diagnostic views omit the environment and effects and are not full gameplay/foam screenshots. No GitHub CI/deployment or live site verification was run because no push is authorized.

Installed-source readback matched the tested four-module SHA256 set. Eleven solver, character, input, effect and integration modules match base9fbb1c3 Git blobs (preserved-runtime.json). Installed syntax checks and portable contour/spacing/grid fixtures passed. Cleanup found no v11 harness processes; fresh governor state was2 s old,11.43 GB available/OK, Codex0 registered jobs, no new kill. Browser/server cleanup was awaited by each harness. No runtime changes followed the final governed tests; only harness import/output paths and notes were adapted for installation. No push.
