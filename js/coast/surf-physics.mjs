import {Fluid3D,G,SCALE,WIDTH,LENGTH,bottom} from './fluid.mjs';
export {G,SCALE,WIDTH,LENGTH,bottom};
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
export function rotate(q,v){const u=[q[0],q[1],q[2]],t=cross(u,v).map(x=>2*x),c=cross(u,t);return v.map((x,i)=>x+q[3]*t[i]+c[i]);}
export class Character{
 constructor(x=0,y=.9,z=12){this.p=[x,y,z];this.v=[0,0,0];this.q=[0,0,0,1];this.w=[0,0,0];this.mass=75;this.inertia=[19,2.6,19];this.contacts=0;this.contactImpulse=0;this.skim=true;this.wiped=false;this.totalImpulse=0;}
 get x(){return this.p[0];}get y(){return this.p[1];}get z(){return this.p[2];}get vx(){return this.v[0];}get vy(){return this.v[1];}get vz(){return this.v[2];}get angle(){return Math.acos(Math.max(-1,Math.min(1,rotate(this.q,[0,1,0])[1])));}
 local(v){return rotate([-this.q[0],-this.q[1],-this.q[2],this.q[3]],v);}
 point(local){const r=rotate(this.q,local);return this.p.map((x,i)=>x+r[i]);}
 velocity(point){const r=point.map((x,i)=>x-this.p[i]),a=cross(this.w,r);return this.v.map((x,i)=>x+a[i]);}
 invInertia(v){const local=this.local(v);return rotate(this.q,local.map((x,i)=>x/this.inertia[i]));}
 impulse(j,point=this.p){for(let i=0;i<3;i++)this.v[i]+=j[i]/this.mass;const torque=cross(point.map((x,i)=>x-this.p[i]),j),angular=this.invInertia(torque);for(let i=0;i<3;i++)this.w[i]+=angular[i];this.totalImpulse+=Math.hypot(...j);}
 advance(dt,input={}){this.contacts=0;this.contactImpulse=0;this.v[1]-=G*dt;this.v[0]+=(input.x||0)*3*dt;this.v[2]+=(input.z||0)*3*dt;
  if(input.jump&&this.skim){this.v[1]+=2.2;this.skim=false;this.wiped=true;}
  for(let i=0;i<3;i++)this.p[i]+=this.v[i]*dt;
  const [x,y,z,w]=this.q,[a,b,c]=this.w;this.q=[x+.5*dt*(a*w+b*z-c*y),y+.5*dt*(-a*z+b*w+c*x),z+.5*dt*(a*y-b*x+c*w),w-.5*dt*(a*x+b*y+c*z)];const len=Math.hypot(...this.q);this.q=this.q.map(x=>x/len);
  this.w=this.w.map(x=>x*Math.exp(-.18*dt));if(this.angle>Math.PI/3){this.skim=false;this.wiped=true;}
  this.p[2]=Math.max(-7,Math.min(LENGTH-1,this.p[2]));
 }
 contactParticle(fluid,i,dt){const a=i*3,point=[fluid.p[a],fluid.p[a+1],fluid.p[a+2]],r=this.local(point.map((x,k)=>x-this.p[k]));let normal=null,depth=Infinity;
  for(const box of [{c:[0,0,0],h:[.24,.85,.20]},...(this.skim?[{c:[0,-.88,0],h:[.38,.012,.58],sole:true}]:[])]){
   const local=r.map((x,k)=>x-box.c[k]),dist=local.map((x,k)=>box.h[k]+.035-Math.abs(x));if(dist.some(x=>x<=0))continue;
   const axis=box.sole?1:dist.indexOf(Math.min(...dist));if(dist[axis]<depth){depth=dist[axis];normal=[0,0,0];normal[axis]=local[axis]>=0?1:-1;}
  }if(!normal)return false;
  const n=rotate(this.q,normal),arm=point.map((x,k)=>x-this.p[k]),bv=this.velocity(point),rv=[fluid.v[a]-bv[0],fluid.v[a+1]-bv[1],fluid.v[a+2]-bv[2]],vn=dot(rv,n),rn=cross(arm,n),effective=1/fluid.mass+1/this.mass+dot(rn,this.invInertia(rn));
  const j=Math.max(0,(-vn+Math.min(.6,depth*.12/dt))/effective);for(let k=0;k<3;k++){fluid.p[a+k]+=n[k]*Math.min(depth,.08);fluid.v[a+k]+=n[k]*j/fluid.mass;}
  this.impulse(n.map(x=>-x*j),point);this.contacts++;this.contactImpulse+=j;fluid.foam[i]=Math.max(fluid.foam[i],.8);return true;
 }
 couple(fluid,dt){
  // Finite active stance: a force couple at wet feet balances the body and
  // returns the opposing angular impulse to the liquid, rather than locking pose.
  if(this.skim){const up=rotate(this.q,[0,1,0]),tilt=cross(up,[0,1,0]),torque=tilt.map((x,k)=>Math.max(-180,Math.min(180,600*x-100*this.w[k])));
   for(const axis of [0,2]){const offset=axis===0?[0,0,.35]:[.3,0,0],a=this.point([offset[0],-1.02,offset[2]]),b=this.point([-offset[0],-1.02,-offset[2]]),arm=a.map((x,k)=>x-b[k]);
    const target=[0,0,0];target[axis]=torque[axis]*dt;const j=cross(target,arm).map(x=>x/dot(arm,arm));
    if(fluid.field(...a).fill>.08&&fluid.field(...b).fill>.08){fluid.reaction(...a,...j);fluid.reaction(...b,...j.map(x=>-x));this.impulse(j,a);this.impulse(j.map(x=>-x),b);}
   }
  }
  const samples=[];for(let k=0;k<7;k++)samples.push({p:[0,-.72+k*.24,0],volume:.075/7,area:.4/7,drag:1,sole:false});
  if(this.skim)for(const x of [-.25,.25])for(const z of [-.42,0,.42])samples.push({p:[x,-.88,z],volume:.002,area:.7/6,drag:.055,sole:true});
  for(const s of samples){const p=this.point(s.p),f=fluid.field(...p),fill=Math.max(0,Math.min(1,(f.fill-.07)/.5));if(!fill)continue;const bv=this.velocity(p),rv=[bv[0]-f.vx,bv[1]-f.vy,bv[2]-f.vz],speed=Math.hypot(...rv),force=rv.map(x=>-.5*1000*s.drag*s.area*fill*speed*x);force[1]+=1000*G*s.volume*fill;
   if(s.sole){const up=rotate(this.q,[0,1,0]),flow=Math.hypot(rv[0],rv[2]),lift=.5*1000*.6*s.area*flow*flow*fill*Math.max(0,up[1]);for(let k=0;k<3;k++)force[k]+=up[k]*lift;}
   const length=Math.hypot(...force),scale=Math.min(1,75*30/samples.length/Math.max(length,1));const j=force.map(x=>x*scale*dt);
   if(fluid.reaction(...p,...j))this.impulse(j,p);
  }
 }
 ground(fluid){for(const x of [-.24,.24])for(const y of [-.85,.85])for(const z of [-.2,.2]){const p=this.point([x,y,z]),floor=fluid.bed(p[0],p[2]);if(p[1]>=floor)continue;this.p[1]+=Math.min(.15,floor-p[1]);const sz=(fluid.bed(p[0],p[2]+.01)-fluid.bed(p[0],p[2]-.01))/.02,n=[0,1,-sz],len=Math.hypot(...n);for(let k=0;k<3;k++)n[k]/=len;
   const bv=this.velocity(p),vn=dot(bv,n),r=cross(p.map((x,k)=>x-this.p[k]),n);if(vn<0)this.impulse(n.map(x=>-vn*x/(1/75+dot(r,this.invInertia(r)))),p);}}
 diagnostics(){return {position:[...this.p],velocity:[...this.v],quaternion:[...this.q],angularVelocity:[...this.w],tiltDegrees:this.angle*180/Math.PI,contacts:this.contacts,totalImpulse:this.totalImpulse,skimming:this.skim,wiped:this.wiped};}
}
export class SurfWorld{
 constructor(options={}){this.fluid=new Fluid3D({options:{periodic:true,pressureIterations:40,...options}});this.person=null;this.board=null;this.originX=0;}
 mount(z=12,x=0,speed=-3){this.person=new Character(x,.88,z);this.person.v[2]=speed;}
 swim(z,y,x=0){this.person=new Character(x,y,z);this.person.skim=false;}
 step(dt,input={}){if(this.person)this.person.advance(dt,input);if(this.person){const dx=this.person.p[0];this.originX=Math.max(-107,Math.min(107,this.originX+dx));this.person.p[0]=0;const f=this.fluid;for(let i=0;i<f.n;i++)f.p[i*3]=((f.p[i*3]-dx+WIDTH/2)%WIDTH+WIDTH)%WIDTH-WIDTH/2;}this.fluid.step(dt,this.person);if(this.person)this.person.ground(this.fluid);}
 reset(){this.fluid.reset();this.person=null;this.originX=0;}
 get attached(){return this.person?.skim||false;}get breakReason(){return this.person?.wiped?'Lost skimming stance':null;}
 diagnostics(){const p=this.person,feet=p?.point([0,-.85,0]);const dryBeach=!!p&&p.z<-.8&&p.contacts===0&&feet[1]<=this.fluid.bed(feet[0],feet[2])+.15&&Math.abs(p.vy)<.5&&this.fluid.field(...feet).fill<.07;return {...this.fluid.diagnostics(),originX:this.originX,rider:p?.diagnostics()||null,dryBeach,board:null};}
}
