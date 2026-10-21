import * as T from 'three';
// Original procedural instanced foam. Slots are written only on birth; gravity,
// ring expansion and fading run on the GPU. No per-frame geometry rebuilding.
export function createSurfEffects(scene,tier,shore){
 const capacity=tier.particles||640,geo=new T.InstancedBufferGeometry();
 geo.setAttribute('position',new T.Float32BufferAttribute([-1,-1,0,1,-1,0,1,1,0,-1,1,0],3));geo.setIndex([0,1,2,0,2,3]);
 const origins=new Float32Array(capacity*3),velocities=new Float32Array(capacity*3),births=new Float32Array(capacity),life=new Float32Array(capacity),sizes=new Float32Array(capacity),kinds=new Float32Array(capacity),seeds=new Float32Array(capacity),death=new Float64Array(capacity);
 const attrs=[];for(const [name,array,size]of [['instanceOrigin',origins,3],['instanceVelocity',velocities,3],['instanceBirth',births,1],['instanceLife',life,1],['instanceSize',sizes,1],['instanceKind',kinds,1],['instanceSeed',seeds,1]]){const a=new T.InstancedBufferAttribute(array,size).setUsage(T.DynamicDrawUsage);geo.setAttribute(name,a);attrs.push(a);}
 const mat=new T.ShaderMaterial({transparent:true,depthWrite:false,side:T.DoubleSide,uniforms:{time:{value:0},pixelHeight:{value:innerHeight*tier.pixelRatio}},vertexShader:`
 attribute vec3 instanceOrigin,instanceVelocity;attribute float instanceBirth,instanceLife,instanceSize,instanceKind,instanceSeed;
 uniform float time,pixelHeight;varying vec2 effectUV;varying float alpha,kind,seed;
 void main(){float age=time-instanceBirth,t=age/max(.01,instanceLife);effectUV=position.xy;kind=instanceKind;seed=instanceSeed;alpha=step(0.,age)*step(t,1.)*pow(max(0.,1.-t),1.2)*smoothstep(0.,.08,t);
 vec3 p=instanceOrigin+instanceVelocity*max(0.,age);float size=instanceSize;
 if(kind<.5){p.y-=18.*age*age;vec4 q=modelViewMatrix*vec4(p,1.);float maxWorld=36.*max(.1,-q.z)/(projectionMatrix[1][1]*pixelHeight);size=min(size*(1.+t*.6),maxWorld);q.xy+=position.xy*size;gl_Position=projectionMatrix*q;}
 else {size*=1.+t*1.8;p.xz+=position.xy*size;gl_Position=projectionMatrix*modelViewMatrix*vec4(p,1.);}
 if(alpha<.002)gl_Position=vec4(2.,2.,2.,1.);}`,fragmentShader:`
 varying vec2 effectUV;varying float alpha,kind,seed;
 void main(){float r=length(effectUV);if(r>1.)discard;float a;if(kind>.5){float ring=abs(r-.73);a=(1.-smoothstep(.045,.19,ring))*(.64+.36*sin(atan(effectUV.y,effectUV.x)*7.+seed));}else{float lobes=.93+.07*sin(effectUV.x*15.+seed)*sin(effectUV.y*13.-seed);a=(1.-smoothstep(.18,lobes,r))*.8;}if(a*alpha<.015)discard;gl_FragColor=vec4(.96,.995,1.,a*alpha);}`});
 const mesh=new T.Mesh(geo,mat);mesh.frustumCulled=false;mesh.renderOrder=3;geo.instanceCount=0;scene.add(mesh);
 let cursor=0,highest=-1,dirtyMin=capacity,dirtyMax=-1,serial=0,lastEmit=-1,lastCollar=-1,live=0,totalBorn=0;
 function hash(i){let x=(i+19)*0x45d9f3b;x=Math.imul(x^(x>>>16),0x45d9f3b);return ((x^(x>>>16))>>>0)/4294967296;}
 function spawn(t,x,y,z,vx,vy,vz,size,lifetime,kind){const i=cursor++;if(cursor===capacity)cursor=0;origins[i*3]=x;origins[i*3+1]=y;origins[i*3+2]=z;velocities[i*3]=vx;velocities[i*3+1]=vy;velocities[i*3+2]=vz;births[i]=t;life[i]=lifetime;sizes[i]=size;kinds[i]=kind;seeds[i]=hash(++serial)*6.28;death[i]=t+lifetime;dirtyMin=Math.min(dirtyMin,i);dirtyMax=Math.max(dirtyMax,i);highest=Math.max(highest,i);totalBorn++;}
 function splash(t,x,y,z,scale=1){spawn(t,x,y+.15,z,0,0,0,2.2*scale,1.25,1);for(let i=0;i<3;i++){const a=hash(++serial)*6.28;spawn(t,x,y+.3,z,Math.cos(a)*3,6+hash(serial+3)*5,Math.sin(a)*3,1.5*scale,.45+hash(serial+5)*.3,0);}}
 function update(t,breaker,person){if(t<lastEmit){death.fill(0);highest=-1;cursor=0;lastEmit=lastCollar=-1;}mat.uniforms.time.value=t;
  if(t-lastEmit>.095){lastEmit=t;if(breaker&&breaker.strength>.12){const events=tier.name==='software'?3:12;for(let j=0;j<events;j++){const x=(hash(++serial)*215-107.5)*6,z=shore(x)+breaker.z*6,y=breaker.y*6,random=hash(serial+7);spawn(t,x,y+.3,z,0,4+random*10,-2-random*7,.9+random*1.6,.35+random*.45,0);if(j%3===0)spawn(t,x,y+.15,z,0,0,-2,2+random*2,1,1);}}}
  if(person&&person.waterDepth>.05&&t-lastCollar>.32){lastCollar=t;const x=person.x*6,z=shore(x)+person.z*6,y=person.waterHeight*6;splash(t,x,y,z,.7);}
  live=0;for(let i=0;i<=highest;i++)if(death[i]>t)live++;while(highest>=0&&death[highest]<=t)highest--;geo.instanceCount=highest+1;
  if(dirtyMax>=dirtyMin){for(const a of attrs){a.updateRange.offset=dirtyMin*a.itemSize;a.updateRange.count=(dirtyMax-dirtyMin+1)*a.itemSize;a.needsUpdate=true;}dirtyMin=capacity;dirtyMax=-1;}
 }
 return {mesh,update,splash,diagnostics:()=>({capacity,live,drawSlots:geo.instanceCount,totalBorn,vertices:4,trianglesPerInstance:2,gpuAnimated:true})};
}
