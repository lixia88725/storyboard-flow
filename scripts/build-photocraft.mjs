// Explicit pinned release build. No toolchain installation or global changes.
import fs from 'node:fs/promises';import path from 'node:path';import os from 'node:os';import {randomUUID}from'node:crypto';import {spawn,spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
import{NATIVE_UPSTREAM,NATIVE_RUST,NATIVE_COMPONENTS,NATIVE_REQUIRED_CAPABILITIES,nativeTarget,nativeName,nativeComponentPaths,assertNativeHeader,sourceDigest,licenseInventory,sha,verifyPackagedNative}from'../dist-electron/platform/main/photocraftPackage.js';
import{probeNativeHost}from'./package-native-probes.mjs';
import{acquireImageProjectLease}from'../dist-electron/platform/main/imageProjectLease.js';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),locations=nativeComponentPaths({repoRoot:repo,packaged:false}),target=nativeTarget(process.platform,process.arch),root=path.join(repo,'native/photocraft');
if(process.env.FLOW_PHOTOCRAFT_TARGET&&process.env.FLOW_PHOTOCRAFT_TARGET!==target)throw Error('Native build target must match the Node host architecture');
const version=spawnSync('rustc',['--version','--verbose'],{encoding:'utf8'});if(version.status!==0)throw Error(version.stderr||'Rust is missing');
const details=version.stdout.replace(/\r/g,'');
if(!details.includes('release: '+NATIVE_RUST+'\n')||!details.includes('host: '+target+'\n'))throw Error('Use Rust '+NATIVE_RUST+' for '+target+'; no toolchain is installed automatically');
if((await fs.readFile(path.join(repo,'vendor/photocraft/.flow-upstream-commit'),'utf8')).trim()!==NATIVE_UPSTREAM)throw Error('PhotoCraft source is not pinned');
const before=await sourceDigest(repo),env={...process.env,CARGO_TARGET_DIR:path.join(root,'target'),RUSTFLAGS:''};delete env.CARGO_ENCODED_RUSTFLAGS;
const result=spawnSync('cargo',['build','--offline','--locked','--release','--manifest-path',path.join(root,'Cargo.toml'),'--all-targets','--target',target],{stdio:'inherit',env});
if(result.status!==0)throw Error('Native release build failed; previous artifacts are not package candidates');
if(await sourceDigest(repo)!==before)throw Error('Native sources changed during build; no receipt published');
const built=path.join(root,'target',target,'release'),out=locations.root+'.stage-'+randomUUID();await fs.mkdir(out,{recursive:true});
for(const kind of NATIVE_COMPONENTS){const name=nativeName(process.platform,kind),bytes=await fs.readFile(path.join(built,name));assertNativeHeader(bytes,process.platform,process.arch);await fs.cp(path.join(built,name),path.join(out,name));}
await fs.cp(path.join(root,'licenses'),path.join(out,'licenses'),{recursive:true});
const licenses=await licenseInventory(path.join(out,'licenses')),licensesSha256=sha(Buffer.from(JSON.stringify(licenses)));
const probe=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'flow-native-package-probe-')));
// Probe failure leaves this owned synthetic directory as evidence. Only successful,
// normally settled probes are removed. Nothing touches a user workspace or Trash.
const reader=spawnSync(path.join(out,nativeName(process.platform)),['--version'],{encoding:'utf8',timeout:10000});
if(reader.status!==0||reader.stdout.trim()!==`flow-photocraft protocol=1 upstream=${NATIVE_UPSTREAM}`)throw Error('Reader protocol/upstream probe failed: '+probe);
const hostCapabilities=await probeNativeHost(path.join(out,nativeName(process.platform,'host')),path.join(probe,'host'),NATIVE_UPSTREAM);
const leaseRoot=path.join(probe,'lease');await fs.mkdir(leaseRoot);const lease=await acquireImageProjectLease({root:leaseRoot,binary:path.join(out,nativeName(process.platform,'lease'))});await lease.assertHeld();await lease.release();
const capabilities={reader:['readerProtocolV1'],host:hostCapabilities,lease:['writerLeaseV1','rootIdentityV1','checkReleaseV1']};
for(const kind of NATIVE_COMPONENTS)if(NATIVE_REQUIRED_CAPABILITIES[kind].some(c=>!capabilities[kind].includes(c)))throw Error('Missing required '+kind+' capability; evidence: '+probe);
const components={};for(const kind of NATIVE_COMPONENTS)components[kind]={name:nativeName(process.platform,kind),sha256:sha(await fs.readFile(path.join(out,nativeName(process.platform,kind)))),protocol:1,capabilities:capabilities[kind].sort(),platform:process.platform,arch:process.arch,target,profile:'release',licensesSha256};
const receipt={protocol:2,upstream:NATIVE_UPSTREAM,rust:NATIVE_RUST,target,platform:process.platform,arch:process.arch,profile:'release',sourceDigest:before,components,licenses};
if(await sourceDigest(repo)!==before)throw Error('Native sources changed during probes; no receipt published');
await fs.writeFile(path.join(out,'build.json'),JSON.stringify(receipt,null,2)+'\n');await verifyPackagedNative(out,process.platform,process.arch);
try{const old=await fs.lstat(locations.root);if(!old.isDirectory()||old.isSymbolicLink())throw Error('Unsafe previous native candidate');await fs.rename(locations.root,locations.root+'.previous-'+randomUUID());}catch(e){if(e.code!=='ENOENT')throw e;}
await fs.rename(out,locations.root);
// Preserve the existing fixture lookup contract, with a release executable.
const fixtureName=process.platform==='win32'?'fixtures.exe':'fixtures';await fs.mkdir(path.join(root,'target/debug/examples'),{recursive:true});await fs.cp(path.join(built,'examples',fixtureName),path.join(root,'target/debug/examples',fixtureName));
await fs.rm(probe,{recursive:true});console.log('Prepared release reader/host/lease and protocol capability receipts:',target,'Rust',NATIVE_RUST);
