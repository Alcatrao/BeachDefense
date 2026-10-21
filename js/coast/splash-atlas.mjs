import * as T from 'three';
// Original impact crown: layered wet white lobes, radial fingers and separated
// droplets. Generated once; no source-game art, screenshots or converted assets.
let cached;
export function splashAtlas(){if(cached)return cached;const tile=96,w=tile*4,h=tile*3,data=new Uint8Array(w*h*4),lobes=[];
 for(let j=0;j<35;j++){const a=.18+j/34*(Math.PI-.36),s=.6+.23*Math.sin(j*2.71);lobes.push([Math.cos(a)*s,Math.sin(a)*s,.045+.028*(.5+.5*Math.sin(j*4.11))]);}
 for(let f=0;f<12;f++){const t=.06+f/11*.94,ox=f%4*tile,oy=Math.floor(f/4)*tile;for(let y=0;y<tile;y++)for(let x=0;x<tile;x++){const u=(x+.5)/tile*2-1,v=(y+.5)/tile*1.8-.25;let a=0;
  for(let j=0;j<lobes.length;j++){const q=lobes[j],cx=q[0]*(.18+t*.9),cy=q[1]*t*2.0-.80*t*t,r=q[2]*(.8+t*.65),dx=(u-cx)/r,dy=(v-cy)/(r*1.5);a=Math.max(a,Math.exp(-(dx*dx+dy*dy)*.65));if(j%2===0&&t<.7){const k=Math.max(0,Math.min(1,(u*cx+v*cy)/(cx*cx+cy*cy+.001))),rx=u-k*cx,ry=v-k*cy;a=Math.max(a,Math.exp(-(rx*rx+ry*ry)/(r*r*.55))*(1-t*.8)*k);}}
  const cloud=Math.exp(-(u*u/(.06+t*.27)+(v-.11)* (v-.11)/(.018+t*.025)))*Math.max(0,1-t*.9);a=Math.min(1,Math.max(a,cloud));const i=((oy+y)*w+ox+x)*4;data[i]=247;data[i+1]=253;data[i+2]=255;data[i+3]=Math.round(a*255);}}
 cached=new T.DataTexture(data,w,h,T.RGBAFormat);cached.magFilter=T.LinearFilter;cached.minFilter=T.LinearMipmapLinearFilter;cached.generateMipmaps=true;cached.needsUpdate=true;return cached;}
