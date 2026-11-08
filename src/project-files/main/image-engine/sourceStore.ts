import { constants } from 'node:fs';
import fs, { type FileHandle } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { assertPhysicalWorkspaceWriterTargets } from '../workspacePhysicalWriterGate.js';
import path from 'node:path';

/** A retained source is not a decoded/editable image. This module never decodes,
 * writes working TIFFs, changes ProjectV1, or modifies an external source.
 * In-process exclusive open owns the root until close(). The Main caller must
 * already hold the project writer authority for cross-process exclusion. This
 * module checks the existing physical writer gate; it does not invent a lease.
 * Cancellation pauses between files;
 * a copy already started always settles. Interrupted partial files are evidence,
 * not resumable complete originals. All storage is append-only except the head
 * manifest and the identity-checked removal of our successful temporary file.
 *
 * Directory sync is skipped on Windows, as in the existing Flow store. Native
 * permission/alias uncertainty fails closed. JS cannot eliminate a hostile
 * directory swap between path validation and a filesystem syscall; directories
 * are rechecked around effects, and uncertain effects remain evidence.
 */
export type SourceIdentity = { dev: string; ino: string; size: string; mtimeNs: string; ctimeNs: string };
export type SourceStoreCode = 'invalid-input' | 'busy' | 'closed' | 'conflict' | 'source-unavailable' | 'source-changed' | 'resource-limit' | 'io-failure';
export class SourceStoreError extends Error {
  constructor(readonly code: SourceStoreCode, message: string, readonly effect: 'none' | 'retained' | 'unknown' = 'none') { super(message); }
}
export type RetainedSource = { digest: string; byteLength: number };
export type SourceImportItem = {
  id: string; sourcePath: string; formatHint?: string; expected: SourceIdentity;
  state: 'queued' | 'copying' | 'publishing' | 'retained' | 'source-unavailable' | 'source-changed' | 'failed';
  /** Unhydrated is intentionally independent of successful source retention. */
  hydration: 'unhydrated';
  copy?: { temporary: string };
  candidate?: RetainedSource;
  retained?: RetainedSource;
  error?: { code: SourceStoreCode; message: string; effect: 'none' | 'retained' | 'unknown' };
};
export type SourceImportManifest = {
  schema: 'storyboard-flow.source-import'; version: 1; importId: string;
  generation: number; phase: 'active' | 'cancelled'; items: SourceImportItem[];
};
/** maxStoredBytes counts this Module's originals and abandoned copies. The Main
 * project coordinator must additionally reserve its shared recovery budget;
 * this local limit is neither total project disk usage nor a process RAM cap. */
export type SourceStoreLimits = { maxSourceBytes: number; maxStoredBytes: number; maxReadBytes: number; maxItems: number };
export type SourceStoreOptions = { root: string; importId: string; limits?: Partial<SourceStoreLimits> };
export type SourceInput = { id: string; sourcePath: string; formatHint?: string; expected?: SourceIdentity };
/** Main-private result. Never send path to a renderer or trust formatHint as a
 * verified format. Main may authorize a bounded native byte stream after this
 * validation; the consumer must bind digest/length and check the real signature. */
export type RetainedSourceObject = RetainedSource & { path: string; identity: SourceIdentity };
export type SourceImportStore = {
  snapshot(): SourceImportManifest;
  retain(itemId: string): Promise<SourceImportItem>;
  resume(options?: { signal?: AbortSignal; onProgress?: (snapshot: SourceImportManifest) => void;itemIds?:readonly string[] }): Promise<SourceImportManifest>;
  cancel(): Promise<SourceImportManifest>;
  object(itemId: string): Promise<RetainedSourceObject>;
  readRange(itemId: string, offset: number, length: number): Promise<Uint8Array>;
  close(): Promise<void>;
};

