import {bottom} from './fluid.mjs';
import {createSectionContour} from './section-contour.mjs';
export function createSectionSurface(samples=512){
 const h=.16,y0=-3.6,z0=-17.8,ny=54,nz=291,S=ny*nz,unused=0;
 const base=new Float32Array(S),bf=new Float32Array(S),liquid=new Float32Array(S),scratch=new Float32Array(S),sf=new Float32Array(S),labels=new Uint8Array(S),queue=new Int32Array(S),solid=new Uint8Array(S);
 for(let k=0;k<nz;k++)for(let j=0;j<ny;j++)solid[j+k*ny]=y0+j*h<bottom(0,z0+k*h)+.03?1:0;
 const profile=createSectionContour(ny,nz,h,y0,z0),data=new Float32Array(samples*8),normalScratch=new Float32Array(samples*2),order=new Int32Array(S*2),arc=new Float64Array(S*2);let ms=0,crestY=0,crestZ=0;
 const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};
 const filtered=(src,a)=>(4*src[a]+2*(src[a-1]+src[a+1]+src[a-ny]+src[a+ny])+src[a-ny-1]+src[a-ny+1]+src[a+ny-1]+src[a+ny+1])/16;
 function update(f){
  const start=performance.now();base.fill(0);bf.fill(0);
  for(let i=0;i<f.n;i++){const a=i*3,x=f.p[a],y=f.p[a+1],z=f.p[a+2],j=Math.floor((y-y0)/h),k=Math.floor((z-z0)/h);if(Math.abs(x)>.21)continue;for(let zz=Math.max(0,k-2);zz<=Math.min(nz-1,k+2);zz++)for(let yy=Math.max(0,j-2);yy<=Math.min(ny-1,j+2);yy++){const q=1-(x*x+(y0+yy*h-y)**2+(z0+zz*h-z)**2)/(.21*.21);if(q<=0)continue;const w=q*q*q,b=yy+zz*ny;base[b]+=w;bf[b]+=w*f.foam[i];}}
  scratch.set(base);sf.set(bf);for(let k=1;k<nz-1;k++)for(let j=1;j<ny-1;j++){const a=j+k*ny;base[a]=filtered(scratch,a);bf[a]=filtered(sf,a);}
  liquid.set(base);for(let a=0;a<S;a++)if(solid[a])base[a]=4;
  labels.fill(0);let head=0,tail=0;for(let k=0;k<nz;k++){queue[tail++]=k*ny;labels[k*ny]=1;}
  while(head<tail){const a=queue[head++],j=a%ny,k=Math.floor(a/ny);for(let edge=0;edge<4;edge++){const b=edge===0?(j>0?a-1:-1):edge===1?(j<ny-1?a+1:-1):edge===2?(k>0?a-ny:-1):(k<nz-1?a+ny:-1);if(b>=0&&!labels[b]&&base[b]>=1.05){labels[b]=1;queue[tail++]=b;}}}
  for(let a=0;a<S;a++){bf[a]/=Math.max(.0001,base[a]);if(!labels[a])base[a]=Math.min(base[a],1.05*.99);base[a]/=1.05;const z=z0+Math.floor(a/ny)*h,y=y0+(a%ny)*h,offshore=smooth((z-22)/4);base[a]=base[a]*(1-offshore)+Math.max(0,Math.min(4,1-y/h*2))*offshore;bf[a]*=1-offshore;}
  profile.extract(base,bf,liquid);
  // Follow the shore-connected open water/bed interface to offshore. The
  // material coordinate is arc length, including overturned parts of the lip.
  let first=-1;for(let i=0;i<profile.count;i++)if(profile.degree[i]===1&&(first<0||profile.z[i]<profile.z[first]))first=i;
  let n=0,previous=-1,current=first,length=0;
  while(current>=0&&n<order.length){order[n]=current;arc[n++]=length;if(profile.z[current]>=22)break;const next=profile.prev[current]===previous?profile.next[current]:profile.prev[current];if(next<0)break;length+=Math.hypot(profile.y[next]-profile.y[current],profile.z[next]-profile.z[current]);previous=current;current=next;}
  if(n<2)throw Error('No connected free surface');
  // Outside the breaking/contact region, join the tank to the far ocean with
  // matching height AND tangent. Blending density creates a false vertical wall
  // whenever the piston draws the tank level below the analytic offshore sea.
  const last=order[n-1],joinZ=profile.z[last],joinY=profile.y[last],span=26-joinZ,slope=Math.max(-.5,Math.min(.5,-profile.normalZ[last]/Math.max(.05,profile.normalY[last])));
  for(let k=1;k<=24;k++){const id=profile.count+k,z=joinZ+(28.36-joinZ)*k/24,t=Math.min(1,(z-joinZ)/span),y=(2*t*t*t-3*t*t+1)*joinY+(t*t*t-2*t*t+t)*span*slope,dy=((6*t*t-6*t)*joinY+(3*t*t-4*t+1)*span*slope)/span,inv=1/Math.hypot(1,dy);profile.y[id]=y;profile.z[id]=z;profile.normalY[id]=inv;profile.normalZ[id]=-dy*inv;profile.foam[id]=profile.foam[last]*(1-t);profile.wetness[id]=1;const before=order[n-1];length+=Math.hypot(y-profile.y[before],z-profile.z[before]);order[n]=id;arc[n++]=length;}
  let edge=0;crestY=-100;crestZ=0;for(let i=0;i<samples;i++){const target=length*i/(samples-1);while(edge<n-2&&arc[edge+1]<target)edge++;const a=order[edge],b=order[edge+1],span=arc[edge+1]-arc[edge],t=span>1e-9?(target-arc[edge])/span:0,j=i*4;
   data[j]=profile.y[a]+t*(profile.y[b]-profile.y[a]);data[j+1]=profile.z[a]+t*(profile.z[b]-profile.z[a]);data[j+2]=profile.normalY[a]+t*(profile.normalY[b]-profile.normalY[a]);data[j+3]=profile.normalZ[a]+t*(profile.normalZ[b]-profile.normalZ[a]);data[samples*4+j]=profile.foam[a]+t*(profile.foam[b]-profile.foam[a]);data[samples*4+j+1]=profile.wetness[a]+t*(profile.wetness[b]-profile.wetness[a]);
   // The offshore join is a deliberate flat continuation outside the tank.
   // Its wetness must follow the same blend as the density, or it discards a gap.
   const join=smooth((data[j+1]-22)/4);data[samples*4+j+1]=Math.max(data[samples*4+j+1],join);
   if(data[j+1]>2&&data[j+1]<20&&data[j]>crestY){crestY=data[j];crestZ=data[j+1];}
  }
  // Shade at a slightly larger scale than the particle lattice. Geometry and
  // cavity topology stay untouched; this removes millimetric mirror bands.
  for(let pass=0;pass<4;pass++){for(let i=0;i<samples;i++){const a=Math.max(0,i-1)*4,b=i*4,c=Math.min(samples-1,i+1)*4;normalScratch[i*2]=.25*data[a+2]+.5*data[b+2]+.25*data[c+2];normalScratch[i*2+1]=.25*data[a+3]+.5*data[b+3]+.25*data[c+3];}for(let i=0;i<samples;i++){const y=normalScratch[i*2],z=normalScratch[i*2+1],inv=1/(Math.hypot(y,z)||1);data[i*4+2]=y*inv;data[i*4+3]=z*inv;}}
  ms=performance.now()-start;return data;
 }
 return {data,update,diagnostics:()=>({samples,sourcePoints:profile.count,crestY,crestZ,reconstructionMs:ms,contour:profile.diagnostics()})};
}
