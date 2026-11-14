import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import ts from 'typescript';
import { temporaryWorkspace } from '../../../../test/temporaryWorkspace';
import { createSourceBackedImport, inspectImportSource, openSourceBackedImport } from './sourceStore';

const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const storage = (root: string) => path.join(root,'.storyboard-flow','image-engine');
const head = (root: string) => path.join(storage(root),'imports','batch','manifest.json');
async function fixture() {
  const root=await temporaryWorkspace('image-engine-');
  const source=path.join(root,'source.synthetic'), bytes=Buffer.alloc(1024*1024+17);
  for(let i=0;i<bytes.length;i++) bytes[i]=i%251;
  await fs.writeFile(source,bytes);
  return {root,source,bytes};
}
const create=(root:string,source:string,extra={})=>createSourceBackedImport({root,importId:'batch',sources:[{id:'one',sourcePath:source,formatHint:'psd'}],...extra});

/** Compile only this owned Module and the existing writer gate into an owned
 * temporary runtime. Child-process crash tests do not scan or execute any suite. */
async function crashRuntime(root:string,source:string,stage:'copying'|'publishing') {
  const runtime=path.join(root,'runtime');await fs.mkdir(runtime);
  const code=await fs.readFile(new URL('./sourceStore.ts',import.meta.url),'utf8');
  const gate=await fs.readFile(new URL('../workspacePhysicalWriterGate.ts',import.meta.url),'utf8');
  const compile=(text:string)=>ts.transpileModule(text,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  await fs.writeFile(path.join(runtime,'sourceStore.mjs'),compile(code).replace('../workspacePhysicalWriterGate.js','./gate.mjs'));
  await fs.writeFile(path.join(runtime,'gate.mjs'),compile(gate));
  const marker=path.join(runtime,'paused');
  const childCode=`
import fs from 'node:fs/promises';
import {createSourceBackedImport} from './sourceStore.mjs';
const pause=async()=>{await fs.writeFile(${JSON.stringify(marker)},'paused');setInterval(()=>{},1000);await new Promise(()=>{});};
if(${JSON.stringify(stage)}==='copying'){
  const open=fs.open.bind(fs);fs.open=async(...args)=>{const h=await open(...args);if(String(args[0]).endsWith('.partial')){const write=h.write.bind(h);h.write=async(...a)=>{const r=await write(...a);await pause();return r;};}return h;};
}else{
  const link=fs.link.bind(fs);fs.link=async(...a)=>{if(String(a[1]).endsWith('.bin'))await pause();return link(...a);};
}
const store=await createSourceBackedImport({root:${JSON.stringify(root)},importId:'batch',sources:[{id:'one',sourcePath:${JSON.stringify(source)}}]});
await store.retain('one');
`;
  const script=path.join(runtime,'crash.mjs');await fs.writeFile(script,childCode);
  const child=spawn(process.execPath,[script],{stdio:['ignore','ignore','pipe']});
  let stderr='';child.stderr.on('data',data=>{stderr+=data;});
  const exited=new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('exit',()=>resolve());});
  let observed=false;
  try {
    for(let i=0;i<500;i++) {
      if(await fs.stat(marker).then(()=>true,()=>false)){observed=true;break;}
      if(child.exitCode!==null) throw Error(`Crash fixture exited before barrier: ${stderr}`);
      await new Promise(resolve=>setTimeout(resolve,10));
    }
    if(!observed) throw Error(`Crash fixture did not reach ${stage}: ${stderr}`);
  } finally {child.kill('SIGKILL');await exited;}
}

