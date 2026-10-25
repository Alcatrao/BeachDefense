# Round 23 research: rendering techniques for the breaking surf (25 Oct 2026, Claude subagent)

Status: COMPLETE (round 23 brief from the main BeachDefense session). Method: web research only (WebSearch/WebFetch);
nothing downloaded, installed or run; no project code read or changed; PDF decks read as text via the r.jina.ai proxy.
Builds on research-r12-breaking-waves.md (physics; GPU frame ~1.1 ms of a ~2 ms budget on the RTX 5070 Ti;
SwiftShader tier) and research-r13-links.md (adopt list: #1 stateless foam-sprite cover on the bore front, #2 soft
contact fade from a depth texture, #3 analytic foam trail, #4 thickness/height colour ramp); referenced, not repeated.
Labels: H/M/L = priority. "Inference" = my reasoning, not stated by a source. UNVERIFIED = rests only on a search
snippet, vendor marketing, a self-reported article or a forum post. [key] = entry under Sources.
Assumed architecture (from the brief): analytic deterministic sea; vertex-displaced surface with analytic fragment
foam; separate lip "curtain" mesh; 1-2k camera-facing procedural sprites (newest without textures), additive or
alpha blended, depth-tested, no depth write; three.js 0.186 WebGLRenderer on WebGL2.

## Ranked shortlist (try in this order)
1. **Pixel-footprint LOD on every spray sprite (H).** Clamp each sprite's thin axis to >= 1.5 px with alpha x
   (true/drawn area); fade interior streaks, drops and sheet texture to their mean once a feature is < ~2 px
   (fwidth). Aims straight at the distant twinkle; a few ALU ops. (§1.2-1.3)
2. **Bounded, order-free blending on the bore splash line (H).** MaxEquation for the white sheets, or additive
   density into a HalfFloat target composited as white*(1-exp(-k*d)). Removes pile-up, order and 8-bit
   quantization flicker; applies to r13 #1's sprite cover. (§1.4)
3. **Diagnose, then time it (H, cheap).** The 5-step twinkle ladder (§0), and EXT_disjoint_timer_query_webgl2
   around the sprite draw with a uniform capping loop counts (§5.1). Picks among 1, 2, 4, 5 and prices the loops.
4. **Bake the procedural sprite shapes into a mipmapped atlas at load (H/M).** One render-to-texture plus
   generateMipmaps: free band-limiting, one fetch instead of per-fragment loops, same deterministic look. (§1.3, §5.2)
5. **Velocity-stretched drops and jets (M/H).** Quad stretched along screen velocity by ~1 frame, alpha scaled by
   area: free motion blur, no strobing of fast small spray. (§1.5)
6. **Flicker-free foam (H).** Cells anchored to the moving water, fixed halftone thresholds, a foam amount that
   only decays (each bubble pops once), three erosion stages, 0.2-10 s life, mean coverage at distance. Extends
   r13 #3. (§2)
7. **Lip and crest translucency (H for look).** Per-channel Beer-Lambert on the analytic thickness plus a
   sun-behind lobe (DICE/Atlas); per-sprite Henyey-Greenstein glow on backlit spray. Extends r13 #4. (§3)
8. **Specular AA for sun glints (M/H, cheap).** three.js's geometryRoughness line in the custom water shader,
   sub-pixel ripple slope variance moved into roughness, specular clamp before tone mapping. (§4)
9. **Analytic shallow-water look (M).** Refraction to the analytic seabed, art-scaled absorption, analytic sky
   reflection, footprint-faded analytic caustics, Snell's window when swimming. (§3-4)
Not now (L): WebGPURenderer for TRAA, OIT, compute particles: every ShaderMaterial would need a TSL rewrite,
EffectComposer is unsupported, and none of the fixes above needs it. (§5.3)

## 0. Twinkle diagnostic ladder (inference)
Each step isolates one cause; keep the change that removes the twinkle.
a. Freeze sea time, orbit the camera slowly: twinkle stays = spatial aliasing; vanishes = temporal (motion).
b. Constant-alpha soft discs instead of sprite interiors: gone = interior-pattern aliasing (fix 1 or 4).
c. Sprites clamped to >= 2 px per axis, alpha x area ratio: gone = sub-pixel coverage aliasing (fix 1).
d. Bore-line sprites on MaxEquation: gone = pile-up, saturation or order (fix 2).
e. Sprite pass into a HalfFloat target, then composite: gone = 8-bit blending quantization (fix 2).
Note: alpha blending of one colour is order-independent (c*(1-Prod(1-a_i)) + bg*Prod(1-a_i)), as is clamped
additive; sort pops matter only where overlapping sprites differ in colour.

## 1. Temporally stable splash and spray
### 1.1 How others draw the white-water line
- Horizon Forbidden West (SIGGRAPH 2022): breakers from artist curves plus one baked deformation texture played by
  a compute shader; per-vertex foam popped on the wave's front face because triangle density limited it [hfw].
  Lesson: keep foam per-pixel, as BeachDefense does.
- Sea of Thieves (SIGGRAPH 2018): foam in a separate buffer blurred with feedback [sot]. Moana (2017, film):
  profile curves with time offsets, whitewater emitted from the peak with deformer velocity, Voronoi detail,
  instanced crash variants [moana].
- Custom C++ coastal renderer (80.lv, one developer): up to 300K GPU foam particles splatted into a screen density
  map, then shaded; ~250-300 FPS on an RTX 4090 laptop (self-reported, UNVERIFIED) [80lv]. Closest public
  precedent for shortlist item 2.
- TLOU2 (GDC 2021): beach curl wave, projected foam, wet sand; slides not readable [tlou2]. Nothing technical
  found for Assassin's Creed III/IV (IV press only, UNVERIFIED), Ghost of Tsushima, Uncharted, AoM Retold.
- Inference: AAA engines run TAA, which averages residual spray sparkle over frames. A three.js WebGL2 forward
  renderer has none, so the sprites themselves must be band-limited (items 1, 4, 5).

### 1.2 Coverage clamp for sub-pixel sprites (H)
- What: never draw a sprite, or a sheet's thin axis, under ~1 px; lower alpha in proportion. Humus phone-wire AA
  (half-pixel wire drawn 1 px wide at half alpha) [geeks3d]; Unity VFX Subpixel AA block enlarges ScaleX/ScaleY
  to at least one pixel and compensates alpha [unity-saa]; Unity minParticleSize [unity-min];
  Niagara pixel_coverage_mode scales A, RGB or RGBA by coverage [niagara].
- Cost ~10 ALU per vertex. Map: sprite vertex shader, per axis sizePx = worldSize * projectionMatrix[1][1] *
  viewportHeight / (2 * clip.w); drawPx = max(sizePx, 1.5); alpha *= area(sizePx) / area(drawPx) as a flat
  varying. Why H: engines ship exactly this for exactly this artefact.

### 1.3 Band-limited procedural interiors (H)
- What: procedural patterns have no mipmaps; measure the footprint with fwidth(uv) and blend each feature to its
  average once it is < ~1-2 px [iq-filter], [iq-band]. The existing fwidth edge AA softens only the silhouette,
  not interior streaks and drops (inference from the brief).
- Cost: one fwidth + smoothstep per layer; loops can exit early when the footprint is large, cutting cost where
  the distant line has most overdraw. Map: w = fwidth(uv) * featureFreq;
  v = mix(pattern, patternMean, smoothstep(0.5, 1.0, w)). The baked atlas (item 4) does the same for less.

### 1.4 Bounded or commutative blending for the bore line (H)
- MAX: GL MIN/MAX ignore blend factors [khr-blendeq]; three.js CustomBlending + MaxEquation [three-mat];
  premultiply colour by alpha. Each pixel keeps the brightest sprite: no build-up, order or saturation flips;
  cost none. Acts like a "Lighten" layer (over cyan water a faint white sprite lifts red first): right for white
  water, wrong for coloured spray (inference).
- Density accumulation (inference, supported by [80lv], [gg3-23], [nv-upsample]): draw the line's sprites as
  additive density into a HalfFloat target (half resolution possible), then composite once with
  scene = mix(scene, white, 1 - exp(-k * density)). Order-free, never clips, smooth with sprite count. Cost: one
  target and one full-screen pass; sprites depth-test against the scene depth texture in the shader (r13 #2 needs
  that texture anyway). NVIDIA's sample uses FP16 to cut quantization artefacts, worst under camera motion [nv-upsample].
  EXT_float_blend gates only 32-bit float blending [khr-floatblend], so RGBA16F blending works wherever it is
  renderable (EXT_color_buffer_float/half_float; inference from the spec scope).
- Weighted blended OIT avoids the popping that discrete changes in surface order cause [wboit];
  three.js OITPassNode is WebGPURenderer-only [three-oit]; in WebGL2 it needs two targets plus a composite, more
  than a white-only effect needs (inference). L.

### 1.5 Velocity stretch and sprite life (M/H)
- What: align the quad with screen-space velocity and stretch it (Unity Stretched Billboard: Camera Scale,
  Velocity Scale, Length Scale) [unity-stretch], [unity-len]. Cost: vertex shader only. Map: project p(t) and
  p(t - dt), dt ~ one frame, build the quad along the difference, alpha *= original / stretched area.
- Life without pops (inference): fade in/out over >= 0.1-0.2 s at life start, end and every LOD change; per-sprite
  randoms from a stable id hash, never from frame number or pool slot order; change counts only through fades.

### 1.6 Temporal and coverage alternatives (L/M)
- TAA (Karis 2014: reprojection + neighbourhood clamp) [karis]. three.js TAARenderPass does no reprojection (the
  docs say it is not TRAA) and only accumulates while the view is static [three-taa]; TRAANode needs depth +
  velocity, MSAA off, WebGPURenderer [three-traa]; blended sprites write no velocity and ghost unless masked (UE
  responsive-AA mask for particles, UNVERIFIED). L.
- Hashed alpha (Wyman 2017; three.js alphaHash) [hashed], [three-ahash]: stable but grainy without TAA. L.
- Alpha-to-coverage (material.alphaToCoverage, needs antialias: true) [three-mat]: 4x MSAA gives ~5 levels, a
  per-pixel screen-door sort; sharpen with (a - cutoff) / max(fwidth(a), 1e-4) + 0.5 (exact form UNVERIFIED)
  [dolphin], [unity-a2c]. M for opaque-looking foam blobs only; bands on soft mist.
- Low-resolution particle buffers are a speed tool: their edges shimmer and pop [gg3-23] (§5.2).

## 2. Foam on faces and bores
- **Lagrangian anchoring (H, inference).** Evaluate foam cells in the water's own coordinates (for the bore: x
  minus the integrated front travel, which is analytic), not world xz, so bubbles ride with the water instead of
  swimming. Cost none. Map: surface fragment shader, same front position the bore already uses.
