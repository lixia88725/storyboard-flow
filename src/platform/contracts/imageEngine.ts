import { validSelection, validTransform } from './flowSelection.js';
import type { FlowSelection, FlowTransform } from './flowSelection.js';

/** Opaque native layer identity: canonical decimal u64 text, never a JS Number.
 * The document/version identity is supplied by the owning Main Session. */
export type ImageEngineLayerId = string;
export type ImageEngineBlendMode = 'normal' | 'multiply' | 'screen';
export type ImageEngineLayerPatch = {
  name?: string;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  blendMode?: ImageEngineBlendMode;
};

/** Product edits only. No filesystem path, native command string, project receipt
 * or caller-selected operation authority. Main retains the complete input before
 * native prepare and alone decides its immutable version in the mixed history.
 *
 * All edits require a settled target; native supplies rollback on failure.
 * opacity is finite 0..1; RGBA channels and tolerance are integers 0..255.
 * Layer sets are bounded, unique and ordered by the captured document stack.
 * Selection geometry is temporary input, not a standalone user Undo step. */
export type ImageEngineEdit =
  | { kind: 'newLayer'; name: string }
  | { kind: 'setLayer'; layerId: ImageEngineLayerId; patch: ImageEngineLayerPatch }
  | { kind: 'setLayerOpacities'; changes: readonly { layerId: ImageEngineLayerId; before: number; opacity: number }[] }
  | { kind: 'removeLayer'; layerId: ImageEngineLayerId }
  | { kind: 'moveLayers'; layerIds: readonly ImageEngineLayerId[]; targetLayerId: ImageEngineLayerId; placement: 'before' | 'after' }
  | { kind: 'clear'; layerId: ImageEngineLayerId }
  | { kind: 'merge'; layerIds: readonly ImageEngineLayerId[] }
  | { kind: 'mergeVisible' }
  | { kind: 'blur'; layerId: ImageEngineLayerId; radius: number; selection?: FlowSelection }
  | { kind: 'fill'; layerId: ImageEngineLayerId; x: number; y: number; color: readonly [number, number, number, number]; tolerance: number }
  | { kind: 'transform'; layerId: ImageEngineLayerId; selection: FlowSelection; matrix: FlowTransform };

/** Temporary display token. It is not a project receipt or permission to accept. */
export type ImageEnginePreviewStamp = Pick<import('../../drawing/renderer/image-engine/frames.js').FrameIdentity,
  'documentId' | 'workerEpoch' | 'epoch'> & {
  previewId: string;
  throughSeq: number;
  baseVersion: string;
  sourceContextGeneration: number;
  editDigest: string;
};

const layerId=(v:unknown):v is ImageEngineLayerId=>typeof v==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(v)&&BigInt(v)<=18446744073709551615n;
const finite=(v:unknown,min:number,max:number):v is number=>typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;
const integer=(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):v is number=>finite(v,min,max)&&Number.isSafeInteger(v);
const shape=(v:unknown,required:readonly string[],optional:readonly string[]=[]):v is Record<string,unknown>=>{
  if(!v||typeof v!=='object'||Array.isArray(v))return false;
  const keys=Reflect.ownKeys(v);return required.every(k=>Object.hasOwn(v,k))&&keys.every(k=>typeof k==='string'&&[...required,...optional].includes(k)&&Object.hasOwn(Object.getOwnPropertyDescriptor(v,k)??{},'value')&&Object.getOwnPropertyDescriptor(v,k)?.enumerable===true);
};
const array=(v:unknown,min:number,max:number):v is unknown[]=>{
  if(!Array.isArray(v)||v.length<min||v.length>max)return false;
  for(let i=0;i<v.length;i++)if(!Object.hasOwn(Object.getOwnPropertyDescriptor(v,String(i))??{},'value')||Object.getOwnPropertyDescriptor(v,String(i))?.enumerable!==true)return false;
  return Reflect.ownKeys(v).every(k=>k==='length'||typeof k==='string'&&/^(0|[1-9][0-9]*)$/.test(k)&&Number(k)<v.length);
};
const ids=(v:unknown,min=1)=>array(v,min,64)&&Array.from(v).every(layerId)&&new Set(v).size===v.length;
const selection=(v:unknown)=>array(v,3,4096)&&Array.from(v).every(p=>shape(p,['x','y']))&&validSelection(v);
const matrix=(v:unknown)=>array(v,6,6)&&validTransform(v);
const name=(v:unknown)=>typeof v==='string'&&v.length<=4096;
const patch=(v:unknown)=>shape(v,[],['name','visible','locked','opacity','blendMode'])&&Reflect.ownKeys(v).length>0&&
  (!Object.hasOwn(v,'name')||name(v.name))&&(!Object.hasOwn(v,'visible')||typeof v.visible==='boolean')&&(!Object.hasOwn(v,'locked')||typeof v.locked==='boolean')&&
  (!Object.hasOwn(v,'opacity')||finite(v.opacity,0,1))&&(!Object.hasOwn(v,'blendMode')||['normal','multiply','screen'].includes(v.blendMode as string));