describe('source-backed import storage on real files',()=>{
  it('retains exact original bytes with SHA-256, independent of decoding or external source',async()=>{
    const {root,source,bytes}=await fixture();const before=await inspectImportSource(source);
    const store=await create(root,source);
    expect(store.snapshot().items[0]).toMatchObject({state:'queued',hydration:'unhydrated'});
    await expect(store.object('one')).rejects.toMatchObject({code:'conflict'});
    const retained=await store.retain('one');
    expect(retained).toMatchObject({state:'retained',hydration:'unhydrated',retained:{digest:digest(bytes),byteLength:bytes.length}});
    const object=await store.object('one');expect((await fs.readFile(object.path)).equals(bytes)).toBe(true);
    expect(await inspectImportSource(source)).toEqual(before);
    expect((await fs.readFile(source)).equals(bytes)).toBe(true);
    const generation=store.snapshot().generation;
    await store.retain('one');expect(store.snapshot().generation).toBe(generation);
    expect((await fs.readdir(path.join(storage(root),'originals')))).toEqual([`${digest(bytes)}.bin`]);
    await fs.unlink(source);await store.close();
    const reopened=await openSourceBackedImport({root,importId:'batch'});
    expect(reopened.snapshot().items[0].hydration).toBe('unhydrated');
    expect(Buffer.from(await reopened.readRange('one',7,21))).toEqual(bytes.subarray(7,28));
    expect((await reopened.object('one')).digest).toBe(digest(bytes));
    await reopened.close();
  });

  it('refuses source replacement after inspection and preserves the replacement',async()=>{
    const {root,source,bytes}=await fixture();const expected=await inspectImportSource(source);
    await fs.rename(source,source+'.old');await fs.writeFile(source,bytes);
    await expect(create(root,source,{sources:[{id:'one',sourcePath:source,expected}]})).rejects.toMatchObject({code:'source-changed'});
    expect(await fs.readFile(source)).toEqual(bytes);
    // A failed create cannot overwrite its partially initialized namespace.
    await expect(create(root,source)).rejects.toMatchObject({code:'EEXIST'});
  });

  it('marks a same-size rewritten source changed rather than importing newer bytes',async()=>{
    const {root,source,bytes}=await fixture();const store=await create(root,source);
    const changed=Buffer.from(bytes);changed[0]^=255;await fs.writeFile(source,changed);
    expect(await store.retain('one')).toMatchObject({state:'source-changed',error:{code:'source-changed'}});
    expect(await fs.readdir(path.join(storage(root),'originals'))).toEqual([]);
    await store.close();const reopened=await openSourceBackedImport({root,importId:'batch'});
    expect((await reopened.resume()).items[0].state).toBe('source-changed');
    expect(await fs.readFile(source)).toEqual(changed);await reopened.close();
  });

  it('cancels at a file checkpoint, retains finished sources, and resumes after reopen',async()=>{
    const {root,source,bytes}=await fixture();const second=path.join(root,'second.synthetic');await fs.writeFile(second,'second original');
    const store=await create(root,source,{sources:[{id:'one',sourcePath:source},{id:'two',sourcePath:second}]});
    const abort=new AbortController();
    const result=await store.resume({signal:abort.signal,onProgress:()=>abort.abort()});
    expect(result.phase).toBe('cancelled');expect(result.items.map(x=>x.state)).toEqual(['retained','queued']);
    await fs.unlink(source);await store.close();
    const reopened=await openSourceBackedImport({root,importId:'batch'});
    expect(reopened.snapshot().phase).toBe('cancelled');
    await expect(reopened.retain('two')).rejects.toMatchObject({code:'busy'});
    expect((await reopened.resume()).items.map(x=>x.state)).toEqual(['retained','retained']);
    expect(await fs.readFile((await reopened.object('one')).path)).toEqual(bytes);await reopened.close();
  });

  it('settles an already started real copy before honoring cancellation',async()=>{
    const {root,source,bytes}=await fixture();const second=path.join(root,'second.synthetic');await fs.writeFile(second,'second');
    const store=await create(root,source,{sources:[{id:'one',sourcePath:source},{id:'two',sourcePath:second}]});
    const abort=new AbortController(), open=fs.open.bind(fs);
    const spy=vi.spyOn(fs,'open').mockImplementation(async(...args)=>{
      const handle=await open(...args);
      if(String(args[0]).endsWith('.partial')){
        const write=handle.write.bind(handle);
        handle.write=(async(...values:unknown[])=>{
          const result=await (write as (...args:unknown[])=>Promise<unknown>)(...values);abort.abort();return result;
        }) as typeof handle.write;
      }
      return handle;
    });
    try {
      const result=await store.resume({signal:abort.signal});
      expect(result.phase).toBe('cancelled');expect(result.items.map(x=>x.state)).toEqual(['retained','queued']);
      expect(await fs.readFile((await store.object('one')).path)).toEqual(bytes);
    } finally {spy.mockRestore();await store.close();}
  });

  it('snapshots source registration before asynchronous filesystem work',async()=>{
    const {root,source}=await fixture();const sources=[{id:'one',sourcePath:source}];
    const opening=createSourceBackedImport({root,importId:'batch',sources});sources[0].sourcePath='/unreachable';sources.push({id:'two',sourcePath:'/unreachable'});
    const store=await opening;expect(store.snapshot().items).toHaveLength(1);expect(store.snapshot().items[0].sourcePath).toBe(source);await store.close();
  });

  it('reports unavailable unretained sources explicitly without impairing retained objects',async()=>{
    const {root,source}=await fixture();const second=path.join(root,'second.synthetic');await fs.writeFile(second,'not yet retained');
    const store=await create(root,source,{sources:[{id:'one',sourcePath:source},{id:'two',sourcePath:second}]});
    await store.retain('one');await store.close();await fs.unlink(second);
    const reopened=await openSourceBackedImport({root,importId:'batch'});
    expect((await reopened.resume()).items[1]).toMatchObject({state:'source-unavailable',hydration:'unhydrated',error:{code:'source-unavailable'}});
    expect((await reopened.object('one')).byteLength).toBeGreaterThan(0);await reopened.close();
  });

  it('serializes repeated retention and refuses a concurrent root writer',async()=>{
    const {root,source}=await fixture();const store=await create(root,source);
    await expect(openSourceBackedImport({root,importId:'batch'})).rejects.toMatchObject({code:'busy'});
    const [one,two]=await Promise.all([store.retain('one'),store.retain('one')]);expect(one.retained).toEqual(two.retained);
    expect((await fs.readdir(path.join(storage(root),'originals'))).length).toBe(1);
    await Promise.all([store.close(),store.close()]);await expect(store.retain('one')).rejects.toMatchObject({code:'closed'});
    const next=await openSourceBackedImport({root,importId:'batch'});await next.close();
  });

  it('applies bounded range reads and snapshots without shared mutable metadata',async()=>{
    const {root,source}=await fixture();const store=await create(root,source);await store.retain('one');
    for(const [offset,length] of [[-1,2],[0,-1],[0,1048577],[1048590,100],[1.1,2],[Number.MAX_SAFE_INTEGER,2]]) await expect(store.readRange('one',offset,length)).rejects.toMatchObject({code:'invalid-input'});
    const copy=store.snapshot();copy.items[0].sourcePath='/bad';copy.items[0].retained!.digest='0'.repeat(64);
    expect((await store.object('one')).digest).not.toBe('0'.repeat(64));await store.close();
  });

  it('refuses aliases, traversal IDs, hostile namespaces, and old recovery protection',async()=>{
    const {root,source}=await fixture();const alias=path.join(root,'alias');await fs.symlink(source,alias);
    await expect(inspectImportSource(alias)).rejects.toMatchObject({code:'conflict'});
    await expect(createSourceBackedImport({root,importId:'../escape',sources:[]})).rejects.toMatchObject({code:'invalid-input'});
    await expect(create(root,source,{sources:[{id:'../escape',sourcePath:source}]})).rejects.toMatchObject({code:'invalid-input'});
    await fs.mkdir(path.join(root,'.storyboard-flow','workspace-recovery-v2'));
    await expect(openSourceBackedImport({root,importId:'batch'})).rejects.toThrow('protected by a recovery inventory');
    expect(await fs.readFile(source)).not.toHaveLength(0);
  });

  it('rejects a symlinked storage namespace before writing through it',async()=>{
    const {root,source}=await fixture();const outside=path.join(root,'outside');await fs.mkdir(outside);await fs.mkdir(path.join(root,'.storyboard-flow'));
    await fs.symlink(outside,path.join(root,'.storyboard-flow','image-engine'));
    await expect(create(root,source)).rejects.toMatchObject({code:'conflict'});expect(await fs.readdir(outside)).toEqual([]);
  });

  it('detects damaged retained bytes without repairing or deleting evidence',async()=>{
    const {root,source}=await fixture();const store=await create(root,source);await store.retain('one');const object=await store.object('one');await store.close();
    const corrupt=Buffer.from('corrupt');await fs.writeFile(object.path,corrupt);
    await expect(openSourceBackedImport({root,importId:'batch'})).rejects.toMatchObject({code:'conflict'});
    expect(await fs.readFile(object.path)).toEqual(corrupt);
  });

  it('refuses an externally changed manifest and preserves it',async()=>{
    const {root,source}=await fixture();const store=await create(root,source);
    const raw=await fs.readFile(head(root),'utf8');const changed=JSON.parse(raw);changed.generation=100;const hostile=JSON.stringify(changed);await fs.writeFile(head(root),hostile);
    await expect(store.retain('one')).rejects.toMatchObject({code:'conflict'});expect(await fs.readFile(head(root),'utf8')).toBe(hostile);await store.close();
  });

  it('rejects a malicious temporary path on reopen without reading or removing its target',async()=>{
    const {root,source,bytes}=await fixture();const store=await create(root,source);await store.close();
    const manifest=JSON.parse(await fs.readFile(head(root),'utf8'));manifest.items[0].state='copying';manifest.items[0].copy={temporary:'../../source.synthetic'};
    await fs.writeFile(head(root),JSON.stringify(manifest));
    await expect(openSourceBackedImport({root,importId:'batch'})).rejects.toMatchObject({code:'conflict'});
    expect(await fs.readFile(source)).toEqual(bytes);
  });

  it('reserves a whole file against local storage limits without deleting earlier originals',async()=>{
    const {root,source,bytes}=await fixture();const second=path.join(root,'second.synthetic');await fs.writeFile(second,bytes);
    const store=await create(root,source,{limits:{maxStoredBytes:bytes.length},sources:[{id:'one',sourcePath:source},{id:'two',sourcePath:second}]});
    const result=await store.resume();expect(result.items.map(x=>x.state)).toEqual(['retained','failed']);expect(result.items[1].error?.code).toBe('resource-limit');
    expect((await fs.readdir(path.join(storage(root),'originals'))).length).toBe(1);await store.close();
  });

  it('reopens after a real process death mid-copy without treating partial bytes as retained',async()=>{
    const {root,source,bytes}=await fixture();await crashRuntime(root,source,'copying');
    const crashed=JSON.parse(await fs.readFile(head(root),'utf8'));expect(crashed.items[0].state).toBe('copying');
    const partial=path.join(storage(root),'originals',crashed.items[0].copy.temporary);const before=await fs.readFile(partial);
    expect(before.length).toBeGreaterThan(0);expect(before.length).toBeLessThan(bytes.length);
    const store=await openSourceBackedImport({root,importId:'batch'});await expect(store.object('one')).rejects.toMatchObject({code:'conflict'});
    expect((await store.resume()).items[0].state).toBe('retained');expect(await fs.readFile(partial)).toEqual(before);
    expect(await fs.readFile((await store.object('one')).path)).toEqual(bytes);await store.close();
  });

  it('finishes a durable publishing checkpoint after process death and removal of the source',async()=>{
    const {root,source,bytes}=await fixture();await crashRuntime(root,source,'publishing');
    const crashed=JSON.parse(await fs.readFile(head(root),'utf8'));expect(crashed.items[0].state).toBe('publishing');
    await fs.unlink(source);const store=await openSourceBackedImport({root,importId:'batch'});
    expect((await store.resume()).items[0]).toMatchObject({state:'retained',hydration:'unhydrated'});
    expect(await fs.readFile((await store.object('one')).path)).toEqual(bytes);await store.close();
  });
});
