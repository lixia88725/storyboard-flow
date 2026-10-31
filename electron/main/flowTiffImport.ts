import {createPresentationCodec} from '../core/formats/presentation.js';
import { pixelDigest } from './flowPixelIdentity.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { admitTiffCandidate, type TiffCodec } from '../core/formats/index.js';
import { openFlowAssetDepot } from '../core/persistence/depot.js';
import { createProjectStore } from '../core/persistence/index.js';
import { publishDirectoryExclusive } from '../core/platform/index.js';
import { openFlowTiffSave, type TiffSourceBinding } from './flowTiffSave.js';
import { assertPhysicalWorkspaceWriterTargets } from './workspacePhysicalWriterGate.js';
import type { ProjectV1 } from '../shared/refactorV1.js';
const get = <T>(r: {ok:true;value:T}|{ok:false;error:{message:string}}):T => { if(!r.ok)throw Error(r.error.message);return r.value; };
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
type Source = { pixelHashes?:Record<string,string>; name: string; location: 'active' | 'parked'; file: string; digest?: string; shotId?: string };
const exists = async (file: string) => { try { await fs.lstat(file); return true; } catch(e) { if((e as NodeJS.ErrnoException).code==='ENOENT')return false;throw e; } };

/** Main-selected folder bootstrap only, not import into an existing live Session.
 * Originals remain read-only. A whole prepared namespace is published exclusively.
 * Staging contains only derived new data; failures cannot replace an existing project. */