- **Fixed thresholds + monotonic decay (H).** Halftone foam: a precomputed dither array is the per-pixel
  threshold, so bubbles pop randomly but in clumps (Yingst, Alford, Parberry 2011) [seafoam]. If foamAmount(age)
  only decreases and each anchored cell keeps its threshold, every bubble switches off exactly once: no flicker
  (inference). Cost one compare. Map: age = t - tFrontPassed (r13 #3).
- **Three erosion stages (H/M).** Boat Attack picks dense, medium or sparse foam channels through a ramp:
  foamBlend = ramp(foamBlendMask, 0.66); foamMask = saturate(length(foamMap * foamBlend) * 1.5 - 0.1); masks from
  wave height, depth edge and FX [boatattack]. Use cellular noise at three thresholds instead of the texture.
- **Decay timescale (M).** Whitecap foam decays in 0.2-10.4 s, longer for larger patches (field data, Callaghan
  2012) [callaghan]: scale the trail lifetime with breaker height.
- **Mean coverage at distance (H).** As 1.3: under ~2 px per cell, replace binary bubbles by foamAmount x area
  fraction [iq-band]. Stops distant foam shimmer; one fwidth.
- **Flow-mapped detail (M).** Two texture phases half a period apart, cross-faded, hide an advected pattern's reset
  (Vlachos 2010; Grimes 2011) [vlachos], [grimes], [catlike]. Only where flow varies in space (backwash, rips).
- **Face streaks (M, inference).** Anisotropic noise stretched along the face's fall line (analytic gradient) as the
  lip throws; Moana used Voronoi detail [moana]. Sea of Thieves' stateful feedback buffer [sot] only if analytic
  foam proves insufficient (L).

## 3. Light through thin water
- **Beer-Lambert through lip and crest (H).** T = exp(-sigma * t) per channel, t = analytic thickness along the
  view ray (or thickness / |dot(N,V)|). Pure water, Pope & Fry 1997 in 1/m: 0.0044 @418 nm, 0.0092 @450, 0.057
  @550, 0.22 @600, 0.34 @650, 0.62 @700 [popefry], [popefry-dat]. A 0.3 m lip keeps ~90% of red, so the physical
  tint is faint; for AoM cyan scale sigma up by art (inference). UE Single Layer Water exposes per-channel
  absorption, scattering and a phase G [ue-slw]. Cost: one exp per channel. Map: curtain mesh (thickness as a
  vertex attribute) and the crest band of the surface (height above trough); multiplies r13 #4's ramp.
- **Sun-behind lobe (H).** DICE (Barre-Brisebois & Bouchard 2011):
  I = att * (pow(sat(dot(V, -normalize(L + N*d))), p) * s + amb) * thickness [zucconi].
  Atlas-derived (Acerola shader, MIT): k1 = peak * H * pow(sat(dot(L,-V)), 4) * pow(0.5 - 0.5*dot(L,N), 3);
  k2 = s * pow(sat(dot(V,N)), 2); k3 = shadow * NdotL; k4 = bubbleDensity; out = (1-F) * scatter + spec + F * env,
  then mix to foam [acerola]; H = wave height, so crests glow most. Crest art controls: SSS Tint, Intensity Base,
  Intensity Sun, Sun Falloff [crest]; Sea of Thieves blends deep/sub-surface colour by view, sun and wave-peak
  mask [sot]. Cost ~15-25 ALU per fragment. Map: surface fragment shader (crest band) and curtain shader.
- **Forward scatter on spray (M/H, inference).** Droplets scatter mostly forward: a Henyey-Greenstein phase with
  g ~0.5-0.8 and cos(theta) = dot(V, -L) makes backlit spray glow (UE exposes the same phase G [ue-slw]).
  Evaluate per sprite in the vertex shader, pass a flat varying: no fragment cost.
- **Snell's window when swimming (M).** From below the sky shows in a cone of about 96-97 degrees; outside it the
  surface is dark or shows a total-internal-reflection image of the water [snell]. GLSL refract() returns zero
  beyond the critical angle (asin(1/1.33) = 48.6 degrees): switch to the underwater colour there. Cost: a branch
  on an existing refract. Map: surface fragment shader with the camera underwater.

## 4. Shallow tropical surface shading
- **Refraction to the analytic seabed (M/H, inference).** Refract the view ray, intersect the seabed (plane, or 2-3
  secant steps on the beach profile), shade the sand at the hit; Evan Wallace's WebGL Water ray-traces refraction
  against a known pool this way [wallace-demo]. Boat Attack instead offsets the opaque texture's screen UV by
  viewNormal.xz * saturate(depth * 0.005), sampled at LOD depth * 0.25 [boatattack]; three.js transmission
  needs an extra scene pass [drei-mtm]. Cost ~20-40 ALU, no extra pass; needs the sand colour evaluable in the
  water shader (world-xz texture or procedural).
- **Absorption and scatter ramp (H for look, cheap).** Boat Attack: ramp at (depth, 0) for absorption and
  (depth, 0.375) for scatter, depth x 1/MaxDepth; composite = lerp(lerp(refraction, reflection, fresnel) + sss +
  spec, foam, foamMask) [boatattack]. Map: d = refracted path in water; colour = sand * exp(-sigma * d) +
  scatterColour * (1 - exp(-sigma_s * d)); an art 1D ramp (pale turquoise, cyan, deep blue) suits the AoM look.
- **Caustics on the sand (M).** Dalmau 2003: from each floor point take the vertical ray and the surface normal
  above, refract, index a mipmapped caustic texture with the refracted direction, attenuate by depth (flat floor)
  [dalmau]. Wallace: brightness = original / refracted area from dFdx/dFdy on a light-space mesh, planar water
  only [wallace-caustics]. three.js webgpu_caustics: refract() in a shadow node with RGB offsets
  [three-caustics]; also [heckel]. Analytic variant (inference, small-slope optics): a vertical ray moves by
  k * d * grad(h), k = 1 - 1/n ~ 0.25, d = depth, so brightness ~ 1 / |det(I + k * d * Hessian(h))| (crests
  focus); the swell's Hessian is analytic; clamp to ~3-5 and fade to 1 below a ~2 px pattern. Cost: Dalmau ~1
  fetch + 10 ALU, analytic ~30 ALU. Map: sand fragment shader evaluating the wave function at its xz.
- **Glints without sparkle (M/H, cheap).** three.js physical: dxy = max(abs(dFdx(n)), abs(dFdy(n)));
  geometryRoughness = max(max(dxy.x, dxy.y), dxy.z); roughness = min(max(r, 0.0525) + geometryRoughness, 1.0)
  (r186; dev now 0.045) [three-lpf]; a custom ShaderMaterial lacks it, so copy it. Valve 2015 variant
  pow(saturate(max(dot(dNdx,dNdx), dot(dNdy,dNdy))), 0.333) (forum user saw little gain, UNVERIFIED)
  [three-gsaa]. Kaplanyan 2016 / Tokuyoshi-Kaplanyan 2021 filter the NDF in slope space; quad derivatives are
  unstable at grazing angles [kaplanyan16], [tokuyoshi21]; Toksvig for averaged normals [toksvig], [selfshadow].
  Bruneton 2010: move sub-pixel waves' slope variance from the normal into the BRDF [bruneton]; map: drop ripple
  components under ~2 px of footprint from the normal, add a^2 k^2 / 2 per sine to roughness^2 (inference).
  Clamp specular before tone mapping; tone mapping before the MSAA resolve reduces sparkle (forum, UNVERIFIED)
  [three-gsaa]; post-processing drops MSAA unless the render target sets samples (inference, three.js API).
- **Reflection (M).** reflect(V, N) into the same analytic sky as the skydome, Schlick Fresnel F0 0.02, no planar
  or screen-space pass; damp it near shore so the cyan dominates (art).

## 5. Performance: WebGL2 now, WebGPU later
### 5.1 Measure first (H)
- EXT_disjoint_timer_query_webgl2: beginQuery(TIME_ELAPSED_EXT)/endQuery around one draw; poll
  QUERY_RESULT_AVAILABLE frames later; drop results when GPU_DISJOINT_EXT is set; one active query at a time
  [khr-timer], [mdn-timer]. Exposed on ~60% of browsers (survey, UNVERIFIED) [w3dsurvey].
- three.js: Object3D.onBeforeRender/onAfterRender bracket one object's draw; time sprites, curtain and surface on
  alternate frames (inference). stats-gl wraps the same extension [statsgl]; WebGLTimestampQueryPool serves
  WebGPURenderer's WebGL backend [three-tqp]. PlayCanvas says WebGL2 gives only frame totals, which conflicts
  with the spec (UNVERIFIED) [pc-ministats].
- Loop cost: a uniform caps each loop at 1, N/2 or N; compare the timed sprite draw from a fixed camera.

### 5.2 Fill-rate levers (expected-gain order; inference unless cited)
- Per-sprite work in the vertex shader as flat varyings (fragment shaders run far more often) [mdn-bp].
- Tight quads: Persson's particle trimming fits a 4-8 vertex hull to the alpha, past 8 it does not pay
  [persson-tool], [persson-gems]; Niagara cutouts likewise [ue-cutout]. For procedural shapes size the quad from
  analytic extents (streak length, sheet aspect).
- Constant-bounded loops exiting early by footprint (1.3), or one atlas fetch (item 4).
- Reduced-resolution sprite pass with depth-aware upsampling, only if the timer shows it is fill-bound. GPU Gems 3
  ch.23 (8800 GTX, 1600x1200, 73-instruction shader): 25 FPS full res; low res 46 (2x2) / 61 (4x4); mixed 44 / 51;
  with 9 instructions 44 / 50 / 57 (full / mixed / low) [gg3-23]. NVIDIA's sample: cross-bilateral upsampling,
  FP16 [nv-upsample].
- Canvas: smaller backbuffer and upscale; non-integer devicePixelRatio causes moire; invalidate unread attachments [mdn-bp].

### 5.3 What WebGPU would add (L for now)
- Adds (three.js WebGPU examples): compute particles (rain, snow, fluid), bitonic sort, indirect draw, OIT, TRAA,
  TAAU, soft particles, caustics, ocean/water [three-ex]; softParticles({opacity, distance, contrast}) is r13 #2
  as a helper [three-soft]; per-pass timestamps via trackTimestamp + resolveTimestampsAsync [three-ts-forum].
- Costs: WebGPURenderer does not support ShaderMaterial, RawShaderMaterial or onBeforeCompile (every shader becomes
  a TSL node material); EffectComposer unsupported; forceWebGL runs the same code on WebGL2 [three-wgpu].
- Support (caniuse, 25 Oct 2026): Chrome/Edge 113+, Safari 26+ (listed partial), iOS Safari 26+, Chrome Android;
  Firefox listed off by default (not cross-checked); ~88% of global usage [caniuse-webgpu].
- Verdict: none of the twinkle fixes needs WebGPU; revisit only if a TSL rewrite happens for other reasons.

## Sources (read 25 Oct 2026 unless marked)
[geeks3d]: https://geeks3d.com/?p=8334
[unity-saa]: https://docs.unity3d.com/Packages/com.unity.visualeffectgraph@12.1/manual/Block-SubpixelAntiAliasing.html
[unity-min]: https://docs.unity3d.com/ScriptReference/ParticleSystemRenderer-minParticleSize.html
[niagara]: https://dev.epicgames.com/documentation/en-us/unreal-engine/python-api/class/NiagaraSpriteRendererProperties
[iq-filter]: https://iquilezles.org/articles/filtering
[iq-band]: https://iquilezles.org/articles/bandlimiting/
[khr-blendeq]: https://registry.khronos.org/OpenGL-Refpages/gl4/html/glBlendEquation.xhtml
[three-mat]: https://threejs.org/docs/pages/Material.html
[khr-floatblend]: https://registry.khronos.org/webgl/extensions/EXT_float_blend/
[nv-upsample]: https://archive.docs.nvidia.com/gameworks/content/gameworkslibrary/graphicssamples/opengl_samples/particleupsamplingsample.htm
[80lv]: https://80.lv/articles/real-time-shoreline-simulation-in-custom-c-coastal-renderer
[wboit]: https://www.jcgt.org/published/0002/02/09/paper.pdf
[three-oit]: https://threejs.org/docs/pages/OITPassNode.html
[unity-stretch]: https://docs.unity3d.com/2023.2/Documentation/Manual/PartSysRendererModule.html
[unity-len]: https://docs.unity3d.com/ScriptReference/ParticleSystemRenderer-lengthScale.html
[karis]: https://advances.realtimerendering.com/s2014/
[three-taa]: https://threejs.org/docs/pages/TAARenderPass.html
[three-traa]: https://threejs.org/docs/pages/TRAANode.html
[hashed]: https://research.nvidia.com/labs/rtr/publication/wyman2017hashed
[three-ahash]: https://discourse.threejs.org/t/alpha-test-vs-alpha-hash/44493
[dolphin]: https://bugs.dolphin-emu.org/issues/11626
[unity-a2c]: https://docs.unity3d.com/Manual/writing-shader-alpha-to-mask.html
[gg3-23]: https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-23-high-speed-screen-particles
[hfw]: https://advances.realtimerendering.com/s2022/SIGGRAPH2022-Advances-Water-Malan.pdf
[sot]: https://history.siggraph.org/wp-content/uploads/2022/09/2018-Talks-Ang_The-Technical-Art-of-Sea-of-Thieves.pdf
[moana]: https://history.siggraph.org/wp-content/uploads/2022/09/2017-Talks-Byun_Moana-Crashing-Waves.pdf
[tlou2]: https://gdcvault.com/play/1027072/Creative-and-Experimental-VFX-in
[seafoam]: https://ianparberry.com/research/seafoam/
[boatattack]: https://raw.githubusercontent.com/Verasl/BoatAttack/master/Packages/com.verasl.water-system/Shaders/WaterCommon.hlsl
[callaghan]: https://data-ww3.ifremer.fr/BIB/Callaghan_etal_JGR2012.pdf
[vlachos]: https://www.advances.realtimerendering.com/s2010/Vlachos-Waterflow(SIGGRAPH%202010%20Advanced%20RealTime%20Rendering%20Course).pdf
[grimes]: https://www.hlportal.de/files/GDC2011_BronwenGrimes_NonstandardTextures.pdf
[catlike]: https://catlikecoding.com/unity/tutorials/flow/texture-distortion/
[popefry]: https://omlc.org/spectra/water/abs/pope97.html
[popefry-dat]: https://omlc.org/spectra/water/data/pope97.dat (table in 1/cm; converted above)
[ue-slw]: https://dev.epicgames.com/documentation/en-us/unreal-engine/single-layer-water-shading-model-in-unreal-engine
[zucconi]: https://www.alanzucconi.com/2017/08/30/fast-subsurface-scattering-2/
[acerola]: https://github.com/GarrettGunnell/Water (Assets/Shaders/FFTWater.shader; cites the Atlas GDC 2019 deck,
  https://gpuopen.com/gdc-presentations/2019/gdc-2019-agtd6-interactive-water-simulation-in-atlas.pdf, too large to read)
[crest]: https://crest.readthedocs.io/en/stable/user/water-appearance.html
[snell]: https://en.wikipedia.org/wiki/Snell%27s_window
[wallace-demo]: https://madebyevan.com/webgl-water/
[wallace-caustics]: https://medium.com/@evanwallace/rendering-realtime-caustics-in-webgl-2a99a29a0b2c
[drei-mtm]: https://drei.docs.pmnd.rs/shaders/mesh-transmission-material
[dalmau]: https://www.gamedeveloper.com/programming/inexpensive-underwater-caustics-using-cg
[three-caustics]: https://github.com/mrdoob/three.js/blob/dev/examples/webgpu_caustics.html
[heckel]: https://blog.maximeheckel.com/posts/caustics-in-webgl
[three-lpf]: https://raw.githubusercontent.com/mrdoob/three.js/r186/src/renderers/shaders/ShaderChunk/lights_physical_fragment.glsl.js (dev also read)
[three-gsaa]: https://discourse.threejs.org/t/having-geometric-specular-antialiasing-would-be-incredible/74816
[kaplanyan16]: https://developer.download.nvidia.com/gameworks/events/GDC2016/akaplanyan_specular_aa.pdf
[tokuyoshi21]: https://www.jcgt.org/published/0010/02/02/paper-lowres.pdf
[toksvig]: https://developer.download.nvidia.cn/whitepapers/2006/Mipmapping_Normal_Maps.pdf
[selfshadow]: https://blog.selfshadow.com/page/13
[bruneton]: https://artis.inrialpes.fr/Publications/2010/BNH10/index.php
[khr-timer]: https://registry.khronos.org/webgl/extensions/EXT_disjoint_timer_query_webgl2/
[mdn-timer]: https://developer.mozilla.org/en-US/docs/Web/API/EXT_disjoint_timer_query
[w3dsurvey]: https://web3dsurvey.com/webgl2/extensions/EXT_disjoint_timer_query_webgl2
[statsgl]: https://npmjs.com/package/stats-gl
[three-tqp]: https://threejs.org/docs/pages/WebGLTimestampQueryPool.html
[pc-ministats]: https://developer.playcanvas.com/user-manual/optimization/mini-stats/
[mdn-bp]: https://developer.mozilla.org/en-US/docs/Web/API/WebGL_API/WebGL_best_practices
[persson-tool]: https://humus.name/index.php?page=Cool
[persson-gems]: https://www.humus.name/Articles/Persson_GraphicsGemsForGames.pdf
[ue-cutout]: https://docs.unrealengine.com/4.27/en-US/API/Plugins/Niagara/UNiagaraSpriteRendererProperties/BoundingMode/index.html
[three-ex]: https://github.com/mrdoob/three.js/blob/dev/examples/files.json
[three-soft]: https://github.com/mrdoob/three.js/blob/dev/examples/webgpu_particles_soft.html
[three-ts-forum]: https://discourse.threejs.org/t/r173-resolve-timestamps-error-message/77370
[three-wgpu]: https://threejs.org/manual/en/webgpurenderer
[caniuse-webgpu]: https://caniuse.com/webgpu
Not read or nothing usable (worth a later browser read): Ben Golus on alpha-to-coverage (403)
https://bgolus.medium.com/anti-aliased-alpha-test-the-esoteric-alpha-to-coverage-8b177335ae4f ; Chermain et al. 2021
glint AA https://publis.icube.unistra.fr/docs/15022/Chermain2021RealTime.pdf ; Uncharted water GDC 2012
https://www.slideshare.net/slideshow/water-technologyofunchartedgdc2012/12977478 ; AC III (login-gated)
https://gdcvault.com/play/1017710/Rendering-Assassin-s-Creed ; three.js forum caustics demo
https://discourse.threejs.org/t/3d-water-caustics-rendering/18232
