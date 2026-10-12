import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { IpcMainInvokeEvent } from 'electron';
import { createWorkspaceRecoveryStore, type RecoveryBudget, type RecoveryOffer } from './workspaceRecoveryStore.js';
import { createMacRecoveryContentAuthorization } from './macRecoveryContentAuthorization.js';

/** Limited content-only ordinary-close route. Unsupported dependency coverage cancels
 * close; this is not first-effect preparation, operation completion or repair. */
export const createWorkspaceRetainedCloseService = (options: {
 budget?: RecoveryBudget; python: string; script: string;
}) => {
 const configured = () => {
  if (!options.budget) throw new Error('Recovery finite limits are not configured');
  return options.budget;
 };
 const sourcesFor = async (root: string, project: any) => {
  const sources = [path.join(root,'.storyboard-workbench/storyboard.project.json')];
  if (!Array.isArray(project?.shots) || (project.parkedShots?.length ?? 0) || (project.pendingDeletedShots?.length ?? 0))
   throw new Error('Complete parked/deleted dependency capture is not implemented');
  for (const shot of project.shots) {
   if (!Array.isArray(shot.layers) || !shot.layers.length) throw new Error('Fallback raster capture unavailable');
   sources.push(shot.imagePath);
   for (const layer of shot.layers) {
    if (!layer.bitmapPath || !layer.id || !shot.id) throw new Error('Exact layer dependency missing');
    sources.push(path.resolve(root,layer.bitmapPath));
   }
  }
  if (sources.length > configured().assets * 3 + 1) throw new Error('Source manifest budget exceeded');
  for (const source of sources) {
   const physical=await fs.realpath(source);
   if (physical !== path.resolve(source) || !physical.startsWith(root+path.sep)) throw new Error('Unsupported source alias/outside workspace');
   const stat=await fs.lstat(source);
   if (!stat.isFile() || stat.nlink!==1 || stat.size>configured().bytes) throw new Error('Unsupported source identity/size');
  }
  return [...new Set(sources)];
 };
 const storeFor = (sources: string[]) => createWorkspaceRecoveryStore({budget:configured(),sources,
  authorize:createMacRecoveryContentAuthorization({python:options.python,script:options.script,sourceByteLimit:configured().bytes})});
 const certifyRetained = async (event: Pick<IpcMainInvokeEvent,'sender'|'senderFrame'>, raw: unknown) => {
  configured();
  if (event.senderFrame!==event.sender.mainFrame) throw new Error('Current top-frame caller required');
  const c=raw as any;
  if (!c || typeof c.folderPath!=='string' || !c.content || c.canvas?.hasUnsettledGesture || c.canvas?.captures?.some((v:any)=>v.hasUnsettledGesture)) throw new Error('Incomplete mounted capture');
  const root=await fs.realpath(c.folderPath), p=c.content.projectRaw;
  // A receipt/remaining script/deletion needs its actual producer asset plan, not inferred Project paths.
  const facts=c.content.effectFacts;
  if (!facts || facts.receipt?.length || facts.deletions?.length || facts.remainingScript) throw new Error('Producer dependency coverage unavailable');
  const sources=await sourcesFor(root,p), assets: RecoveryOffer['assets']=[];
  const desired=c.content.desiredAssets;
  if (!Array.isArray(desired)) throw new Error('Missing desired asset inventory');
  for (const shot of p.shots) {
   const bytes=await fs.readFile(shot.imagePath);
   const m=await sharp(bytes,{limitInputPixels:Math.floor(configured().bytes/4),failOn:'error'}).metadata();
   if(!m.width||!m.height||!['png','tiff'].includes(m.format??''))throw new Error('Exact PNG/TIFF base image required');
   assets.push({assetId:`asset_${assets.length}`,bytes,role:`${shot.id}/base`,width:m.width,height:m.height,encoding:m.format!});
  }
  for (const shot of p.shots) for (const layer of shot.layers) {
   const source=path.resolve(root,layer.bitmapPath);
   const candidates=desired.filter((v:any)=>v.shotId===shot.id&&v.layerId===layer.id);
   const latest=candidates.at(-1);
   if (latest && (latest.folderPath!==c.folderPath || path.resolve(root,latest.bitmapPath)!==source || !/^data:image\/png;base64,[A-Za-z0-9+/]*={0,2}$/.test(latest.dataUrl))) throw new Error('Desired asset binding/encoding mismatch');
   const bytes=latest?Buffer.from(latest.dataUrl.split(',')[1],'base64'):await fs.readFile(source);
   if (bytes.length>configured().bytes) throw new Error('Actual encoded byte limit exceeded');
   const metadata=await sharp(bytes,{limitInputPixels:Math.floor(configured().bytes/4),failOn:'error'}).metadata();
   if (metadata.format!=='png' || !metadata.width || !metadata.height) throw new Error('PNG layer capture required');
   assets.push({assetId:`asset_${assets.length}`,bytes,role:`${shot.id}/${layer.id}`,width:metadata.width,height:metadata.height,encoding:'png'});
  }
  if (desired.some((v:any)=>!p.shots.some((s:any)=>s.id===v.shotId&&s.layers.some((l:any)=>l.id===v.layerId)))) throw new Error('Unpublished desired dependency cannot be omitted');
  const offer:RecoveryOffer={revision:`${c.content.sequence}:${c.content.assetRevision}`,projectRaw:p,
   viewState:{selectedShotIds:c.selectedShotIds,dirtyShotIds:c.dirtyShotIds,fileNameSyncState:c.fileNameSyncState,workspaceSaveState:c.workspaceSaveState},
   scriptState:{state:'unobserved'},effectFacts:facts,continuationState:{state:'notExecutable'},assets,requiredAssetIds:assets.map(a=>a.assetId)};
  const store=storeFor(sources), caller={sender:event.sender,frame:event.senderFrame!,window:event.sender,document:event.senderFrame!};
  const ack=await store.retain(caller,root,offer);
  const reread=await store.inspectReadonly(root);
  if (reread.state!=='protectedReadable'||reread.ack?.sealDigest!==ack.sealDigest||reread.ack.revision!==offer.revision) throw new Error('Retained exact revision/readback not certified');
  for (const a of assets) if (!(await store.readAsset(root,ack.generationId,a.assetId)).equals(Buffer.from(a.bytes))) throw new Error('Actual retained byte readback mismatch');
  return true;
 };
 const readReadonly = async (requested: string) => {
  configured();const root=await fs.realpath(requested);
  const source=path.join(root,'.storyboard-workbench/storyboard.project.json');
  const stat=await fs.lstat(source);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>configured().bytes)throw new Error('Metadata input unavailable');
  const project=JSON.parse(await fs.readFile(source,'utf8'));
  const store=storeFor(await sourcesFor(root,project)), state=await store.inspectReadonly(root);
  if (state.state!=='protectedReadable'||!state.content||!state.ack) throw new Error(`Readonly recovery unavailable: ${state.state} ${state.issue??''}`);
  const assets=[];
  for(const asset of state.content.assets){const bytes=await store.readAsset(root,state.ack.generationId,asset.assetId);assets.push({role:asset.role,dataUrl:`data:image/${asset.encoding};base64,${bytes.toString('base64')}`});}
  return {state:state.state,revision:state.ack.revision,projectRaw:state.content.projectRaw,effectFacts:state.content.effectFacts,assets};
 };
 return {certifyRetained,readReadonly};
};
