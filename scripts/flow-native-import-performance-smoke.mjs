// Real native entry, 300 synthetic sources, independent userData. Never user media.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import sharp from 'sharp';
const repo=process.cwd(),require=createRequire(import.meta.url),electron=require('electron');
const run=(bin,args,env)=>new Promise(resolve=>{const child=spawn(bin,args,{cwd:repo,env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',e=>resolve({code:-1,stdout,stderr:stderr+e}));child.on('exit',code=>resolve({code,stdout,stderr}));});
const seed=await run(process.execPath,['scripts/flow-native-workbench-seed.mjs'],process.env);
if(seed.code!==0)throw Error(seed.stderr);
const out=seed.stdout.trim().split('\n').at(-1);
if(!out.startsWith('/private/tmp/flow-native-workbench-'))throw Error('Unexpected fixture');
await fs.mkdir(path.join(out,'sources'));await fs.mkdir(path.join(out,'destination'));
const png=await sharp({create:{width:960,height:540,channels:4,background:'#fafafa'}}).png().toBuffer();
const jpeg=await sharp(png).jpeg().toBuffer();
for(let i=0;i<300;i++)await fs.writeFile(path.join(out,'sources',String(i).padStart(4,'0')+(i%2?'.jpg':'.png')),i%2?jpeg:png);
for(const phase of ['paint','reopen']){
 const result=await run(electron,['scripts/flow-native-import-performance-driver.cjs'],{...process.env,FLOW_NATIVE_WORKSPACE:'1',FLOW_REPO:repo,FLOW_OUT:out,FLOW_PERF_PHASE:phase});
 await fs.writeFile(path.join(out,'performance-'+phase+'-process.json'),JSON.stringify(result,null,2));
 if(result.code!==0)throw Error(`${phase} failed: ${out}\n${result.stderr}\n${result.stdout}`);
 const receipt=JSON.parse(await fs.readFile(path.join(out,'performance-'+phase+'.json'),'utf8'));if(!receipt.ok)throw Error('Missing successful receipt');
}
console.log('PASS',out);