const CAPS: SourceStoreLimits = Object.freeze({ maxSourceBytes: 128 << 20, maxStoredBytes: 8 * 1024 ** 3, maxReadBytes: 1 << 20, maxItems: 100_000 });
const META_CAP = 64 << 20, CHUNK = 256 << 10;
const idPattern = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const temporaryPattern = /^copy-[a-f0-9-]{36}\.partial$/;
const codeSet = new Set<SourceStoreCode>(['invalid-input','busy','closed','conflict','source-unavailable','source-changed','resource-limit','io-failure']);
const clone = <T>(value: T): T => structuredClone(value);
const missing = (e: unknown) => (e as NodeJS.ErrnoException).code === 'ENOENT';
const message = (e: unknown) => e instanceof Error ? e.message : String(e);
function fail(code: SourceStoreCode, text: string, effect: SourceStoreError['effect'] = 'none'): never { throw new SourceStoreError(code, text, effect); }
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function exact(value: unknown, required: string[], optional: string[] = []): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || required.some(k => !Object.hasOwn(value,k)) || Object.keys(value).some(k => !required.includes(k) && !optional.includes(k)))
    fail('conflict', 'Unsupported source-store metadata');
}
function validPath(p: unknown): asserts p is string {
  if (typeof p !== 'string' || !path.isAbsolute(p) || p.includes('\0') || path.normalize(p) !== p) fail('invalid-input', 'A canonical absolute path is required');
}
function identity(stat: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint }): SourceIdentity {
  return { dev: String(stat.dev), ino: String(stat.ino), size: String(stat.size), mtimeNs: String(stat.mtimeNs), ctimeNs: String(stat.ctimeNs) };
}
function validIdentity(v: unknown): v is SourceIdentity {
  try { exact(v,['dev','ino','size','mtimeNs','ctimeNs']); return Object.values(v).every(x => typeof x === 'string' && /^-?\d+$/.test(x)) && BigInt(v.size as string) >= 0n; } catch { return false; }
}
const sameIdentity = (a: SourceIdentity,b: SourceIdentity) => a.dev===b.dev && a.ino===b.ino && a.size===b.size && a.mtimeNs===b.mtimeNs && a.ctimeNs===b.ctimeNs;
function limitsFor(value?: Partial<SourceStoreLimits>): SourceStoreLimits {
  const limits = { ...CAPS, ...value };
  for (const [key,n] of Object.entries(limits)) if (!(key in CAPS) || !Number.isSafeInteger(n) || n<1 || n>CAPS[key as keyof SourceStoreLimits]) fail('invalid-input',`Invalid source-store limit ${key}`);
  return limits;
}
async function directory(p: string, create: boolean): Promise<SourceIdentity> {
  if (create) await fs.mkdir(p,{mode:0o700}).catch(e=>{ if ((e as NodeJS.ErrnoException).code!=='EEXIST') throw e; });
  const st = await fs.lstat(p,{bigint:true});
  if (!st.isDirectory() || st.isSymbolicLink() || await fs.realpath(p)!==p) fail('conflict',`Unsafe source-store directory: ${p}`);
  return identity(st);
}
async function openRegular(p: string): Promise<FileHandle> {
  if (typeof constants.O_NOFOLLOW !== 'number') fail('conflict','No-follow file reads unavailable');
  const before = await fs.lstat(p,{bigint:true});
  if (!before.isFile() || before.isSymbolicLink() || await fs.realpath(p)!==p) fail('conflict',`Unsafe source-store file: ${p}`);
  const handle = await fs.open(p,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    const after=await handle.stat({bigint:true});
    if (!after.isFile() || !sameIdentity(identity(before),identity(after))) fail('conflict',`File changed while opening: ${p}`);
    return handle;
  } catch(e) { await handle.close(); throw e; }
}
async function flushDirectory(p: string) {
  if (process.platform==='win32') return;
  const handle=await fs.open(p,constants.O_RDONLY);
  try { await handle.sync(); } finally { await handle.close(); }
}
async function fileBytes(p: string, cap: number): Promise<Buffer> {
  const handle=await openRegular(p);
  try {
    const st=await handle.stat({bigint:true});
    if(st.size>BigInt(cap)) fail('resource-limit',`Metadata exceeds ${cap} bytes`);
    const chunks:Buffer[]=[];const buffer=Buffer.allocUnsafe(Math.min(CHUNK,cap+1));let total=0;
    while(true){const read=await handle.read(buffer,0,Math.min(buffer.length,cap-total+1),total);if(!read.bytesRead)break;total+=read.bytesRead;if(total>cap)fail('resource-limit','Metadata grew beyond byte budget');chunks.push(Buffer.from(buffer.subarray(0,read.bytesRead)));}
    if(!sameIdentity(identity(st),identity(await handle.stat({bigint:true})))) fail('conflict','Metadata changed during read');
    return Buffer.concat(chunks,total);
  } finally { await handle.close(); }
}
/** The same opened handle is hashed and identity-checked; memory is bounded by CHUNK. */
async function digestHandle(handle: FileHandle, cap: number, sink?: FileHandle, expected?: SourceIdentity): Promise<RetainedSource> {
  const before=identity(await handle.stat({bigint:true}));
  if(expected && !sameIdentity(before,expected)) fail('source-changed','Source changed since it was registered');
  if(BigInt(before.size)>BigInt(cap)) fail('resource-limit','Source exceeds byte budget');
  const hash=createHash('sha256'), buffer=Buffer.allocUnsafe(CHUNK);
  let byteLength=0;
  while(true) {
    const {bytesRead}=await handle.read(buffer,0,Math.min(CHUNK,cap-byteLength+1),byteLength);
    if(!bytesRead) break;
    byteLength+=bytesRead;
    if(byteLength>cap) fail('resource-limit','Source grew beyond byte budget');
    const bytes=buffer.subarray(0,bytesRead); hash.update(bytes);
    if(sink) {
      let written=0;
      while(written<bytes.length) { const result=await sink.write(bytes,written,bytes.length-written,null); if(!result.bytesWritten) fail('io-failure','Copy made no progress','unknown'); written+=result.bytesWritten; }
    }
  }
  if(BigInt(byteLength)!==BigInt(before.size) || !sameIdentity(before,identity(await handle.stat({bigint:true})))) fail('source-changed','Source changed during retention');
  return {digest:hash.digest('hex'),byteLength};
}
/** Read-only registration: callers can bind an inspected identity before creation. */
export async function inspectImportSource(sourcePath: string): Promise<SourceIdentity> {
  validPath(sourcePath);
  let handle: FileHandle;
  try { handle=await openRegular(sourcePath); }
  catch(e) { if(missing(e)) fail('source-unavailable',`Source is unavailable: ${sourcePath}`); throw e; }
  try { return identity(await handle.stat({bigint:true})); } finally { await handle.close(); }
}

