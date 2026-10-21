// Exercise the exact project prefix and each subfolder, including nested module workers.
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(process.env.SURF_ROOT||path.join(__dirname,'../..'));
const out = path.resolve(process.env.SURF_SMOKE_OUT||path.join(__dirname,'../../verification/v13/publisher-smoke'));
fs.mkdirSync(out, {recursive:true});
const mime = {'.html':'text/html; charset=utf-8', '.js':'text/javascript', '.mjs':'text/javascript',
  '.json':'application/json', '.jpg':'image/jpeg', '.png':'image/png', '.bin':'application/octet-stream'};
let server, browser;
const results = [];
(async () => {
  server = http.createServer((req,res) => {
    const u = new URL(req.url, 'http://localhost');
    if (!u.pathname.startsWith('/BeachDefense/')) return res.writeHead(404).end();
    let rel = decodeURIComponent(u.pathname.slice('/BeachDefense/'.length));
    if (rel.endsWith('/') || !rel) rel += 'index.html';
    const file = path.resolve(root, rel.replace(/^codex\//,''));
    if (!file.startsWith(root + path.sep)) return res.writeHead(403).end();
    fs.readFile(file,(err,data) => {
      res.setHeader('Content-Type',mime[path.extname(file)] || 'application/octet-stream');
      res.writeHead(err ? 404 : 200).end(err ? 'missing' : data);
    });
  });
  await new Promise(r => server.listen(0,'127.0.0.1',r));
  const base = process.env.SITE_URL || `http://127.0.0.1:${server.address().port}/BeachDefense/`;
  browser = await chromium.launch({headless:true, ...(process.env.BROWSER_CHANNEL ? {channel:process.env.BROWSER_CHANNEL} : {}),
    args:process.env.GPU ? ['--enable-webgl'] : ['--enable-webgl','--use-gl=angle','--use-angle=swiftshader']});
  for (const [name,folder] of [['codex','codex/']]) {
    const page = await browser.newPage({viewport:{width:1280,height:800}});
    page.setDefaultTimeout(90000);await page.addInitScript(()=>{window.__captureAttempts=0;Element.prototype.requestPointerLock=function(){window.__captureAttempts++;throw Error('Pointer capture forbidden in tests');};});
    const errors=[], failed=[], workers=[], responses=[];
    page.on('pageerror',e => errors.push(e.message));
    page.on('console',m => {if(m.type()==='error' && /THREE|shader|WebGLProgram|VALIDATE_STATUS/i.test(m.text())) errors.push(m.text());});
    page.on('requestfailed',r => failed.push({url:r.url(),error:r.failure()?.errorText}));
    page.on('response',r => { if(r.status()>=400) failed.push({url:r.url(),status:r.status()});
      if(r.url().startsWith(base)) responses.push({url:r.url(),status:r.status()}); });
    page.on('worker',w => workers.push(w.url()));
    const result={name,url:base+folder,errors,failed,workers,responses};
    results.push(result);
    try {
      await page.goto(result.url+'?debug=1',{waitUntil:'networkidle',timeout:120000});
      await page.waitForFunction(() => typeof document.querySelector('#startButton')?.onclick === 'function',null,{timeout:120000});
      await page.screenshot({path:path.join(out,`${name}-menu.png`)});
      await page.click(name==='codex' ? '#surfStartButton' : '#startButton');
      await page.waitForFunction(() => document.querySelector('canvas') && document.querySelector('#startMenu').style.display==='none',null,{timeout:120000});
      if(name==='codex') {
        await page.waitForFunction(() => window.beachFluid?.world.ready && !beachFluid.world.loading && beachFluid.world.latest?.localTime>0,null,{timeout:180000});
        const t = await page.evaluate(() => beachFluid.world.fluid.time);
        await page.waitForFunction(t => beachFluid.world.fluid.time>t+.1,t,{timeout:60000});
        result.physics=await page.evaluate(() => ({time:beachFluid.world.fluid.time,localTime:beachFluid.world.latest.localTime}));
        result.surface=await page.evaluate(() => beachGame.diagnostics().ocean);
      } else if(name==='claude') {
        await page.waitForFunction(() => window.__beach?.surf,null,{timeout:60000});
        result.surf = await page.evaluate(() => Boolean(__beach.surf));
      }
      await page.waitForTimeout(2500);
      await page.screenshot({path:path.join(out,`${name}-game.png`)});
      assert.equal(errors.length,0,JSON.stringify(errors));
      assert.equal(failed.filter(x=>!x.url.endsWith('/favicon.ico')).length,0,JSON.stringify(failed));
      if(name==='codex') {
        for(const script of ['beach-worker.mjs','ambient-worker.mjs'])
          assert(responses.some(x=>x.url.includes('/codex/js/coast/'+script)&&x.status===200),script);
        assert(responses.some(x=>x.url.includes('/codex/js/coast/initial-state.bin')&&x.status===200),'initial state fetch');
        assert(workers.some(x=>x.endsWith('/codex/js/coast/beach-worker.mjs')),'module worker created');
        await page.goto(base+'codex/beach.html',{waitUntil:'networkidle'});
        await page.waitForFunction(() => window.coastDemo?.world.ready,null,{timeout:120000});
        result.shorebreak=[];
        for(const seconds of [28,31.5,33,34.5,37.5,39,40]) {
          await page.evaluate(async seconds => {
            await coastDemo.command('advance',{count:Math.max(0,Math.round((seconds-coastDemo.world.ambient.time)*60))});
            coastDemo.setView([28,34.5,40].includes(seconds)?'tube':'wide');
          },seconds);
          await page.screenshot({path:path.join(out,`codex-shorebreak-${seconds}.png`)});
          result.shorebreak.push(await page.evaluate(()=>coastDemo.diagnostics()));
        }
        await page.evaluate(()=>coastDemo.setView('wide'));
        await page.screenshot({path:path.join(out,'codex-whole-beach.png')});
        assert.equal(errors.length,0,JSON.stringify(errors));
      }
      assert.equal(await page.evaluate(()=>window.__captureAttempts),0);result.pass=true;
    } catch(e) {result.pass=false;result.failure=e.stack;console.error(name,e.message);}
    fs.writeFileSync(path.join(out,'smoke.json'),JSON.stringify(results,null,2));
    await page.close();
  }
  assert(results.every(x=>x.pass),'Some versions failed browser verification; see pages-evidence/smoke.json');
  console.log(JSON.stringify(results.map(({name,pass,physics,surf})=>({name,pass,physics,surf}))));
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(async()=>{if(browser)await browser.close();if(server)server.close();});
