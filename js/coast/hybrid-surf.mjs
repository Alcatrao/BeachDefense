// Depth-averaged finite-volume water + connected ballistic breaking sheets.
// Independent coastal transects share incident swell; no 3D pressure projection.
// Inspired by Thurey et al. (2007), not an implementation of their full method.
export const NX=17,NZ=384,POINTS=512,X0=-121,DX=242/(NX-1),Z0=-18,DZ=78/(NZ-1),G=9.81;
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
export function bottom(x,z){return -Math.min(3,(z<0?z*.18:z*.06)+Math.max(0,z-6)*.27);}
export function incident(x,z,t){const phase=.145*(z-60)+t*Math.PI/4+.22*Math.sin(x*.047)+.10*Math.sin(x*.113),group=.90+.10*Math.cos(t*.13+x*.021);return 1.45*group*Math.sin(phase)+.18*Math.sin(2*phase+.3);}
class Transect{
 constructor(x,{forcing=true}={}){this.x=x;this.forcing=forcing;this.h=new Float64Array(NZ);this.q=new Float64Array(NZ);this.foam=new Float64Array(NZ);this.bed=new Float64Array(NZ);this.dh=new Float64Array(NZ);this.dq=new Float64Array(NZ);this.old=new Float64Array(NZ);this.vy=new Float64Array(NZ);this.df=new Float64Array(NZ);this.sheets=[this.makeSheet(),this.makeSheet()];this.time=0;this.nextBreak=0;this.impacts=0;this.emitted=0;this.returned=0;this.breakCount=0;this.lastImpact={z:8,y:0,strength:0,velocityY:0,flowZ:0,foam:0};
  for(let i=0;i<NZ;i++){const z=Z0+i*DZ;this.bed[i]=bottom(x,z);this.h[i]=Math.max(0,-this.bed[i]);}
 }
 makeSheet(){return {active:false,emitting:false,clock:0,age:0,z:0,crest:0,c:0,count:0,y:new Float64Array(64),p:new Float64Array(64),u:new Float64Array(64),v:new Float64Array(64),mass:new Float64Array(64),alive:new Uint8Array(64)};}
 index(z){return clamp(Math.round((z-Z0)/DZ),1,NZ-2);}
 height(z){const f=clamp((z-Z0)/DZ,0,NZ-1.00001),i=Math.floor(f),a=f-i;return (this.h[i]+this.bed[i])*(1-a)+(this.h[i+1]+this.bed[i+1])*a;}
 flow(z){const i=this.index(z);return this.h[i]>.008?this.q[i]/this.h[i]:0;}
 step(dt){this.time+=dt;const h=this.h,q=this.q,b=this.bed,n=NZ;this.old.set(h);this.dh.fill(0);this.dq.fill(0);this.df.fill(0);
  // Hydrostatic reconstruction: exactly balanced lake-at-rest even on dry slopes.
  // Local Lax-Friedrichs flux, positivity guarded by CFL-sized time steps.
  for(let i=0;i<n-1;i++){const j=i+1,etaL=h[i]+b[i],etaR=h[j]+b[j],top=Math.max(b[i],b[j]),hl=Math.max(0,etaL-top),hr=Math.max(0,etaR-top),ul=h[i]>.008?q[i]/h[i]:0,ur=h[j]>.008?q[j]/h[j]:0,ql=hl*ul,qr=hr*ur,c=Math.max(Math.abs(ul)+Math.sqrt(G*hl),Math.abs(ur)+Math.sqrt(G*hr)),fh=.5*(ql+qr-c*(hr-hl)),fq=.5*(ql*ul+qr*ur+G*.5*(hl*hl+hr*hr)-c*(qr-ql)),r=dt/DZ;
   this.dh[i]-=fh*r;this.dh[j]+=fh*r;this.dq[i]-=(fq+.5*G*(h[i]*h[i]-hl*hl))*r;this.dq[j]+=(fq+.5*G*(h[j]*h[j]-hr*hr))*r;
   const ff=fh*(fh>0?this.foam[i]:this.foam[j]);this.df[i]-=ff*r;this.df[j]+=ff*r;
  }
  // Closed inland edge, characteristic inlet with a smooth relaxation zone.
  this.dq[0]+=.5*G*h[0]*h[0]*dt/DZ;this.dq[n-1]-=.5*G*h[n-1]*h[n-1]*dt/DZ;
  for(let i=0;i<n;i++){const old=h[i];h[i]=Math.max(0,h[i]+this.dh[i]);q[i]+=this.dq[i];if(h[i]<.008)q[i]=0;else q[i]/=1+dt*.018*Math.abs(q[i]/h[i])/Math.max(.06,h[i]);this.foam[i]=clamp((old*this.foam[i]+this.df[i])/Math.max(.008,h[i]),0,1)*Math.exp(-dt/5.5);
   const z=Z0+i*DZ;if(this.forcing&&z>44){const a=1-Math.exp(-dt*3*((z-44)/16)**2),eta=incident(this.x,z,this.time),target=Math.max(0,eta-b[i]),u=-eta*Math.sqrt(G/3);h[i]+=(target-h[i])*a;q[i]+=(u*target-q[i])*a;}
   this.vy[i]=(h[i]-old)/dt;
  }
  // A crest releases a lip only after shoaling produces a steep shoreward face.
  // Phase and break location are measured from the evolving water, not a timer.
  if(this.forcing&&this.time>this.nextBreak){let best=0,idx=-1;for(let i=3;i<n-3;i++){const z=Z0+i*DZ,eta=h[i]+b[i],slope=(eta-h[i-2]-b[i-2])/(2*DZ);if(z<2||z>14||eta<.65||this.flow(z)>-.15)continue;const score=slope;if(score>best){best=score;idx=i;}}
   if(best>.30&&idx>0){let k=idx;while(k<Math.min(n-2,idx+24)&&h[k+1]+b[k+1]>h[k]+b[k])k++;const s=this.sheets.find(s=>!s.active);if(s){s.active=s.emitting=true;s.age=s.clock=0;s.z=Z0+k*DZ;s.crest=h[k]+b[k];s.c=this.flow(s.z)-Math.sqrt(G*h[k]);s.launchU=Math.min(-7,s.c-Math.sqrt(2*G*s.crest)*.60);s.launchV=Math.sqrt(2*G*s.crest)*.31;s.count=0;s.alive.fill(0);this.nextBreak=this.time+6;this.breakCount++;}}
  }
  this.lastImpact.strength*=Math.exp(-dt/ .45);
  for(const s of this.sheets){if(!s.active)continue;s.age+=dt;s.clock+=dt;
   if(s.emitting){const oldZ=s.z,predicted=s.z+s.c*dt,k=this.index(predicted);let best=k;for(let j=Math.max(2,k-5);j<Math.min(n-2,k+6);j++)if(h[j]+b[j]>h[best]+b[best])best=j;const el=h[best-1]+b[best-1],ec=h[best]+b[best],er=h[best+1]+b[best+1],fraction=clamp(.5*(el-er)/(el-2*ec+er-1e-8),-.5,.5),target=Z0+(best+fraction)*DZ;s.z=clamp(oldZ+(target-oldZ)*(1-Math.exp(-dt/.09)),oldZ-8*dt,oldZ-.5*dt);s.c+=(clamp((s.z-oldZ)/dt,-8,-.5)-s.c)*(1-Math.exp(-dt/.12));s.crest+=(this.height(s.z)-s.crest)*(1-Math.exp(-dt/.06));if(s.age>1.00||s.crest<.25)s.emitting=false;
    if(s.clock>=1/45&&s.count<64){s.clock-=1/45;const i=s.count++,k=this.index(s.z),energy=Math.sqrt(2*G*Math.max(.05,s.crest)),u=this.flow(s.z);s.p[i]=s.z;s.y[i]=s.crest+.015;s.u[i]=s.launchU;s.v[i]=s.launchV;s.mass[i]=Math.min(.012,h[k]*DZ*.08);for(let j=-8;j<=8;j++){const weight=(9-Math.abs(j))/81,m=s.mass[i]*weight/DZ;h[k+j]=Math.max(0,h[k+j]-m);q[k+j]-=u*m;}s.alive[i]=1;this.emitted+=s.mass[i];}
   }
   let live=0;for(let i=0;i<s.count;i++){if(!s.alive[i])continue;s.v[i]-=G*dt;s.p[i]+=s.u[i]*dt;s.y[i]+=s.v[i]*dt;const surface=this.height(s.p[i]);if(s.y[i]<surface&&s.v[i]<0){const k=this.index(s.p[i]),mass=s.mass[i];for(let j=-3;j<=3;j++){const weight=(4-Math.abs(j))/16;h[k+j]+=mass*weight/DZ;q[k+j]+=mass*s.u[i]*weight/DZ;this.foam[k+j]=Math.max(this.foam[k+j],1-Math.abs(j)*.12);}s.alive[i]=0;this.impacts++;this.returned+=mass;const e=this.lastImpact;e.z=s.p[i];e.y=surface;e.strength=1;e.flowZ=s.u[i];e.velocityY=s.v[i];e.foam=1;}else live++;}
   if(!s.emitting&&!live)s.active=false;
  }
 }
}
export class HybridSurf{
 constructor(options={}){this.lanes=Array.from({length:NX},(_,i)=>new Transect(X0+i*DX,options));this.time=0;this.surface=new Float32Array(POINTS*NX*8);this.height=new Float32Array(256);this.foam=new Float32Array(256);this.sampleScratch=new Float64Array(4);this.interpolationScratch=new Float64Array(8);this.characterX=0;this.breakers=[];for(let i=0;i<NX;i++)this.breakers.push({x:X0+i*DX,z:8,y:0,strength:0});this.stats={};}
 step(dt){for(const lane of this.lanes)lane.step(dt);this.time+=dt;}
 save(){const scalars=['active','emitting','clock','age','z','crest','c','count','launchU','launchV'],arrays=['y','p','u','v','mass','alive'],event=['z','y','strength','velocityY','flowZ','foam'],data=new Float64Array(4+NX*(NZ*3+11+2*(10+64*6)));let o=0;data[o++]=140021;data[o++]=NX;data[o++]=NZ;data[o++]=this.time;for(const a of this.lanes){for(const key of ['h','q','foam']){data.set(a[key],o);o+=NZ;}for(const key of ['nextBreak','emitted','returned','impacts','breakCount'])data[o++]=a[key];for(const key of event)data[o++]=a.lastImpact[key];for(const s of a.sheets){for(const key of scalars)data[o++]=Number(s[key]||0);for(const key of arrays){data.set(s[key],o);o+=64;}}}return data.buffer;}
 load(buffer){const d=new Float64Array(buffer);if(d.length!==4+NX*(NZ*3+11+2*(10+64*6))||d[0]!==140021||d[1]!==NX||d[2]!==NZ)throw Error('Hybrid surf state format mismatch');if(!d.every(Number.isFinite))throw Error('Invalid hybrid surf state');let o=4;this.time=d[3];for(const a of this.lanes){a.time=this.time;for(const key of ['h','q','foam']){a[key].set(d.subarray(o,o+NZ));o+=NZ;}for(const key of ['nextBreak','emitted','returned','impacts','breakCount'])a[key]=d[o++];for(const key of ['z','y','strength','velocityY','flowZ','foam'])a.lastImpact[key]=d[o++];for(const s of a.sheets){for(const key of ['active','emitting','clock','age','z','crest','c','count','launchU','launchV'])s[key]=d[o++];for(const key of ['y','p','u','v','mass','alive']){s[key].set(d.subarray(o,o+64));o+=64;}}}return this;}
 // Bounded bilinear occupancy. The sheet has finite thickness; its underside
 // does not fill the air cavity. Contact is independent of the render mesh.
 laneAt(x){return this.lanes[clamp(Math.round((x-X0)/DX),0,NX-1)];}
 sampleLane(a,z,out){const k=a.index(z);out[0]=a.height(z);out[1]=a.vy[k]+a.flow(z)*(a.height(z+DZ)-a.height(z-DZ))/(2*DZ);out[2]=a.flow(z);out[3]=a.foam[k];out[4]=Math.max(0,out[0]-bottom(0,z));out[5]=clamp((a.height(z+DZ)-a.height(z-DZ))/(2*DZ),-3,3);return out;}
 densityLane(a,y,z,out){const eta=a.height(z),k=a.index(z);out[0]=y>bottom(0,z)?clamp((eta-y)/.10+.5,0,1):0;out[1]=a.vy[k]+a.flow(z)*(a.height(z+DZ)-a.height(z-DZ))/(2*DZ);out[2]=a.flow(z);out[3]=a.foam[k];for(const s of a.sheets){if(!s.active)continue;for(let i=1;i<s.count;i++){if(!s.alive[i]||!s.alive[i-1])continue;const dz=s.p[i]-s.p[i-1],dy=s.y[i]-s.y[i-1],t=clamp(((z-s.p[i-1])*dz+(y-s.y[i-1])*dy)/(dz*dz+dy*dy+1e-9),0,1),d=Math.hypot(z-s.p[i-1]-t*dz,y-s.y[i-1]-t*dy),fill=clamp((.14-d)/.10,0,1);if(fill>out[0]){out[0]=fill;out[1]=s.v[i];out[2]=s.u[i];out[3]=.35;}}}return out;}
 sample(z,out){const f=clamp((this.characterX-X0)/DX,0,NX-1.000001),i=Math.floor(f),t=f-i;this.sampleLane(this.lanes[i],z,out);this.sampleLane(this.lanes[i+1],z,this.interpolationScratch);for(let k=0;k<6;k++)out[k]+=(this.interpolationScratch[k]-out[k])*t;return out;}
 density(y,z,out){const f=clamp((this.characterX-X0)/DX,0,NX-1.000001),i=Math.floor(f),t=f-i;this.densityLane(this.lanes[i],y,z,out);this.densityLane(this.lanes[i+1],y,z,this.interpolationScratch);for(let k=0;k<4;k++)out[k]+=(this.interpolationScratch[k]-out[k])*t;return out;}
 react(x,z,impulse){const fx=clamp((x-X0)/DX,0,NX-1.000001),ix=Math.floor(fx),tx=fx-ix,fz=clamp((z-Z0)/DZ,1,NZ-2.000001),iz=Math.floor(fz),tz=fz-iz;for(let j=0;j<2;j++)for(let k=0;k<2;k++)this.lanes[ix+j].q[iz+k]+=impulse*(j?tx:1-tx)*(k?tz:1-tz)/(1000*DX*DZ);}
 contact(y,z,pitch,out,scratch){let wet=0,vy=0,vz=0,foam=0,foot=0;const c=Math.cos(pitch),s=Math.sin(pitch);for(let j=0;j<7;j++)for(let k=-1;k<=1;k++){const dy=-.75+j*.25,yy=y+dy*c,zz=z+dy*s+k*.18,w=(k===0?.5:.25)/7;if(yy<bottom(0,zz))continue;this.density(yy,zz,scratch);const volume=scratch[0]*w;wet+=volume;vy+=scratch[1]*volume;vz+=scratch[2]*volume;foam+=scratch[3]*volume;if(j===0)foot+=scratch[0]*w*7;}out[1]=wet?vy/wet:0;out[2]=wet?vz/wet:0;out[3]=wet?foam/wet:0;out[6]=wet;out[7]=foot;}
 writeSurface(){const data=this.surface;data.fill(0);let crestY=-1,crestZ=8,maxOverhang=0,active=0,tubeZ=8,tubeY=1,tubeGap=0;
  for(let lane=0;lane<NX;lane++){const a=this.lanes[lane],offset=lane*POINTS*4,meta=(NX+lane)*POINTS*4;for(let i=0;i<NZ;i++){const z=Z0+i*DZ,fade=clamp((z-50)/10,0,1),blend=fade*fade*(3-2*fade),y=(a.h[i]+a.bed[i])*(1-blend)+incident(a.x,z,this.time)*blend,slope=(a.height(z+DZ)-a.height(z-DZ))/(2*DZ),inv=1/Math.hypot(1,slope);data[offset+i*4]=y;data[offset+i*4+1]=z;data[offset+i*4+2]=inv;data[offset+i*4+3]=-slope*inv;data[meta+i*4]=a.foam[i];data[meta+i*4+1]=clamp(a.h[i]/.04,0,1);if(lane===8&&z>0&&z<30&&a.h[i]>.1&&y>crestY){crestY=y;crestZ=z;}}
   for(let sheet=0;sheet<2;sheet++){const s=a.sheets[sheet];if(s.active)active++;let newest=s.count-1;while(newest>=0&&!s.alive[newest])newest--;let oldest=newest;while(oldest>0&&s.alive[oldest-1])oldest--;const valid=s.active&&newest-oldest>=2,anchorZ=s.emitting?s.z:s.p[Math.max(0,newest)],anchorY=s.emitting?a.height(s.z):s.y[Math.max(0,newest)];
    // A continuous strip ends at its first impact. Retired parcels must never
    // reconnect to the lip; that was the source of the prototype's long tears.
    for(let j=0;j<64;j++){const i=NZ+sheet*64+j,o=offset+i*4,m=meta+i*4,f=j/63*(newest-oldest+1),k=Math.floor(f),t=f-k;let z=anchorZ,y=anchorY,foam=.10;
     if(valid){const ia=clamp(newest-k+1,oldest,newest),ib=clamp(newest-k,oldest,newest),za=k===0?anchorZ:s.p[ia],ya=k===0?anchorY:s.y[ia];z=za+(s.p[ib]-za)*t;y=ya+(s.y[ib]-ya)*t;foam=.10+Math.max(0,-s.v[ib])*.075;}
     data[o]=y;data[o+1]=z;data[o+2]=1;data[o+3]=0;data[m]=foam;data[m+1]=valid?1:0;data[m+3]=valid?.45:0;if(valid)maxOverhang=Math.max(maxOverhang,anchorZ-z);
    }
    for(let j=0;j<64;j++){const i=NZ+sheet*64+j,l=offset+(NZ+sheet*64+Math.max(0,j-1))*4,r=offset+(NZ+sheet*64+Math.min(63,j+1))*4,o=offset+i*4,dy=data[r]-data[l],dz=data[r+1]-data[l+1],inv=1/Math.max(.001,Math.hypot(dy,dz));data[o+2]=-dz*inv;data[o+3]=dy*inv;}
    if(valid){const front=s.p[oldest];if(lane===8){for(let j=oldest;j<=newest;j++){const gap=s.y[j]-a.height(s.p[j]);if(gap>tubeGap){tubeGap=gap;tubeZ=s.p[j];tubeY=a.height(tubeZ)+gap*.5;}}}for(let i=0;i<NZ;i++){const z=Z0+i*DZ;if(z>front&&z<anchorZ){const t=(z-front)/Math.max(.1,anchorZ-front);data[meta+i*4+3]=Math.max(data[meta+i*4+3],Math.sin(t*Math.PI)*.85);}}}
   }
   Object.assign(this.breakers[lane],a.lastImpact);
  }
  // Normals use the very same rendered positions, including the distant
  // boundary blend; no derivative mismatch line at the offshore join.
  for(let lane=0;lane<NX;lane++)for(let i=0;i<NZ;i++){const l=(lane*POINTS+Math.max(0,i-1))*4,r=(lane*POINTS+Math.min(NZ-1,i+1))*4,o=(lane*POINTS+i)*4,dy=data[r]-data[l],dz=data[r+1]-data[l+1],inv=1/Math.hypot(dy,dz);data[o+2]=dz*inv;data[o+3]=-dy*inv;}
  // Inactive strip ends borrow neighboring geometry and fade coverage. Never
  // join a live crest to stale geometry left behind by a previous wave.
  for(let sheet=0;sheet<2;sheet++)for(let lane=0;lane<NX;lane++){const r=NZ+sheet*64;if(data[((NX+lane)*POINTS+r)*4+1]>.5)continue;let nearest=-1;for(let distance=1;distance<NX;distance++){for(let side=-1;side<=1;side+=2){const other=lane+side*distance;if(other>=0&&other<NX&&data[((NX+other)*POINTS+r)*4+1]>.5){nearest=other;break;}}if(nearest>=0)break;}if(nearest>=0)for(let j=0;j<64;j++){const a=(lane*POINTS+r+j)*4,b=(nearest*POINTS+r+j)*4;for(let k=0;k<4;k++)data[a+k]=data[b+k];}}
  for(let lane=0;lane<NX;lane++)for(let i=0;i<POINTS;i++){const l=Math.max(0,lane-1),r=Math.min(NX-1,lane+1),a=(l*POINTS+i)*4,b=(r*POINTS+i)*4,o=(lane*POINTS+i)*4,den=(r-l)*DX;data[((NX+lane)*POINTS+i)*4+2]=-((data[b]-data[a])*data[o+2]+(data[b+1]-data[a+1])*data[o+3])/den;}
  const a=this.laneAt(0);for(let i=0;i<256;i++){const z=-17.8+i*46.3/255;this.height[i]=a.height(z);this.foam[i]=a.foam[a.index(z)];}
  this.stats={crestY,crestZ,maxOverhang,tubeZ,tubeY,tubeGap,activeSheets:active,cells:NX*NZ,contour:'finite-volume + ballistic sheets',breakCount:this.lanes.reduce((n,a)=>n+a.breakCount,0),impacts:this.lanes.reduce((n,a)=>n+a.impacts,0)};return data;
 }
}
