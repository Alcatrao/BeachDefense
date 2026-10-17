import * as T from 'three';import{bottom}from'./fluid.mjs';
// Marching-squares contour of the simulated liquid section, extruded along the
// beach. The contour may overturn; no height field or prescribed curl is used.
export function createCoastSurface(scene,shore){
 const h=.12,y0=-3.6,z0=-7.8,ny=74,nz=303,N=ny*nz,iso=1.05,H=.21;
 const scratch=new Float32Array(N),labels=new Uint8Array(N),queue=new Int32Array(N);
 const density=new Float32Array(N),ff=new Float32Array(N),maxVertices=180000,pos=new Float32Array(maxVertices*3),norm=new Float32Array(maxVertices*3),foam=new Float32Array(maxVertices);
 const geo=new T.BufferGeometry();for(const[name,a,size]of[['position',pos,3],['normal',norm,3],['foam',foam,1]])geo.setAttribute(name,new T.BufferAttribute(a,size).setUsage(T.DynamicDrawUsage));
 const mat=new T.ShaderMaterial({side:T.DoubleSide,uniforms:{center:{value:0},gap:{value:0},cut:{value:-100000},cutEnd:{value:100000},time:{value:0}},vertexShader:`attribute float foam;varying vec3 P,N;varying float F;void main(){P=(modelMatrix*vec4(position,1.)).xyz;N=normal;F=foam;gl_Position=projectionMatrix*viewMatrix*vec4(P,1.);}`,fragmentShader:`uniform float center,gap,cut,cutEnd,time;varying vec3 P,N;varying float F;float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}void main(){if(P.x<cut||P.x>cutEnd||abs(P.x-center)<gap)discard;vec3 n=normalize(N),v=normalize(cameraPosition-P);if(dot(n,v)<0.)n=-n;float fres=pow(1.-max(dot(n,v),0.),4.),sun=pow(max(dot(reflect(-normalize(vec3(-.4,1.,.3)),n),v),0.),65.);vec3 c=mix(vec3(.018,.45,.58),vec3(.025,.67,.72),clamp(P.y*.08+.5,0.,1.));c*=.7+.3*max(n.y,0.);c=mix(c,vec3(.71,.91,1.),fres*.65)+sun*.7;float grain=hash(floor(P.xz*2.+time));gl_FragColor=vec4(mix(c,vec3(.94,.98,1.)*(.9+.1*grain),clamp(F*1.8,0.,1.)),1.);}`});
 const mesh=new T.Mesh(geo,mat);mesh.frustumCulled=false;mesh.scale.setScalar(6);scene.add(mesh);let ms=0,vertices=0,segments=0,crestZ=12,crestY=0;
 function update(f,originX=null){const t=performance.now();density.fill(0);ff.fill(0);for(let i=0;i<f.n;i++){const a=i*3,x=f.p[a],y=f.p[a+1],z=f.p[a+2],j=Math.floor((y-y0)/h),k=Math.floor((z-z0)/h);if(Math.abs(x)>H)continue;for(let zz=Math.max(0,k-2);zz<=Math.min(nz-1,k+2);zz++)for(let yy=Math.max(0,j-2);yy<=Math.min(ny-1,j+2);yy++){const q=1-(x*x+(y0+yy*h-y)**2+(z0+zz*h-z)**2)/(H*H);if(q<=0)continue;const w=q*q*q,b=yy+zz*ny;density[b]+=w;ff[b]+=w*f.foam[i];}}
 // Visual kernel filtering and connected-liquid mask keep detached spray from
 // becoming full-beach sheets. They do not alter the solver or collider.
 scratch.set(density);
 for(let k=1;k<nz-1;k++)for(let j=1;j<ny-1;j++){const a=j+k*ny;density[a]=(4*scratch[a]+2*(scratch[a-1]+scratch[a+1]+scratch[a-ny]+scratch[a+ny])+scratch[a-ny-1]+scratch[a-ny+1]+scratch[a+ny-1]+scratch[a+ny+1])/16;}
 // Submerged bed boundaries are occluded by sand; do not mesh their underside.
 for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)if(y0+j*h<bottom(0,z0+k*h)+.03)density[j+k*ny]=4;
 labels.fill(0);let tail=0,head=0;
 for(let k=0;k<nz;k++){queue[tail++]=k*ny;labels[k*ny]=1;}
 while(head<tail){const a=queue[head++],j=a%ny,k=Math.floor(a/ny);for(const b of[j>0?a-1:-1,j<ny-1?a+1:-1,k>0?a-ny:-1,k<nz-1?a+ny:-1])if(b>=0&&!labels[b]&&density[b]>=iso){labels[b]=1;queue[tail++]=b;}}
 for(let a=0;a<N;a++)if(!labels[a])density[a]=Math.min(density[a],iso*.99);
 vertices=0;segments=0;crestY=-100;const offsets=[0,1,ny+1,ny],dy=[0,1,1,0],dz=[0,0,1,1],edges=[[0,1],[1,2],[2,3],[3,0]];
 const vertex=(x,q,n,F)=>{if(vertices>=maxVertices)throw Error('Coast surface capacity exceeded');const a=vertices*3;pos[a]=x;pos[a+1]=q[0];pos[a+2]=q[1]+shore(x*6)/6;norm[a]=0;norm[a+1]=n[0];norm[a+2]=n[1];foam[vertices++]=F;};
 for(let k=1;k<nz-2;k++)for(let j=1;j<ny-2;j++){const a=j+k*ny,hits=[];for(const[u,v]of edges){const da=density[a+offsets[u]],db=density[a+offsets[v]];if((da>=iso)===(db>=iso))continue;const t=(iso-da)/(db-da),y=y0+(j+dy[u]+t*(dy[v]-dy[u]))*h,z=z0+(k+dz[u]+t*(dz[v]-dz[u]))*h,F=ff[a+offsets[u]]/(da||1)*(1-t)+ff[a+offsets[v]]/(db||1)*t;const au=a+offsets[u],av=a+offsets[v],grad=b=>[density[b-1]-density[b+1],density[b-ny]-density[b+ny]],nu=grad(au),nv=grad(av);hits.push({p:[y,z],F,n:nu.map((q,i)=>q+(nv[i]-q)*t)});if(z>4&&z<12&&y>crestY){crestY=y;crestZ=z;}}if(hits.length<2)continue;for(let e=0;e+1<hits.length;e+=2){const u=hits[e],v=hits[e+1],n=[density[a-1]-density[a+1],density[a-ny]-density[a+ny]];segments++;for(let col=0;col<16;col++){const x=-107.5+col*215/16,xx=x+215/16;vertex(x,u.p,u.n,u.F);vertex(xx,u.p,u.n,u.F);vertex(xx,v.p,v.n,v.F);vertex(x,u.p,u.n,u.F);vertex(xx,v.p,v.n,v.F);vertex(x,v.p,v.n,v.F);}}}
 geo.setDrawRange(0,vertices);for(const a of Object.values(geo.attributes))a.needsUpdate=true;mat.uniforms.center.value=(originX??0)*6;mat.uniforms.gap.value=originX===null?0:9.5;mat.uniforms.time.value=f.time;ms=performance.now()-t;
 }
 return {mesh,update,cutaway(on){mat.uniforms.cut.value=on?0:-100000;mat.uniforms.cutEnd.value=on?12:100000;},diagnostics:()=>({vertices,segments,crestZ,crestY,reconstructionMs:ms,widthMetres:215})};
}
