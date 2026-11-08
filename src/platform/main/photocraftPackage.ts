// Native resource location and build/package admission. Never expose paths to renderer.
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
export const NATIVE_COMPONENTS=['reader','host','lease'] as const;
export type NativeComponent=typeof NATIVE_COMPONENTS[number];
export const nativeName=(platform:string,component:NativeComponent='reader')=>({reader:'flow-photocraft',host:'flow-photocraft-host',lease:'flow-project-lease'}[component])+(platform==='win32'?'.exe':'');
export function assertNativeWorkspacePlatform(platform:string,arch:string){nativeTarget(platform,arch);if(platform==='win32')throw Error('Native workspace lease is unsupported on Windows; packaging is unavailable');}
/** Pure shared location policy. Callers still verify receipts/capabilities before spawn. */
export function nativeComponentPaths(options:{repoRoot?:string;resourcesPath?:string;packaged:boolean;platform?:string;arch?:string}){
 const platform=options.platform??process.platform,arch=options.arch??process.arch;assertNativeWorkspacePlatform(platform,arch);
 const base=options.packaged?options.resourcesPath:options.repoRoot;if(!base||!path.isAbsolute(base))throw Error('Absolute native resource root required');
 const root=options.packaged?path.join(base,'photocraft'):path.join(base,'native/photocraft/target/flow-release');
 return{root,reader:path.join(root,nativeName(platform,'reader')),host:path.join(root,nativeName(platform,'host')),lease:path.join(root,nativeName(platform,'lease'))};
}
export const NATIVE_REQUIRED_CAPABILITIES:Record<NativeComponent,readonly string[]>={reader:['readerProtocolV1'],host:['immutableVersionExportV1','detachedImageJobsV1','flowV1UpgradeInterpretationV1','readonlyExportMetadataV1','strokePipelineV1','settledResumeV1','flowBrushPresetsV1','intrinsicSelectionPaintGuardV1','productImageEditsV1','toolContextSummaryV1','productEditPreviewV1','temporarySelectionContextV1'],lease:['writerLeaseV1','rootIdentityV1','checkReleaseV1']};
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
 const root=path.join(repoRoot,'native/photocraft'),leaves=['Cargo.toml','Cargo.lock'];
 const visit=async(dir:string)=>{const st=await fs.lstat(path.join(root,dir));if(!st.isDirectory()||st.isSymbolicLink())throw Error('Aliased native source directory');for(const item of await fs.readdir(path.join(root,dir),{withFileTypes:true})){const leaf=dir+'/'+item.name;if(item.isDirectory())await visit(leaf);else if(item.isFile())leaves.push(leaf);else throw Error('Aliased native source');}};
 await visit('src');const h=createHash('sha256');
 for(const leaf of leaves.sort()){const file=path.join(root,leaf),st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1)throw Error('Aliased native source');const bytes=await fs.readFile(file);h.update(leaf+'\0'+bytes.length+'\0');h.update(bytes);}
 return h.digest('hex');
}
export async function licenseInventory(root:string):Promise<Record<string,string>>{
 const files:Record<string,string>={};
 async function visit(dir:string,prefix:string){const identity=await fs.lstat(dir);if(!identity.isDirectory()||identity.isSymbolicLink())throw Error('PhotoCraft license directory alias is not allowed');for(const item of await fs.readdir(dir,{withFileTypes:true})){
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
export type NativeComponentReceipt={name:string;sha256:string;protocol:1;capabilities:string[];platform:string;arch:string;target:string;profile:'release';licensesSha256:string;packagedSha256?:string};
export type NativeBuildReceipt={protocol:2;upstream:string;rust:string;target:string;platform:string;arch:string;profile:'release';sourceDigest:string;components:Record<NativeComponent,NativeComponentReceipt>;licenses:Record<string,string>};
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const ordinary=async(file:string)=>{const st=await fs.lstat(file);if(st.isSymbolicLink()||!st.isFile()||st.nlink!==1)throw Error('Aliased native package file');return fs.readFile(file);};
async function inspect(root:string,platform:string,arch:string,afterSigning=false){
 assertNativeWorkspacePlatform(platform,arch);const directory=await fs.lstat(root);if(!directory.isDirectory()||directory.isSymbolicLink()||await fs.realpath(root)!==root)throw Error('Aliased native package directory');
 const receipt=JSON.parse((await ordinary(path.join(root,'build.json'))).toString()) as NativeBuildReceipt;
 if(receipt.protocol!==2||receipt.upstream!==NATIVE_UPSTREAM||receipt.rust!==NATIVE_RUST||receipt.profile!=='release'||receipt.platform!==platform||receipt.arch!==arch||receipt.target!==nativeTarget(platform,arch)||!digest(receipt.sourceDigest)||!receipt.components||Object.keys(receipt.components).sort().join(',')!==[...NATIVE_COMPONENTS].sort().join(','))throw Error('PhotoCraft build receipt identity mismatch');
 const licenses=await licenseInventory(path.join(root,'licenses'));if(JSON.stringify(licenses)!==JSON.stringify(receipt.licenses))throw Error('PhotoCraft license inventory mismatch');
 const licensesSha256=sha(Buffer.from(JSON.stringify(licenses))),binaries={} as Record<NativeComponent,Buffer>;
 for(const kind of NATIVE_COMPONENTS){const component=receipt.components[kind];
  if(!component||component.name!==nativeName(platform,kind)||component.protocol!==1||component.platform!==platform||component.arch!==arch||component.target!==receipt.target||component.profile!=='release'||component.licensesSha256!==licensesSha256||!digest(component.sha256)||component.packagedSha256!==undefined&&!digest(component.packagedSha256)||!Array.isArray(component.capabilities)||component.capabilities.some(c=>typeof c!=='string'||!c)||new Set(component.capabilities).size!==component.capabilities.length||NATIVE_REQUIRED_CAPABILITIES[kind].some(c=>!component.capabilities.includes(c)))throw Error('PhotoCraft '+kind+' capability/identity mismatch');
  const bytes=await ordinary(path.join(root,component.name));assertNativeHeader(bytes,platform,arch);
  if(!afterSigning&&sha(bytes)!==(component.packagedSha256??component.sha256))throw Error('PhotoCraft '+kind+' binary digest mismatch');binaries[kind]=bytes;
 }
 return {receipt,bytes:binaries.reader,binaries};
}
export async function verifyPreparedNative(repoRoot:string,platform:string=process.platform,arch:string=process.arch){
 const locations=nativeComponentPaths({repoRoot,packaged:false,platform,arch});
 let verified;try{verified=await inspect(locations.root,platform,arch);}catch(error){throw Error('PhotoCraft native component is required; run npm run setup:photocraft and npm run build:photocraft. '+String(error));}
 if(NATIVE_COMPONENTS.some(k=>verified.receipt.components[k].packagedSha256)||verified.receipt.sourceDigest!==await sourceDigest(repoRoot))throw Error('PhotoCraft source changed since its native build; rebuild before packaging');
 const stamp=await fs.readFile(path.join(repoRoot,'vendor/photocraft/.flow-upstream-commit'),'utf8');if(stamp.trim()!==NATIVE_UPSTREAM)throw Error('PhotoCraft source pin mismatch');
 return {...locations,source:locations.root,binary:locations.reader,receipt:verified.receipt};
}
export const verifyPackagedNative=(root:string,platform:string,arch:string)=>inspect(root,platform,arch);
// Original component admission precedes signing. Re-seal all nested components,
// then re-sign only the outer app so none of the bound binary bytes change again.
export async function sealSignedNative(root:string,platform:string,arch:string){
 const {receipt,binaries}=await inspect(root,platform,arch,true);
 for(const kind of NATIVE_COMPONENTS)receipt.components[kind].packagedSha256=sha(binaries[kind]);
 await fs.writeFile(path.join(root,'build.json'),JSON.stringify(receipt,null,2)+'\n');await inspect(root,platform,arch);
}