function validateManifest(v: unknown, importId: string, limits: SourceStoreLimits): SourceImportManifest {
  exact(v,['schema','version','importId','generation','phase','items']);
  if(v.schema!=='storyboard-flow.source-import' || v.version!==1 || v.importId!==importId || !Number.isSafeInteger(v.generation) || Number(v.generation)<0 || !['active','cancelled'].includes(String(v.phase)) || !Array.isArray(v.items) || v.items.length>limits.maxItems) fail('conflict','Invalid source-import manifest');
  const ids=new Set<string>();
  for(const item of v.items as unknown[]) {
    exact(item,['id','sourcePath','expected','state','hydration'],['formatHint','copy','candidate','retained','error']);
    if(typeof item.id!=='string' || !idPattern.test(item.id) || ids.has(item.id) || !validIdentity(item.expected) || item.hydration!=='unhydrated' || !['queued','copying','publishing','retained','source-unavailable','source-changed','failed'].includes(String(item.state))) fail('conflict','Invalid source-import item');
    ids.add(item.id); validPath(item.sourcePath);
    if(item.formatHint!==undefined && (typeof item.formatHint!=='string' || item.formatHint.length>64 || item.formatHint.includes('\0'))) fail('conflict','Invalid format hint');
    if(item.copy!==undefined) { exact(item.copy,['temporary']); if(typeof item.copy.temporary!=='string' || !temporaryPattern.test(item.copy.temporary)) fail('conflict','Invalid copy evidence name'); }
    for(const key of ['candidate','retained']) if(item[key]!==undefined) {
      const object=item[key]; exact(object,['digest','byteLength']);
      if(typeof object.digest!=='string' || !hashPattern.test(object.digest) || !Number.isSafeInteger(object.byteLength) || Number(object.byteLength)<0 || Number(object.byteLength)>limits.maxSourceBytes || String(object.byteLength)!==(item.expected as SourceIdentity).size) fail('conflict','Invalid retained object');
    }
    if(item.error!==undefined) { exact(item.error,['code','message','effect']); if(!codeSet.has(item.error.code as SourceStoreCode) || typeof item.error.message!=='string' || item.error.message.length>8192 || !['none','retained','unknown'].includes(String(item.error.effect))) fail('conflict','Invalid retained error'); }
    if((item.state==='copying' && !item.copy) || (item.state==='publishing' && (!item.copy || !item.candidate)) || (item.state==='retained' && (!item.retained || item.copy || item.candidate)) || (item.state!=='retained' && item.retained)) fail('conflict','Inconsistent source-import state');
  }
  return clone(v as unknown as SourceImportManifest);
}

