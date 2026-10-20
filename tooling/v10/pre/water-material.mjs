import * as T from 'three';
// Original, seeded procedural noise. No game/reference image assets.
let detail;
function noiseTexture(){if(detail)return detail;const n=128,height=new Float32Array(n*n),bytes=new Uint8Array(n*n*4);let seed=0x194a731b;for(let i=0;i<height.length;i++){seed^=seed<<13;seed^=seed>>>17;seed^=seed<<5;const u=(i%n)/n*6.2831853,v=Math.floor(i/n)/n*6.2831853;const warp=.9*Math.sin(2*u-3*v)+.45*Math.sin(3*u+2*v);height[i]=.5+.22*Math.sin(11*u+5*v+warp)+.12*Math.sin(7*u-13*v+.7*Math.sin(u+v))+.05*((seed>>>0)/4294967295-.5);}
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){const i=x+y*n,a=i*4,dx=(height[((x+1)%n)+y*n]-height[((x+n-1)%n)+y*n])*.7,dz=(height[x+((y+1)%n)*n]-height[x+((y+n-1)%n)*n])*.7;bytes[a]=128+dx*110;bytes[a+1]=128+dz*110;bytes[a+2]=Math.max(0,Math.min(255,height[i]*255));bytes[a+3]=255;}
 detail=new T.DataTexture(bytes,n,n,T.RGBAFormat);detail.wrapS=detail.wrapT=T.RepeatWrapping;detail.magFilter=T.LinearFilter;detail.minFilter=T.LinearMipmapLinearFilter;detail.generateMipmaps=true;detail.anisotropy=1;detail.needsUpdate=true;return detail;
}
export function createWaterMaterial(tier={}){return new T.ShaderMaterial({side:T.DoubleSide,extensions:{derivatives:true},uniforms:{cut:{value:-645},cutEnd:{value:645},time:{value:0},farWaves:{value:0},rippleStrength:{value:tier.name==='software'?0:.60},detail:{value:noiseTexture()}},
 vertexShader:`// BEACH_WATER
 uniform float time,farWaves;attribute float foam,wetness;varying vec3 P,N;varying float F,depth,W;varying vec2 U;
 float shoreline(float x){float n=(x+1245.)/1290.;float s=sin(n*3.14159265)*60.+sin(n*6.2831853)*20.+50.;if(n>=.6&&n<=1.){float t=(n-.6)/.4;s+=t*t*(3.-2.*t)*sin(t*3.14159265)*100.;}return -s;}
 void main(){P=(modelMatrix*vec4(position,1.)).xyz;N=normal;F=foam;W=wetness;U=vec2(P.x,P.z-shoreline(P.x))/6.;float bed=U.y<0.?-U.y*.18:-min(3.,min(.6,U.y*.15)+max(0.,U.y-10.)*.65);depth=max(0.,P.y/6.-bed);
 if(farWaves>.5){float fade=smoothstep(26.5,42.,U.y),phase=.62*U.y+.10*U.x+time*1.6,phase2=.39*U.y-.17*U.x+time*1.22;float wave=.10*sin(phase)+.045*sin(phase2);P.y+=wave*6.*fade;N=normalize(vec3(-fade*(.010*cos(phase)-.00765*cos(phase2)),1.,-fade*(.062*cos(phase)+.01755*cos(phase2))));}
 gl_Position=projectionMatrix*viewMatrix*vec4(P,1.);}`,
 fragmentShader:`// BEACH_WATER
 uniform float cut,cutEnd,time,rippleStrength;uniform sampler2D detail;varying vec3 P,N;varying float F,depth,W;varying vec2 U;
 void main(){if(P.x<cut||P.x>cutEnd||W<.12)discard;
 vec3 n=normalize(N),v=normalize(cameraPosition-P);if(dot(n,v)<0.)n=-n;
 // Incommensurate rotated scales, continuous UVs and mip-filtered detail.
 vec2 uv=U*.67+vec2(time*.012,-time*.019);vec4 a=texture2D(detail,uv),b=texture2D(detail,mat2(.731,-.682,.682,.731)*uv*1.713+vec2(.373,.819));
 if(rippleStrength>0.){vec2 wavelet=(a.rg+b.gr-1.)*rippleStrength;float rippleFade=1.-smoothstep(.06,.5,max(length(dFdx(uv)),length(dFdy(uv))));n=normalize(n+vec3(wavelet.x,0.,wavelet.y)*n.y*n.y*rippleFade*(1.-F));}
 float fres=.0204+.9796*pow(1.-max(dot(n,v),0.),5.);vec3 reflected=reflect(-v,n);vec3 sky=mix(vec3(.75,.91,.93),vec3(.44,.79,.85),smoothstep(0.,.8,reflected.y));
 // sRGB art targets: open100/225/235, shallow175/250/250, bar150/208/193.
 vec3 open=vec3(.392,.882,.922),shallow=vec3(.686,.980,.980),bar=vec3(.588,.816,.757);
 vec3 c=mix(shallow,open,smoothstep(.12,2.4,depth));float sandbar=exp(-pow((U.y-7.)/2.5,2.))*.30;c=mix(c,bar,sandbar);c*=.91+.09*max(n.y,0.);c=mix(c,sky,fres*.7);
 vec3 sun=normalize(vec3(-.32,.75,.57));float spec=max(dot(reflect(-sun,n),v),0.);c+=vec3(1.)*(pow(spec,28.)*.23+pow(spec,110.)*.35);
 float coverage=smoothstep(.10,.65,F);float churn=texture2D(detail,U*.11+vec2(time*.004,-time*.007)).b;float lace=smoothstep(.29,.70,mix(a.b,b.b,.47)*.72+churn*.28+F*.20);float f=coverage*mix(lace,1.,smoothstep(.72,1.,F)*.85);vec3 white=vec3(.97,1.,1.)*(.96+.04*max(n.y,0.));c=mix(c,white,f);
 float haze=1.-exp(-length(cameraPosition-P)*.000055);gl_FragColor=vec4(mix(c,vec3(.78,.89,.91),haze),1.);}`});}
