// Invoke this runner through Resource_Governor/aiwork.py on the owner's PC.
const {spawnSync}=require('node:child_process'),path=require('node:path');
function run(file,args=[],env={}){const r=spawnSync(process.execPath,[path.join(__dirname,file),...args],{stdio:'inherit',env:{...process.env,SURF_CANONICAL:'1',...env}});if(r.status!==0)process.exit(r.status||1);}
run('contact-test.mjs');run('physics-test.mjs');
run('measure.cjs',[],{SURF_OUT:path.join(__dirname,'../../verification/v13/installed')});
run('measure.cjs',['--software'],{SURF_OUT:path.join(__dirname,'../../verification/v13/installed')});
run('paced.cjs',[],{SURF_PACED:'1',SURF_OUT:path.join(__dirname,'../../verification/v13/installed-paced')});
run('smoke.cjs',[],{SURF_SMOKE_OUT:path.join(__dirname,'../../verification/v13/installed-smoke-gpu')});
run('hero.cjs',[],{SURF_SMOKE_OUT:path.join(__dirname,'../../verification/v13/installed-hero')});
run('publisher-smoke.cjs');