const writers = new Map<string, symbol>();

async function openStore(options: SourceStoreOptions, sources?: readonly SourceInput[], verifyOriginalsOnOpen=true): Promise<SourceImportStore> {
  if(!options || typeof options!=='object') fail('invalid-input','Source-store options are required');
  validPath(options.root);
  if(typeof options.importId!=='string' || !idPattern.test(options.importId)) fail('invalid-input','Invalid import ID');
  const root=options.root, importId=options.importId, limits=limitsFor(options.limits);
  sources=sources===undefined?undefined:clone(sources); // snapshot before the first await
  const rootIdentity=await directory(root,false);
  await assertPhysicalWorkspaceWriterTargets([root]);
  if(writers.has(root)) fail('busy','Another source-import writer owns this project root');
  const writer=Symbol(importId); writers.set(root,writer);
  const dirs=[path.join(root,'.storyboard-flow'),path.join(root,'.storyboard-flow','image-engine')];
  const storage=dirs[1];
  let closed=false, closing=false, paused=false, cancellation=0, tail=Promise.resolve();
  let closeWork:Promise<void>|undefined;
  const originals=path.join(storage,'originals'), imports=path.join(storage,'imports'), batch=path.join(imports,importId), history=path.join(batch,'manifests');
  const head=path.join(batch,'manifest.json');
  let manifest: SourceImportManifest, headDigest: string | undefined;
  const bindings=new Map<string,SourceIdentity>();
  const assertBound=async () => {
    if(closed) fail('closed','Source import is closed');
    await assertPhysicalWorkspaceWriterTargets([root]);
    if(writers.get(root)!==writer) fail('conflict','Source-import writer ownership changed');
    const current=await directory(root,false);
    if(current.dev!==rootIdentity.dev || current.ino!==rootIdentity.ino) fail('conflict','Project root identity changed');
    for(const [d,expected] of bindings) { const now=await directory(d,false); if(now.dev!==expected.dev || now.ino!==expected.ino) fail('conflict',`Storage directory identity changed: ${d}`); }
  };
  const schedule=<T>(job:()=>Promise<T>):Promise<T> => {
    if(closing || closed) return Promise.reject(new SourceStoreError('closed','Source import is closing'));
    const work=tail.then(job); tail=work.then(()=>undefined,()=>undefined); return work;
  };
  const publish=async (next:SourceImportManifest) => {
    await assertBound(); validateManifest(next,importId,limits);
    if(headDigest!==undefined) { const current=await fileBytes(head,META_CAP); if(sha(current)!==headDigest) fail('conflict','Import manifest changed outside its writer'); }
    const bytes=Buffer.from(JSON.stringify(next)+'\n'); if(bytes.length>META_CAP) fail('resource-limit','Import manifest exceeds metadata budget');
    const digest=sha(bytes), version=path.join(history,`${next.generation}-${digest}.json`);
    const temp=path.join(batch,`manifest-${randomUUID()}.tmp`);
    const handle=await fs.open(temp,'wx',0o600);
    let temporaryIdentity:SourceIdentity;
    try { await handle.writeFile(bytes); await handle.sync();temporaryIdentity=identity(await handle.stat({bigint:true})); } finally { await handle.close(); }
    await assertBound();
    if(!sameIdentity(temporaryIdentity,identity(await fs.lstat(temp,{bigint:true}))))fail('conflict','Manifest temporary file changed','unknown');
    await fs.link(temp,version).catch(async e=>{ if((e as NodeJS.ErrnoException).code!=='EEXIST') throw e; if(sha(await fileBytes(version,META_CAP))!==digest) fail('conflict','Manifest version collision','retained'); });
    await flushDirectory(history);
    if(headDigest===undefined) await fs.link(temp,head); else await fs.rename(temp,head);
    // After head publication an error is unknown, and reopening must read the actual head.
    manifest=clone(next); headDigest=digest;
    await flushDirectory(batch); await assertBound();
    if(sha(await fileBytes(head,META_CAP))!==digest)fail('conflict','Published manifest identity differs','unknown');
    // Initial link leaves our own temp name; historical manifest keeps the bytes.
    if(next.generation===0){
      // Our own hard links legitimately change ctime. Require the owned inode and
      // unchanged bytes instead of comparing the pre-link ctime for deletion.
      const current=identity(await fs.lstat(temp,{bigint:true}));
      if(current.dev!==temporaryIdentity.dev || current.ino!==temporaryIdentity.ino || sha(await fileBytes(temp,META_CAP))!==digest)fail('conflict','Manifest temporary file changed','retained');
      await fs.unlink(temp);
    }
  };
  const update=async (change:(m:SourceImportManifest)=>void) => {
    const next=clone(manifest); next.generation++; change(next); await publish(next);
  };
  const find=(itemId:string) => { if(!idPattern.test(itemId)) fail('invalid-input','Invalid import item ID'); const item=manifest.items.find(x=>x.id===itemId); if(!item) fail('invalid-input','Unknown import item'); return item; };
  const verifyObject=async (ref:RetainedSource, file=path.join(originals,`${ref.digest}.bin`)):Promise<RetainedSourceObject> => {
    await assertBound(); const handle=await openRegular(file);
    try {
      const result=await digestHandle(handle,limits.maxSourceBytes);
      if(result.digest!==ref.digest || result.byteLength!==ref.byteLength) fail('conflict',`Retained source is damaged; evidence preserved: ${file}`);
      const bound=identity(await handle.stat({bigint:true}));
      await assertBound(); const entry=identity(await fs.lstat(file,{bigint:true})); if(!sameIdentity(bound,entry)) fail('conflict','Retained source changed during verification');
      return {...ref,path:file,identity:bound};
    } finally { await handle.close(); }
  };
  const storedBytes=async () => {
    let total=0;
    for(const name of await fs.readdir(originals)) {
      if(!/^[a-f0-9]{64}\.bin$/.test(name) && !temporaryPattern.test(name)) fail('conflict','Unknown entry in retained-source namespace');
      const file=path.join(originals,name), st=await fs.lstat(file,{bigint:true});
      if(!st.isFile() || st.isSymbolicLink()) fail('conflict','Unsafe retained-source entry');
      total+=Number(st.size); if(!Number.isSafeInteger(total) || total>limits.maxStoredBytes) fail('resource-limit','Retained-source storage budget exceeded');
    }
    return total;
  };
  const publishCandidate=async (itemId:string) => {
    const item=find(itemId), ref=item.candidate!, temp=path.join(originals,item.copy!.temporary), final=path.join(originals,`${ref.digest}.bin`);
    let finalExists=true;
    try { await verifyObject(ref); } catch(e) { if(missing(e)) finalExists=false; else throw e; }
    if(!finalExists) { await verifyObject(ref,temp); await assertBound(); await fs.link(temp,final); }
    await flushDirectory(originals); await verifyObject(ref);
    await update(m=>{const x=m.items.find(x=>x.id===itemId)!; x.state='retained';x.retained=clone(ref);delete x.copy;delete x.candidate;delete x.error;});
    // Only our successfully published temp is removed; interrupted copies remain evidence.
    try { const bound=await verifyObject(ref,temp); const now=identity(await fs.lstat(temp,{bigint:true})); if(sameIdentity(bound.identity,now)) await fs.unlink(temp); }
    catch(e) { if(!missing(e)) throw new SourceStoreError('io-failure',`Retained source is safe; copy evidence remains at ${temp}: ${message(e)}`,'retained'); }
    await flushDirectory(originals);
  };
  const retain=async (itemId:string):Promise<SourceImportItem> => {
    await assertBound(); let item=find(itemId);
    if(item.state==='retained') { await verifyObject(item.retained!); return clone(item); }
    if(item.state==='publishing') { await publishCandidate(itemId); return clone(find(itemId)); }
    if(item.state==='source-changed') return clone(item);
    const expected=clone(item.expected), temporary=`copy-${randomUUID()}.partial`, temp=path.join(originals,temporary);
    try {
      let source:FileHandle;
      try { source=await openRegular(item.sourcePath); }
      catch(e) { if(missing(e) || ['EACCES','EPERM'].includes((e as NodeJS.ErrnoException).code??'')) fail('source-unavailable',`Registered source is unavailable: ${item.sourcePath}`); throw e; }
      try {
        if(!sameIdentity(identity(await source.stat({bigint:true})),expected)) fail('source-changed','Source changed since registration');
        const size=Number(expected.size);
        if(!Number.isSafeInteger(size) || size>limits.maxSourceBytes) fail('resource-limit','Source exceeds retention budget');
        if((await storedBytes())+size>limits.maxStoredBytes) fail('resource-limit','Insufficient retained-source storage budget');
        await update(m=>{const x=m.items.find(x=>x.id===itemId)!;x.state='copying';x.copy={temporary};delete x.candidate;delete x.error;});
        const sink=await fs.open(temp,'wx',0o600);
        let ref:RetainedSource;
        try { ref=await digestHandle(source,limits.maxSourceBytes,sink,expected);await sink.sync(); }
        finally { await sink.close(); }
        // Detect a path replacement as well as mutation of the opened handle.
        const latest=await inspectImportSource(item.sourcePath);
        if(!sameIdentity(latest,expected)) fail('source-changed','Source path changed during retention','retained');
        await flushDirectory(originals);
        await update(m=>{const x=m.items.find(x=>x.id===itemId)!;x.state='publishing';x.candidate=ref;});
      } finally { await source.close(); }
      await publishCandidate(itemId);
    } catch(e) {
      // Publishing must remain retryable without the external source; do not downgrade
      // an unknown publication into an ordinary failure or overwrite its candidate.
      item=find(itemId);
      if(item.state==='publishing' || item.state==='retained') throw e;
      const error=e instanceof SourceStoreError?e:new SourceStoreError('io-failure',message(e),'unknown');
      await update(m=>{const x=m.items.find(x=>x.id===itemId)!;x.state=error.code==='source-unavailable'?'source-unavailable':error.code==='source-changed'?'source-changed':'failed';x.error={code:error.code,message:error.message.slice(0,8192),effect:error.effect==='none'&&x.copy?'retained':error.effect};});
    }
    return clone(find(itemId));
  };
  try {
    for(const d of [...dirs,originals,imports]) bindings.set(d,await directory(d,true));
    if(sources) {
      if(!Array.isArray(sources) || sources.length>limits.maxItems) fail('invalid-input','Invalid source batch');
      // Creation is exclusive; never initialize over an existing/corrupt manifest.
      await fs.mkdir(batch,{mode:0o700}); bindings.set(batch,await directory(batch,false)); bindings.set(history,await directory(history,true));
      const items:SourceImportItem[]=[], ids=new Set<string>();
      for(const raw of clone(sources)) {
        if(!raw || typeof raw.id!=='string' || !idPattern.test(raw.id) || ids.has(raw.id)) fail('invalid-input','Invalid or duplicate source item ID');
        ids.add(raw.id); validPath(raw.sourcePath);
        if(raw.formatHint!==undefined && (typeof raw.formatHint!=='string' || raw.formatHint.length>64 || raw.formatHint.includes('\0'))) fail('invalid-input','Invalid format hint');
        const expected=await inspectImportSource(raw.sourcePath);
        if(raw.expected && (!validIdentity(raw.expected) || !sameIdentity(raw.expected,expected))) fail('source-changed','Source changed since inspection');
        items.push({id:raw.id,sourcePath:raw.sourcePath,...(raw.formatHint===undefined?{}:{formatHint:raw.formatHint}),expected,state:'queued',hydration:'unhydrated'});
      }
      manifest={schema:'storyboard-flow.source-import',version:1,importId,generation:0,phase:'active',items}; await publish(manifest);
    } else {
      bindings.set(batch,await directory(batch,false)); bindings.set(history,await directory(history,false));
      const bytes=await fileBytes(head,META_CAP); manifest=validateManifest(JSON.parse(bytes.toString('utf8')),importId,limits);headDigest=sha(bytes);paused=manifest.phase==='cancelled';
      if(verifyOriginalsOnOpen)for(const item of manifest.items) if(item.state==='retained') await verifyObject(item.retained!);
    }
  } catch(e) {
    if(writers.get(root)===writer) writers.delete(root);
    throw e;
  }
  return {
    snapshot:()=>clone(manifest),
    retain:itemId=>schedule(()=>{if(paused) fail('busy','Import is paused; resume it before retaining another item');return retain(itemId);}),
    resume:(opts={})=>{const admittedCancellation=cancellation,requested=opts.itemIds===undefined?undefined:clone(opts.itemIds);return schedule(async()=>{
      if(requested!==undefined&&(!Array.isArray(requested)||requested.length>limits.maxItems||new Set(requested).size!==requested.length||requested.some(id=>!manifest.items.some(item=>item.id===id))))fail('invalid-input','Invalid or unknown resume item IDs');
      const selected=requested===undefined?undefined:new Set(requested);
      paused=cancellation!==admittedCancellation;
      await update(m=>{m.phase='active';});
      for(const entry of manifest.items) {
        if(selected&&!selected.has(entry.id))continue;
        if(paused || opts.signal?.aborted) {paused=true;break;}
        await retain(entry.id);
        try {opts.onProgress?.(clone(manifest));} catch { /* advisory observers cannot change a settled retention */ }
      }
      if(paused) await update(m=>{m.phase='cancelled';});
      return clone(manifest);
    });},
    cancel:()=>{paused=true;cancellation++;return schedule(async()=>{await update(m=>{m.phase='cancelled';});return clone(manifest);});},
    object:itemId=>schedule(async()=>{const item=find(itemId);if(item.state!=='retained') fail('conflict','Source has not been retained; it is not ready for native reads');return verifyObject(item.retained!);}),
    readRange:(itemId,offset,length)=>schedule(async()=>{
      if(!Number.isSafeInteger(offset) || offset<0 || !Number.isSafeInteger(length) || length<0 || length>limits.maxReadBytes) fail('invalid-input','Invalid retained-source read range');
      const item=find(itemId);if(item.state!=='retained') fail('conflict','Source has not been retained');
      const ref=await verifyObject(item.retained!);if(offset>ref.byteLength || length>ref.byteLength-offset) fail('invalid-input','Read exceeds retained source');
      const handle=await openRegular(ref.path);
      try {
        if(!sameIdentity(ref.identity,identity(await handle.stat({bigint:true})))) fail('conflict','Retained source changed before range read');
        const bytes=Buffer.alloc(length);let done=0;
        while(done<length){const read=await handle.read(bytes,done,length-done,offset+done);if(!read.bytesRead) fail('conflict','Retained source truncated during range read');done+=read.bytesRead;}
        if(!sameIdentity(ref.identity,identity(await handle.stat({bigint:true})))) fail('conflict','Retained source changed during range read');
        return new Uint8Array(bytes);
      } finally {await handle.close();}
    }),
    close:()=>{
      if(closeWork)return closeWork;
      closing=true;paused=true;cancellation++;
      closeWork=(async()=>{await tail;await assertBound();if(writers.get(root)===writer)writers.delete(root);closed=true;})().catch(error=>{
        // An identity refusal keeps the original writer. If its exact directory
        // is restored, that same owner can retry draining/closing; a rejected
        // promise must not permanently prevent lawful resource release.
        closing=false;closeWork=undefined;throw error;
      });
      return closeWork;
    }
  };
}

