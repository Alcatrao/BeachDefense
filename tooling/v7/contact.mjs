// Stable Pages entry point: v13 validates the installed piston sea and occupancy body.
// Earlier exact-orbital/reciprocal-body assertions remain in Git history.
import fs from 'node:fs';
await import('../v13/contact-test.mjs');
const output=new URL('../../verification/v7/',import.meta.url);fs.mkdirSync(output,{recursive:true});
fs.copyFileSync(new URL('../../verification/v13/contact-fixtures.json',import.meta.url),new URL('contact-60.json',output));
