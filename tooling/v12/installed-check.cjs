const {spawnSync}=require('node:child_process');
for(const file of ['height-physics.mjs','beach-worker.mjs','surf-effects.mjs','beach-ocean.mjs']){
 const r=spawnSync(process.execPath,['--check','js/coast/'+file],{stdio:'inherit'});if(r.status!==0)process.exit(1);
}
for(const file of ['contact-test.mjs','height-test.mjs']){
 const r=spawnSync(process.execPath,['tooling/v12/'+file],{stdio:'inherit'});if(r.status!==0)process.exit(1);
}
console.log('Installed syntax, occupancy fixtures and live-fluid regression passed.');
