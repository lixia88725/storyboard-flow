// The same three boundary assertions can run against the rejected candidate or cwd.
// Reads exactly one permitted source file; no historical test tree is loaded.
import {readFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {transform} from 'esbuild';
import assert from 'node:assert/strict';
const file='src/drawing/renderer/paintPresentation.ts';
const old=process.argv.includes('--baseline');
const source=old?execFileSync('git',['show',`37ad7f3:${file}`],{encoding:'utf8'}):await readFile(file,'utf8');
const {code}=await transform(source,{loader:'ts',format:'esm'});
const module=await import('data:text/javascript;base64,'+Buffer.from(code).toString('base64'));
const tick=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
const stroke=id=>({id,tool:'brush',color:'#123456',size:10,opacity:.3,points:[2,3]});
function harness(maxPoints=200000){
  const writes=[];let paused=false;
  const gate=module.createPaintInputGate?.()??{isPaused:()=>paused,pause:()=>{paused=true;}};
  const owner=module.createPaintPresentation({inputGate:gate,maxPoints,
    raster:{create:()=>[],copy:()=>{},stroke:()=>{},decode:()=>new Promise(()=>{}),release:()=>{}},
    current:()=>({shotId:'s',imageId:'i',layerId:'l',assetId:'base',width:32,height:32}),report:()=>{},
    commit:(_t,s)=>new Promise((resolve,reject)=>writes.push({s,resolve,reject})),
  });return{owner,gate,writes};
}
const cases=[
  ['settled-to-freeze admission',async()=>{const h=harness();await h.owner.settle();h.gate.pause();assert.equal(h.owner.begin('s','l',stroke('gap')),false,'paused owner must reject new input');}],
  ['budget overflow native up semantics',async()=>{const h=harness(1);h.owner.begin('s','l',stroke('A'));h.owner.update({...stroke('A'),points:[2,3,4,5]});h.owner.end('A');assert.equal(h.writes.length,0,'up must not commit truncated prefix');}],
  ['none failure explicit retry',async()=>{const h=harness();h.owner.begin('s','l',stroke('A'));h.owner.end('A');h.writes[0].reject({message:'temporary',effect:'none'});await tick();assert.equal(typeof h.owner.resolveFailure,'function','failure must have an explicit recovery action');await h.owner.resolveFailure('retry');assert.equal(h.writes.length,2);}],
];
let failed=0;for(const [name,run]of cases){try{await run();console.log('PASS',name);}catch(error){failed++;console.log('FAIL',name,error.message);}}
console.log(JSON.stringify({candidate:old?'37ad7f3':'working tree',passed:cases.length-failed,failed}));process.exitCode=failed?1:0;
