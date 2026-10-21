# Codex v12: occupied-water contact and persistent whitewater

21 October 2026. Author: Codex. Base: 8d436e91fad061ca23c8aad1e05c3dad25a730f9, codex/breaking-surf. Local work only; owner explicitly says do not push. Main, Claude, hosting workflows and all input modules unchanged.

## Research and implementation decisions

Read Claude's bridge reply 20261021T130521141247Z-claude-57d3d590, cooperation brief and R12/R13 research in branches/claude/notes-claude. Claude's proposed density contact beneath an overhanging lip and flow-advected surface foam informed this change. Authorship remains separate; no peer assets or source copied. Claude's analytic lip-hit model is not reciprocal momentum exchange. Its larger/rogue-wave goals differ from this branch's physical shorebreak goal.

Verified primary source: https://github.com/rlguy/Blender-FLIP-Fluids/wiki/Domain-Whitewater-Settings describes advected surface foam, gravity-driven spray and crest/turbulence/speed emission. These are techniques, not copied code/assets. The unavailable GPU Gems page is not evidence. Neither a limited literature search nor an analytic heightfield proves that every possible game uses the same approach.

1. A bounded cross-section particle hash feeds 21 body-volume samples using the solver's compact density kernel. Only occupied liquid contributes buoyancy and local relative-flow drag. An overhead lip no longer fills the air below it. Wet feet can plane beneath a separated lip; full immersion cannot skim. The cheap single-valued envelope remains for rendering, not body-volume contact.
2. Instanced foam now persists 1.3-2 seconds and moves with the sampled flow, alongside ballistic spray and expanding rings. A 1 KB height texture conforms the foam to the evolving envelope on the GPU. Birth attributes only; capped 640/128 hardware/software slots; no per-frame geometry rebuild. Emission also responds to downward water velocity. Body collars require actual immersion.
3. The physical fluid solver, contour, grid, water shader, camera and automation input guard are unchanged. The exact four tested runtime files were installed byte-for-byte (verification/v12/source-hashes.json). Git baseline comparisons normalize CRLF/LF; raw source hashes retain actual bytes.

## Before/after measurements

Fresh v11 baseline versus final v12; separate headless Edge browsers, sequential under aiwork, 2 slots and 1.5 GB reservation. RTX 5070 Ti at 1920x1080; SwiftShader at 1280x800 with automatic half pixel ratio. Five-second samples, variable system load and wave phase. Not the proposed Claude four-CPU-affinity protocol. CPU is instrumented main-thread animation callback time, not total process/worker CPU. GPU timer queries were available and non-disjoint; results read only after the measurement window.

| Metric | RTX before | RTX after | SwiftShader before | SwiftShader after |
|---|---:|---:|---:|---:|
| CPU callback mean ms | 0.832 | 0.850 | 2.099 | 0.947 |
| Frame interval mean ms | 16.686 | 16.681 | 25.532 | 22.776 |
| Frame interval p95 ms | 16.8 | 16.8 | 33.4 | 16.8 |
| Water GPU ms per draw (2 draws) | 0.0810 | 0.1257 | 3.0912 | 3.5872 |
| Foam GPU ms per draw (1 draw) | 0.1129 | 0.0937 | 0.3755 | 0.4409 |
| Combined water + foam GPU ms/frame | 0.275 | 0.345 | 6.558 | 7.615 |
| Coast vertices, snapshot | 15984 | 15984 | 5460 | 5780 |
| Coast triangles, snapshot | 31208 | 31208 | 10336 | 10944 |
| Effect drawn slots, snapshot | 220 | 640 | 125 | 128 |
| Body worker update ms, snapshot | 0.3 | 0.7 | 0.3 | 0.3 |
| Ambient solver update ms, snapshot | 9.1 | 13.2 | 11.7 | 12.0 |

About 15 total draws (12 scene, 2 water, 1 effects), unchanged draw structure. Vertex counts vary with contour phase; no geometry reduction claim. More foam fills the existing bounded pool. Final RTX remains near 60 fps and water plus foam below 2 ms, but its GPU cost rose. SwiftShader also has higher measured draw time; its lower mean frame interval is a short-window observation, not proof of an overall optimization or a causal improvement over the old differently loaded 169 ms run. Intermediate candidate metrics are not substituted for final values.

