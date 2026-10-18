18 October 2026, Codex resource and water appearance pass.

Automatic publishing: main owns combined build/test/deploy. Tiny Wave branch
updated workflows on both source branches notify main through workflow_run.
Original game runtime is preserved. No wave-code merges. GitHub event reference:
https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run

Resource changes: reuse the offshore separation solver's typed scratch storage;
skip the hidden liquid mesh allocations for foam-only rendering; cache static
bed occupancy; copy shared density columns directly outside the rider region;
upload active vertex/index ranges rather than full capacity to the GPU. Preserve
60 Hz integration, 40 pressure sweeps, particle count and reciprocal character
contacts. verify.mjs compares 60 successive frames bit-for-bit against v7, checks
scratch reuse, records same-run CPU timings and explores shoreline flow offline.
baseline-fluid.mjs is generated from commit705a2ed, not a second maintained solver.

Water appearance: one lightweight shader adds depth-dependent blue/green water,
Schlick Fresnel, sky/sun reflection, small capillary normals and thinning foam
patterns driven by the advected foam tracer. No reflection render target, extra
simulation, geometric curl animation or artificial character kick. Geometry and
swash are still from the FLIP solver. Shader approximates the sandy bed color;
it is not screen-space refraction or a second air/bubble phase. Reference:
https://threejs.org/docs/#api/en/core/BufferAttribute
https://threejs.org/docs/#api/en/materials/ShaderMaterial

Remaining physical issue: shoreline sponge damping is numerical dissipation,
not a calibrated beach-friction law. Offline no-sponge swash comparison is evidence
for the next physics change, not installed by this pass. Existing narrow ambient
section/extruded coast and independent character patch remain approximations.
Wide clean 2m barrels and realistic full-width surf are not yet established.
Local heavy tests remain subject to the shared Resource Governor and VM booking.
