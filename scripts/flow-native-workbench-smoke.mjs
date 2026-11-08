// Run after npm run build. Explicit native host and lease binaries are required.
// Creates only a new synthetic project/profile under the canonical temp directory.
import fs from 'node:fs/promises';import path from 'node:path';import{fileURLToPath}from'node:url';import{spawn}from'node:child_process';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
for(const key of['FLOW_IMAGE_HOST','FLOW_PROJECT_LEASE_BINARY'])if(!path.isAbsolute(process.env[key]??''))throw Error(`${key} must name an explicit prepared native component`);
function run(command,args,env){return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd:repo,env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal,stdout,stderr}));});}
const seed=await run(process.execPath,['scripts/flow-native-workbench-seed.mjs'],process.env);if(seed.code!==0)throw Error(seed.stderr);const out=seed.stdout.trim().split('\n').at(-1);if(!out?.startsWith('/private/tmp/flow-native-workbench-'))throw Error('Invalid isolated fixture');
const electron=path.join(repo,'node_modules/.bin/electron');
for(const phase of['paint','reopen','early-close']){const result=await run(electron,['scripts/flow-native-workbench-driver.cjs'],{...process.env,FLOW_NATIVE_WORKSPACE:'1',FLOW_REPO:repo,FLOW_OUT:out,FLOW_REOPEN:phase==='reopen'?'1':'0',FLOW_EARLY_CLOSE:phase==='early-close'?'1':'0'});await fs.writeFile(path.join(out,phase+'-process.log'),JSON.stringify(result,null,2));if(result.code!==0)throw Error(`${phase} failed; evidence: ${out}\n${result.stderr}`);const receipt=JSON.parse(await fs.readFile(path.join(out,phase+'-result.json'),'utf8'));if(receipt.ok!==true)throw Error(`${phase} incomplete: ${out}`);}
console.log(`PASS ${out}`);