/** Shared by product admission, native Adapter and Main journal replay. Never
 * normalises/coerces input: the retained body is the exact validated product edit. */
export function validImageEngineEdit(value:unknown):value is ImageEngineEdit {
 try{
  if(!shape(value,['kind'],['name','layerId','patch','changes','layerIds','targetLayerId','placement','radius','selection','x','y','color','tolerance','matrix']))return false;
  const v=value;
  switch(v.kind){
   case 'newLayer':return shape(v,['kind','name'])&&name(v.name);
   case 'setLayer':return shape(v,['kind','layerId','patch'])&&layerId(v.layerId)&&patch(v.patch);
   case 'setLayerOpacities':return shape(v,['kind','changes'])&&array(v.changes,1,64)&&v.changes.every(c=>shape(c,['layerId','before','opacity'])&&layerId(c.layerId)&&finite(c.before,0,1)&&finite(c.opacity,0,1))&&new Set(v.changes.map(c=>(c as {layerId:string}).layerId)).size===v.changes.length;
   case 'removeLayer':case 'clear':return shape(v,['kind','layerId'])&&layerId(v.layerId);
   case 'moveLayers':return shape(v,['kind','layerIds','targetLayerId','placement'])&&ids(v.layerIds)&&layerId(v.targetLayerId)&&!(v.layerIds as string[]).includes(v.targetLayerId)&&['before','after'].includes(v.placement as string);
   case 'merge':return shape(v,['kind','layerIds'])&&ids(v.layerIds,2);
   case 'mergeVisible':return shape(v,['kind']);
   case 'blur':return shape(v,['kind','layerId','radius'],['selection'])&&layerId(v.layerId)&&finite(v.radius,1,50)&&(!Object.hasOwn(v,'selection')||selection(v.selection));
   case 'fill':return shape(v,['kind','layerId','x','y','color','tolerance'])&&layerId(v.layerId)&&finite(v.x,-1_000_000,1_000_000)&&finite(v.y,-1_000_000,1_000_000)&&array(v.color,4,4)&&v.color.every(n=>integer(n,0,255))&&integer(v.tolerance,0,255);
   case 'transform':return shape(v,['kind','layerId','selection','matrix'])&&layerId(v.layerId)&&selection(v.selection)&&matrix(v.matrix);
   default:return false;
  }
 }catch{return false;}
}
export function validImageEnginePreviewStamp(v:unknown):v is ImageEnginePreviewStamp {
 try{return shape(v,['documentId','workerEpoch','epoch','previewId','throughSeq','baseVersion','sourceContextGeneration','editDigest'])&&layerId(v.documentId)&&integer(v.workerEpoch,1)&&integer(v.epoch)&&typeof v.previewId==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v.previewId)&&integer(v.throughSeq,1)&&integer(v.sourceContextGeneration)&&[v.baseVersion,v.editDigest].every(s=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s));}catch{return false;}
}

