# Codex v9 local result — 20 October 2026

Branch: codex/breaking-surf, based on 2770e39. No push or publication. Original/main, publisher and Claude source untouched. This document supersedes the pending status in PROGRESS.md and MOUSE-SAFETY.md.

## Measurements

Headless Edge, RTX 5070 Ti at 1920x1080; SwiftShader at 1280x800 with 640x400 framebuffer. Five-second windows after warm-up. CPU means are main-thread RAF callback cost, excluding worker CPU. Frame intervals include scheduling and backend work. EXT_disjoint_timer_query_webgl2 results were read after profiling stopped, capped at 2500 draws; disjoint=false. Combined water timing is mean per-draw time multiplied by two water draws, plus one foam draw. These short windows differ in physical phase and competing machine load; they do not establish sustained gameplay performance.

| Stage | RTX CPU ms | RTX interval ms | RTX water+foam GPU ms | Software CPU ms | Software interval ms | Software water+foam backend ms |
|---|---:|---:|---:|---:|---:|---:|
| Pointer-safe before optimization | 11.513 | 17.500 | .218 | 20.585 | 27.770 | 12.197 |
| Cached contour profiles | 7.854 | 16.680 | .177 | 15.361 | 30.581 | 14.875 |
| Single solver and height/flow body | .762 | 16.673 | .049 | 1.037 | 22.725 | 9.257 |
| Instanced effects and procedural look | .969 | 16.680 | .363 | 1.174 | 25.361 | 11.419 |
| Final dry-shore/join/collars/input fixes | 1.555 | 16.680 | .105 | 1.882 | 110.695 | 47.798 |

Final hardware interval p95=16.9 ms, about 60 fps, with 86.5% lower main-thread callback cost than the measured baseline. Water/foam were already below the 2 ms GPU budget before this change. Software final p95=133.5 ms: within the requested approximately 150 ms target, but **slower than baseline** and inconsistent across samples. Machine load changed; no causal adjustment or consistent software speedup is claimed.

Final mean per draw: RTX scene .02777 ms, water .04397 ms, foam .01753 ms; SwiftShader scene 4.41244 ms, water 20.58002 ms, foam 6.63837 ms. Each frame has 12 scene draws, 2 water draws and 1 instanced effect draw. Scene cost excludes water/foam here.

Final coast snapshots: hardware 15,604 vertices / 30,452 triangles, far grid 1,225 vertices / 2,304 triangles; software 6,270 / 11,844, far grid 231 / 400. Renderer total 15 calls, 116,964 hardware or 96,212 software triangles (including scene/effects; varies over time), zero points. Effects use four shared vertices, two triangles per instance, caps 640/128; final live counts 115/36 and draw slots 220/100. Coast upload 864,752/342,768 bytes per update, reconstruction snapshot 2.5/1.5 ms, around 30 Hz. Baseline coast snapshots were 14,967/29,154 hardware and 13,969/27,250 software. Adaptive hardware density increases detail rather than minimizing vertices everywhere.

## Changes and decisions

Cached contour profiles avoid repeated extraction across unchanged alongshore columns. Four fixed-state comparisons have identical indices/counts and maximum position difference 3.8147e-6 m. Reconstruction before/after: 8.54/3.60, 23.62/22.72, 17.84/15.34 and 3.22/1.12 ms. This comparison isolates the cache stage, before adaptive spacing/wetness changes.

The original live FLIP/PIC section, pressure, gravity, source forcing and initial state remain. A 256-bin height/velocity envelope from physical particles drives buoyancy, relative-flow drag and bounded planing forces independently of the render mesh. Removing the second fluid volume is the main CPU saving. **Character coupling is now one-way: the body receives water forces but does not return momentum to water.** The single-valued height field cannot distinguish a barrel air pocket from its roof. Force clamps are stability/gameplay approximations. No phase/proximity kick substitutes for measured incoming flow. The older finite-body implementation remains in js/coast/surf-physics.mjs; its contact tests are not evidence for this runtime.

