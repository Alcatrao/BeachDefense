import {bottom} from './fluid.mjs';
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
// Gameplay samples the liquid particles, never the reconstructed render mesh.
// This single-valued envelope deliberately cannot resolve the air under a lip.
export class HeightField {
 constructor(){this.n=256;this.z0=-7.8;this.dz=36.3/(this.n-1);this.h=new Float32Array(this.n);this.raw=new Float32Array(this.n);this.vy=new Float32Array(this.n);this.vz=new Float32Array(this.n);this.foam=new Float32Array(this.n);this.count=new Uint16Array(this.n);this.sums=new Float32Array(this.n*3);this.ready=false;}
 update(p,v,foam,n){const N=this.n;this.raw.fill(-100);this.count.fill(0);this.sums.fill(0);this.vy.fill(0);
  for(let i=0;i<n;i++){const a=i*3,k=Math.round((p[a+2]-this.z0)/this.dz);if(k<0||k>=N||Math.abs(p[a])>.2)continue;this.raw[k]=Math.max(this.raw[k],p[a+1]+.055);this.count[k]++;}
  for(let i=0;i<n;i++){const a=i*3,k=Math.round((p[a+2]-this.z0)/this.dz);if(k<0||k>=N||Math.abs(p[a])>.2||p[a+1]<this.raw[k]-.45)continue;this.sums[k*3]+=v[a+1];this.sums[k*3+1]+=v[a+2];this.sums[k*3+2]+=foam[i];this.vy[k]++;}
  for(let k=0;k<N;k++){const floor=bottom(0,this.z0+k*this.dz);if(this.count[k]<3)this.raw[k]=floor;const count=this.vy[k];this.vy[k]=count?this.sums[k*3]/count:0;this.vz[k]=count?this.sums[k*3+1]/count:0;this.foam[k]=count?this.sums[k*3+2]/count:0;}
  for(let k=0;k<N;k++)this.h[k]=.25*this.raw[Math.max(0,k-1)]+.5*this.raw[k]+.25*this.raw[Math.min(N-1,k+1)];this.ready=true;
 }
 sample(z,out){const f=clamp((z-this.z0)/this.dz,0,this.n-1.001),i=Math.floor(f),t=f-i;out[0]=this.h[i]*(1-t)+this.h[i+1]*t;out[1]=this.vy[i]*(1-t)+this.vy[i+1]*t;out[2]=this.vz[i]*(1-t)+this.vz[i+1]*t;out[3]=this.foam[i]*(1-t)+this.foam[i+1]*t;out[4]=Math.max(0,out[0]-bottom(0,z));out[5]=clamp((this.h[i+1]-this.h[i])/this.dz,-3,3);return out;}
}
export class HeightCharacter {
 constructor({x=0,y=.95,z=6.5,speed=-3}={}){this.p=new Float64Array([x,y,z]);this.v=new Float64Array([0,0,speed]);this.q=new Float64Array([0,0,0,1]);this.pitch=0;this.omega=0;this.sample=new Float64Array(6);this.contacts=0;this.skim=false;this.wiped=false;this.totalImpulse=0;this.waterForceZ=0;this.dry=false;}
 step(dt,input,field){const p=this.p,v=this.v,s=this.sample;field.sample(p[2],s);const floor=bottom(0,p[2]),immersion=clamp((s[0]-(p[1]-.85))/1.5,0,1),wet=s[4]>.035&&immersion>0;
  // Archimedes buoyancy, relative-flow quadratic drag, and finite planing lift.
  // No phase/proximity kick and no prescribed shoreward impulse.
  const ry=clamp(s[1]-v[1],-10,10),rz=clamp(s[2]-v[2],-12,12),relative=Math.hypot(v[0],ry,rz),area=.18*immersion;
  let fx=wet?-.5*1000*.8*area*relative*v[0]:0,fy=wet?1000*9.81*.12*immersion+.5*1000*.65*area*relative*ry:0,fz=wet?.5*1000*.8*area*relative*rz:0;
  const planing=wet&&Math.abs(v[2])>2&&Math.abs(p[1]-.85-s[0])<.5;
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
 diagnostics(){return {position:Array.from(this.p),velocity:Array.from(this.v),quaternion:Array.from(this.q),angularVelocity:[this.omega,0,0],tiltDegrees:Math.abs(this.pitch)*180/Math.PI,contacts:this.contacts,totalImpulse:this.totalImpulse,waterForceZ:this.waterForceZ,waterHeight:this.sample[0],waterDepth:this.sample[4],flowZ:this.sample[2],skimming:this.skim,wiped:this.wiped};}
}
