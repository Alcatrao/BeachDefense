import assert from 'node:assert/strict';
import {createSectionContour as previous} from './pre/section-contour.mjs';
import {createSectionContour as candidate} from '../../js/coast/section-contour.mjs';
const ny=70,nz=180,h=.05,y0=-1.75,z0=0,S=ny*nz,d=new Float32Array(S),f=new Float32Array(S),w=new Float32Array(S).fill(2);
// A smooth wave crosses the grid at very unequal distances. Reparameterization
// should remove point clusters while retaining that smooth physical shape.
for(let k=0;k<nz;k++)for(let j=0;j<ny;j++){const y=y0+j*h,z=k*h;d[j+k*ny]=1+(.23*Math.sin(z*1.7)+.013*Math.sin(z*31)-y)*12;f[j+k*ny]=.5+.2*Math.sin(z*.7);}
const stats=c=>{c.extract(d,f,w);let min=Infinity,max=0,sum=0,error=0;for(let i=0;i<c.segments;i++){const a=c.links[i*2],b=c.links[i*2+1],length=Math.hypot(c.y[a]-c.y[b],c.z[a]-c.z[b]);min=Math.min(min,length);max=Math.max(max,length);sum+=length;for(const id of[a,b])error=Math.max(error,Math.abs(c.y[id]-(.23*Math.sin(c.z[id]*1.7)+.013*Math.sin(c.z[id]*31))));}return{...c.diagnostics(),minLength:min,maxLength:max,meanLength:sum/c.segments,spacingRatio:max/min,maxPhysicalHeightError:error};};
const before=stats(previous(ny,nz,h,y0,z0)),after=stats(candidate(ny,nz,h,y0,z0));assert.equal(before.points,after.points);assert.equal(after.invalidDegree,0);assert(after.spacingRatio<before.spacingRatio);assert(after.maxPhysicalHeightError<.025);console.log(JSON.stringify({before,after,passed:true}));
