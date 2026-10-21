import {bottom} from './fluid.mjs';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
// Gameplay samples the liquid particles, never the reconstructed render mesh.
// Keep the cheap envelope for visuals; body contact queries liquid markers in a
// bounded cross-section hash, so an overhead lip cannot fill the air below it.
export class HeightField {
 constructor(){this.n=256;this.z0=-7.8;this.dz=36.3/(this.n-1);this.h=new Float32Array(this.n);this.raw=new Float32Array(this.n);this.vy=new Float32Array(this.n);this.vz=new Float32Array(this.n);this.foam=new Float32Array(this.n);this.count=new Uint16Array(this.n);this.sums=new Float32Array(this.n*3);this.ready=false;}
 update(p,v,foam,n){const N=this.n;this.raw.fill(-100);this.count.fill(0);this.sums.fill(0);this.vy.fill(0);
  if(!this.head){this.hashH=.21;this.hashY=-3.6;this.hashNY=44;this.hashNZ=174;this.head=new Int32Array(this.hashNY*this.hashNZ);this.next=new Int32Array(Math.max(20000,n));}
  if(this.next.length<n)this.next=new Int32Array(n);this.head.fill(-1);this.particles=p;this.velocities=v;this.particleFoam=foam;this.particlesReady=true;
  for(let i=0;i<n;i++){const a=i*3;if(Math.abs(p[a])>.21)continue;const j=Math.floor((p[a+1]-this.hashY)/this.hashH),k=Math.floor((p[a+2]-this.z0)/this.hashH);if(j<0||j>=this.hashNY||k<0||k>=this.hashNZ)continue;const c=j+k*this.hashNY;this.next[i]=this.head[c];this.head[c]=i;}
  for(let i=0;i<n;i++){const a=i*3,k=Math.round((p[a+2]-this.z0)/this.dz);if(k<0||k>=N||Math.abs(p[a])>.2)continue;this.raw[k]=Math.max(this.raw[k],p[a+1]+.055);this.count[k]++;}
  for(let i=0;i<n;i++){const a=i*3,k=Math.round((p[a+2]-this.z0)/this.dz);if(k<0||k>=N||Math.abs(p[a])>.2||p[a+1]<this.raw[k]-.45)continue;this.sums[k*3]+=v[a+1];this.sums[k*3+1]+=v[a+2];this.sums[k*3+2]+=foam[i];this.vy[k]++;}
  for(let k=0;k<N;k++){const floor=bottom(0,this.z0+k*this.dz);if(this.count[k]<3)this.raw[k]=floor;const count=this.vy[k];this.vy[k]=count?this.sums[k*3]/count:0;this.vz[k]=count?this.sums[k*3+1]/count:0;this.foam[k]=count?this.sums[k*3+2]/count:0;}
  for(let k=0;k<N;k++)this.h[k]=.25*this.raw[Math.max(0,k-1)]+.5*this.raw[k]+.25*this.raw[Math.min(N-1,k+1)];this.ready=true;
 }
 sample(z,out){const f=clamp((z-this.z0)/this.dz,0,this.n-1.001),i=Math.floor(f),t=f-i;out[0]=this.h[i]*(1-t)+this.h[i+1]*t;out[1]=this.vy[i]*(1-t)+this.vy[i+1]*t;out[2]=this.vz[i]*(1-t)+this.vz[i+1]*t;out[3]=this.foam[i]*(1-t)+this.foam[i+1]*t;out[4]=Math.max(0,out[0]-bottom(0,z));out[5]=clamp((this.h[i+1]-this.h[i])/this.dz,-3,3);return out;}
 density(y,z,out){let d=0,vy=0,vz=0,foam=0;const h=this.hashH,j=Math.floor((y-this.hashY)/h),k=Math.floor((z-this.z0)/h),p=this.particles,v=this.velocities;
  for(let kk=Math.max(0,k-1);kk<=Math.min(this.hashNZ-1,k+1);kk++)for(let jj=Math.max(0,j-1);jj<=Math.min(this.hashNY-1,j+1);jj++)for(let i=this.head[jj+kk*this.hashNY];i>=0;i=this.next[i]){const a=i*3,q=1-(p[a]*p[a]+(p[a+1]-y)**2+(p[a+2]-z)**2)/(h*h);if(q<=0)continue;const w=q*q*q;d+=w;vy+=w*v[a+1];vz+=w*v[a+2];foam+=w*this.particleFoam[i];}
  out[0]=clamp(d/3.5,0,1);out[1]=d?vy/d:0;out[2]=d?vz/d:0;out[3]=d?foam/d:0;return out;
 }
 contact(y,z,pitch,out,scratch){
  if(!this.particlesReady){out[6]=clamp((out[0]-(y-.85))/1.5,0,1);out[7]=out[6]>0?1:0;return;}
  let wet=0,vy=0,vz=0,foam=0,foot=0;const c=Math.cos(pitch),s=Math.sin(pitch);
  // Seven vertical slices and three cross-shore samples approximate displaced
  // body volume. Only occupied water contributes buoyancy and relative-flow drag.
  for(let j=0;j<7;j++)for(let k=-1;k<=1;k++){const dy=-.75+j*.25,yy=y+dy*c,zz=z+dy*s+k*.18,w=(k===0?.5:.25)/7;if(yy<bottom(0,zz))continue;this.density(yy,zz,scratch);const fill=clamp((scratch[0]-.025)/.55,0,1),volume=fill*w;wet+=volume;vy+=scratch[1]*volume;vz+=scratch[2]*volume;foam+=scratch[3]*volume;if(j===0)foot+=fill*w*7;}
  out[1]=wet?vy/wet:0;out[2]=wet?vz/wet:0;out[3]=wet?foam/wet:0;out[6]=wet;out[7]=foot;
 }
}
export class HeightCharacter {
 constructor({x=0,y=.95,z=6.5,speed=-3}={}){this.p=new Float64Array([x,y,z]);this.v=new Float64Array([0,0,speed]);this.q=new Float64Array([0,0,0,1]);this.pitch=0;this.omega=0;this.sample=new Float64Array(8);this.contactSample=new Float64Array(4);this.contacts=0;this.skim=false;this.wiped=false;this.totalImpulse=0;this.waterForceZ=0;this.dry=false;}
 step(dt,input,field){const p=this.p,v=this.v,s=this.sample;field.sample(p[2],s);field.contact(p[1],p[2],this.pitch,s,this.contactSample);const immersion=s[6],wet=s[4]>.035&&immersion>.002;
  // Archimedes buoyancy, relative-flow quadratic drag, and finite planing lift.
  // No phase/proximity kick and no prescribed shoreward impulse.
  const ry=clamp(s[1]-v[1],-10,10),rz=clamp(s[2]-v[2],-12,12),relative=Math.hypot(v[0],ry,rz),area=.18*immersion;
  let fx=wet?-.5*1000*.8*area*relative*v[0]:0,fy=wet?1000*9.81*.12*immersion+.5*1000*.65*area*relative*ry:0,fz=wet?.5*1000*.8*area*relative*rz:0;
  // A lightly wetted, moving sole can plane even beneath an overhang. The
  // highest envelope is not the local surface, and a submerged body cannot skim.
  const planing=wet&&s[7]>.08&&immersion<.45&&Math.abs(v[2])>2&&Math.abs(v[1]-s[1])<3;
  if(planing)fy+=Math.min(500,.5*1000*.06*v[2]*v[2]*immersion);
  fx=clamp(fx,-3000,3000);fy=clamp(fy,-3000,3500);fz=clamp(fz,-3000,3000);
  this.waterForceZ=fz;this.totalImpulse+=Math.hypot(fx,fy,fz)*dt;
  // Limited player effort is a force, so moving water can overpower steering.
  fx+=(input.x||0)*260-v[0]*6;fz+=(input.z||0)*260;
  v[0]+=fx/75*dt;v[1]+=(fy/75-9.81)*dt;v[2]+=fz/75*dt;
  if(input.jump&&this.contacts&& !this.jumpHeld)v[1]+=3;this.jumpHeld=!!input.jump;
  p[0]=clamp(p[0]+v[0]*dt,-107,107);p[1]+=v[1]*dt;p[2]=clamp(p[2]+v[2]*dt,-7.5,27);
  const bed=bottom(0,p[2])+.85;this.contacts=wet?1:0;if(p[1]<bed){p[1]=bed;v[1]=Math.max(0,v[1]);this.contacts++;const drag=wet?.985:.90;v[0]*=drag;v[2]*=drag;}
  const torque=wet?-.45*fz:0;this.omega+=(torque-1100*this.pitch-90*this.omega)/35*dt;this.pitch=clamp(this.pitch+this.omega*dt,-1.2,1.2);this.q[0]=Math.sin(this.pitch/2);this.q[3]=Math.cos(this.pitch/2);
  this.wiped=Math.abs(this.pitch)>.48;this.skim=planing&&!this.wiped;this.dry=s[4]<.035&&p[1]<=bed+.12&&Math.abs(v[1])<.5;
 }
 diagnostics(){return {position:Array.from(this.p),velocity:Array.from(this.v),quaternion:Array.from(this.q),angularVelocity:[this.omega,0,0],tiltDegrees:Math.abs(this.pitch)*180/Math.PI,contacts:this.contacts,totalImpulse:this.totalImpulse,waterForceZ:this.waterForceZ,waterHeight:this.sample[0],waterDepth:this.sample[4],waterImmersion:this.sample[6],footWetness:this.sample[7],contactModel:'particle-volume-quadrature',flowZ:this.sample[2],skimming:this.skim,wiped:this.wiped};}
}
