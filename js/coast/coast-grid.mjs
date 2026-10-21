// Keep the existing view budget, but spend columns on actual shoreline bends.
// Factory-scoped work arrays/helpers are reused; stationary views cost nothing.
export function createCoastGrid(shore,columns){
 const x=new Float64Array(columns),score=new Float64Array(columns);let focus=NaN;
 function interval(a,b){
  const l=x[a],r=x[b],width=r-l,yl=shore(l*6)/6,yr=shore(r*6)/6;let error=0;
  for(let k=1;k<4;k++){const t=k/4;error=Math.max(error,Math.abs(shore((l+width*t)*6)/6-(yl+(yr-yl)*t)));}
  const distance=Math.abs((l+r)*.5-focus);return error+.003*width*width/(1+distance*.05)**2;
 }
 function update(center){
  center=Math.max(-100,Math.min(100,center));if(center===focus)return x;focus=center;x[0]=-121;x[1]=121;score[0]=interval(0,1);let n=2;
  while(n<columns){let best=0;for(let j=1;j<n-1;j++)if(score[j]>score[best])best=j;const mid=(x[best]+x[best+1])*.5;for(let j=n;j>best+1;j--){x[j]=x[j-1];score[j]=score[j-1];}x[best+1]=mid;n++;score[best]=interval(best,best+1);score[best+1]=interval(best+1,best+2);}
  return x;
 }
 return {x,update};
}
