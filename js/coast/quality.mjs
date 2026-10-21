export function waterTier(renderer){
 const gl=renderer.getContext(),debug=gl.getExtension('WEBGL_debug_renderer_info');
 const name=debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER);
 const force=new URLSearchParams(location.search).get('soft');
 const software=force==='1'||(force!=='0'&&/SwiftShader|llvmpipe|Software/i.test(name));
 const tier={name:software?'software':'hardware',renderer:name,pixelRatio:software?.5:Math.min(devicePixelRatio,1),columns:software?20:48,farX:software?20:48,farZ:software?20:48,particles:software?128:640,anisotropy:1};
 renderer.setPixelRatio(tier.pixelRatio);return tier;
}
