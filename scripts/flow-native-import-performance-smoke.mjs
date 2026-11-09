// Real native entry and independent userData. Synthetic by default; an explicitly
// authorized FLOW_ARTIST_SOURCE is read-only and outputs stay in a temporary project.
import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import sharp from 'sharp';
const realSource=process.env.FLOW_ARTIST_SOURCE?path.resolve(process.env.FLOW_ARTIST_SOURCE):null;
const repo=process.cwd(),require=createRequire(import.meta.url),electron=require('electron');
const run=(bin,args,env)=>new Promise(resolve=>{const child=spawn(bin,args,{cwd:repo,env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.on('error',e=>resolve({code:-1,stdout,stderr:stderr+e}));child.on('exit',code=>resolve({code,stdout,stderr}));});
let out=process.env.FLOW_ARTIST_RESUME_OUT;
if(out){
 if(!realSource||!out.startsWith('/private/tmp/flow-native-workbench-')||path.resolve(out)!==out)throw Error('Only an existing isolated artist fixture may resume');
 const failed=JSON.parse(await fs.readFile(path.join(out,'performance-paint-failed.json'),'utf8'));
 if(!failed.root?.startsWith(out+'/destination/'))throw Error('Existing artist project must remain inside its fixture');
}else{
const seed=await run(process.execPath,['scripts/flow-native-workbench-seed.mjs'],process.env);
if(seed.code!==0)throw Error(seed.stderr);
out=seed.stdout.trim().split('\n').at(-1);
if(!out.startsWith('/private/tmp/flow-native-workbench-'))throw Error('Unexpected fixture');
await fs.mkdir(path.join(out,'sources'));await fs.mkdir(path.join(out,'destination'));
if(!realSource){
const png=await sharp({create:{width:960,height:540,channels:4,background:'#fafafa'}}).png().toBuffer();
const jpeg=await sharp(png).jpeg().toBuffer();
for(let i=0;i<300;i++)await fs.writeFile(path.join(out,'sources',String(i).padStart(4,'0')+(i%2?'.jpg':'.png')),i%2?jpeg:png);
}
}
const sourceCount=realSource?(await fs.readdir(realSource,{withFileTypes:true})).filter(e=>e.isFile()&&/\.(png|jpe?g|tiff?|psd)$/i.test(e.name)).length:300;
if(!sourceCount)throw Error('No supported input files');
for(const phase of [process.env.FLOW_ARTIST_RESUME_OUT?'save-retry':'paint','reopen']){
 const result=await run(electron,['scripts/flow-native-import-performance-driver.cjs'],{...process.env,FLOW_NATIVE_WORKSPACE:'1',FLOW_REPO:repo,FLOW_OUT:out,FLOW_PERF_PHASE:phase,FLOW_ARTIST_SOURCE:realSource??'',FLOW_SOURCE_COUNT:String(sourceCount)});
 await fs.writeFile(path.join(out,'performance-'+phase+'-process.json'),JSON.stringify(result,null,2));
 if(result.code!==0)throw Error(`${phase} failed: ${out}\n${result.stderr}\n${result.stdout}`);
 const receipt=JSON.parse(await fs.readFile(path.join(out,'performance-'+phase+'.json'),'utf8'));if(!receipt.ok)throw Error('Missing successful receipt');
}
console.log('PASS',out);
