import * as T from 'three';
// Original ballistic crown animation, generated once. No AoM pixels or assets.
// Four-by-three frames: droplets fan outward, rise, fall and disperse.
let cached;
export function splashAtlas(){if(cached)return cached;const tile=80,cols=4,rows=3,w=tile*cols,h=tile*rows,data=new Uint8Array(w*h*4),jets=[];
 for(let j=0;j<23;j++){const a=.20+j/22*(Math.PI-.40),speed=.68+.22*Math.sin(j*2.73);jets.push({x:Math.cos(a)*speed,y:Math.sin(a)*speed,r:.024+.014*(.5+.5*Math.sin(j*4.11))});}
 for(let f=0;f<12;f++){const t=.04+f/11*.94,ox=(f%cols)*tile,oy=Math.floor(f/cols)*tile;for(let y=0;y<tile;y++)for(let x=0;x<tile;x++){const u=(x+.5)/tile*2-1,v=(y+.5)/tile*1.8-.24;let a=0;for(let j=0;j<jets.length;j++){const q=jets[j],cx=q.x*t*1.25,cy=q.y*t*2.25-1.10*t*t,r=q.r*(1+t*.65),dx=(u-cx)/r,dy=(v-cy)/(r*1.6);a=Math.max(a,Math.exp(-(dx*dx+dy*dy)*.7));if(t<.52){const k=Math.max(0,Math.min(1,(u*cx+v*cy)/(cx*cx+cy*cy+.001))),rx=u-k*cx,ry=v-k*cy;a=Math.max(a,Math.exp(-(rx*rx+ry*ry)/(r*r*.35))*(1-t/.52)*k);}}const halo=Math.exp(-(u*u/(.05+t*.3)+v*v/.016))*Math.max(0,1-t*1.3);a=Math.min(1,Math.max(a,halo));const i=((oy+y)*w+ox+x)*4;data[i]=244;data[i+1]=253;data[i+2]=255;data[i+3]=Math.round(a*255);}}
 cached=new T.DataTexture(data,w,h,T.RGBAFormat);cached.magFilter=T.LinearFilter;cached.minFilter=T.LinearMipmapLinearFilter;cached.generateMipmaps=true;cached.needsUpdate=true;return cached;
}
