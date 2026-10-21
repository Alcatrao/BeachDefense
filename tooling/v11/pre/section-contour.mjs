// Connected marching-squares contour. A saddle cell keeps two separate strands
// instead of averaging all its crossings into one pinched surface-net vertex.
// Buffers are allocated once; the liquid solver and gameplay sampler are untouched.
export function createSectionContour(ny,nz,h,y0,z0){
 const size=ny*nz,capacity=2*size,edgeIds=new Int32Array(capacity),next=new Int32Array(capacity),prev=new Int32Array(capacity),degree=new Uint8Array(capacity);
 const y=new Float32Array(capacity),z=new Float32Array(capacity),rawY=new Float32Array(capacity),rawZ=new Float32Array(capacity),normalY=new Float32Array(capacity),normalZ=new Float32Array(capacity),referenceY=new Float32Array(capacity),referenceZ=new Float32Array(capacity),foam=new Float32Array(capacity),wetness=new Float32Array(capacity),dy=new Float32Array(capacity),dz=new Float32Array(capacity),links=new Uint32Array(capacity*2);
 let count=0,segments=0,ambiguous=0,maxDisplacement=0,invalidDegree=0,d,f,liquid;
  function point(edge){let id=edgeIds[edge];if(id>=0)return id;id=count++;edgeIds[edge]=id;next[id]=prev[id]=-1;degree[id]=0;
   const vertical=edge<size,a=vertical?edge:edge-size,b=a+(vertical?1:ny),t=(1-d[a])/(d[b]-d[a]),j=a%ny,k=Math.floor(a/ny);
   rawY[id]=y[id]=y0+(j+(vertical?t:0))*h;rawZ[id]=z[id]=z0+(k+(vertical?0:t))*h;
   foam[id]=f[a]+t*(f[b]-f[a]);wetness[id]=Math.min(1,Math.max(0,(liquid[a]+t*(liquid[b]-liquid[a]))/1.05));
   const gy=(d[a-1]-d[a+1])*(1-t)+(d[b-1]-d[b+1])*t,gz=(d[a-ny]-d[a+ny])*(1-t)+(d[b-ny]-d[b+ny])*t;
   referenceY[id]=gy;referenceZ[id]=gz;return id;
  }
  function connect(a,b){const u=point(a),v=point(b);links[segments*2]=u;links[segments*2+1]=v;segments++;
   if(degree[u]===0)prev[u]=v;else next[u]=v;if(degree[v]===0)prev[v]=u;else next[v]=u;degree[u]++;degree[v]++;
  }
 function extract(density,foamField,liquidField){
  d=density;f=foamField;liquid=liquidField;edgeIds.fill(-1);count=segments=ambiguous=maxDisplacement=invalidDegree=0;
  for(let k=1;k<nz-2;k++)for(let j=1;j<ny-2;j++){
   const a=j+k*ny,v0=d[a]-1,v1=d[a+1]-1,v2=d[a+ny+1]-1,v3=d[a+ny]-1;
   const mask=(v0>=0?1:0)|(v1>=0?2:0)|(v2>=0?4:0)|(v3>=0?8:0);if(mask===0||mask===15)continue;
   const e0=a,e1=size+a+1,e2=a+ny,e3=size+a;
   // Bilinear asymptotic decider: signs alone cannot choose a saddle's topology.
   if(mask===5||mask===10){ambiguous++;if(v0*v2-v1*v3>=0){connect(e0,e1);connect(e2,e3);}else{connect(e3,e0);connect(e1,e2);}continue;}
   let first=-1;if((v0>=0)!==(v1>=0))first=e0;
   if((v1>=0)!==(v2>=0)){if(first<0)first=e1;else{connect(first,e1);continue;}}
   if((v2>=0)!==(v3>=0)){if(first<0)first=e2;else{connect(first,e2);continue;}}
   if((v3>=0)!==(v0>=0)&&first>=0)connect(first,e3);
  }
  // Fair each connected strand in the section, never across a tube's air gap.
  // Eight Taubin pairs attenuate particle/grid-scale corrugation without
  // shrinking the large curl; deviation from the physical skin stays <= 7 cm.
  for(let pass=0;pass<16;pass++){
   const factor=pass%2===0?.5:-.53;
   for(let i=0;i<count;i++){dy[i]=dz[i]=0;if(degree[i]!==2||wetness[i]<.2)continue;const a=prev[i],b=next[i];dy[i]=factor*((y[a]+y[b])*.5-y[i]);dz[i]=factor*((z[a]+z[b])*.5-z[i]);}
   for(let i=0;i<count;i++){let yy=y[i]+dy[i],zz=z[i]+dz[i],oy=yy-rawY[i],oz=zz-rawZ[i],length=Math.hypot(oy,oz);if(length>.07){yy=rawY[i]+oy*.07/length;zz=rawZ[i]+oz*.07/length;}y[i]=yy;z[i]=zz;}
  }
  // Derive the shading normal from the final, shared curve (not stale density).
  for(let i=0;i<count;i++){
   const a=prev[i],b=next[i];let gy=referenceY[i],gz=referenceZ[i];if(degree[i]===2){const la=Math.hypot(y[i]-y[a],z[i]-z[a])||1,lb=Math.hypot(y[b]-y[i],z[b]-z[i])||1;gy=(z[i]-z[a])/la+(z[b]-z[i])/lb;gz=(y[a]-y[i])/la+(y[i]-y[b])/lb;if(gy*referenceY[i]+gz*referenceZ[i]<0){gy=-gy;gz=-gz;}}
   if(Math.hypot(gy,gz)<1e-8){gy=referenceY[i];gz=referenceZ[i];}const length=Math.hypot(gy,gz)||1;normalY[i]=gy/length;normalZ[i]=gz/length;
   maxDisplacement=Math.max(maxDisplacement,Math.hypot(y[i]-rawY[i],z[i]-rawZ[i]));if(degree[i]>2)invalidDegree++;
  }
  return api;
 }
 const api={extract,y,z,normalY,normalZ,foam,wetness,links,prev,next,degree,get count(){return count;},get segments(){return segments;},diagnostics:()=>({points:count,segments,ambiguousCells:ambiguous,invalidDegree,maxFairingDisplacement:maxDisplacement,fairingPasses:16,method:'connected-marching-squares'})};return api;
}
