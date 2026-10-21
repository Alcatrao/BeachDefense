// Stable Pages gate for v14 occupied-liquid contact, skim and wipeout.
import fs from 'node:fs';
await import('../v14/contact-test.mjs');
const output=new URL('../../verification/v7/',import.meta.url);fs.mkdirSync(output,{recursive:true});
fs.copyFileSync(new URL('../../verification/v14/contact-result.json',import.meta.url),new URL('contact-60.json',output));
