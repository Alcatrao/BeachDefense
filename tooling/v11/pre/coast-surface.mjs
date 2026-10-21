import * as T from 'three';
import {createWaterMaterial} from './water-material.mjs';
import {bottom} from './fluid.mjs';
import {createSectionContour} from './section-contour.mjs';
// A connected physical section is shared along the curved beach. Only its skin
// is faired; the particle state and CPU character height/flow field are unchanged.
export function createCoastSurface(scene,shore,tier={columns:48}){
 const h=.16,y0=-3.6,z0=-7.8,ny=54,nz=228,S=ny*nz,maxX=tier.columns||48;
 const base=new Float32Array(S),bf=new Float32Array(S),liquid=new Float32Array(S),scratch=new Float32Array(S),sf=new Float32Array(S),labels=new Uint8Array(S),queue=new Int32Array(S),solid=new Uint8Array(S);
 for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)solid[j+k*ny]=y0+j*h<bottom(0,z0+k*h)+.03?1:0;
 const pos=new Float32Array(300000),norm=new Float32Array(300000),foam=new Float32Array(100000),wetness=new Float32Array(100000),indices=new Uint32Array(600000),geo=new T.BufferGeometry();
 for(const[name,array,size]of[['position',pos,3],['normal',norm,3],['foam',foam,1],['wetness',wetness,1]])geo.setAttribute(name,new T.BufferAttribute(array,size).setUsage(T.DynamicDrawUsage));geo.setIndex(new T.BufferAttribute(indices,1).setUsage(T.DynamicDrawUsage));const attributes=Object.values(geo.attributes);
 const mat=createWaterMaterial(tier),mesh=new T.Mesh(geo,mat);mesh.scale.setScalar(6);mesh.frustumCulled=false;scene.add(mesh);
 const profile=createSectionContour(ny,nz,h,y0,z0),xs=new Float64Array(maxX);
 let vertices=0,triangles=0,ms=0,crestY=0,crestZ=12,nx=maxX;
 const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
 const filtered=(src,a)=>(4*src[a]+2*(src[a-1]+src[a+1]+src[a-ny]+src[a+ny])+src[a-ny-1]+src[a-ny+1]+src[a+ny-1]+src[a+ny+1])/16;
 function update(f,originX=null,live=null,focusX=0){
  if(live?.n)throw Error('Connected section renderer expects the height/flow character, not a second fluid volume');
  const start=performance.now();base.fill(0);bf.fill(0);
  for(let i=0;i<f.n;i++){const a=i*3,x=f.p[a],y=f.p[a+1],z=f.p[a+2],j=Math.floor((y-y0)/h),k=Math.floor((z-z0)/h);if(Math.abs(x)>.21)continue;for(let zz=Math.max(0,k-2);zz<=Math.min(nz-1,k+2);zz++)for(let yy=Math.max(0,j-2);yy<=Math.min(ny-1,j+2);yy++){const q=1-(x*x+(y0+yy*h-y)**2+(z0+zz*h-z)**2)/(.21*.21);if(q<=0)continue;const w=q*q*q,b=yy+zz*ny;base[b]+=w;bf[b]+=w*f.foam[i];}}
  scratch.set(base);sf.set(bf);for(let k=1;k<nz-1;k++)for(let j=1;j<ny-1;j++){const a=j+k*ny;base[a]=filtered(scratch,a);bf[a]=filtered(sf,a);}
  liquid.set(base);for(let a=0;a<S;a++)if(solid[a])base[a]=4;
  labels.fill(0);let head=0,tail=0;for(let k=0;k<nz;k++){queue[tail++]=k*ny;labels[k*ny]=1;}
  while(head<tail){const a=queue[head++],j=a%ny,k=Math.floor(a/ny);for(let edge=0;edge<4;edge++){const b=edge===0?(j>0?a-1:-1):edge===1?(j<ny-1?a+1:-1):edge===2?(k>0?a-ny:-1):(k<nz-1?a+ny:-1);if(b>=0&&!labels[b]&&base[b]>=1.05){labels[b]=1;queue[tail++]=b;}}}
  for(let a=0;a<S;a++){bf[a]/=Math.max(.0001,base[a]);if(!labels[a])base[a]=Math.min(base[a],1.05*.99);base[a]/=1.05;const z=z0+Math.floor(a/ny)*h,y=y0+(a%ny)*h,offshore=smooth((z-22)/4);base[a]=base[a]*(1-offshore)+Math.max(0,Math.min(4,1-y/h*2))*offshore;bf[a]*=1-offshore;}
  profile.extract(base,bf,liquid);const n=profile.count;vertices=nx*n;if(vertices>100000)throw Error('Surface vertex capacity');
  const center=Math.max(-100,Math.min(100,focusX));for(let c=0;c<nx;c++){const u=2*c/(nx-1)-1;xs[c]=center+Math.sign(u)*Math.pow(Math.abs(u),1.8)*(u<0?center+121:121-center);}
  crestY=-100;for(let i=0;i<n;i++)if(profile.z[i]>4&&profile.z[i]<12&&profile.y[i]>crestY){crestY=profile.y[i];crestZ=profile.z[i];}
  for(let c=0;c<nx;c++){const x=xs[c],offset=shore(x*6)/6,slope=shore(x*6+.5)-shore(x*6-.5);for(let i=0;i<n;i++){const v=c*n+i,b=v*3;pos[b]=x;pos[b+1]=profile.y[i];pos[b+2]=profile.z[i]+offset;norm[b]=-slope*profile.normalZ[i];norm[b+1]=profile.normalY[i];norm[b+2]=profile.normalZ[i];foam[v]=profile.foam[i];wetness[v]=profile.wetness[i];}}
  let count=0;for(let c=0;c<nx-1;c++)for(let i=0;i<profile.segments;i++){const a=c*n+profile.links[i*2],b=c*n+profile.links[i*2+1],d=a+n,e=b+n;if(count+6>indices.length)throw Error('Surface index capacity');indices[count++]=a;indices[count++]=b;indices[count++]=e;indices[count++]=a;indices[count++]=e;indices[count++]=d;}
  geo.setDrawRange(0,count);for(const a of attributes){a.updateRange.count=vertices*a.itemSize;a.needsUpdate=vertices>0;}geo.index.updateRange.count=count;geo.index.needsUpdate=count>0;triangles=count/3;mat.uniforms.time.value=f.time;ms=performance.now()-start;
 }
 function checkSurface(){const edges=new Map(),add=(a,b)=>{const key=Math.min(a,b)*100000+Math.max(a,b);edges.set(key,(edges.get(key)||0)+1);};for(let i=0;i<geo.drawRange.count;i+=3){const a=indices[i],b=indices[i+1],c=indices[i+2];add(a,b);add(b,c);add(c,a);}let interiorBoundaryEdges=0,nonmanifoldEdges=0;for(const[key,count]of edges){if(count>2)nonmanifoldEdges++;if(count!==1)continue;const a=Math.floor(key/100000)*3,b=(key%100000)*3,x=(pos[a]+pos[b])*.5,y=(pos[a+1]+pos[b+1])*.5,z=(pos[a+2]+pos[b+2])*.5-shore(x*6)/6;if(Math.abs(x)<105&&y>-3.1&&y<4.3&&z>-5&&z<24)interiorBoundaryEdges++;}return{interiorBoundaryEdges,nonmanifoldEdges};}
 return{mesh,update,checkSurface,cutaway(on){mat.uniforms.cut.value=on?0:-645;mat.uniforms.cutEnd.value=on?12:645;},diagnostics:()=>({vertices,triangles,crestZ,crestY,reconstructionMs:ms,widthMetres:215,xColumns:nx,singleSurface:true,profileCount:profile.count,contour:profile.diagnostics(),uploadBytes:vertices*32+triangles*12,allocatedUploadBytes:pos.byteLength+norm.byteLength+foam.byteLength+wetness.byteLength+indices.byteLength})};
}
