import assert from 'node:assert/strict';
// Pure grid experiment: same columns, allocate them to curvature and view.
import {createCoastGrid} from '../../js/coast/coast-grid.mjs';

const shore=x=>{const n=(x+1245)/1290;let s=Math.sin(n*Math.PI)*60+Math.sin(n*Math.PI*2)*20+50;if(n>=.6&&n<=1){const t=(n-.6)/.4;s+=t*t*(3-2*t)*Math.sin(t*Math.PI)*100;}return -s;};
function maxError(xs){let error=0;for(let i=0;i<xs.length-1;i++){const l=xs[i],r=xs[i+1],yl=shore(l*6)/6,yr=shore(r*6)/6;for(let k=1;k<32;k++){const t=k/32;if(Math.abs(l+(r-l)*t)<=107.5)error=Math.max(error,Math.abs(shore((l+(r-l)*t)*6)/6-(yl+(yr-yl)*t)));}}return error;}
const rows=[];for(const columns of[20,48])for(const center of[-100,-40,0,40,100]){const old=new Float64Array(columns),next=new Float64Array(columns),scores=new Float64Array(columns);for(let c=0;c<columns;c++){const u=2*c/(columns-1)-1;old[c]=center+Math.sign(u)*Math.abs(u)**1.8*(u<0?center+121:121-center);}next.set(createCoastGrid(shore,columns).update(center));const before=maxError(old),after=maxError(next);assert(after<before);for(let i=1;i<next.length;i++)assert(next[i]>next[i-1]);rows.push({columns,center,before,after});}
console.log(JSON.stringify({rows,passed:true}));
