import { expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { temporaryWorkspace } from '../../../../test/temporaryWorkspace';
import { openRecoveryJournal } from './recoveryJournal';
const sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');
async function fixture(){const root=await temporaryWorkspace('recovery-journal-'),directory=path.join(root,'journal');let reserved=0,growth=0;const options={directory,formatId:'synthetic',assertHeld:async()=>{},reserve:async(n:number)=>{reserved+=n;return()=>{reserved-=n;};},onGrowth:(n:number)=>growth+=n};return{root,directory,options,journal:await openRecoveryJournal(options),usage:()=>({reserved,growth})};}
const append=async(j:Awaited<ReturnType<typeof openRecoveryJournal>>,v:unknown)=>(await j.admit(v)).completion;

it('rechecks concurrent admission limits after asynchronous reservations and keeps every admitted promise durable',async()=>{
 const f=await fixture();let release!:()=>void;const gate=new Promise<void>(r=>release=r);const options={...f.options,reserve:async(n:number)=>{await gate;return f.options.reserve(n);}};await f.journal.close();const j=await openRecoveryJournal(options);const tasks=Array.from({length:70},(_,n)=>j.admit({n}));release();const admitted=await Promise.allSettled(tasks);expect(admitted.filter(r=>r.status==='fulfilled')).toHaveLength(64);await Promise.all(admitted.flatMap(r=>r.status==='fulfilled'?[r.value.completion]:[]));expect(j.durableThrough).toBe(64);expect(f.usage().reserved).toBe(0);await j.close();
});

it('retains an actual failed partial append, fsyncs its sealed prefix, then publishes a bound continuation and resumes',async()=>{
 const root=await temporaryWorkspace('journal-partial-'),directory=path.join(root,'journal'),open=fs.open.bind(fs),events:string[]=[];let armed=false,failed=false;
 const spy=vi.spyOn(fs,'open').mockImplementation(async(...args)=>{const h=await open(...args),file=String(args[0]);if(file.startsWith(directory)){const sync=h.sync.bind(h);h.sync=async()=>{events.push(file);return sync();};if(file.endsWith('segment-0.log')&&typeof args[1]==='number'){const write=h.write.bind(h);h.write=(async(...a:any[])=>{if(armed&&!failed){failed=true;const r=await (write as any)(a[0],a[1],100,a[3]);expect(r.bytesWritten).toBe(100);throw Error('real partial write');}return(write as any)(...a);}) as typeof h.write;}}return h;});
 let charged=0;const options={directory,formatId:'synthetic',assertHeld:async()=>{},reserve:async(n:number)=>{charged+=n;return()=>charged-=n;},onGrowth:()=>{}};let j=await openRecoveryJournal(options);await append(j,{first:true});armed=true;await expect(append(j,{text:'x'.repeat(500)})).rejects.toMatchObject({effect:'unknown'});await j.close();const original=await fs.readFile(path.join(directory,'segment-0.log'));events.length=0;armed=false;j=await openRecoveryJournal(options);expect(j.durableThrough).toBe(1);await append(j,{after:true});await j.close();expect(await fs.readFile(path.join(directory,'segment-0.log'))).toEqual(original);const m=JSON.parse(await fs.readFile(path.join(directory,'continuation-1.json'),'utf8'));expect(m.previousSha256).toBe(sha(original));const prefixSync=events.findIndex(p=>p.endsWith('segment-0.log')),manifestSync=events.findIndex(p=>p.endsWith('.tmp'));expect(prefixSync).toBeGreaterThanOrEqual(0);expect(manifestSync).toBeGreaterThan(prefixSync);spy.mockRestore();
});

it('preserves orphan manifest stages on pre-publication failure and never adopts an orphan segment',async()=>{
 const f=await fixture();await append(f.journal,{first:true});await f.journal.close();await fs.appendFile(path.join(f.directory,'segment-0.log'),'unsealed');const open=fs.open.bind(fs);let armed=true;
 const spy=vi.spyOn(fs,'open').mockImplementation(async(...args)=>{const h=await open(...args);if(String(args[0]).endsWith('.tmp')){const sync=h.sync.bind(h);h.sync=async()=>{await sync();if(armed){armed=false;throw Error('manifest fsync ACK lost before publish');}};}return h;});await expect(openRecoveryJournal(f.options)).rejects.toThrow();spy.mockRestore();const before=await fs.readdir(f.directory);expect(before.some(n=>/^segment-1-/.test(n))).toBe(true);expect(before).not.toContain('continuation-1.json');const j=await openRecoveryJournal(f.options);expect(j.durableThrough).toBe(1);await append(j,{after:true});await j.close();const after=await fs.readdir(f.directory);for(const leaf of before)expect(after).toContain(leaf);expect(after.filter(n=>/^segment-1-/.test(n))).toHaveLength(2);
});

it('does not reinterpret a damaged middle header as an unsealed suffix when a valid later group survives',async()=>{
 const f=await fixture();await append(f.journal,{first:true});await append(f.journal,{second:true});await f.journal.close();const file=path.join(f.directory,'segment-0.log'),raw=await fs.readFile(file);raw.writeUInt32BE(1<<20,8);Buffer.from(sha(raw.subarray(0,56)),'hex').copy(raw,56);await fs.writeFile(file,raw);await expect(openRecoveryJournal(f.options)).rejects.toThrow('later group');expect(await fs.readFile(file)).toEqual(raw);expect(await fs.readdir(f.directory)).toEqual(['segment-0.log']);
});

it('checks retained segments by streaming, rejects a changed continuation binding and never reads whole segment files',async()=>{
 const f=await fixture();await append(f.journal,{first:true});await f.journal.close();await fs.appendFile(path.join(f.directory,'segment-0.log'),'tail');const spy=vi.spyOn(fs,'readFile');let j=await openRecoveryJournal(f.options);await j.audit();await j.close();expect(spy.mock.calls.some(c=>String(c[0]).endsWith('.log'))).toBe(false);spy.mockRestore();const file=path.join(f.directory,'continuation-1.json'),m=JSON.parse(await fs.readFile(file,'utf8'));m.prefixHash='a'.repeat(64);await fs.writeFile(file,JSON.stringify(m));await expect(openRecoveryJournal(f.options)).rejects.toThrow('binding');
});

it('retries an unknown continuation directory publication by its exact manifest without creating a second branch',async()=>{
 const f=await fixture();await append(f.journal,{first:true});await f.journal.close();await fs.appendFile(path.join(f.directory,'segment-0.log'),'tail');const open=fs.open.bind(fs);let armed=true;
 const spy=vi.spyOn(fs,'open').mockImplementation(async(...args)=>{const h=await open(...args);if(args[0]===f.directory&&args[1]==='r'){const sync=h.sync.bind(h);h.sync=async()=>{const exists=await fs.access(path.join(f.directory,'continuation-1.json')).then(()=>true,()=>false);if(armed&&exists){armed=false;throw Error('continuation directory sync unknown');}return sync();};}return h;});await expect(openRecoveryJournal(f.options)).rejects.toThrow('directory sync unknown');spy.mockRestore();const before=await fs.readdir(f.directory),manifest=await fs.readFile(path.join(f.directory,'continuation-1.json'));const j=await openRecoveryJournal(f.options);await append(j,{next:true});await j.close();expect(await fs.readFile(path.join(f.directory,'continuation-1.json'))).toEqual(manifest);expect((await fs.readdir(f.directory)).filter(n=>n.startsWith('segment-1-'))).toHaveLength(1);for(const leaf of before)expect(await fs.readdir(f.directory)).toContain(leaf);
});

it('reserves continuation evidence before writing it and retains the old tail if the shared budget refuses',async()=>{
 const f=await fixture();await append(f.journal,{first:true});await f.journal.close();const file=path.join(f.directory,'segment-0.log');await fs.appendFile(file,'tail');const before=await fs.readFile(file);await expect(openRecoveryJournal({...f.options,reserve:async()=>{throw Error('shared budget exhausted');}})).rejects.toThrow('shared budget');expect(await fs.readFile(file)).toEqual(before);expect(await fs.access(path.join(f.directory,'continuation-1.json')).then(()=>true,()=>false)).toBe(false);const j=await openRecoveryJournal(f.options);expect(j.durableThrough).toBe(1);await j.close();
});

it('flushes two already-admitted independent facts in one actual sync without waiting to fill the group',async()=>{
 const root=await temporaryWorkspace('journal-group-'),directory=path.join(root,'journal'),open=fs.open.bind(fs);let armed=false,syncs=0;const spy=vi.spyOn(fs,'open').mockImplementation(async(...args)=>{const h=await open(...args);if(String(args[0]).endsWith('/segment-0.log')&&typeof args[1]==='number'){const sync=h.sync.bind(h);h.sync=async()=>{if(armed)syncs++;return sync();};}return h;});const j=await openRecoveryJournal({directory,formatId:'synthetic',manualFlush:true,assertHeld:async()=>{},reserve:async()=>()=>{},onGrowth:()=>{}});armed=true;const a=await j.admit({kind:'input',id:'a'}),b=await j.admit({kind:'confirmation',id:'previous'});j.flushSoon();const receipts=await Promise.all([a.completion,b.completion]);expect(syncs).toBe(1);expect(receipts.map(r=>r.durableThrough)).toEqual([2,2]);await j.close();spy.mockRestore();
});

it('refuses disconnected and noncanonical continuation branches while preserving their evidence',async()=>{
 const f=await fixture();await append(f.journal,{first:true});await f.journal.close();await fs.writeFile(path.join(f.directory,'continuation-01.json'),'{}');await expect(openRecoveryJournal(f.options)).rejects.toThrow('Unreachable continuation');expect(await fs.readFile(path.join(f.directory,'continuation-01.json'),'utf8')).toBe('{}');
});
