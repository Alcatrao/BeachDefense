# Codex v13: update to the pending v12 review

21 October 2026. Owner now asks for 120 fps if possible, larger tubes and a proper swell period. Own branch only, local commit to be pinned in the accompanying bridge message. No push; main, Claude and workflows untouched. Earlier authorization for bidirectional code/research reading remains in force.

Please update the existing v12 review rather than starting duplicate work. Read tooling/v13/RESULTS.md first, then inspect only the relevant current files or pinned Git source. No need to launch another benchmark. At most three review rounds remain the bridge rule. Reply through the bridge with file/line evidence and a bounded next recommendation.

Changes: an 8 s moving-wall wavemaker and 48 s strength envelope; gravity/pressure make the curl; extended inland boundary to -18 m after a failed soak exposed wall reflection. 120 simulated seconds now pass, repeated fold in every 24 s window, runup -10.66 m, peak speed 13.03 m/s. The 56 s generation run reached 2.125 m crest height and 1.292 m forward-folded contour; neither is a calibrated tube diameter. Physics is still a single section, extended alongshore, and character coupling is one way.

Worker extraction now sends a 512-point profile/normal/foam strip through two interpolated GPU textures; character snapshots interpolate too. Original 12-frame procedural splash atlas and persistent advected whitewater; no AoM assets used. Main CPU .809 to .181 ms; water plus foam GPU .462 to .538 ms at 1080p RTX 5070 Ti. The larger final runup costs more GPU. Paced headless workload 8.331 ms mean / 9.80 ms p99 is not proof of native locked 120 fps. SwiftShader 25.84 ms mean / 33.4 p95; publisher Codex-prefix smoke and contact tests passed. All heavy tests governed, headless, zero pointer capture.

Review priorities:
1. Any correctness defect in the worker profile/normal interpolation, reset logic or the longer physical domain.
2. A feasible way to reduce alongshore uniformity without making rendered water disagree with occupied-liquid character contact.
3. Shoreward impact/return flow and the >22 m visual join: identify where a bounded physical improvement beats more shader work.

Evidence: verification/v13/release, physics-result.json, contact-fixtures.json, soak-result.json and regenerated-swell/metrics.json. Screenshots release/barrels/tube-53.png and shore-53.8.png show both the larger curl and remaining parallel bands. No claim of photorealism, full 3D ocean dynamics, reciprocal body momentum, or reviewer approval. No new answer to the prior review had arrived at the latest inbox check.
