import 'node:fs';
import assert from 'node:assert/strict';import fs from 'node:fs';
import {HybridSurf,NX,NZ,DX,DZ,Z0,bottom} from '../../js/coast/hybrid-surf.mjs';
import {HeightCharacter} from '../../js/coast/height-physics.mjs';
fs.mkdirSync(new URL('../../verification/v14/',import.meta.url),{recursive:true});
const mass=f=>f.lanes.reduce((s,a)=>s+a.h.reduce((n,h)=>n+h,0)*DX*DZ,0);
const rest=new HybridSurf({forcing:false}),mass0=mass(rest);for(let i=0;i<480;i++)rest.step(1/240);const restFlow=Math.max(...rest.lanes[8].q.map(Math.abs));assert(restFlow<1e-10);assert(Math.abs(mass(rest)-mass0)<1e-9);
const f=new HybridSurf(),s=new Float64Array(8),d=new Float64Array(4),body=new HeightCharacter({z:6.5,y:.95,speed:-3});let minForce=0,maxForce=0,air=0,lipContact=0,peak=0,trough=0,wetFront=0,runup=0,returning=0,maxGap=0,skimFrames=0,wipedFrames=0,minVz=0,maxVz=0;
const start=performance.now(),breakTimes=[],rows=[],stepTimes=[];let lastBreak=0;
for(let i=0;i<120*60;i++){const t=performance.now();for(let j=0;j<4;j++){f.step(1/240);if(j%2===1){f.characterX=body.p[0];body.step(1/120,{},f);}}stepTimes.push(performance.now()-t);const a=f.lanes[8];minForce=Math.min(minForce,body.waterForceZ);maxForce=Math.max(maxForce,body.waterForceZ);minVz=Math.min(minVz,body.v[2]);maxVz=Math.max(maxVz,body.v[2]);if(body.skim)skimFrames++;if(body.wiped)wipedFrames++;
 assert(body.p.every(Number.isFinite)&&body.v.every(Number.isFinite));assert(body.sample[6]>=0&&body.sample[6]<=1.000001);assert(Math.abs(Math.hypot(...body.q)-1)<1e-8);
 if(a.breakCount>lastBreak){breakTimes.push(f.time);lastBreak=a.breakCount;}
 if(i%6===0){f.characterX=0;f.writeSurface();maxGap=Math.max(maxGap,f.stats.tubeGap);for(let k=0;k<NZ;k++){assert(Number.isFinite(a.h[k])&&a.h[k]>=0&&Number.isFinite(a.q[k]));const z=Z0+k*DZ;if(z>1&&z<25){peak=Math.max(peak,a.h[k]+a.bed[k]);trough=Math.min(trough,a.h[k]+a.bed[k]);}if(a.h[k]>.06)wetFront=Math.min(wetFront,z);if(z<0&&a.h[k]>.08){runup=Math.min(runup,a.flow(z));returning=Math.max(returning,a.flow(z));}}
  for(const sheet of a.sheets){if(!sheet.active)continue;for(let j=1;j<sheet.count;j++){if(!sheet.alive[j]||!sheet.alive[j-1])continue;const y=(sheet.y[j]+sheet.y[j-1])*.5,z=(sheet.p[j]+sheet.p[j-1])*.5;f.density(y,z,d);if(d[0]>.2&&d[2]<-1)lipContact++;const floor=a.height(z);if(y-floor>.5){f.density((y+floor)*.5,z,d);if(d[0]<.02)air++;}}}
 }
 if(i%60===0)for(const lane of f.lanes)assert(lane.h.every(x=>Number.isFinite(x)&&x>=0)&&lane.q.every(Number.isFinite));if(i%60===0)rows.push({time:f.time,...f.stats,body:body.diagnostics()});
}
assert(air>0&&lipContact>0);assert(maxGap>1);assert(runup<-1&&returning>.2);assert(wetFront< -3);assert(minForce<-100&&maxForce>10);assert(skimFrames>0);assert(breakTimes.length>=10);const intervals=breakTimes.slice(2).map((t,i)=>t-breakTimes[i+1]);assert(intervals.every(v=>v>6&&v<10));
let balance=0;for(const a of f.lanes){const outstanding=a.sheets.reduce((n,s)=>n+s.mass.reduce((v,m,i)=>v+(s.alive[i]?m:0),0),0);balance=Math.max(balance,Math.abs(a.emitted-a.returned-outstanding));}assert(balance<1e-9);
// Reaction is the equal-and-opposite cross-shore drag impulse, not a wave kick.
const momentum=f=>f.lanes.reduce((n,a)=>n+a.q.reduce((s,v)=>s+v,0)*1000*DX*DZ,0),p0=momentum(rest);rest.react(1,8,-12.5);assert(Math.abs(momentum(rest)-p0+12.5)<1e-8);
stepTimes.sort((a,b)=>a-b);const report={seconds:120,wallMs:performance.now()-start,solverBodyMeanMs:stepTimes.reduce((s,x)=>s+x,0)/stepTimes.length,solverBodyP95Ms:stepTimes[Math.floor(stepTimes.length*.95)],cells:NX*NZ,restFlow,restMassError:mass(rest)-mass0,sheetMassError:balance,peak,trough,crestTroughRange:peak-trough,maxGap,wetFront,runup,returning,minForce,maxForce,minVz,maxVz,airProbes:air,lipContactProbes:lipContact,skimFrames,wipedFrames,breakTimes,intervals,rows};fs.writeFileSync(new URL('../../verification/v14/physics-result.json',import.meta.url),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,rows:undefined}));