export async function importFlowTiffFolder(root: string, codec: TiffCodec): Promise<ProjectV1> {
  codec=createPresentationCodec(codec);
  if (!path.isAbsolute(root) || path.resolve(root)!==root || await fs.realpath(root)!==root) throw Error('Canonical project directory required');
  const rootIdentity = await fs.lstat(root,{bigint:true});
  if(!rootIdentity.isDirectory() || rootIdentity.isSymbolicLink())throw Error('Real project directory required');
  const bind = async () => {
    const now=await fs.lstat(root,{bigint:true});
    if(now.dev!==rootIdentity.dev || now.ino!==rootIdentity.ino || !now.isDirectory() || now.isSymbolicLink() || await fs.realpath(root)!==root)throw Error('Import root changed');
    await assertPhysicalWorkspaceWriterTargets([root]);
  };
  await bind();
  if(await exists(path.join(root,'.storyboard-flow')))throw Error('Project data already exists; open it instead of importing over it');
  const scan = async ():Promise<Source[]> => {
    const sources:Source[]=[];
    for(const location of ['active','parked'] as const){
      const folder=location==='active'?root:path.join(root,'Pending');
      if(location==='parked' && !await exists(folder))continue;
      const entry=await fs.lstat(folder);
      if(!entry.isDirectory() || entry.isSymbolicLink() || await fs.realpath(folder)!==folder)throw Error('Aliased TIFF folder refused');
      for(const item of await fs.readdir(folder,{withFileTypes:true})){
        if(item.name.startsWith('.') || !/\.tiff?$/i.test(item.name))continue;
        if(!item.isFile())throw Error(`TIFF must be a regular file: ${item.name}`);
        sources.push({name:item.name,location,file:path.join(folder,item.name)});
      }
    }
    const sort=new Intl.Collator('en',{numeric:true,sensitivity:'variant'});
    return sources.sort((a,b)=>a.location.localeCompare(b.location)||sort.compare(a.name,b.name)||(a.name<b.name?-1:a.name>b.name?1:0));
  };
  const sources=await scan();
  if(!sources.length || sources.length>10000)throw Error('Import requires 1–10000 TIFF files');
  if(new Set(sources.map(s=>s.name.toLowerCase())).size!==sources.length)throw Error('Duplicate TIFF names across root/Pending need distinct names');
  const readSource = async (source:Source) => {
    await bind();
    if(await fs.realpath(source.file)!==source.file)throw Error(`Aliased TIFF refused: ${source.name}`);
    const handle=await fs.open(source.file,constants.O_RDONLY|constants.O_NOFOLLOW);
    try{
      const st=await handle.stat();
      if(!st.isFile() || st.nlink!==1 || st.size>128*1024*1024)throw Error(`Unsupported TIFF file: ${source.name}`);
      const bytes=await handle.readFile();if(bytes.length>128*1024*1024)throw Error('TIFF exceeds byte limit');return bytes;
    }finally{await handle.close();}
  };
  const stage=await fs.mkdtemp(path.join(root,'.flow-import-'));
  const stageIdentity=await fs.lstat(stage,{bigint:true});
  let published=false;
  try{
    const project:ProjectV1={schema:'storyboard-flow.project',version:1,id:randomUUID(),name:path.basename(root),naming:{sceneCode:'scene',artistName:'artist',version:'v001'},revision:0,shots:[],parkedShots:[],dialogues:[],images:{}};
    const depot=get(await openFlowAssetDepot({root:stage,sessionId:randomUUID(),maxPixels:16*1024*1024,maxPngBytes:32*1024*1024}));
    let preparedBytes=0;
    for(const source of sources){
      const original=await readSource(source);source.digest=hash(original);preparedBytes+=original.byteLength;
      const candidate=get(await codec.decode(original));source.pixelHashes={};for(const layer of candidate.image.layers)source.pixelHashes[layer.id]=await pixelDigest(layer.png);
      for(const layer of candidate.image.layers)preparedBytes+=layer.png.byteLength;
      if(preparedBytes>512*1024*1024)throw Error('Import exceeds 512 MiB prepared PNG budget');
      const shotId=randomUUID();source.shotId=shotId;
      candidate.image.id=randomUUID();candidate.image.revision=0;
      if(candidate.text)candidate.text={...candidate.text,projectId:project.id,projectName:project.name,shotId,
        dialogues:candidate.text.dialogues.map(d=>({...d,id:randomUUID(),shotId}))};
      const image=get(await admitTiffCandidate(candidate,depot,shotId));
      project.images[image.id]=image;
      (source.location==='active'?project.shots:project.parkedShots).push({id:shotId,imageId:image.id,
        ...(candidate.text?.presentation?{presentation:candidate.text.presentation.settings}:{}),name:candidate.text?.shotName??path.parse(source.name).name,scriptText:candidate.text?.scriptText??''});
      project.dialogues.push(...candidate.text?.dialogues??[]);
    }
    if(project.shots[0]?.presentation)project.presentation=structuredClone(project.shots[0].presentation);
    const mappings:TiffSourceBinding[]=sources.map(s=>({shotId:s.shotId!,name:s.name,digest:s.digest!,location:s.location,pixelHashes:s.pixelHashes!}));
    const output=await openFlowTiffSave(stage,project.id,codec);
    await output.bindSources(project,mappings,source=>readSource(sources.find(s=>s.shotId===source.shotId)!));
    const store=createProjectStore();
    get(await store.saveCheckpoint(stage,project,async id=>get(await depot.read(id))));
    get(await store.loadCheckpoint(stage));
    // Detect additions/removals and byte changes after all decoding/admission.
    const current=await scan();
    if(JSON.stringify(current.map(s=>s.file))!==JSON.stringify(sources.map(s=>s.file)))throw Error('TIFF folder changed during import');
    for(const source of sources)if(hash(await readSource(source))!==source.digest)throw Error(`TIFF changed during import: ${source.name}`);
    await bind();
    await publishDirectoryExclusive(path.join(stage,'.storyboard-flow'),path.join(root,'.storyboard-flow'));
    published=true;
    await bind();
    const loaded=get(await store.loadCheckpoint(root));
    if(loaded.project.id!==project.id)throw Error('Published project identity mismatch');
    return loaded.project;
  } catch(error){
    throw Error(`${published?'Project published but verification failed':'Import failed'}: ${error instanceof Error?error.message:String(error)}; source TIFFs were not modified`);
  } finally {
    // Private derived staging only; never remove a replaced root/directory.
    await bind();const now=await fs.lstat(stage,{bigint:true});
    if(now.dev!==stageIdentity.dev || now.ino!==stageIdentity.ino || !now.isDirectory() || now.isSymbolicLink())throw Error(`Import staging identity changed; retained: ${stage}`);
    await fs.rm(stage,{recursive:true});
  }
}
