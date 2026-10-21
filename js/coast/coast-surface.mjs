import * as T from 'three';
import {createWaterMaterial} from './water-material.mjs';
import {createCoastGrid} from './coast-grid.mjs';
// A fixed strip samples connected, overturning liquid profiles on the GPU.
// Reconstruction stays in the worker; frame interpolation needs one uniform.
export function createCoastSurface(scene,shore,tier={columns:48}){
 const samples=512,rows=tier.name==='software'?256:512,nx=tier.columns||48,grid=createCoastGrid(shore,nx),geo=new T.BufferGeometry();
 const position=new Float32Array(rows*nx*3),uv=new Float32Array(rows*nx*2),indices=new Uint32Array((rows-1)*(nx-1)*6);
 const a=new Float32Array(samples*8),b=new Float32Array(samples*8);
 function texture(data){const t=new T.DataTexture(data,samples,2,T.RGBAFormat,T.FloatType);t.minFilter=t.magFilter=T.NearestFilter;t.needsUpdate=true;return t;}
 let previous=texture(a),current=texture(b),ready=false,received=0,duration=1/30,physicalTime=0,focus=Infinity,diagnostic={};
 grid.update(0);for(let c=0;c<nx;c++)for(let r=0;r<rows;r++){const i=c*rows+r;position[i*3]=grid.x[c];uv[i*2]=(r/(rows-1)*(samples-1)+.5)/samples;}
 let q=0;for(let c=0;c<nx-1;c++)for(let r=0;r<rows-1;r++){const i=c*rows+r;indices[q++]=i;indices[q++]=i+1;indices[q++]=i+rows+1;indices[q++]=i;indices[q++]=i+rows+1;indices[q++]=i+rows;}
 geo.setAttribute('position',new T.BufferAttribute(position,3).setUsage(T.DynamicDrawUsage));geo.setAttribute('uv',new T.BufferAttribute(uv,2));geo.setIndex(new T.BufferAttribute(indices,1));
 const mat=createWaterMaterial(tier);Object.assign(mat.uniforms,{surfacePrevious:{value:previous},surfaceCurrent:{value:current},surfaceMix:{value:1},profileSurface:{value:1}});
 const mesh=new T.Mesh(geo,mat);mesh.scale.setScalar(6);mesh.frustumCulled=false;scene.add(mesh);
 function update(f,originX=null,live=null,focusX=0,surface=null,stats={}){
  if(!surface)return;
  if(!ready||f.time<physicalTime){previous.image.data.set(surface);previous.needsUpdate=true;current.image.data.set(surface);current.needsUpdate=true;ready=true;duration=0;}
  else if(f.time>physicalTime){const swap=previous;previous=current;current=swap;current.image.data.set(surface);current.needsUpdate=true;duration=Math.min(.1,f.time-physicalTime);}
  received=performance.now();physicalTime=f.time;diagnostic=stats;mat.uniforms.surfacePrevious.value=previous;mat.uniforms.surfaceCurrent.value=current;
  if(Math.abs(focus-focusX)>.15){focus=focusX;grid.update(focusX);for(let c=0;c<nx;c++)for(let r=0;r<rows;r++)position[(c*rows+r)*3]=grid.x[c];geo.attributes.position.needsUpdate=true;}
 }
 function animate(time,playing){const alpha=playing&&duration>0?Math.min(1,(performance.now()-received)/(duration*1000)):1;mat.uniforms.surfaceMix.value=alpha;mat.uniforms.time.value=time;}
 let topology;
 function checkSurface(){if(!topology){const edges=new Map(),vertices=rows*nx;for(let i=0;i<indices.length;i+=3)for(let k=0;k<3;k++){const a=indices[i+k],b=indices[i+(k+1)%3],key=Math.min(a,b)*vertices+Math.max(a,b);edges.set(key,(edges.get(key)||0)+1);}let interiorBoundaryEdges=0,nonmanifoldEdges=0,boundaryEdges=0;for(const [key,count]of edges){if(count>2)nonmanifoldEdges++;if(count===1){boundaryEdges++;const a=Math.floor(key/vertices),b=key%vertices,ca=Math.floor(a/rows),cb=Math.floor(b/rows),ra=a%rows,rb=b%rows;if(!((ca===cb&&(ca===0||ca===nx-1))||(ra===rb&&(ra===0||ra===rows-1))))interiorBoundaryEdges++;}}topology={interiorBoundaryEdges,nonmanifoldEdges,boundaryEdges,expectedBoundaryEdges:2*(rows+nx-2),fixedConnectedStrip:true};}const d=current.image.data;let finite=true,maxProfileStep=0;for(let i=0;i<d.length;i++)if(!Number.isFinite(d[i]))finite=false;for(let i=1;i<samples;i++)maxProfileStep=Math.max(maxProfileStep,Math.hypot(d[i*4]-d[(i-1)*4],d[i*4+1]-d[(i-1)*4+1]));return {...topology,finite,maxProfileStep};}
 return {mesh,update,animate,cutaway(on){mat.uniforms.cut.value=on?0:-645;mat.uniforms.cutEnd.value=on?12:645;},checkSurface,diagnostics:()=>({vertices:rows*nx,triangles:indices.length/3,crestY:diagnostic.crestY||0,crestZ:diagnostic.crestZ||10,reconstructionMs:diagnostic.reconstructionMs||0,widthMetres:215,xColumns:nx,singleSurface:true,profileCount:samples,contour:diagnostic.contour,uploadBytes:samples*8*4,workerReconstruction:true,gpuInterpolation:true,interpolation:mat.uniforms.surfaceMix.value})};
}
