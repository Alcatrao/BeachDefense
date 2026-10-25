# Round 23 research: stay on three.js or move engine? (25 Oct 2026)

Author: Claude subagent (Opus 5.5) for the BeachDefense owner. Status: FINAL for round 23.
Method: web research only (WebSearch/WebFetch) on 25 Oct 2026. Official docs, release notes, PRs and vendor
posts were fetched where possible. Nothing was downloaded, installed, run or measured on this project.
Builds on research-r12-breaking-waves.md and research-r13-links.md, which are not repeated here.
UNVERIFIED = the claim rests only on a search snippet, vendor marketing or a forum/third-party post.
"Not re-checked" = background knowledge, not looked up today. [n] = entry in the sources list.

Baseline (from the brief): three.js 0.186.0, which is r186, the newest release (24 Sep 2026) [14]. WebGL2, all
water in custom GLSL ShaderMaterials, ~5k lines of JS. Analytic swell -> lip/tube -> bore with a JS CPU mirror,
lip curtain, 1-2k procedural billboard sprites. ~0.5-0.75 ms/frame at 720p on an RTX 5070 Ti; static GitHub Pages.

## Short answer

Stay on three.js, and keep WebGLRenderer + GLSL for now.
- No candidate ships breaking or overturning surf. None has a water system that runs in a web build and would beat
  the analytic model. The look lives in our own shaders, and any engine switch means rewriting them.
- Every switch costs at least a rewrite of all shaders and glue code. Unity and Godot also add multi-MB wasm
  downloads and slower startup on Pages. Godot's web export is WebGL2-only and has five preset blend modes.
- The three.js manual still calls WebGLRenderer "the recommended choice for pure WebGL 2 applications" and says
  WebGPURenderer is experimental [12]. r184-r186 keep shipping WebGL fixes, and no deprecation has been announced [14].
- If WebGPU is ever needed, the cheapest path is inside three.js: WebGPURenderer + TSL, ported one material at a
  time. Since r184 WebGLRenderer can run TSL node materials through a compatibility layer intended as a transition
  path [15]. The port can therefore be incremental and tested on the current renderer.
- The software tier is eroding for every engine. Chrome removed its automatic SwiftShader WebGL fallback in 2025
  (sources give M137-M139; now flags or policy only) [6][8][9], and Chrome had not shipped WebGPU fallback
  adapters [5]. Treat SwiftShader as a test tier, not a user tier.

## Comparison (criteria 1-7 from the brief)

| Candidate | 1 Reach, fallback | 2 Water in web builds | 3 Shader control, CPU mirror | 4 Particles | 5 Size, Pages | 6 Overhead, debug, headless | 7 Licence, migration |
|---|---|---|---|---|---|---|---|
| three.js r186 WebGLRenderer (now) | WebGL2 in all current browsers; Chrome software path only via flags/policy or WARP [8][9] | our analytic model (no engine has breakers) | full GLSL, any blend state incl. min/max; JS mirror | instanced billboards; render-target ping-pong; no compute | plain JS, no wasm; works on Pages today | leanest; Spector.js; current SwiftShader tests | MIT (not re-checked); no cost |
| three.js WebGPURenderer + TSL | WebGPU for ~88% of users [3]; automatic WebGL2 backend [12] | Water Pro: paid, FFT deep water, no breakers (r13) | GLSL ShaderMaterial unsupported, rewrite in TSL; JS mirror unchanged | compute on WebGPU; WebGL2 backend emulates it with transform feedback [13] | same static deploy | renderer experimental; many-draw-call CPU regression [18]; WebGPU Inspector [20] | MIT; port the surf shaders, incremental via r184 layer [15] |
| Babylon.js 9 | separate WebGL2 and WebGPU engines, chosen at start | flat WaterMaterial; FFT ocean demo needs WebGPU [38]; no breakers | GLSL ok on WebGL2; on WebGPU a ~2 MB WASM transpiler or WGSL rewrite [34][35] | GPU particles: transform feedback on WebGL2, compute on WebGPU | core ~2 MB raw / ~460 kB gzip (forum, UNVERIFIED) [37] | Inspector; heavier runtime | Apache-2.0 [36]; rewrite ~5k lines of glue, GLSL bodies mostly reusable |
| PlayCanvas 2.x | WebGL2 + WebGPU (beta) with WebGL2 fallback [39] | none found | GLSL on both (WASM transpile on WebGPU) or WGSL [39] | compute since 1.70, WebGPU only (UNVERIFIED) [40] | not measured | optional hosted editor | engine MIT [40]; same rewrite as Babylon |
| Unity 6.6 Web | WebGL2 default; WebGPU opt-in, out of experimental in 6.6 [21] | HDRP (Water System) not on web [23]; Crest no WebGL [24]; KWS PC/console [25] | HLSL/Shader Graph, full control; C# mirror | VFX Graph GPU particles need WebGPU | ~3-10 MB minimal builds (forum, UNVERIFIED) [27]; Pages needs Decompression Fallback [28] | ~200 MB RAM empty URP (forum, UNVERIFIED); Editor build step | Personal free < $200k; Pro $2,310/seat/yr [26]; full rewrite |
| Godot 4.7 Web | WebGL2 Compatibility renderer only; no upstream WebGPU [29][30] | FFT ocean add-ons need Forward+, not on web | GLSL-like language; 5 preset blend modes only [31]; C# not on web, GDScript mirror [29] | GPUParticles without compute (forum) | ~35 MB wasm raw, ~1/4 gzip (forum, UNVERIFIED) [32]; single-thread export fine on Pages [29] | engine wasm overhead; shader-compile hitches on web (forum) | MIT (not re-checked); full rewrite |
| Bevy (Rust/wgpu) | WebGL2 or WebGPU fixed per build; fallback = two builds [41] | none relevant | WGSL; Rust mirror | compute in WebGPU build only | multi-MB wasm; size profile added (UNVERIFIED) [41] | pre-1.0 breaking releases (not re-checked) | MIT/Apache-2.0 (not re-checked); full Rust rewrite |
| Unreal 5 | no web export; Pixel Streaming needs servers [42] | n/a | n/a | n/a | not static | n/a | out |

