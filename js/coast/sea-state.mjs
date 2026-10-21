// Physical tank forcing. The tube is produced by the pressure solve and seabed,
// never by prescribing a curl path. Units are metres and seconds.
export const SEA_STATE=Object.freeze({period:8,stroke:5,depth:3,nominalHeight:2.3,groupPeriod:48,groupVariation:.10});
export function waveNumber(period,depth){const omega=2*Math.PI/period;let k=omega*omega/9.81;for(let i=0;i<12;i++){const q=k*depth,t=Math.tanh(q);k-=(9.81*k*t-omega*omega)/(9.81*(t+q*(1-t*t)));}return k;}
export const SWELL_K=waveNumber(SEA_STATE.period,SEA_STATE.depth);
export const SURF_OPTIONS=Object.freeze({source:false,period:SEA_STATE.period,stroke:SEA_STATE.stroke,delay:0,groupPeriod:SEA_STATE.groupPeriod,groupVariation:SEA_STATE.groupVariation,symmetry:true,separate:true,periodic:true});
