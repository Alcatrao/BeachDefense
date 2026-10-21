const {spawnSync}=require('node:child_process'),path=require('node:path');
function run(file,args=[],env={}){
 console.log('BEGIN '+file+' '+args.join(' '));
 const r=spawnSync(process.execPath,[path.join(__dirname,file),...args],{stdio:'inherit',env:{...process.env,SURF_CANONICAL:'',...env}});
 console.log(JSON.stringify({file,args,status:r.status,signal:r.signal,error:r.error?.message}));
 if(r.status!==0)process.exit(1);
}
run('contact-test.mjs');run('height-test.mjs');
for(const args of [[],['--software']])run('measure.cjs',args,{SURF_OUT:path.join(__dirname,'final')});
for(const args of [[],['--software']])run('smoke.cjs',args,{SURF_SMOKE_OUT:path.join(__dirname,args.length?'final-smoke-software':'final-smoke-gpu')});