## Per-candidate notes

### three.js WebGLRenderer (current)
- r184 (16 Apr), r185 (1 Jul) and r186 (24 Sep 2026) all carry WebGLRenderer fixes or features: packed normal maps,
  the NodeMaterial layer, context-restore fixes, async PBO unbinding [14]. No deprecation notice was found.
- Downstream, the React Three Fiber 10 alpha moves WebGLRenderer behind a "legacy" entry point (release-note
  snippet, UNVERIFIED). This is a sign of where the ecosystem is heading, not a three.js decision.
- It covers every criterion the project uses today and costs nothing to keep.

### three.js WebGPURenderer + TSL
- Reach: WebGPU is on by default in Chromium on Windows, macOS and ChromeOS (113+), Android 12+ (121+), Linux Intel
  Gen12+ (144+) and NVIDIA on Wayland (147+). Firefox has it on Windows (141+) and macOS (145 on macOS 26, all from 147); Linux and
  Android are not default. Safari 26 has it on macOS, iOS, iPadOS and visionOS [1][2]. caniuse gives 85.8% full
  plus 2.0% partial global usage (StatCounter, Sep 2026) [3]. Opt-in compatibility mode (Chrome 146) targets older
  GPUs [4]. Everyone else gets the WebGL2 backend automatically [12].
- Port: ShaderMaterial, RawShaderMaterial and onBeforeCompile are not supported. Materials must become TSL node
  materials, and EffectComposer is replaced by a TSL post stack [12]. TSL emits WGSL or GLSL for the active
  backend. glslFn/wgslFn wrap native code but are still consumed through TSL [19]. Whether one GLSL body runs on
  both backends is unclear (UNVERIFIED), so plan to translate the shaders into TSL.
