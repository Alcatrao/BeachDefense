# Round 12 research: breaking waves in games and real physics (21 Oct 2026, Claude subagent)

Question from the owner: what other games/projects use real breaking waves, and are actual real
physics an option, or is it too heavy and unpredictable?

Method: web research only (WebSearch/WebFetch), 21 Oct 2026. Nothing installed, built or run.
Several PDFs (Thuerey 2007, Moana talk) could not be text-extracted here, so their numbers are
from abstracts/project pages. Items marked UNVERIFIED rest on a search snippet or vendor claim.
Context from this branch (notes-claude/CURRENT.md): analytic GPU field, whole frame ~1.1 ms GPU on
the RTX 5070 Ti, budget ~2 ms; SwiftShader soft tier already ~0.6-0.9 s per frame; the sea spans
roughly x +-645 by z 0..430 units. Codex's separate FLIP route was not read for this note.

Short answer: no shipped game found that simulates plunging breakers with live physics. Games and
films that show convincing breakers use authored or analytic profiles, often driven or calibrated
by an offline 2D simulation. Live physics in real time is used only for height fields (no
overturning) plus particles, or for small tanks of particles.

## 1. Games and productions that show breaking waves

| Title | How the breaker is made | Evidence |
|---|---|---|
| True Surf (True Axis, Quest, 2023) | Blends 2D animations of vertical wave slices (spilling to plunging); a custom 2D water sim made the reference; beach/weather physics picks the slice; live Surfline data | [Meta blog][truesurf] |
| Fluid Flux (UE4/5 plugin) | 2D shallow-water grid near shore; vendor: wave breaks are NOT simulated, use predefined wave-profile animation; coastline non-simulated, blended with a pre-baked sim state | [UE forum][ff], [80.lv][ff2] |
| KeraFlow (UE plugin, Sep 2026) | Claims shoaling, curling C-shaped lip, plunge; GPU compute; method not stated | [UE forum][kera] UNVERIFIED |
| Unreal Water plugin | Gerstner only (cheap, depends only on time); no breaking | [Epic docs][uewater] |
| Crest (Unity) | FFT/Gerstner displacement plus shoreline foam; no overturning feature documented | [Crest docs][crest], [80.lv][crest2] |
| Sea of Thieves (Rare) | FFT ocean (Tessendorf) plus GPU surface fluid sims for incidental water; no shore breakers described | [SIGGRAPH 2018 talk][sot] |
| AC IV Black Flag (Ubisoft) | Beaufort-scale open ocean, shallow-water shaders; no breaker method published | [PlayStation blog][ac4], [Co-optimus][ac4b] |
| Uncharted 3/4 (Naughty Dog) | GDC 2012 water talk: mesh, flow shader, LOD, wave generation; no breakers mentioned | [GDC Vault][unch] |
| The Last of Us Part II | GDC 2021 VFX talk lists a beach "curl wave" effect; technique not public | [GDC Vault][tlou] |
| TransWorld Surf (Angel Studios, 2001) | Reportedly a parametric/procedural wave (break point, steepness, barrel size), not a fluid sim | [surfertoday][tws] UNVERIFIED (page 403; snippet only) |
| Kelly Slater's Pro Surfer, Surf World Series, Barton Lynch Pro Surfing 2022, The Surfer | No technical write-up found; marketing only ("proprietary engine", "physics-based control") | [PSX Data Center][ksps], [Red Bull][sws], [Stevivor][bl] |
| Surfers Code (indie) | Vertex equation (pulse-wave function) on a mesh after bones failed | [surfertoday][scode] UNVERIFIED (403) |
| Hydrophobia (2010) | Real-time fluid engine for flooding corridors, not surf | [Wikipedia][hydro] |
| Moana (Disney film) | Profile-curve wave deformer (animator keys 2D profile curves, system interpolates) for most of 40+ crashing-wave shots; APIC solver only for hero shots, because it was costlier | [Disney][moana], [Performing Water][moana2] |
| Surf's Up (Sony film, 2007) | Art-directed wave rig with custom wave-animation software; producer guidance reportedly "don't simulate the waves" | [SIGGRAPH archive][surfsup], [JoBlo][surfsup2] (quote UNVERIFIED) |
| dome272 Wave-Simulator (hobby, three.js WebGL2, Oct 2026) | GPU Boussinesq height field; crest tracker classifies by Iribarren number; plunging crests throw ballistic lip curtains; barrel carved in the renderer; tested only on SwiftShader | [PR #3][dome] (unreviewed code) |

Pattern: even the film studios with offline budgets used a profile deformer for most breakers.
Every real-time product found keeps the overturning part authored or kinematic.

## 2. Research on real-time or interactive breaking waves

- Fournier & Reeves 1986 and Peachey 1986 (SIGGRAPH): Gerstner/trochoid profiles whose phase and
  shape depend on depth and steepness; breakers placed by depth; spray as particles. The ancestor
  of the current analytic model. [F&R][fr], [Peachey][peachey]
- Jeschke, Birkholz, Schmann 2003 (WSCG poster): procedural breaking waves as functions of space
  and time, no time stepping, frame rate tied to screen resolution; fast but limited flexibility.
  [ZCU][jbs]
- de Lima, Braun, Musse 2010 (SBGAMES): procedural real-time breaking waves for games, few
  parameters, low cost. [hgpu][delima]
- Mihalef, Metaxas, Sussman 2004 (SCA): library of precomputed 2D breaking-wave slices; the
  animator picks a slice shape at a moment, which seeds a 3D Navier-Stokes solve; much faster than
  simulating from the start. The direct precedent for option (b). [PDF][mihalef]
- Thuerey, Mueller-Fischer, Schirm, Gross 2007 (Pacific Graphics; NVIDIA patent US8204725): shallow-
  water height field; steep fronts detected by gradient threshold emit sheets of connected
  particles that overturn and turn into drops and foam on impact; real time on 2007 hardware.
  The canonical "height field + particle lip" hybrid, i.e. option (c). [paper][thuerey], [patent][thuereyp]
- Chentanez, Mueller, Kim 2014 (SCA; TVCG 2015): 3D Eulerian grid + particles only in a region of
  interest, shallow-water height field elsewhere, two-way coupled; interactive. [EG][chentanez]
  Chentanez & Mueller 2011 (SIGGRAPH): real-time 3D Eulerian water on a tall-cell grid. [archive][tall]
- Jeschke & Wojtan 2017, Water wave packets: Lagrangian packets on a flat 2D domain; artist-
  friendly, real time; no breaking. [ISTA][wwp]. Skrivan et al. 2020, Wave curves (Wojtan, not
  Jeschke): ripples on deforming surfaces as post-process; no breaking. [ISTA][wc]
- Jeschke & Wojtan 2023 (SIGGRAPH): height field split into shallow-water bulk flow plus Airy
  surface waves; real-time 512 m scenes with wakes reaching a beach; height field, so no
  overturning. [NVIDIA][jw23]
- Celeris (Tavakkol & Lynett 2017) and Celeris-WebGPU (Lynett, USC): extended Boussinesq on the
  GPU, faster than real time; WebGPU version runs in the browser with Madsen-Sorensen equations and
  the Kennedy et al. breaking model (energy dissipation at the front, not overturning).
  [arXiv][celeris], [Celeris forum][celerisw]
- Huang et al. 2021 (SIGGRAPH Asia), Ships, splashes and waves on a vast ocean: FLIP + BEM hybrid;
  offline, 42-249 s per frame with 99M-634M particles; their brute-force FLIP comparison used
  ~1.7B particles (table figure). Shows the cost of particle oceans even offline. [arXiv][ships]
- Neural/learned: GNS (Sanchez-Gonzalez et al. 2020) learns particle water in small boxes; recent
  learned free-surface surrogates target engineering loads, not real-time breaking surf. Nothing
  game-ready found. [ICML][gns], [MDPI 2025][mdpi]
- Offline 2D tools that can make a breaking slice: Basilisk (two-phase Navier-Stokes, VOF,
  quadtree AMR in 2D; used for plunging-breaker studies) [arXiv][basilisk]; DualSPHysics (CPU/GPU
  SPH, validated for breaking waves) [UVigo][dsph]. Run times for a beach slice not found.

## 3. Real-time 3D fluid in the browser

- SPH in WebGPU: ~30k particles real time on an integrated GPU; neighbour search is the
  bottleneck. PIC/FLIP (David Li, WebGL): ~100k. MLS-MPM in WebGPU (WebGPU-Ocean / WaterBall):
  ~100k on a Ryzen 7 5825U iGPU, screen-space rendering at half resolution.
  [Codrops 2025][codrops], [dli/fluid][dli]
- Same MLS-MPM demo: 500k particles on an RTX 3060 laptop (one test). [CGWorld][cgworld]
  A derived project: ~400k at 30-35 fps on M1 iGPU, 60 fps on a dGPU. UNVERIFIED (snippet).
- These demos spend the whole frame on a box a few metres across. None shows a plunging breaker.
- SwiftShader: Chrome is removing the automatic SwiftShader WebGL fallback (opt-in flag from about
  M139; version UNVERIFIED; Edge has a matching policy) [blink-dev][swift], [Edge policy][edge]. Chrome had not shipped
  WebGPU fallback adapters to users (Apr 2025) [Chrome][fallback]. So a WebGPU fluid has no
  software tier at all; the WebGL2 soft tier would need a separate path.
- GPU float atomics (used by MPM/FLIP particle-to-grid scatter) apply in any order, so results
  differ run to run unless a deterministic mode is used. [NVIDIA Warp][warp]

Scale check (estimate, this note): a 2 m plunging lip is ~0.2 m thick; resolving it with ~4
particles needs ~0.05 m spacing = 8,000 particles per m3. Only the break zone of 200 m x 40 m x
1.5 m mean depth is 12,000 m3, i.e. ~100 million particles. With a browser budget of ~300k
particles, the spacing would be ~0.34 m: a 2 m wave is ~6 particles tall and no lip forms. The
visible sea here is over 1 km wide. Real-time 3D particle physics at beach scale is two to three
orders of magnitude out of reach, before rendering a surface from the particles.

A 2D cross-shore slice is different: 150 m x ~2 m of water at 0.05 m spacing is ~120k samples,
which is routine offline and even feasible interactively.

## 4. Feasibility for this project

Ratings are judgements from the sources above plus this branch's measured costs.

| | (a) Current analytic | (b) Baked 2D slice sim driving the profile | (c) Shallow-water/Boussinesq height field + particles | (d) Live 3D SPH/FLIP/MPM |
|---|---|---|---|---|
| GPU/CPU cost | ~1.1 ms frame, measured | Similar or lower: texture lookups replace part of the crest maths | Several grid passes per step (dome272: 29) over ~10^5 cells; CPU queries need readback (one frame late) or a CPU twin | Whole frame for ~10^5 particles; needs ~10^8 for a resolved lip |
| Determinism | Exact; closed form in t; CPU mirror `evalSurf` | Exact playback; same table on CPU | Deterministic per device with fixed dt; drifts across GPUs; history-dependent | Not reproducible run to run (atomics); chaotic |
| Controllability | Full, direct parameters | High: choose/blend slices by breaker type and height; peel and timing stay analytic | Indirect: via bathymetry and boundary forcing; break point emerges | Lowest; Disney needed special tools even offline |
| Overturning lip | Yes (kinematic) | Yes, physically shaped (multi-valued profile curve) | No; lip must be added kinematically (Thuerey 2007, dome272) | Only at unreachable resolution |
| SwiftShader soft tier | Runs (0.6-0.9 s/frame) | Runs; one more texture | Probably too slow at useful resolution; keep (a) as fallback | No (WebGPU compute, no fallback adapter) |
| Effort | Done; incremental | Moderate: offline 2D runs, free-surface extraction, parameterise by arc length, pack into a texture, blend in shader and CPU mirror | High: new solver, wet/dry, breaking model, coupling to lip/spray, readback path, second code path for the soft tier | Very high, and the result would still not be a beach breaker |

What real physics would buy: break positions and bores that follow real bathymetry, refraction,
reflection, wave-wave interaction, swash and rip currents (height field), and player wakes. A
physically measured lip shape (offline slice). What it would not buy: an overturning lip from any
height field, a resolved lip from any real-time 3D method at this scale, or predictable gameplay.
Spray and foam stay particle/texture layers in every option.

## Recommendation

Keep (a) as the runtime model and the soft tier. Use real physics offline, option (b): run a small
library of 2D cross-shore slices (spilling, plunging, surging; 3-4 heights on the beach slope),
extract the free-surface curve against time, pack it into a texture, and let the shader and
`evalSurf` blend slices along the peeling break line. This is the True Surf / Moana / Fluid Flux /
Mihalef pattern. Do not pursue (d) for the surf. Consider (c) later only as an optional desktop
layer for bores and swash, with (a) as the fallback, if gameplay needs wakes or rips.

## Sources

Reference-style link targets for the bracketed links above (rendered Markdown hides this list).

[truesurf]: https://www.meta.com/blog/true-surf-launch/
[ff]: https://forums.unrealengine.com/t/2420009
[ff2]: https://80.lv/articles/highly-realistic-coastline-set-up-in-ue5-with-fluid-flux-2-0
[kera]: https://forums.unrealengine.com/t/brahoule-studio-keraflow-water-plugin/2834591
[uewater]: https://dev.epicgames.com/documentation/unreal-engine/API/Plugins/Water/UGerstnerWaterWaves
[crest]: https://crest.readthedocs.io/en/stable/about/introduction.html
[crest2]: https://80.lv/articles/crest-ocean-system-for-unity-m11
[sot]: https://history.siggraph.org/wp-content/uploads/2022/09/2018-Talks-Ang_The-Technical-Art-of-Sea-of-Thieves.pdf
[ac4]: https://blog.playstation.com/archive/2013/09/12/why-assassins-creed-iv-black-flag-on-ps4-is-a-truly-next-gen-experience
[ac4b]: https://www.co-optimus.com/amparticle/10800/assassin-s-creed-iv-creates-a-beautiful-next-gen-caribbean.html
[unch]: https://gdcvault.com/play/1015309/Water-Technology-of
[tlou]: https://gdcvault.com/play/1027072/Creative-and-Experimental-VFX-in
[tws]: https://www.surfertoday.com/surfing/the-story-of-the-transworld-surf-video-game
[ksps]: https://psxdatacenter.com/psx2/games2/SLUS-20334.html
[sws]: https://www.redbull.com/int-en/surf-world-series-interview
[bl]: https://stevivor.com/news/barton-lynch-pro-surfing-2022-coming-from-aussie-dev-bungarra
[scode]: https://www.surfertoday.com/surfing/how-i-developed-the-surfers-code-video-game
[hydro]: https://en.wikipedia.org/wiki/Hydrophobia_(video_game)
[moana]: https://disneyanimation.com/publications/moana-crashing-waves/
[moana2]: https://media.disneyanimation.com/uploads/production/publication_asset/163/asset/Moana-_Performing_Water.pdf
[surfsup]: https://history.siggraph.org/animation-video-pod/surfs-up-a-practical-guide-to-making-waves-by-sony-pictures-imageworks/
[surfsup2]: https://www.joblo.com/interview-brannonbuck/
[dome]: https://github.com/dome272/Wave-Simulator/pull/3
[fr]: https://history.siggraph.org/?p=116025
[peachey]: https://history.siggraph.org/?p=116024
[jbs]: https://dspace5.zcu.cz/handle/11025/1025
[delima]: https://hgpu.org/?p=5372
[mihalef]: https://www.math.fsu.edu/~sussman/BreakingWavesElectronic.pdf
[thuerey]: https://matthias-research.github.io/pages/publications/breakingWaves.pdf
[thuereyp]: https://patents.google.com/patent/US8204725
[chentanez]: https://diglib.eg.org/handle/10.2312/sca.20141117.001-010
[tall]: https://history.siggraph.org/?p=114669
[wwp]: https://visualcomputing.ist.ac.at/publications/2017/WWP
[wc]: https://visualcomputing.ist.ac.at/publications/2020/WaveCurves/
[jw23]: https://research.nvidia.com/labs/prl/shallow-water-simulation
[celeris]: https://arxiv.org/abs/1611.05984v1
[celerisw]: https://celeris.discourse.group/t/celeris-webgpu-theory-source-code/26
[ships]: https://arxiv.org/abs/2108.05481
[gns]: https://proceedings.mlr.press/v119/sanchez-gonzalez20a.html
[mdpi]: https://mdpi-res.com/d_attachment/jmse/jmse-13-02277/article_deploy/jmse-13-02277.pdf
[basilisk]: https://arxiv.org/abs/2302.01699
[dsph]: https://portalcientifico.uvigo.gal/documentos/5f90daaa2999522a4a6ed28e
[codrops]: https://tympanus.net/codrops/2025/02/26/webgpu-fluid-simulations-high-performance-real-time-rendering/
[dli]: https://github.com/dli/fluid
[cgworld]: https://cgworld.jp/flashnews/202501-matsuoka-601-LiquidSim.html
[swift]: https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM/m/oLrB5up_BwAJ
[edge]: https://learn.microsoft.com/en-my/deployEdge/microsoft-edge-policies/enableunsafeswiftshader
[fallback]: https://developer.chrome.com/blog/new-in-webgpu-136
[warp]: https://nvidia.github.io/warp/stable/user_guide/execution_and_performance/deterministic_execution.html
