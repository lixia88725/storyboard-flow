// Run after npm run build. Explicit native host and lease binaries are required.
// Creates only a new synthetic project/profile under the canonical temp directory.
import fs from 'node:fs/promises';import path from 'node:path';import{fileURLToPath}from'node:url';import{spawn}from'node:child_process';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
if(process.env.FLOW_SOURCE_IMPORT_ONLY==='1'&&process.env.FLOW_SOURCE_IMPORT!=='1')throw Error('Import-only requires FLOW_SOURCE_IMPORT=1; refusing an empty acceptance run');
for(const key of['FLOW_IMAGE_HOST','FLOW_PROJECT_LEASE_BINARY'])if(!path.isAbsolute(process.env[key]??''))throw Error(`${key} must name an explicit prepared native component`);
function run(command,args,env){return new Promise((resolve,reject)=>{const child=spawn(command,args,{cwd:repo,env,stdio:['ignore','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',v=>stdout+=v);child.stderr.on('data',v=>stderr+=v);child.on('error',reject);child.on('exit',(code,signal)=>resolve({code,signal,stdout,stderr}));});}
const seed=await run(process.execPath,['scripts/flow-native-workbench-seed.mjs'],process.env);if(seed.code!==0)throw Error(seed.stderr);const out=seed.stdout.trim().split('\n').at(-1);if(!out?.startsWith('/private/tmp/flow-native-workbench-'))throw Error('Invalid isolated fixture');
const electron=path.join(repo,'node_modules/.bin/electron');
for(const phase of(process.env.FLOW_SOURCE_IMPORT_ONLY==='1'?[]:['paint','reopen','early-close'])){const result=await run(electron,['scripts/flow-native-workbench-driver.cjs'],{...process.env,FLOW_NATIVE_WORKSPACE:'1',FLOW_REPO:repo,FLOW_OUT:out,FLOW_REOPEN:phase==='reopen'?'1':'0',FLOW_EARLY_CLOSE:phase==='early-close'?'1':'0',FLOW_COLD_COPY:'0'});await fs.writeFile(path.join(out,phase+'-process.log'),JSON.stringify(result,null,2));if(result.code!==0)throw Error(`${phase} failed; evidence: ${out}\n${result.stderr}`);const receipt=JSON.parse(await fs.readFile(path.join(out,phase+'-result.json'),'utf8'));if(receipt.ok!==true)throw Error(`${phase} incomplete: ${out}`);}
if(process.env.FLOW_COLD_COPY==='1'){
 if(process.env.FLOW_SAVE!=='1'||process.env.FLOW_SOURCE_IMPORT_ONLY==='1')throw Error('Cold-copy acceptance requires the saved and normally closed baseline');
 const original=path.join(out,'project'),copy=path.join(out,'project-copy');
 const crypto=await import('node:crypto');
 async function inventory(root,relative=''){const result=[];for(const entry of(await fs.readdir(path.join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name))){const name=path.join(relative,entry.name);if(entry.isSymbolicLink())throw Error('Synthetic project unexpectedly contains an alias');if(entry.isDirectory())result.push(...await inventory(root,name));else result.push([name,crypto.createHash('sha256').update(await fs.readFile(path.join(root,name))).digest('hex')]);}return result;}
 const before=await inventory(original);await fs.cp(original,copy,{recursive:true,errorOnExist:true,force:false});
 const result=await run(electron,['scripts/flow-native-workbench-driver.cjs'],{...process.env,FLOW_NATIVE_WORKSPACE:'1',FLOW_REPO:repo,FLOW_OUT:out,FLOW_REOPEN:'1',FLOW_EARLY_CLOSE:'0',FLOW_COLD_COPY:'1'});
 await fs.writeFile(path.join(out,'copy-reopen-process.log'),JSON.stringify(result,null,2));
 if(result.code!==0)throw Error(`copy-reopen failed: ${out}\n${result.stderr}`);
 const receipt=JSON.parse(await fs.readFile(path.join(out,'copy-reopen-result.json'),'utf8'));if(receipt.ok!==true)throw Error('Cold-copy acceptance incomplete');
 if(JSON.stringify(before)!==JSON.stringify(await inventory(original)))throw Error('Opening copied project changed original project bytes');
 await fs.writeFile(path.join(out,'copy-original-unchanged.json'),JSON.stringify({ok:true,files:before.length}));
}
if(process.env.FLOW_SOURCE_IMPORT==='1'){
 const sharp=(await import('sharp')).default,source=path.join(out,'sources');await fs.mkdir(source);await fs.mkdir(path.join(out,'destination'));
 await sharp({create:{width:640,height:360,channels:4,background:{r:250,g:250,b:250,alpha:1}}}).png().toFile(path.join(source,'01.png'));
 await sharp({create:{width:640,height:360,channels:4,background:{r:64,g:128,b:192,alpha:1}}}).png().toFile(path.join(source,'02.png'));
 await fs.writeFile(path.join(source,'03-broken.png'),'synthetic invalid image');
 for(const phase of ['import','import-reopen']){const result=await run(electron,['scripts/flow-native-import-driver.cjs'],{...process.env,FLOW_NATIVE_WORKSPACE:'1',FLOW_REPO:repo,FLOW_OUT:out,FLOW_IMPORT_REOPEN:phase==='import-reopen'?'1':'0'});await fs.writeFile(path.join(out,phase+'-process.log'),JSON.stringify(result,null,2));if(result.code!==0)throw Error(`${phase} failed: ${out}\n${result.stderr}`);const receipt=JSON.parse(await fs.readFile(path.join(out,phase+'-result.json'),'utf8'));if(receipt.ok!==true)throw Error(`${phase} incomplete: ${out}`);}
}
console.log(`PASS ${out}`);
