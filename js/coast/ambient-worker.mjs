import {HybridSurf} from './hybrid-surf.mjs';
// The lightweight solver and character now share one worker. This module owns
// initialization; the immutable checkpoint skips the initial 24-second spin-up.
// After loading, all time advances through the solver; there is no replay loop.
export async function loadSurf(){const response=await fetch(new URL('./initial-state.bin',import.meta.url));if(!response.ok)throw Error('Missing initial surf state');return new HybridSurf().load(await response.arrayBuffer());}
