import {HeightField,HeightCharacter} from './height-physics.mjs';
// One live physical section supplies both the visible breaker and the cheap
// gameplay height/velocity sampler. No second 24k-marker character volume.
const field=new HeightField();let ambient={n:0,time:0,p:new Float32Array(0),v:new Float32Array(0),foam:new Float32Array(0)},person=null,physicsMs=0,ambientMs=0,ambientDropped=0,maxParcelStepRms=0,bodyTime=0,breaker={z:8,y:0,strength:0},input={},waiting=false,pending=[],pool=null,seq=0;
const requests=new Map(),background=new Worker(new URL('./ambient-worker.mjs',import.meta.url),{type:'module'});let readyResolve;const initialized=new Promise(resolve=>readyResolve=resolve);
background.onerror=e=>{throw Error(e.message);};
background.onmessage=e=>{const m=e.data;ambient.n=m.n;ambient.time=m.time;ambient.p=new Float32Array(m.p);ambient.v=new Float32Array(m.v);ambient.foam=new Float32Array(m.foam);ambientMs=m.stepMs;ambientDropped=m.dropped;maxParcelStepRms=m.maxParcelStepRms;
 const start=performance.now();field.update(ambient.p,ambient.v,ambient.foam,ambient.n);
 let best=0;breaker.strength=0;for(let k=0;k<field.n;k++){const z=field.z0+k*field.dz;if(z<.5||z>14)continue;const strength=field.foam[k]*(.25+Math.max(0,-field.vy[k]));if(strength>best){best=strength;breaker.z=z;breaker.y=field.h[k];breaker.strength=strength;breaker.flowZ=field.vz[k];breaker.velocityY=field.vy[k];breaker.foam=field.foam[k];}}
 if(person)while(bodyTime<ambient.time-1e-7){const dt=Math.min(1/120,ambient.time-bodyTime);person.step(dt,input,field);bodyTime+=dt;}else bodyTime=ambient.time;physicsMs=performance.now()-start;
 if(!pool&&!waiting)pool={ap:new Float32Array(ambient.n*3),af:new Float32Array(ambient.n),height:new Float32Array(field.n)};
 if(m.id===0)readyResolve();if(m.id){requests.get(m.id)?.();requests.delete(m.id);}snapshot();
};
function ambientCommand(type,args={}){const id=++seq;return new Promise(resolve=>{requests.set(id,resolve);background.postMessage({type,id,...args});});}
function snapshot(){if(waiting||!pool)return;pool.ap.set(ambient.p);pool.af.set(ambient.foam);pool.height.set(field.h);const p=new ArrayBuffer(0),foam=new ArrayBuffer(0),data={type:'state',ids:pending.splice(0),p,foam,ap:pool.ap.buffer,af:pool.af.buffer,height:pool.height.buffer,diagnostics:{particles:0,ambientParticles:ambient.n,time:ambient.time,localTime:bodyTime,originX:0,rider:person?.diagnostics()||null,dryBeach:!!person?.dry,board:null,localActive:!!person,physicsMs,ambientMs,ambientDropped,backgroundMode:'live',characterModel:'particle-volume-and-flow',breaker,oneWayCoupling:true,maxParcelStepRms,phaseError:person?bodyTime-ambient.time:0,droppedTime:ambientDropped}};waiting=true;pool=null;postMessage(data,[data.p,data.foam,data.ap,data.af,data.height]);}
let queue=Promise.resolve();onmessage=e=>{const m=e.data;if(m.type==='recycle'){pool={ap:new Float32Array(m.ap),af:new Float32Array(m.af),height:new Float32Array(m.height)};waiting=false;if(pending.length)snapshot();return;}if(m.type==='input'){input=m.input;return;}
 queue=queue.then(async()=>{await initialized;
  if(m.type==='playing')await ambientCommand('playing',{value:m.value});
  if(m.type==='advance')for(let i=0;i<m.count;i+=2)await ambientCommand('advance',{count:Math.min(2,m.count-i)});
  if(m.type==='mount'){person=new HeightCharacter(m);bodyTime=ambient.time;}
  if(m.type==='leave')person=null;
  if(m.type==='reset'){person=null;await ambientCommand('reset');bodyTime=ambient.time;}
  if(m.id)pending.push(m.id);snapshot();
 }).catch(error=>{throw error;});};
