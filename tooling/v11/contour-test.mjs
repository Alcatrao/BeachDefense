import assert from 'node:assert/strict';
import {createSectionContour} from '../../js/coast/section-contour.mjs';
const ny=70,nz=70,h=.05,y0=-1.75,z0=-1.75,S=ny*nz,d=new Float32Array(S),f=new Float32Array(S),liquid=new Float32Array(S).fill(2),c=createSectionContour(ny,nz,h,y0,z0);
// An annulus has an interior air pocket and an exterior: two distinct closed
// strands. Fairing may not join them or erase the pocket.
for(let k=0;k<nz;k++)for(let j=0;j<ny;j++){const r=Math.hypot(y0+j*h,z0+k*h);d[j+k*ny]=1+2*Math.min(r-.55,1.25-r);}
c.extract(d,f,liquid);assert(c.count>100);for(let i=0;i<c.count;i++){assert.equal(c.degree[i],2);assert(Number.isFinite(c.normalY[i]));assert(Math.abs(Math.hypot(c.normalY[i],c.normalZ[i])-1)<1e-5);}
const visited=new Uint8Array(c.count);let components=0;for(let i=0;i<c.count;i++){if(visited[i])continue;components++;let p=-1,q=i;while(!visited[q]){visited[q]=1;const n=c.prev[q]===p?c.next[q]:c.prev[q];p=q;q=n;}}assert.equal(components,2);assert(c.diagnostics().maxFairingDisplacement<=.070001);
const annulus=c.diagnostics();
// Isolated bilinear saddle with all four crossings: two connections, never a
// four-way vertex. Test both signs of the asymptotic determinant.
const small=4,dc=new Float32Array(16),fc=new Float32Array(16),lc=new Float32Array(16).fill(2),s=createSectionContour(small,small,1,0,0);
dc.fill(0);dc[5]=3;dc[6]=0;dc[10]=3;dc[9]=0;s.extract(dc,fc,lc);assert.equal(s.count,4);assert.equal(s.segments,2);assert.equal(s.diagnostics().ambiguousCells,1);for(let i=0;i<4;i++)assert.equal(s.degree[i],1);const positive=Array.from(s.links.slice(0,4));
dc[5]=1.2;dc[10]=1.2;s.extract(dc,fc,lc);assert.equal(s.count,4);assert.equal(s.segments,2);for(let i=0;i<4;i++)assert.equal(s.degree[i],1);
// Connectivity differs geometrically (edge coordinates), regardless of node IDs.
const endpoints=[];for(let i=0;i<s.segments;i++){const a=s.links[i*2],b=s.links[i*2+1];endpoints.push([[s.y[a],s.z[a]],[s.y[b],s.z[b]]]);}
assert(endpoints.some(pair=>pair.every(p=>p[0]<1.3||p[1]<1.3)));
console.log(JSON.stringify({annulus,components,saddle:s.diagnostics(),positiveSaddleLinks:positive,negativeSaddleEndpoints:endpoints,passed:true}));