export const createSourceBackedImport = (options: SourceStoreOptions & { sources: readonly SourceInput[] }): Promise<SourceImportStore> => {
  if(!options || !Array.isArray(options.sources))return Promise.reject(new SourceStoreError('invalid-input','Explicit sources are required to create an import'));
  return openStore(options,options.sources);
};
export const openSourceBackedImport = (options: SourceStoreOptions): Promise<SourceImportStore> => openStore(options);

/** Main already holds root writer authority. Opening this writer validates only
 * metadata, not a batch-wide readiness claim. Existing object()/retain() still
 * fully verify the particular retained object before returning it. The default
 * openSourceBackedImport keeps its historical eager full-object audit. */
export async function openSourceBackedImportForTargetUse(options:SourceStoreOptions):Promise<{store:SourceImportStore;verification:'manifest-only'}>{
 return{store:await openStore(options,undefined,false),verification:'manifest-only'};
}

/** Readonly metadata inspection for Main's lazy registry. This validates the
 * complete existing manifest and directory identities, but deliberately does
 * not verify original-object bytes. It returns no writer or ready image claim;
 * object()/retain() remain the authority for actual source use. */
export async function inspectSourceBackedImport(options:SourceStoreOptions):Promise<{manifest:SourceImportManifest;verification:'manifest-only'}>{
 validPath(options.root);if(!idPattern.test(options.importId))fail('invalid-input','Invalid import ID');const limits=limitsFor(options.limits),root=options.root;
 const storage=path.join(root,'.storyboard-flow/image-engine'),batch=path.join(storage,'imports',options.importId),head=path.join(batch,'manifest.json');
 const paths=[root,path.join(root,'.storyboard-flow'),storage,path.join(storage,'originals'),path.join(storage,'imports'),batch,path.join(batch,'manifests')];
 const identities=await Promise.all(paths.map(p=>directory(p,false))),before=await inspectImportSource(head),bytes=await fileBytes(head,META_CAP),manifest=validateManifest(JSON.parse(bytes.toString('utf8')),options.importId,limits);
 if(!sameIdentity(before,await inspectImportSource(head)))fail('conflict','Source manifest identity changed during inspection');
 for(let i=0;i<paths.length;i++){const now=await directory(paths[i],false);if(now.dev!==identities[i].dev||now.ino!==identities[i].ino)fail('conflict','Source inspection directory identity changed');}
 return{manifest:clone(manifest),verification:'manifest-only'};
}
