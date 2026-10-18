import * as T from 'three';

// No render targets, reflection cameras or wave-shape displacement. The liquid
// solver supplies the overhang, swash and advected foam; this shades that skin.
export function createWaterMaterial(){
 return new T.ShaderMaterial({side:T.DoubleSide,
  uniforms:{cut:{value:-645},cutEnd:{value:645},time:{value:0}},
  vertexShader:`
   attribute float foam;
   varying vec3 P,N;
   varying float F,depth;
   varying vec2 U;
   float shoreline(float x){
    float n=(x+1245.)/1290.;
    float s=sin(n*3.14159265)*60.+sin(n*6.2831853)*20.+50.;
    if(n>=.6&&n<=1.){float t=(n-.6)/.4;s+=t*t*(3.-2.*t)*sin(t*3.14159265)*100.;}
    return -s;
   }
   void main(){
    P=(modelMatrix*vec4(position,1.)).xyz;N=normal;F=foam;
    U=vec2(P.x,P.z-shoreline(P.x))/6.;
    float bed=U.y<0.?-U.y*.18:-min(3.,min(.6,U.y*.15)+max(0.,U.y-10.)*.65);
    depth=max(0.,P.y/6.-bed);
    gl_Position=projectionMatrix*viewMatrix*vec4(P,1.);
   }`,
  fragmentShader:`
   uniform float cut,cutEnd,time;
   varying vec3 P,N;
   varying float F,depth;
   varying vec2 U;
   void main(){
    if(P.x<cut||P.x>cutEnd)discard;
    vec3 n=normalize(N),v=normalize(cameraPosition-P);
    if(dot(n,v)<0.)n=-n;
    // Small capillary detail changes reflected light, never the breaking shape.
    vec2 phase=vec2(dot(U,vec2(7.1,11.7))-time*1.4,dot(U,vec2(-13.3,5.7))+time*1.1);
    vec2 ripple=vec2(.027,.019)*cos(phase);
    n=normalize(n+vec3(ripple.x,0.,ripple.y)*n.y*n.y*(1.-clamp(F,0.,1.)));
    float nv=max(dot(n,v),0.);
    float fres=.0204+.9796*pow(1.-nv,5.);
    vec3 reflected=reflect(-v,n);
    vec3 sky=mix(vec3(.76,.87,.91),vec3(.27,.56,.74),smoothstep(0.,.8,reflected.y));
    // Beer-Lambert depth attenuation reveals sandy shallows and blue-green faces.
    vec3 transmission=exp(-depth*vec3(.85,.26,.16));
    vec3 water=mix(vec3(.012,.24,.33),vec3(.61,.68,.47),transmission);
    water*=.76+.24*max(n.y,0.);
    vec3 c=mix(water,sky,fres);
    vec3 sun=normalize(vec3(-.4,1.,.3));
    c+=vec3(1.,.96,.86)*pow(max(dot(reflect(-sun,n),v),0.),110.)*.9;
    // Foam coverage is driven only by solver tracers. Detail opens small holes
    // in the thinning sheet, while dense impact foam remains opaque white.
    vec2 q=U*4.1+vec2(time*.12,-time*.18);
    float cells=.5+.5*sin(q.x+sin(q.y*1.31))*sin(q.y+sin(q.x*.73));
    float coverage=smoothstep(.12,.65,F);
    float lace=smoothstep(.19,.64,cells+F*.5);
    float foam=coverage*mix(lace,1.,smoothstep(.6,1.,F));
    vec3 white=vec3(.91,.96,.96)*(.86+.14*max(n.y,0.));
    c=mix(c,white,foam);
    float haze=1.-exp(-length(cameraPosition-P)*.000055);
    gl_FragColor=vec4(mix(c,vec3(.72,.85,.90),haze),1.);
   }`
 });
}
