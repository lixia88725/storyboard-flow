// Synthetic daily-workflow acceptance. No personal media, Clipboard or Trash.
import fs from 'node:fs/promises';import path from 'node:path';import {spawn} from 'node:child_process';
const repo=process.cwd();
for(const name of ['FLOW_IMAGE_HOST','FLOW_PROJECT_LEASE_BINARY'])if(!path.isAbsolute(process.env[name]??''))throw Error(`${name} must identify a prepared component`);
const run=(command,args,env)=>new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd:repo,env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal,stdout,stderr}));});
const seed=await run(process.execPath,['scripts/flow-native-workbench-seed.mjs'],process.env);if(seed.code!==0)throw Error(seed.stderr);
const out=seed.stdout.trim().split('\n').at(-1);if(!out?.startsWith('/private/tmp/flow-native-workbench-'))throw Error('Invalid synthetic root');
const source=path.join(out,'daily-sources');await fs.mkdir(source);
const sharp=(await import('sharp')).default;
for(let i=0;i<8;i++){const image=sharp({create:{width:1920,height:1080,channels:4,background:{r:30+i*20,g:80,b:170,alpha:1}}});await (i===7?image.jpeg():image.png()).toFile(path.join(source,`source-${i}.${i===7?'jpg':'png'}`));}
const hostWrapper=path.join(out,'daily-host.sh'),hostPid=path.join(out,'daily-host.pid');
const quote=s=>"'"+s.replaceAll("'","'\"'\"'")+"'";
await fs.writeFile(hostWrapper,'#!/bin/sh\nprintf \"%s\" \"$$\" > '+quote(hostPid)+'\nexec '+quote(process.env.FLOW_IMAGE_HOST)+' \"$@\"\n',{mode:0o700});
for(const phase of ['daily','daily-reopen']){
 const result=await run(path.join(repo,'node_modules/.bin/electron'),['scripts/flow-native-daily-driver.cjs'],{...process.env,FLOW_NATIVE_WORKSPACE:'1',FLOW_REPO:repo,FLOW_OUT:out,FLOW_IMAGE_HOST:hostWrapper,FLOW_DAILY_HOST_PID:hostPid,FLOW_DAILY_REOPEN:phase==='daily-reopen'?'1':'0'});
 await fs.writeFile(path.join(out,`${phase}-process.log`),JSON.stringify(result,null,2));
 if(result.code!==0)throw Error(`${phase} failed: ${out}\n${result.stderr}`);
 const receipt=JSON.parse(await fs.readFile(path.join(out,`${phase}-result.json`),'utf8'));if(receipt.ok!==true)throw Error(`${phase} incomplete: ${out}`);
}
console.log(`PASS ${out}`);
