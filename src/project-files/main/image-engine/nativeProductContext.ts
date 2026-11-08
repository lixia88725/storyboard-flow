import { validImageEnginePreviewStamp } from '../../../platform/contracts/imageEngine.js';
import type { ImageEngineContextSummary, ImageEngineDisplayIdentity, ImageEngineLayerSummary, ImageEngineLocks } from '../../../platform/contracts/imageEngine.js';
import { record } from '../../../session/core/imageProjectValues.js';
const fail=():never=>{throw Object.assign(Error('Malformed native product context'),{code:'protocol',effect:'unknown'});};
const id=(v:unknown):string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<=18446744073709551615n?v:fail();
const text=(v:unknown,max=16384):string=>typeof v==='string'&&v.length<=max?v:fail();
const num=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max?v:fail();
const integer=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):number=>Number.isSafeInteger(v)?num(v,min,max):fail();
const bool=(v:unknown):boolean=>typeof v==='boolean'?v:fail();
const hash=(v:unknown):string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v)?v:fail();
const box=(v:unknown):readonly[number,number,number,number]=>Array.isArray(v)&&v.length===4?[integer(v[0],-10_000_000),integer(v[1],-10_000_000),integer(v[2],0,8192),integer(v[3],0,8192)]:fail();
const locks=(v:unknown):ImageEngineLocks=>{if(!record(v))return fail();return{all:bool(v.all),pixels:bool(v.pixels),position:bool(v.position),transparency:bool(v.transparency),artboard:bool(v.artboard)};};
/** Decode once at the native trust boundary. Main/UI consume a small projection,
 * never arbitrary Rust Session state, native command names or persistent History. */
export function parseNativeProductContext(v:Record<string,unknown>,displayIdentity:ImageEngineDisplayIdentity):ImageEngineContextSummary {
 if(v.kind!=='contextSummary'||id(v.documentId)!==displayIdentity.documentId||integer(v.workerEpoch,1)!==displayIdentity.workerEpoch||integer(v.epoch)!==displayIdentity.epoch)return fail();
 const seen=new Set<string>();let remaining=4096;
 const tree=(value:unknown,depth=0):ImageEngineLayerSummary[]=>{
  if(!Array.isArray(value)||depth>128)return fail();
  return value.map(l=>{if(!record(l)||--remaining<0)return fail();const layerId=id(l.layerId);if(seen.has(layerId))return fail();seen.add(layerId);
   const nativeBlend=text(l.blend,128),blendMode=({'Normal':'normal','Multiply':'multiply','Screen':'screen'} as const)[nativeBlend as 'Normal'|'Multiply'|'Screen']??null;
   if(!['raster','group','unsupported'].includes(String(l.kind)))return fail();
   return{layerId,name:text(l.name),kind:l.kind as ImageEngineLayerSummary['kind'],visible:bool(l.visible),opacity:num(l.opacity,0,1),blendMode,nativeBlend,locks:locks(l.locks),effectiveLocks:locks(l.effectiveLocks),children:tree(l.children,depth+1)};
  });
 };
 const layers=tree(v.layers);if(integer(v.layerCount)!==seen.size)return fail();
 const active=v.activeLayerId===null?null:id(v.activeLayerId);if(active&&!seen.has(active))return fail();
 if(!Array.isArray(v.selectedLayerIds)||v.selectedLayerIds.length>4096)return fail();const selected=v.selectedLayerIds.map(id);if(new Set(selected).size!==selected.length||selected.some(x=>!seen.has(x)))return fail();
 const generation=integer(v.contextGeneration);
 let editPreview:ImageEngineContextSummary['editPreview']=null;
 if(v.editPreview!==null&&v.editPreview!==undefined){const p=v.editPreview;if(!record(p)||!validImageEnginePreviewStamp(p.stamp))return fail();if(p.stamp.documentId!==displayIdentity.documentId||p.stamp.workerEpoch!==displayIdentity.workerEpoch||p.stamp.epoch!==displayIdentity.epoch||p.stamp.sourceContextGeneration!==generation)return fail();editPreview={stamp:structuredClone(p.stamp),pendingOperationId:p.pendingOperationId===null?null:text(p.pendingOperationId,80),blockedReason:p.blockedReason===null?null:text(p.blockedReason,4096)};}

 if(!record(v.selection))return fail();const selection={present:bool(v.selection.present),token:v.selection.token===null?null:text(v.selection.token,128),bounds:v.selection.bounds===null?null:box(v.selection.bounds)};
 let temporarySelection:ImageEngineContextSummary['temporarySelection']=null;
 if(v.temporarySelection!==null){const s=v.temporarySelection;if(!record(s))return fail();temporarySelection={layerId:id(s.layerId),documentId:id(s.documentId),contextGeneration:integer(s.contextGeneration),pointCount:integer(s.pointCount,3,4096),token:text(s.token,128),bounds:box(s.bounds)};if(temporarySelection.documentId!==displayIdentity.documentId||!seen.has(temporarySelection.layerId)||temporarySelection.contextGeneration!==generation)return fail();}
 let floating:ImageEngineContextSummary['floating']=null;
 if(v.floating!==null){const f=v.floating;if(!record(f)||!['active','dropPrepared','blocked'].includes(String(f.phase))||!Array.isArray(f.offset)||f.offset.length!==2)return fail();floating={previewId:text(f.previewId,80),throughSeq:integer(f.throughSeq),sourceLayerId:id(f.sourceLayerId),phase:f.phase as 'active'|'dropPrepared'|'blocked',baseVersion:hash(f.baseVersion),offset:[integer(f.offset[0],-10_000_000,10_000_000),integer(f.offset[1],-10_000_000,10_000_000)],outlineBounds:f.outlineBounds===null?null:box(f.outlineBounds)};}
 if(!record(v.tools)||Object.keys(v.tools).length>64)return fail();const tools:Record<string,{enabled:boolean;reason?:string|null}>={};
 for(const[k,t]of Object.entries(v.tools)){if(!record(t)||k.length>128)return fail();tools[k]={enabled:bool(t.enabled),...(t.reason===undefined?{}:{reason:t.reason===null?null:text(t.reason,4096)})};}
 if(!['full-layer','source-selection-refused'].includes(String(v.paintScope)))return fail();
 if(!['alpha','backgroundColor'].includes(String(v.eraserBehavior)))return fail();
 return{displayIdentity:{...displayIdentity},imageVersionRef:v.imageVersionRef===null?null:hash(v.imageVersionRef),contextGeneration:generation,layers,activeLayerId:active,selectedLayerIds:selected,selection,temporarySelection,floating,editPreview,candidateId:v.candidateId===null?null:text(v.candidateId,80),inputActive:bool(v.inputActive),pipelineActive:bool(v.pipelineActive),frozen:bool(v.frozen),settlementRequired:bool(v.settlementRequired),tools,paintScope:v.paintScope as 'full-layer'|'source-selection-refused',eraserBehavior:v.eraserBehavior as 'alpha'|'backgroundColor'};
}
