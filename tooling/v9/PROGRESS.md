# Codex v9 wave look and performance — 20 October 2026

Own branch only: codex/breaking-surf. Owner requires approval before every push. No push performed. No Claude branch read or changed. No installed AoM assets or owner screenshot copied. Existing main and publisher are untouched.

## Measured stages

All heavy jobs admitted by aiwork.py with two slots and 1.5 GB reservation (physics-only .4 GB). Main-thread CPU means are RAF callback costs, excluding worker CPU. RTX 5070 Ti at 1920x1080; SwiftShader viewport1280x800, software framebuffer640x400. Five-second profiler windows, timer queries capped at2500 per run and read only after profiling stops. These are short samples, not sustained play guarantees.

| Change | RTX CPU/frame | RTX interval | RTX water+foam GPU/frame | Software CPU/frame | Software interval | Software water+foam backend/frame |
|---|---:|---:|---:|---:|---:|---:|
| Current pointer-safe look baseline | 11.513 ms | 17.500 ms | .218 ms | 20.585 ms | 27.770 ms | 12.197 ms |
| Reuse unaffected contour profiles | 7.854 ms | 16.680 ms | .177 ms | 15.361 ms | 30.581 ms | 14.875 ms |
| Single solver + height/flow character | .762 ms | 16.673 ms | .049 ms | 1.037 ms | 22.725 ms | 9.257 ms |

Both water passes unchanged in count: 2 water, 1 foam. Old foam points become empty in the height-body intermediate stage, so its GPU number excludes the replacement effects that are still awaiting verification. RTX mesh snapshots14,967 ->14,944 ->5,904 vertices; triangles29,154 ->29,130 ->11,118 (vary with physical phase). Software13,969 ->13,969 ->5,904 vertices. The sampling phases differ slightly between realtime runs, so use the separate fixed-state contour comparison for geometry equivalence. Software interval worsened in the contour-only stage despite lower CPU: GPU/backend timings and other live workload varied; do not attribute every timing change to the optimization.

Contour regression: identical indices and vertex/triangle counts in four matched states at27.5,28,30,33 seconds, mounted and unmounted. Maximum position difference3.8147e-6 m (Float32 averaging). Reconstruction mean before/after:8.54/3.60,23.62/22.72,17.84/15.34,3.22/1.12 ms. No solver changes in this stage.

New runtime: the background live FLIP/PIC section, initial-state.bin, source forcing, gravity, pressure, wet/dry bed/friction and physical clock are unchanged. Surface profiles shared alongshore are extracted once; local mesh work is skipped because the character no longer owns a second fluid volume. A fixed256-bin CPU height envelope and surface velocity field come directly from the physical markers, never the render mesh. Character forces use buoyancy, relative-flow quadratic drag, bounded planing lift, finite player effort and gravity/ground contact. The force clamp is a numerical/gameplay stability approximation. No phase-triggered wave kick. The coupling is ONE WAY: the body no longer returns momentum to the water. The height envelope cannot distinguish the barrel air pocket from the roof. Old finite-body/pressure implementation is retained in js/coast/surf-physics.mjs; its old contact tests do NOT validate this new runtime.

New physics regression passed: calm zero-input z6.5 unchanged after2s; incoming flow-3 m/s carries body toz4.894, reversed flow+3 toz8.106. Six seconds of actual warm-start live fluid produce shoreward force down to-3000 N and speed-6.389 m/s, body remains finite and quaternion normalized;15,056 fixed markers. Does not establish calibrated human hydrodynamics or reciprocal fluid coupling.

Pending appearance/effects stage: original seeded128x128 warped-ridge normal/noise texture generated once; incommensurate rotated scales and continuous UV; reduced glare saturation, broken-up whitewater coverage. Far waves evaluated once per vertex with analytical normals, shoreward phase travel, fade at transition. Near grid now clusters alongshore around the camera and the far field clusters depth rows toward shore. Software tier20 columns, pixel ratio.5, anisotropy1,128 particles; hardware48 columns,640 particles. New single instanced-quad effect mesh stores birth/lifetime/velocity/size/type attributes, GPU gravity/fade/ring expansion, highest-live-slot instance count, capped screen sprite size; births follow measured foam/falling-flow breaker strength and the character wet collar. No per-frame particle geometry rebuild. This stage is not verified until the pending governor-admitted browser job actually runs.

Mouse safeguard retained: navigator.webdriver or automation=1 suppresses all pointer-lock requests; test harness blocks native capture at prototype level and releases it on cleanup. Manual play retains capture. Main movement vectors reused and bridge inputs compare numbers instead of allocating JSON strings each physics tick. The legacy particle solver and worker snapshots still allocate internally; do not claim the entire game is allocation-free.

## Admission hold

Rendering measurement first rejected at22:30 Lisbon, free9.87 GB minus all job reservations5.5 GB below5 GB planned headroom. Status showed admission based only on current reservations but the actual job request adds1.5 GB. A fresh status did not release the real reservation constraint; second attempt was also rejected. No workload or governor settings changed; no memory reduction/bypass. A50s guarded wait expired. One300s guarded wait is queued for the new appearance GPU measurement, not yet a test result. Other assistants' jobs/VM reservations untouched. Finish tests, inspect screenshots and update this note before any completion claim.

## Verification paths / next steps

verification/v9 before-opt, profile-cache, height-body hold measurements/screenshots. geometry/comparison.json holds exact before/after reconstruction results. height-test.json holds new gameplay regression. v9/look-effects is pending final measurement; smoke.cjs covers own nested URLs, workers, startup, input safety, fixed phases28/30/31.5/33.5/36/39/40 and rider snapshots. Test both hardware and SwiftShader with90s screenshot timeout. Inspect tube and wide shots before accepting look; then record final performance, limits, cleanup and commit the chosen own-branch files. Ask before push.

References: https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/ ; https://threejs.org/docs/pages/InstancedBufferGeometry.html ; https://threejs.org/docs/pages/Info.html . No external artwork used.

FINAL: pending stages above completed. See RESULTS.md for authoritative final measurements, passing tests, one-way coupling limits and admission history. No push.