Original generated-once warped-ridge/noise textures, rotated incommensurate scales, cyan reflections, broad glare, wet whitewater and a hazy sky improve the look. Far waves evaluate once per vertex with analytic normals. Adaptive grids concentrate detail near the camera/shore. A wetness mask removes the dry-sand water skin; overlap and far-grid spacing close the observed join hole. Instanced capped splash bursts, rings and collars animate from birth/lifetime attributes on the GPU; geometry is not rebuilt per frame. Main movement vectors and bridge inputs are reused. Legacy solver/snapshot allocations remain.

Software detection selects half pixel ratio, 20 coast columns, cheap normals, anisotropy 1 and 128 effects versus 48 columns/640 effects on hardware. Original procedural art only; no installed AoM assets or owner reference screenshots included.

## Verification and governor

All browser/physics jobs ran through aiwork.py. Reservation-based admission rejections and expired guarded waits were respected; other jobs/bookings and governor policy were untouched. Final sequential pipeline was admitted with 2 slots/1.5 GB at 10.21 GB available and exited 0. Available memory later entered the low band (8.17 GB); no additional independent job was launched. No governor kill occurred.

Final pipeline: hardware measurement, SwiftShader measurement, hardware smoke, SwiftShader smoke, portable height regression. Both smokes captured 12 screenshots, maximum 324 ms hardware / 729 ms software against a 90-second screenshot timeout. All 28 observed local paths loaded, including nested beach-worker, ambient-worker and initial-state paths under /BeachDefense/codex/. Zero page/shader errors; real physics clock advanced; body finite and phase synchronized; camera roll zero. These are local own-branch publish-path checks, **not a run of the cloud publisher or proof of the other versions**. No deployment occurred.

Calm zero-input body stayed at z=6.5 after 2 s. Flow -3 m/s carried it to z=4.894; reversed flow +3 carried it to z=8.106. Six seconds of live fluid retained 15,056 markers and a finite normalized body, with shoreward force down to -3000 N and speed -6.389 m/s. This demonstrates flow-dependent interaction, not calibrated human hydrodynamics.

Automated tests preserve the mouse fix: webdriver/automation=1 prevents pointer capture on Start/Restart/Resume/canvas. Escape explicitly pauses automated play and Resume resumes without pretending capture. Both smokes asserted **zero requestPointerLock attempts** with a fail-closed prototype guard. No native cursor/focus APIs or Windows mouse settings used; browsers and servers close in finally blocks. The original desktop symptom was not reproduced independently, so unrelated software capture is outside this evidence.

An initial effects shader compile failed because of a built-in uv name collision; corrected to effectUV and final tests passed. An initial smoke waited for a hidden Resume button because automation lacked Escape pause; fixed and both final smokes passed. That was a button wait, not a screenshot timeout. Failed shader evidence is retained separately.

## Limits and handoff

The physical section extends coherently across about 215 m; alongshore uniformity, distant analytic waves, visual foam and spray remain approximations. Pinched folds, contour creases and residual banding remain visible. A clean calibrated 2 m barrel, fully natural shorebreak and artifact-free views are unfinished. Surface updates remain about 30 Hz even with a 60 Hz display. This result meets the sampled hardware budget and software smoke timeout, not every original realism goal.

Evidence: verification/v9/{before-opt,profile-cache,height-body,look-effects,final,smoke-gpu,smoke-software,geometry}, height-test.json. Harnesses: tooling/v9/{measure.cjs,smoke.cjs,height-test.mjs}; run heavy checks through the governor. Browser harnesses require the locally installed Playwright/Edge and default canonical root; SURF_ROOT overrides the source root, SURF_OUT overrides measurement output. geometry.cjs is a historical cache-stage harness tied to its archived pre-opt source path, not a portable final test. PROGRESS.md preserves chronological decisions and admission holds; this file is final authority for v9 local completion.

References: https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/ ; https://threejs.org/docs/pages/InstancedBufferGeometry.html ; https://threejs.org/docs/pages/Info.html . No push without fresh owner approval.

Cleanup readback: no surviving Playwright measurement/smoke processes matched the completed harnesses. Remaining headless Edge roots belonged to a separate assistant's tests, identified by process command lines only and left untouched; their files/branch were not opened. Fresh governor status: 9.99 GB available, level ok, Codex registered running-job reservations 0. Syntax checks for changed runtime modules and the three portable harnesses passed; diff whitespace check passed.
