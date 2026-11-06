// Explicit local dependency preparation; never part of app startup or npm build.
import { access, mkdir, mkdtemp, readFile, writeFile, rename, cp } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const commit = 'a259993118ac7ce1d4c828a385abbc3191841e86';
const target = path.join(repo, 'vendor/photocraft');
try {
  await access(target);
  const manifest = await readFile(path.join(target, 'Cargo.toml'), 'utf8');
  const stamp = await readFile(path.join(target, '.flow-upstream-commit'), 'utf8');
  if (stamp.trim() !== commit || !manifest.includes('version = "0.20.1"')) throw Error('Existing PhotoCraft checkout is not the pinned source; retained untouched');
  console.log('Pinned PhotoCraft dependency is already prepared:', commit);
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  try { await access(target); throw Error('Existing PhotoCraft directory has no verified stamp; retained untouched'); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  const temp = await mkdtemp(path.join(os.tmpdir(), 'flow-photocraft-setup-'));
  const archive = path.join(temp, 'source.tar.gz');
  for (const [command,args] of [
    ['curl',['--fail','--location','--max-time','180',`https://codeload.github.com/storytold/photocraft/tar.gz/${commit}`,'-o',archive]],
    ['tar',['-xzf',archive,'-C',temp]]
  ]) { const r=spawnSync(command,args,{stdio:'inherit'});if(r.status!==0)throw Error(`${command} failed; evidence retained at ${temp}`); }
  const source=path.join(temp,`photocraft-${commit}`);
  await writeFile(path.join(source,'.flow-upstream-commit'),commit+'\n',{flag:'wx'});
  await mkdir(path.dirname(target),{recursive:true});
  // Source and destination can be different devices. Prepare in vendor then
  // rename exclusively only after absence checks; never merge directory trees.
  const stage=await mkdtemp(path.join(path.dirname(target),'.photocraft-prepare-'));
  await cp(source,path.join(stage,'source'),{recursive:true,errorOnExist:true,force:false});
  await access(target).then(()=>{throw Error('PhotoCraft destination appeared; preparation retained')},e=>{if(e.code!=='ENOENT')throw e});
  await rename(path.join(stage,'source'),target);
  console.log('Prepared PhotoCraft source:',commit,'; download evidence:',temp);
}
