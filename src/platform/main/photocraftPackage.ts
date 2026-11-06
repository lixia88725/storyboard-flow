// Build/package admission only. Never called by the editor or renderer.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';

export const NATIVE_UPSTREAM='a259993118ac7ce1d4c828a385abbc3191841e86';
export const NATIVE_RUST='1.99.1';
export const NATIVE_LICENSES=['PHOTOCRAFT-MIT.txt','PHOTOCRAFT-APACHE.txt','PHOTOCRAFT-NOTICE.txt','THIRD-PARTY.txt','OFL-Inter.txt','OFL-JetBrainsMono.txt','LICENSE-libfacedetection.txt'];
export const nativeTarget=(platform:string,arch:string):string=>{
 const target:Record<string,string>={'darwin/arm64':'aarch64-apple-darwin','darwin/x64':'x86_64-apple-darwin','win32/x64':'x86_64-pc-windows-msvc'};
 const value=target[platform+'/'+arch];if(!value)throw Error('Unsupported PhotoCraft platform/architecture: '+platform+'/'+arch);return value;
};
export const nativeName=(platform:string)=>platform==='win32'?'flow-photocraft.exe':'flow-photocraft';
export const sha=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
export function assertNativeHeader(bytes:Buffer,platform:string,arch:string){
 nativeTarget(platform,arch);
 if(platform==='darwin'){
  if(bytes.length<32||bytes.readUInt32LE(0)!==0xfeedfacf||bytes.readUInt32LE(4)!==(arch==='arm64'?0x100000c:0x1000007))throw Error('PhotoCraft Mach-O architecture mismatch');
 }else{
  if(bytes.length<64||bytes.toString('ascii',0,2)!=='MZ')throw Error('PhotoCraft PE binary missing');
  const offset=bytes.readUInt32LE(60);
  if(offset>bytes.length-26||bytes.toString('ascii',offset,offset+4)!=='PE\0\0'||bytes.readUInt16LE(offset+4)!==0x8664||bytes.readUInt16LE(offset+24)!==0x20b)throw Error('PhotoCraft PE x64 architecture mismatch');
 }
}
export async function sourceDigest(repoRoot:string){
 const h=createHash('sha256');
 for(const leaf of ['Cargo.toml','Cargo.lock','src/main.rs','src/export.rs']){h.update(leaf+'\0');h.update(await fs.readFile(path.join(repoRoot,'native/photocraft',leaf)));}
 return h.digest('hex');
}
export async function licenseInventory(root:string):Promise<Record<string,string>>{
 const files:Record<string,string>={};
 async function visit(dir:string,prefix:string){for(const item of await fs.readdir(dir,{withFileTypes:true})){
  const leaf=prefix+item.name,file=path.join(dir,item.name);
  if(item.isDirectory())await visit(file,leaf+'/');
  else if(item.isFile()){const bytes=await fs.readFile(file);if(!bytes.length)throw Error('Empty PhotoCraft license: '+leaf);files[leaf]=sha(bytes);}
  else throw Error('PhotoCraft license alias is not allowed');
 }}
 await visit(root,'');
 for(const name of NATIVE_LICENSES)if(!files[name])throw Error('Missing PhotoCraft license: '+name);
 if(!Object.keys(files).some(n=>n.startsWith('source-notices/')))throw Error('PhotoCraft dependency source notices missing');
 return Object.fromEntries(Object.entries(files).sort(([a],[b])=>a<b?-1:a>b?1:0));
}
export type NativeBuildReceipt={protocol:1;upstream:string;rust:string;target:string;platform:string;arch:string;sourceDigest:string;binarySha256:string;licenses:Record<string,string>;packagedBinarySha256?:string};
async function inspect(root:string,platform:string,arch:string,afterSigning=false){
 const receipt=JSON.parse(await fs.readFile(path.join(root,'build.json'),'utf8')) as NativeBuildReceipt;
 if(receipt.protocol!==1||receipt.upstream!==NATIVE_UPSTREAM||receipt.rust!==NATIVE_RUST||receipt.platform!==platform||receipt.arch!==arch||receipt.target!==nativeTarget(platform,arch)||!/^[a-f0-9]{64}$/.test(receipt.sourceDigest))throw Error('PhotoCraft build receipt identity mismatch');
 const bytes=await fs.readFile(path.join(root,nativeName(platform)));assertNativeHeader(bytes,platform,arch);
 if(!afterSigning&&sha(bytes)!==(receipt.packagedBinarySha256??receipt.binarySha256))throw Error('PhotoCraft binary digest mismatch');
 if(JSON.stringify(await licenseInventory(path.join(root,'licenses')))!==JSON.stringify(receipt.licenses))throw Error('PhotoCraft license inventory mismatch');
 return {receipt,bytes};
}
export async function verifyPreparedNative(repoRoot:string,platform:string=process.platform,arch:string=process.arch){
 const root=path.join(repoRoot,'native/photocraft/target/debug');
 let verified;try{verified=await inspect(root,platform,arch);}catch(error){throw Error('PhotoCraft native component is required; run npm run setup:photocraft and npm run build:photocraft. '+String(error));}
 if(verified.receipt.packagedBinarySha256||verified.receipt.sourceDigest!==await sourceDigest(repoRoot))throw Error('PhotoCraft source changed since its native build; rebuild before packaging');
 const stamp=await fs.readFile(path.join(repoRoot,'vendor/photocraft/.flow-upstream-commit'),'utf8');if(stamp.trim()!==NATIVE_UPSTREAM)throw Error('PhotoCraft source pin mismatch');
 return {source:root,binary:path.join(root,nativeName(platform)),receipt:verified.receipt};
}
export const verifyPackagedNative=(root:string,platform:string,arch:string)=>inspect(root,platform,arch);
// Only called after the packaging recipe has verified the original component and
// successfully ad-hoc signed the app. Signing changes Mach-O bytes, not licenses.
export async function sealSignedNative(root:string,platform:string,arch:string){
 const {receipt,bytes}=await inspect(root,platform,arch,true);
 receipt.packagedBinarySha256=sha(bytes);await fs.writeFile(path.join(root,'build.json'),JSON.stringify(receipt,null,2)+'\n');
 await inspect(root,platform,arch);
}
