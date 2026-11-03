import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { createOutputObservation } from './flowOutputObservation';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
it('caches unchanged file bytes and invalidates on write, replacement and disappearance',async()=>{
 const root=await temporaryWorkspace('flow-observe-'),file=path.join(root,'test.tif');await fs.writeFile(file,'one');
 const observe=createOutputObservation(async()=>{}), open=fs.open.bind(fs);let reads=0;
 const spy=vi.spyOn(fs,'open').mockImplementation(async(...args)=>{
  const handle=await open(...args),read=handle.readFile.bind(handle);
  handle.readFile=((...params:Parameters<typeof handle.readFile>)=>{reads++;return read(...params);}) as typeof handle.readFile;
  return handle;
 });
 try{
  expect(await observe(file)).toBe(hash('one'));expect(await observe(file)).toBe(hash('one'));expect(reads).toBe(1);
  await fs.writeFile(file,'two');expect(await observe(file)).toBe(hash('two'));expect(reads).toBe(2);
  await fs.rename(file,file+'.old');await fs.writeFile(file,'two');expect(await observe(file)).toBe(hash('two'));expect(reads).toBe(3);
  await fs.unlink(file);expect(await observe(file)).toBe(null);
 }finally{spy.mockRestore();}
});
it('rejects aliased paths, hard links and a file changed during inspection',async()=>{
 const root=await temporaryWorkspace('flow-observe-binding-'),file=path.join(root,'test.tif');await fs.writeFile(file,'one');
 const observe=createOutputObservation(async()=>{});
 await fs.symlink(file,file+'.alias');await expect(observe(file+'.alias')).rejects.toThrow('Aliased');
 await fs.link(file,file+'.link');await expect(observe(file)).rejects.toThrow('Unsupported');await fs.unlink(file+'.link');
 let calls=0;const changing=createOutputObservation(async()=>{if(++calls===2)await fs.writeFile(file,'changed');});
 await expect(changing(file)).rejects.toThrow('changed while checking');
 expect(await fs.readFile(file,'utf8')).toBe('changed');
});
