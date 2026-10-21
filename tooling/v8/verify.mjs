// Stable Pages gate for the installed v14 hybrid solver.
import fs from 'node:fs';
await import('../v14/physics-test.mjs');
const output=new URL('../../verification/v8/',import.meta.url);fs.mkdirSync(output,{recursive:true});
fs.copyFileSync(new URL('../../verification/v14/physics-result.json',import.meta.url),new URL('physics-and-swash.json',output));
