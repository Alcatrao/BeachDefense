import assert from 'node:assert/strict';
import fs from 'node:fs';
import {performance} from 'node:perf_hooks';
import {makeFluidSolver} from '../../js/coast/fluid.mjs';
import {makeFluidSolver as baselineFactory} from './baseline-fluid.mjs';

const options={sourceAmplitude:1.55,sourceK:.20,symmetry:true,separate:true,periodic:true};
const raw=fs.readFileSync(new URL('../../js/coast/initial-state.bin',import.meta.url));
const data=raw.buffer.slice(raw.byteOffset,raw.byteOffset+raw.byteLength),header=new Float64Array(data,0,2),n=header[0];
function create(factory,extra={}){
 const Section=factory({width:.48,spacing:.12,cell:.16});
 const f=new Section({options:{...options,...extra}});
 f.p.set(new Float64Array(data,16,n*3));f.v.set(new Float64Array(data,16+n*24,n*3));
 f.foam.set(new Float64Array(data,16+n*48,n));f.time=header[1];f.rebuild();return f;
}
const old=create(baselineFactory),current=create(makeFluidSolver);
const timing={baseline:[],optimized:[]};
for(let frame=0;frame<60;frame++){
 for(const [name,f] of frame%2?[['optimized',current],['baseline',old]]:[['baseline',old],['optimized',current]]){
  const start=performance.now();f.step(1/60);if(frame>=10)timing[name].push(performance.now()-start);
 }
 assert.deepEqual(current.p.subarray(0,n*3),old.p.subarray(0,n*3),'positions changed');
 assert.deepEqual(current.v.subarray(0,n*3),old.v.subarray(0,n*3),'velocities changed');
 assert.deepEqual(current.foam.subarray(0,n),old.foam.subarray(0,n),'foam changed');
 if(frame===0)current.cacheIdentity=current.separationCache;
 assert.equal(current.separationCache,current.cacheIdentity,'scratch storage was replaced');
}
const average=a=>a.reduce((s,x)=>s+x,0)/a.length;
const result={exactPhysicsFrames:60,dt:1/60,unchangedParticleCount:n,
 separationScratchBytes:current.separationCache.head.byteLength+current.separationCache.next.byteLength+
  current.separationCache.cy.byteLength+current.separationCache.cz.byteLength,
 baselineMs:average(timing.baseline),optimizedMs:average(timing.optimized)};
result.avoidedScratchAllocationBytesPerSecond=result.separationScratchBytes*60;
// Inspect swash using the existing source and an offline no-sponge candidate.
// Candidate results do not change the installed runtime or authorize acceptance.
result.swash={};
for(const [name,extra] of [['installed',{}],['noShoreSponge',{sponge:false}]]){
 const f=create(makeFluidSolver,extra),samples=[];
 for(let frame=0;frame<720;frame++){
  f.step(1/60);
  if(frame%30!==29)continue;
  let front=Infinity,foam=0,shoreward=0,seaward=0,nearshore=0;
  for(let i=0;i<f.n;i++){
   const a=i*3,z=f.p[a+2];assert(Number.isFinite(z));front=Math.min(front,z);
   if(z<2){nearshore++;if(f.v[a+2]<-.1)shoreward++;if(f.v[a+2]>.1)seaward++;if(f.foam[i]>.35)foam++;}
  }
  samples.push({time:f.time,front,nearshore,shoreward,seaward,foam});
 }
 result.swash[name]=samples;
}
const out=new URL('../../verification/v8/',import.meta.url);fs.mkdirSync(out,{recursive:true});
fs.writeFileSync(new URL('physics-and-swash.json',out),JSON.stringify(result,null,2));
console.log(JSON.stringify({...result,swash:Object.fromEntries(Object.entries(result.swash).map(([k,v])=>[k,{minFront:Math.min(...v.map(x=>x.front)),peakShoreward:Math.max(...v.map(x=>x.shoreward)),peakSeaward:Math.max(...v.map(x=>x.seaward))}]))}));