## Verification

Final governed pipeline exit 0: contact fixtures, six-second live-fluid regression, two renderer profiles, then two 15-shot browser smokes. Logs: verification/v12/final-run.log. Browser cleanup awaits close in finally; server cleanup follows. Automation uses automation=1 and an injected pointer-lock blocker, never native desktop input. Zero pointer capture attempts, zero page/shader errors, upright camera, finite body state and zero physical/render phase error.

- Occupancy fixtures: separated overhead lip leaves body in air dry (legacy envelope reported immersion 1); head-only impact gives partial immersion and shoreward force without wet feet; opposing flows push in opposing directions; calm flow does not translate the body; under-lip sole contact planes; full immersion cannot plane. Fifteen spatial-hash probes match brute-force density to 1e-10. Particle velocities are explicitly unchanged by the body, documenting one-way coupling.
- Live solver: 15056 liquid markers, six seconds, normalized body quaternion, minimum shoreward force -332.37 N and minimum shoreward speed -1.310 m/s. This behavior intentionally differs from the old envelope's excessive contact. Uniform-field tests exercise the legacy fallback, not occupancy proof.
- Final smoke: 30 PNGs total, 30 asset/module/binary paths return 200 per renderer, both workers load. Maximum screenshot latency RTX 270 ms, SwiftShader 268 ms, below 90 seconds. Includes matched 28-40 s wide views, tube diagnostics and 41.5/43/44.5/46 s body views. Tube diagnostics hide effects/far sea to expose shape; they are not default gameplay appearance.
- v11 matched screenshots in before-smoke; final captures in final-smoke-gpu/software. Final rendered profiles and JSON in final. Executed harness preserved separately from portable rerun scripts. candidate-run.log includes the earlier stale model-name assertion failure, subsequently corrected; smokes-run.log is incomplete and is not final pass evidence. The final pipeline explicitly records child exit codes.

Useful views: verification/v12/final-smoke-gpu/rider-43.png (character in whitewater), rider-46.png (recovery), wide-33.5.png (whole shorebreak). Screenshots reviewed visually; no hand-play test performed.

## Limits and next work

This is still ONE-WAY physical coupling: particle-derived body forces do not displace liquid or return momentum. Density quadrature is an approximate body volume with calibrated thresholds, not resolved solid-fluid pressure. Pitch torque still uses a simple aggregate lever arm; no per-sample torque integration. A single physical section remains extended along the beach; no alongshore peeling/history or fully 3D breaking-water solve. Broad white bands and coarse folds remain. The foam envelope can place effects on the upper lip instead of inside a tube; no full soft depth fade/bubble classification. A clean calibrated two-metre barrel remains unfinished. This change improves contact correctness and whitewater persistence, not the fundamental wave geometry.

Claude review requested separately through the live-session bridge. Full-cycle arc-length profile export is deferred; no claim it was delivered. The paired shape/runup/color V1-V6 comparison is not complete. No push, publication, main merge or Claude branch modification authorized in this turn.

## Re-run

With fresh governor status permitting admission, from E:/AI_Workspaces/BeachDefense:

    E:/AI_Workspaces/Resource_Governor/.venv/Scripts/python.exe E:/AI_Workspaces/Resource_Governor/aiwork.py run --assistant codex --slots 2 --reserve-mem-gb 1.5 --disposable --wait-for-headroom --max-wait 300 -- C:/Users/joaoa/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node.exe tooling/v12/final.cjs

Portable harness writes under verification/v12/local-check (fixtures at verification/v12 root). Original recorded runs served the same canonical base with four staged runtime overrides; source-hashes.json proves installed bytes match. Re-running is not necessary to reproduce old evidence and will not overwrite final/ or final-smoke-*.

Installed-byte syntax/fixtures/live regression also passed under aiwork (verification/v12/installed-check.log). Final governor status: 19.82 GB available, memory ok, zero held slots/running-job reservation. Review request 20261021T132808501526Z-codex-98544f7b queued without warnings and still unread at final check; review is pending, not approval.
