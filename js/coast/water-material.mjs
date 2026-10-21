import {SEA_STATE,SWELL_K,waveNumber} from './sea-state.mjs';
import * as T from 'three';
// Original, seeded procedural noise. No game/reference image assets.
let detail;
function noiseTexture(){if(detail)return detail;const n=128,height=new Float32Array(n*n),bytes=new Uint8Array(n*n*4);let seed=0x194a731b;
 const random=()=>{seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;return (seed>>>0)/4294967296;};
 // Random spectral wavelets replace the two dominant repeating zigzag ridges.
 // Blue stores independent multiscale foam noise, not those wavelet heights.
 const waves=new Float32Array(24*4),noise=new Float32Array(32*32);for(let i=0;i<24;i++){waves[i*4]=Math.floor(random()*23)-11;waves[i*4+1]=7+Math.floor(random()*14);waves[i*4+2]=random()*6.2831853;waves[i*4+3]=.025+random()*.02;}for(let i=0;i<noise.length;i++)noise[i]=random();
 const sample=(x,y,scale)=>{const u=x/n*scale,v=y/n*scale,ix=Math.floor(u),iy=Math.floor(v),fx=u-ix,fy=v-iy,s=fx*fx*(3-2*fx),t=fy*fy*(3-2*fy),a=noise[(ix%scale)+(iy%scale)*32],b=noise[((ix+1)%scale)+(iy%scale)*32],c=noise[(ix%scale)+((iy+1)%scale)*32],d=noise[((ix+1)%scale)+((iy+1)%scale)*32];return (a+(b-a)*s)*(1-t)+(c+(d-c)*s)*t;};
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=x+y*n,u=x/n*6.2831853,v=y/n*6.2831853,warp=.9*Math.sin(2*u-3*v)+.45*Math.sin(3*u+2*v);let value=.5;for(let w=0;w<24;w++){const a=w*4;value+=Math.sin(waves[a]*u+waves[a+1]*v+waves[a+2]+warp)*waves[a+3];}height[i]=value;bytes[i*4+2]=255*(sample(x,y,8)*.55+sample(x,y,16)*.3+sample(x,y,32)*.15);}
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=x+y*n,a=i*4,dx=(height[((x+1)%n)+y*n]-height[((x+n-1)%n)+y*n])*.7,dz=(height[x+((y+1)%n)*n]-height[x+((y+n-1)%n)*n])*.7;bytes[a]=128+dx*110;bytes[a+1]=128+dz*110;bytes[a+3]=255;}
 detail=new T.DataTexture(bytes,n,n,T.RGBAFormat);detail.wrapS=detail.wrapT=T.RepeatWrapping;detail.magFilter=T.LinearFilter;detail.minFilter=T.LinearMipmapLinearFilter;detail.generateMipmaps=true;detail.anisotropy=1;detail.needsUpdate=true;return detail;
}
export function createWaterMaterial(tier={}){return new T.ShaderMaterial({side:T.DoubleSide,defines:{SOFT_WATER:tier.name==='software'?1:0},extensions:{derivatives:true},uniforms:{swell:{value:new T.Vector4(SWELL_K,2*Math.PI/SEA_STATE.period,waveNumber(10.7,3),2*Math.PI/10.7)},cut:{value:-645},cutEnd:{value:645},time:{value:0},farWaves:{value:0},profileSurface:{value:0},surfacePrevious:{value:null},surfaceCurrent:{value:null},surfaceMix:{value:1},rippleStrength:{value:tier.name==='software'?0:.60},detail:{value:noiseTexture()}},
 vertexShader:`// BEACH_WATER
 uniform vec4 swell;uniform float time,farWaves,profileSurface,surfaceMix;uniform sampler2D surfacePrevious,surfaceCurrent;attribute float foam,wetness;varying vec3 P,N;varying float F,depth,W;varying vec2 U;
 float shoreline(float x){float n=(x+1245.)/1290.;float s=sin(n*3.14159265)*60.+sin(n*6.2831853)*20.+50.;if(n>=.6&&n<=1.){float t=(n-.6)/.4;s+=t*t*(3.-2.*t)*pow(sin(t*3.14159265),2.)*100.;}return -s;}
 void main(){vec3 local=position;N=normal;F=foam;W=wetness;
 if(profileSurface>.5){vec2 uv0=vec2(uv.x,.25),uv1=vec2(uv.x,.75);vec4 a=mix(texture2D(surfacePrevious,uv0),texture2D(surfaceCurrent,uv0),surfaceMix),b=mix(texture2D(surfacePrevious,uv1),texture2D(surfaceCurrent,uv1),surfaceMix);local.y=a.x;local.z=a.y+shoreline(local.x*6.)/6.;float slope=(shoreline(local.x*6.+.5)-shoreline(local.x*6.-.5));N=normalize(vec3(-slope*a.w,a.z,a.w));F=b.x;W=b.y;}
 P=(modelMatrix*vec4(local,1.)).xyz;U=vec2(P.x,P.z-shoreline(P.x))/6.;float bed=-min(3.,(U.y<0.?U.y*.18:U.y*.06)+max(0.,U.y-6.)*.27);depth=max(0.,P.y/6.-bed);
 if(farWaves>.5){float fade=smoothstep(28.5,40.,U.y),phase=swell.x*(U.y+.06*U.x)+time*swell.y,phase2=swell.z*(U.y-.13*U.x)+time*swell.w,phase3=.30*U.y+.08*U.x+time*1.62;float group=.90+.10*cos(time*.13),w=.85*group*sin(phase)+.26*sin(phase2)+.10*sin(phase3);P.y+=w*6.*fade;float dx=.85*group*swell.x*.06*cos(phase)-.26*swell.z*.13*cos(phase2)+.008*cos(phase3),dz=.85*group*swell.x*cos(phase)+.26*swell.z*cos(phase2)+.03*cos(phase3);N=normalize(vec3(-fade*dx,1.,-fade*dz));}
 gl_Position=projectionMatrix*viewMatrix*vec4(P,1.);}`,
 fragmentShader:`// BEACH_WATER
 uniform float cut,cutEnd,time,rippleStrength;uniform sampler2D detail;varying vec3 P,N;varying float F,depth,W;varying vec2 U;
 void main(){if(P.x<cut||P.x>cutEnd||W<.12)discard;
 vec3 n=normalize(N),v=normalize(cameraPosition-P);if(dot(n,v)<0.)n=-n;
 // Incommensurate rotated scales, continuous UVs and mip-filtered detail.
 vec4 flowDetail=texture2D(detail,U*.11+vec2(time*.004,time*.025));float churn=flowDetail.b;
 #if SOFT_WATER == 1
 vec4 a=vec4(churn),b=a;
 #else
 vec2 uv=U*.67+vec2(time*.012,time*.019)+vec2(churn,-churn)*.21;vec4 a=texture2D(detail,uv),b=texture2D(detail,mat2(.731,-.682,.682,.731)*uv*1.713+vec2(.373,.819));
 if(rippleStrength>0.){vec2 wavelet=(a.rg+b.gr-1.)*rippleStrength+(flowDetail.rg-.5)*1.8;float rippleFade=1.-smoothstep(.06,.5,max(length(dFdx(uv)),length(dFdy(uv))));n=normalize(n+vec3(wavelet.x,0.,wavelet.y)*n.y*n.y*rippleFade*(1.-F*.65));}
 #endif
 float fres=.0204+.9796*pow(1.-max(dot(n,v),0.),5.);vec3 reflected=reflect(-v,n);vec3 sky=mix(vec3(.75,.91,.93),vec3(.44,.79,.85),smoothstep(0.,.8,reflected.y));
 // sRGB art targets: open100/225/235, shallow175/250/250, bar150/208/193.
 vec3 open=vec3(.392,.882,.922),shallow=vec3(.686,.980,.980),bar=vec3(.588,.816,.757);
 vec3 c=mix(shallow,open,smoothstep(.12,2.4,depth));float sandbar=exp(-pow((U.y-7.)/2.5,2.))*.30;c=mix(c,bar,sandbar);c*=.78+.22*max(n.y,0.);c=mix(c,sky,fres*.82);float translucency=pow(max(dot(-v,normalize(vec3(-.32,.75,.57))),0.),3.)*(1.-abs(n.y))*(1.-smoothstep(0.,2.6,depth));c+=vec3(.025,.12,.10)*translucency;
 vec3 sun=normalize(vec3(-.32,.75,.57));float spec=max(dot(reflect(-sun,n),v),0.);
 #if SOFT_WATER == 1
 // Turbulent water has a wider, dimmer lobe: small physical folds should not
 // turn into beach-long white mirrors. Reuse the existing flow-noise lookup.
 float rough=smoothstep(.12,.7,F);c+=vec3(1.)*pow(spec,18.)*(.20+.18*churn)*(1.-rough*.65);
 #else
 float rough=smoothstep(.12,.7,F),glarePatch=.35+.65*churn;
 c+=vec3(1.)*(pow(spec,12.)*.30+pow(spec,80.)*.26*(1.-rough))*glarePatch*(1.-rough*.65);
 #endif
 // Break up the boundary of whitewater alongshore, not just its interior.
 // All coverage still comes from the physical foam tracers; no timed crest mask.
 float turbulence=mix(a.b,b.b,.47)*.6+churn*.4;float coverage=smoothstep(.10,.64,F*(.22+turbulence*1.45));float lace=smoothstep(.34,.73,turbulence+F*.10);float f=coverage*mix(lace,1.,smoothstep(.82,1.,F)*.28);vec3 white=vec3(.97,1.,1.)*(.96+.04*max(n.y,0.));c=mix(c,white,f);
 float haze=1.-exp(-length(cameraPosition-P)*.000055);gl_FragColor=vec4(mix(c,vec3(.78,.89,.91),haze),1.);}`});}
