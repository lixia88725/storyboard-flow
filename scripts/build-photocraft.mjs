// Explicit pinned native build. No rustup installation or global configuration.
import fs from 'node:fs/promises';import path from 'node:path';import {spawnSync}from'node:child_process';import{fileURLToPath}from'node:url';
import{NATIVE_UPSTREAM,NATIVE_RUST,nativeTarget,nativeName,assertNativeHeader,sourceDigest,licenseInventory,sha}from'../dist-electron/platform/main/photocraftPackage.js';
const repo=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),target=nativeTarget(process.platform,process.arch),root=path.join(repo,'native/photocraft');
if(process.env.FLOW_PHOTOCRAFT_TARGET&&process.env.FLOW_PHOTOCRAFT_TARGET!==target)throw Error('Native build target must match the Node host architecture');
const version=spawnSync('rustc',['--version','--verbose'],{encoding:'utf8'});if(version.status!==0)throw Error(version.stderr||'Rust is missing');
const details=version.stdout.replace(/\r/g,'');
if(!details.includes('release: '+NATIVE_RUST+'\n')||!details.includes('host: '+target+'\n'))throw Error('Use Rust '+NATIVE_RUST+' for '+target+'; no toolchain is installed automatically');
if((await fs.readFile(path.join(repo,'vendor/photocraft/.flow-upstream-commit'),'utf8')).trim()!==NATIVE_UPSTREAM)throw Error('PhotoCraft source is not pinned');
const env={...process.env,CARGO_TARGET_DIR:path.join(root,'target'),RUSTFLAGS:process.platform==='win32'?'-C target-feature=+crt-static':''};delete env.CARGO_ENCODED_RUSTFLAGS;
const result=spawnSync('cargo',['build','--locked','--manifest-path',path.join(root,'Cargo.toml'),'--all-targets','--target',target],{stdio:'inherit',env});
if(result.status!==0)throw Error('Native build failed; previous artifacts are not package candidates');
const built=path.join(root,'target',target,'debug'),out=path.join(root,'target/debug'),bytes=await fs.readFile(path.join(built,nativeName(process.platform)));assertNativeHeader(bytes,process.platform,process.arch);
await fs.mkdir(path.join(out,'examples'),{recursive:true});await fs.cp(path.join(built,nativeName(process.platform)),path.join(out,nativeName(process.platform)));
await fs.cp(path.join(built,'examples',process.platform==='win32'?'fixtures.exe':'fixtures'),path.join(out,'examples',process.platform==='win32'?'fixtures.exe':'fixtures'));
await fs.rm(path.join(out,'licenses'),{recursive:true,force:true});await fs.cp(path.join(root,'licenses'),path.join(out,'licenses'),{recursive:true});
const receipt={protocol:1,upstream:NATIVE_UPSTREAM,rust:NATIVE_RUST,target,platform:process.platform,arch:process.arch,sourceDigest:await sourceDigest(repo),binarySha256:sha(bytes),licenses:await licenseInventory(path.join(out,'licenses'))};
await fs.writeFile(path.join(out,'build.json'),JSON.stringify(receipt,null,2)+'\n');console.log('Prepared native component and fixtures:',target,'Rust',NATIVE_RUST);