export type ImageEngineDisplayIdentity = import('../../drawing/renderer/image-engine/frames.js').FrameIdentity;
export type ImageEngineLocks = {all:boolean;pixels:boolean;position:boolean;transparency:boolean;artboard:boolean};
export type ImageEngineLayerSummary = {
  layerId:ImageEngineLayerId;name:string;kind:'raster'|'group'|'unsupported';visible:boolean;opacity:number;
  blendMode:ImageEngineBlendMode|null;nativeBlend:string;locks:ImageEngineLocks;effectiveLocks:ImageEngineLocks;
  children:readonly ImageEngineLayerSummary[];
};
export type ImageEngineTemporarySelection = {
  layerId:ImageEngineLayerId;documentId:string;contextGeneration:number;pointCount:number;token:string;
  bounds:readonly [number,number,number,number];
};
/** Bounded actor context, separate from project versions and source-file masks.
 * Temporary polygon geometry remains in its owning Main/UI request; this summary
 * returns only its bounded identity and bounds, never mask pixels or paths. */
export type ImageEngineContextSummary = {
  displayIdentity:ImageEngineDisplayIdentity;imageVersionRef:string|null;contextGeneration:number;
  layers:readonly ImageEngineLayerSummary[];activeLayerId:ImageEngineLayerId|null;selectedLayerIds:readonly ImageEngineLayerId[];
  selection:{present:boolean;token:string|null;bounds:readonly[number,number,number,number]|null};
  temporarySelection:ImageEngineTemporarySelection|null;
  floating:{previewId:string;throughSeq:number;sourceLayerId:ImageEngineLayerId;phase:'active'|'dropPrepared'|'blocked';baseVersion:string;offset:readonly[number,number];outlineBounds:readonly[number,number,number,number]|null}|null;
  editPreview:{stamp:ImageEnginePreviewStamp;pendingOperationId:string|null;blockedReason:string|null}|null;
  candidateId:string|null;inputActive:boolean;pipelineActive:boolean;frozen:boolean;settlementRequired:boolean;
  tools:Readonly<Record<string,{enabled:boolean;reason?:string|null}>>;paintScope:'full-layer'|'source-selection-refused';eraserBehavior:'alpha'|'backgroundColor';
};
export type ImageEngineEditContext = {expectedContextGeneration:number;preview?:ImageEnginePreviewStamp};

export type ImageEnginePreviewResult = {stamp:ImageEnginePreviewStamp;displayIdentity:ImageEngineDisplayIdentity};

/** Main-only immutable job inputs: a caller still needs the project's writer
 * authority and an already reserved global recovery budget. These are not
 * renderer commands or permission to install/accept a project version. */
export type ImageEngineCreationInput = {kind:'new';width:number;height:number}|
  {kind:'duplicate';source:import('./imageProject.js').NativeImageRef};
export type ImageEngineJobReservation = {maxAdditionalBytes:number};
export type ImageEngineVersionSummary = {
  versionId:string;documentId:string;width:number;height:number;layers:readonly ImageEngineLayerSummary[];
  activeLayerId:ImageEngineLayerId|null;selectedLayerIds:readonly ImageEngineLayerId[];
  sourceSelectionPresent:boolean;paintScope:'full-layer'|'source-selection-refused';
};
export type ImageEngineThumbnail = {format:'png';width:number;height:number;byteLength:number;sha256:string};
export type ImageEngineInspection = {summary:ImageEngineVersionSummary;thumbnail:ImageEngineThumbnail;bytes:Uint8Array};

export type ImageEngineSourceOptions={interpretationId?:'photocraft-v1'|'flow-v1-upgrade'};
