# BeachDefense — physical surf prototype

Codex branch `codex/breaking-surf`, 18 October 2026. Serve this directory over HTTP and open `index.html`. **Try beach-wide physical surf** enters the existing 3D game with the new water. **Start Game** uses the same ocean with the defense gameplay. `beach.html` provides whole-beach, tube cutaway and rider views. The previous natural-water tank remains at `lab.html` / `natural-lab.html`.

WASD moves, Space jumps, V changes the game camera, B resets surf, and Esc pauses. Skimming engages when entering the surf; there is no separate visible board. The standalone beach view starts paused: Play, Enter surf, then Follow rider.

The offshore wavemaker drives a FLIP/PIC liquid simulation over a shallow reef shelf. Gravity, pressure and the bed evolve the nearshore lip; no tube trajectory or proximity-triggered character kick is prescribed. A physical simulation recording supplies distant waves along 215 m of curved beach. A moving, live 3D fluid volume around the character handles finite-mass particle contact, buoyancy, drag and planing, including opposite impulses returned to water. This makes the large beach affordable without solving its entire volume in 3D every frame.

This is an experimental approximation, not a complete realistic ocean. Distant water is a repeated five-second recording of a constrained cross-shore simulation. The character's local 3.6 m periodic volume evolves independently after entry; its wake does not propagate into the distant recording. The transition can show seams, the loop can pop, and the surface is still visibly faceted. Air is atmospheric pressure, not a solved gas; foam is a bounded visual tracer. A clean, long, surfable 2 m barrel is unfinished.

## Evidence

`verification/v6` contains source hashes, measurements and headless screenshots. The live source simulation completed 60 simulated seconds with 15,056 fixed markers and recurring connected-roof cavity candidates. Its strongest sampled cavity was about 1.08 m high by 2.04 m wide. The exact bundled recording's strongest measured air pocket was 0.96 m high by 1.56 m wide. These are air-pocket dimensions, not calibrated crest-to-trough wave heights or scientific validation.

The installed 60 Hz character regression conserves isolated linear contact momentum to numerical precision. With the same entry position/speed, the wave trial tips to 83.4 degrees by two seconds; calm water remains upright at 11.8 degrees. Calm skimming later ends as speed is lost. Both trials keep 24,192 local water markers finite for six seconds.

At 1440×900, headless Edge using the RTX 5070 Ti rendered the integrated game at 60 FPS during a six-second sample; simulated water time advanced at 0.90 times wall time. The standalone surf view updated at 29 FPS, ratio 0.96. Software rendering was slower: 25 FPS in game, ratio 0.63, and 19 FPS in the standalone view, ratio 0.70. These short measurements are not a hardware-independent performance guarantee or a sustained human playtest. Surf entry, defense entry, pause and resume passed with no page errors.

Current runtime: `js/coast`, `js/main.js`, `js/surf-bodies.js`. Physics is in a worker at 60 Hz, with 40 pressure sweeps and a single outstanding snapshot; surface updates target 30 Hz. Fixed particle arrays, a 15.7 MB distant recording, 180,000 coast-vertex capacity and 4,500 local foam-point cap bound the work. Lower timestep/pressure budgets were rejected after calm-control failures.

Verification runners are in `tooling/v6`. Run them through the local Resource Governor on this PC: `contact.mjs`, `cache-validation.mjs`, `validate.mjs`, and `browser.cjs --gpu` (omit `--gpu` for software WebGL). `validate.mjs` also produces the warm state used by `bake.mjs`; the recording is already bundled for ordinary play. See `CURRENT.md` and `tooling/v6/NOTES.md` for limitations, provenance and continuation details. Claude's separate worktree was not accessed or modified.