- Incremental route: r184 added WebGLNodesHandler (renderer.setNodesHandler), which runs TSL materials on
  WebGLRenderer (PR #32851, merged 14 Mar 2026) [15].
  - Supported: shadows, lights, skinning, instancing, batching and fog.
  - Not supported at merge: VSM shadows, MRT, transmission and compile() (later addressed, PR #34217); storage
    textures probably not; post-processing untested.
- Compute: compute is native on WebGPU. The WebGL2 backend runs compute() as a vertex shader with transform
  feedback and rasterizer discard, and has no indirect dispatch [13]. The official compute-particles example
  draws 200k sprites from storage buffers [16].
- Performance:
  - Issue #30560 ("High priority", opened Feb 2025): per-object uniform buffers make many-draw-call scenes
    slower. Maintainers advise instancing or batching [18].
  - Forum reports, UNVERIFIED [17][18]:

    | Test | WebGLRenderer | WebGPURenderer (WebGPU) | WebGPURenderer (WebGL2 backend) |
    |---|---|---|---|
    | r183, 4,000 meshes: CPU per frame | 4.5 ms | 9.7 ms | 10.3 ms |
    | r183, 4,000 meshes: first frame | 32 ms | 167 ms | 344 ms |
    | r181, 50k cubes | ~40 fps | 3-6 fps | not reported |

  - Our GPU time is already small, so any payoff would have to come from features, not speed.
- Debug and headless:
  - WebGPU Inspector extension (Chrome, Firefox): frame capture and live shader edits [20].
  - Headless WebGPU needs --enable-unsafe-webgpu --use-webgpu-adapter=swiftshader (UNVERIFIED) [11].
  - forceWebGL keeps the current SwiftShader WebGL tests usable [12].

### Babylon.js 9
- Licence and releases: Apache-2.0. 9.0 shipped in Mar 2026 and 9.27.1 on 18 Sep 2026 (secondary) [36].
- Engines: Babylon has separate WebGL2 and WebGPU engines. Its WebGPU port is complete apart from point size and
  fan/loop topologies [34].
- Shaders: GLSL ShaderMaterial works on WebGL2. On WebGPU, Babylon converts GLSL at runtime with a downloaded WASM
  library (~2 MB per a Babylon blog snippet, UNVERIFIED) [35]. Its docs recommend WGSL for faster startup and smaller
  downloads [34].
- Particles and water: GPU particles use transform feedback on WebGL2 and compute on WebGPU. There is a legacy
  flat WaterMaterial and an FFT ocean demo that needs WebGPU [38]. Neither has breakers.
- Migration: the Inspector is a real debugging plus. A move means rewriting the scene, camera and input glue;
  GLSL bodies are mostly reusable on WebGL2. There is no gain specific to water.

### PlayCanvas
- Licence: the engine is MIT, and the editor front end has been MIT since 2025. Hosted editor plans are paid
  (prices UNVERIFIED) [40].
- Graphics: WebGPU is listed as beta, with WebGL2 fallback. GLSL runs on both (WASM-transpiled on WebGPU); WGSL
  runs on WebGPU only [39].
- Compute since engine 1.70, with a 1M-particle demo (blog, via snippet) [40].
- No water system found. The migration cost is like Babylon's, with no water gain.

### Unity 6.6 (Web)
- WebGPU status (Web Graphics team post, 24 Aug 2026) [21][22]:
  - WebGPU left experimental in 6.6, but WebGL2 stays the default.
  - Fallback follows the Graphics API list; Device Filtering is available; a secure context is required.
  - Compute unlocks VFX Graph GPU particles, the GPU Resident Drawer, STP and APV.
  - WebGL can still win on CPU when there are many draws.
- WebGPU limits: no async compute, no synchronous GPU readback (AsyncGPUReadback only), limited storage
  formats [22].
- Water:
  - HDRP, and with it the Water System, is not available on the web (staff, 2024; nothing newer found) [23].
  - Crest does not support WebGL [24]. KWS targets PC/console, and its HDRP version needs compute [25].
  - That leaves asset-store URP shaders, none with breakers.
- Size and hosting:
  - Forum reports (UNVERIFIED) [27]: minimal URP web builds ~3.3-6 MB, a typical empty URP build ~10 MB,
    ~200 MB runtime memory.
  - Pages cannot send Content-Encoding for Unity's precompressed files. Builds therefore need Decompression
    Fallback, which brings a bigger loader and less efficient loading per Unity's docs, or no compression [28].
  - Whether Pages gzips .wasm/.data on the fly is not verified.
- Licence and migration:
  - Runtime Fee cancelled (Sep 2024). Personal is free under $200k revenue/funding; Pro is $2,310/seat/yr from
    12 Jan 2026 [26].
  - Migration is a full rewrite in C# and HLSL/Shader Graph, plus an Editor build step.

### Godot 4.7 (Web)
- Rendering:
  - Official web export uses the Compatibility renderer on WebGL2 only. Forward+ and Mobile are unavailable on the
    web, and WebGPU is not supported [29].
  - The 4.7 release page (2026) mentions no web or WebGPU change [30].
  - WebGPU exists only in community forks (dwalter/godotwebgpu, lpenguin 4.7.2 builds, hogdot; UNVERIFIED) [33].
- Shaders: the GLSL-like shading language handles vertex displacement and procedural fragments. Blending is limited
  to mix, add, sub, mul and premultiplied alpha: no arbitrary factors and no min/max [31].
- Water and particles: FFT ocean add-ons rely on compute (Forward+), so they do not run on the web. GPUParticles
  run on Compatibility without compute (forum).
- CPU mirror: C# cannot be exported to the web in Godot 4, so the mirror would be GDScript [29].
- Size: ~35 MB wasm uncompressed (forum, UNVERIFIED) [32], about a quarter with gzip. Single-threaded export is the
  default, so Pages works without COOP/COEP [29]. Precompressed Brotli failed on github.io (forum, UNVERIFIED) [32].
- Net: a downgrade for this project.

### Bevy (Rust, wgpu)
- A wasm build targets WebGL2 or WebGPU through a compile-time feature. A fallback means two builds plus a
  navigator.gpu check in JS (wgpu docs; Bevy specifics UNVERIFIED) [41].
- Shaders are WGSL; naga translates them to GLSL for WebGL2 (UNVERIFIED).
- Bevy added a size-optimised wasm profile because its web builds were too big (PR #20419 snippet, UNVERIFIED).
- A move is a full rewrite in Rust, with no water advantage.

### Unreal Engine 5
- No web export (forum and third-party sources, UNVERIFIED; the Epic docs page returned 403) [42]. HTML5 was
  deprecated in 4.23 and moved out of the engine to a community Platform Extension, last maintained for 4.24.3;
  UE5 has no web target. Pixel Streaming needs servers, which rules out static Pages. Out of scope.

### Others (brief)
- Needle Engine is a layer on three.js with Unity/Blender authoring. Commercial use needs a paid licence [43].
  No water gain.
- Cocos Creator: experimental WebGPU (secondary, UNVERIFIED) [45].
- Defold, Wonderland: nothing relevant found.

## Recommendation and when switching would pay off

1. Now: stay on three.js r186 WebGLRenderer + GLSL. Spend effort on the look (r12/r13 ideas), not on a port.
2. Particles: 1-2k stateless procedural sprites gain nothing from compute; their cost is fill rate. If overdraw
   bites, draw the splash into a reduced-size target and composite it with a depth test (GPU Gems 3 ch. 23) [44].
   That works on WebGL2 today.
3. CPU mirror: every option keeps two copies of the wave function, one shader and one CPU. GPU readback is
   asynchronous on WebGPU (Unity: AsyncGPUReadback only [22]) and GPU-side simulation is not guaranteed deterministic (r12), so the
   analytic JS mirror stays the right design.
4. Prepare cheaply:
   - Keep the wave math in small, pure GLSL functions with matching JS.
   - Optionally, as a one-day spike, port one material to TSL on WebGLRenderer through the r184 layer [15] and
     measure how costly a full port would be.
5. Move to WebGPURenderer + TSL (not to another engine) only when one of these holds:
   - We need stateful GPU simulation, such as spray, foam or wet-sand accumulation with per-particle or per-texel
     state, beyond what render-target ping-pong in WebGL2 can carry. We must also accept that ~12% of users get
     the emulated WebGL2 path [3][13].
   - Issue #30560 is fixed, or our scene has few draw calls (check renderer.info.render.calls first) [18].
   - three.js deprecates WebGLRenderer. No such announcement exists as of r186 [14].
6. Another engine only pays off if the project's goals change, for example:
   - native or console ports;
   - non-programmer artists who need an editor (Unity, or PlayCanvas's editor);
   - a large need for built-in physics or UI.
   Even then, Unity Web brings no breakers and costs several MB on Pages. Godot Web stays a downgrade until upstream
   has a WebGPU web export. Bevy and Unreal are out.
7. Tests:
   - Keep --enable-unsafe-swiftshader with --use-gl=angle --use-angle=swiftshader-webgl for the SwiftShader
     tier [7].
   - Add --enable-unsafe-webgpu --use-webgpu-adapter=swiftshader only if a WebGPU path is ever tested [11].
   - Expect GPU-less users on Chrome to get WARP on Windows (rolling out, UNVERIFIED) [9][10] or no WebGL at all.

## Sources (accessed 25 Oct 2026; "fetched" = page read directly, otherwise search result/snippet)

1. gpuweb wiki, Implementation Status (fetched; last edited 2 Oct 2026): https://github.com/gpuweb/gpuweb/wiki/Implementation-Status
2. web.dev, WebGPU support in major browsers, 25 Nov 2025 (fetched): https://web.dev/blog/webgpu-supported-major-browsers
3. caniuse, WebGPU, 85.8% + 2.02%, StatCounter Sep 2026 (fetched): https://caniuse.com/webgpu
4. Chrome for Developers, New in WebGPU 146, compatibility mode: https://developer.chrome.com/blog/new-in-webgpu-146
5. Chrome for Developers, New in WebGPU 136, 23 Apr 2025 (fetched): isFallbackAdapter on GPUAdapterInfo; Chrome had not shipped fallback adapters: https://developer.chrome.com/blog/new-in-webgpu-136
6. blink-dev, SwiftShader fallback threads: https://groups.google.com/a/chromium.org/g/blink-dev/c/yhFguWS_3pM/m/oLrB5up_BwAJ and https://groups.google.com/a/chromium.org/g/blink-dev/c/TvNk-PJO2Sk/m/hTEi9pYvAQAJ
7. Chromium docs, SwiftShader (fetched): https://chromium.googlesource.com/chromium/src/+/main/docs/gpu/swiftshader.md
8. EnableUnsafeSwiftShader policy, M139 behaviour (fetched): https://developer.samsung.com/browser/policy/enable-unsafe-swift-shader.html
9. Esri KB on Chrome without GPU, WARP (HTTP 403, snippet only, UNVERIFIED): https://support.esri.com/en-us/knowledge-base/usage-of-arcgis-maps-sdk-for-javascript-with-chrome-whe-000038872
10. EarthRanger, GPU/WebGL issues in Chrome (UNVERIFIED): https://support.earthranger.com/en_US/troubleshooting-gpu-and-webgl-issues-in-chrome
11. agent-browser WebGPU preset flags (UNVERIFIED): https://agent-browser.dev/webgpu
12. three.js manual, WebGPURenderer (fetched): https://threejs.org/manual/pages/webgpurenderer.html
13. three.js WebGLBackend.js, dev branch (fetched): https://raw.githubusercontent.com/mrdoob/three.js/dev/src/renderers/webgl-fallback/WebGLBackend.js
14. three.js releases r184-r186 (fetched): https://github.com/mrdoob/three.js/releases and https://github.com/mrdoob/three.js/releases/tag/r184
15. three.js PR #32851, WebGLRenderer NodeMaterial compatibility layer (fetched): https://github.com/mrdoob/three.js/pull/32851
16. three.js webgpu_compute_particles example (fetched): https://raw.githubusercontent.com/mrdoob/three.js/dev/examples/webgpu_compute_particles.html
17. three.js forum, r183 many-mesh benchmark (fetched; single report): https://discourse.threejs.org/t/webgpurenderer-2x-slower-cpu-and-5-10x-slower-first-frame-than-webglrenderer-on-many-mesh-scenes-r183-same-on-both-backends/91904
18. three.js forum, WebGPU performance issue, r181 (fetched): https://discourse.threejs.org/t/webgpu-performance-issue/87939 ; issue #30560: https://github.com/mrdoob/three.js/issues/30560
19. Maxime Heckel, Field Guide to TSL and WebGPU (snippet): https://blog.maximeheckel.com/posts/field-guide-to-tsl-and-webgpu/
20. WebGPU Inspector, Chrome Web Store v1.0.1 (Mar 2026) and Firefox add-on: https://chromewebstore.google.com/detail/holcbbnljhkpkjkhgkagjkhhpeochfal and https://addons.mozilla.org/firefox/addon/webgpu-inspector/
21. Unity, WebGPU out of experimental in Unity 6.6 (fetched): https://discussions.unity.com/t/webgpu-out-of-experimental-in-unity-6-6/1734694 ; 6.6 release thread: https://discussions.unity.com/t/unity-6-6-is-now-available/1735357
22. Unity 6.6 manual, WebGPU limitations and Web graphics APIs (fetched): https://docs.unity3d.com/6000.6/Documentation/Manual/WebGPU-limitations.html and https://docs.unity3d.com/6000.6/Documentation/Manual/web-graphics-apis-intro.html
23. Unity forum, Unity 6 HDRP on WebGPU, staff reply (fetched): https://discussions.unity.com/t/unity-6-hdrp-on-webgpu/1540460
24. Crest documentation, introduction (fetched): https://crest.readthedocs.io/en/stable/about/introduction.html
25. KWS Water System HDRP, Asset Store (snippet): https://assetstore.unity.com/packages/tools/particles-effects/kws-water-system-hdrp-rendering-205007
26. Unity pricing updates (fetched): https://unity.com/pricing-updates
27. Unity forum, build size and memory (UNVERIFIED): https://discussions.unity.com/t/smallest-possible-webgl-build-size/917019 , https://discussions.unity.com/t/unity-6-wasm-stripping-tool/1524437 , https://discussions.unity.com/t/web-build-memory-consumption-on-unity-6/1613334
28. Unity 2020.3 manual, Deploying WebGL builds, Decompression Fallback (the Unity 6 page returned 404): https://docs.unity3d.com/2020.3/Documentation/Manual/webgl-deploying.html
29. Godot 4.6 docs, Exporting for the Web (fetched): https://docs.godotengine.org/en/4.6/tutorials/export/exporting_for_web.html
30. Godot 4.7 release page (fetched): https://godotengine.org/releases/4.7/
31. Godot spatial shader reference, blend render modes (fetched): https://docs.godotengine.org/en/stable/tutorials/shaders/shader_reference/spatial_shader.html
32. Godot forum, size and Brotli on Pages (UNVERIFIED): https://forum.godotengine.org/t/export-optimising-a-build-for-size/94584 , https://forum.godotengine.org/t/wasm-de-compression-is-this-really-working-or-am-i-getting-it-wrong/71728
33. Godot WebGPU forks (UNVERIFIED): https://github.com/dwalter/godotwebgpu , https://github.com/lpenguin/godot/releases , https://github.com/hogdanish/hogdot
34. Babylon docs, WebGPU status and WGSL/GLSL (fetched): https://doc.babylonjs.com/setup/support/webGPU/webGPUStatus and https://doc.babylonjs.com/setup/support/webGPU/webGPUWGSL
35. Babylon blog (HTTP 403, snippet only, UNVERIFIED): https://babylonjs.medium.com/transparently-supporting-both-webgl-and-webgpu-in-babylon-js-8379272a4306
36. Babylon 9.0 (secondary) and Wikipedia (Apache-2.0, 9.27.1): https://www.windowsmode.com/babylon-js-9-0-released-build-immersive-3d-web-apps/ and https://en.wikipedia.org/wiki/Babylon.js
37. Babylon forum, bundle size (UNVERIFIED): https://forum.babylonjs.com/t/treeshaking-shaderwgsl/59598 , https://forum.babylonjs.com/t/importing-webgl-only-or-webgpu-only/60435
38. Popov72 OceanDemo, FFT ocean on WebGPU: https://github.com/Popov72/OceanDemo
39. PlayCanvas manual, graphics and shaders: https://developer.playcanvas.com/user-manual/graphics/ and https://developer.playcanvas.com/user-manual/graphics/shaders/
40. PlayCanvas blog, licensing forum, editor MIT news: https://blog.playcanvas.com/build-webgpu-apps-today-with-playcanvas/ , https://forum.playcanvas.com/t/playcanvas-licensing-details/21815 , https://alternativeto.net/news/2025/8/playcanvas-editor-frontend-is-now-open-source-with-mit-license
41. Bevy + WebGPU and wgpu web platform notes: https://bevy.org/news/bevy-webgpu/ , https://wgpu.rs/doc/src/wgpu/documentation/platforms/web.rs.html ; Bevy PR #20419 (search snippet only, UNVERIFIED): https://github.com/bevyengine/bevy/pull/20419
42. Unreal HTML5 status, forum/third-party (UNVERIFIED): https://forums.unrealengine.com/t/html5-support/1172997 , https://forums.unrealengine.com/t/html5-export/270433 , https://github.com/ufna/UE-HTML5 , https://www.summerengine.com/make-great-games/unreal-engine-html5-export
43. Needle Engine FAQ, licensing: https://engine.needle.tools/docs/reference/faq.html
44. GPU Gems 3, ch. 23, High-Speed Off-Screen Particles (NVIDIA): https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-23-high-speed-screen-particles
45. Web game engine comparison 2026, secondary (UNVERIFIED): https://app.cinevva.com/guides/web-game-engines-comparison
