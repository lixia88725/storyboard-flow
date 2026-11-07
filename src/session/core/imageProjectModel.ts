import type { ImageBindingV2, ImageProjectEdit, ImageProjectEditResult, NativeDecision, NativeImageRef, ProjectV2, SourceImageRef } from '../../platform/contracts/imageProject.js';
import type { ResultV1 } from '../../platform/contracts/refactorV1.js';
import type { FlowStroke } from '../../platform/contracts/flowWave2.js';
import { validPresentation } from '../../platform/contracts/flowPresentation.js';
import { copy, fail, id, ok, record, revision, same, shape, text } from './imageProjectValues.js';

const token = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(v);
export const imageHash = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
export const validSourceImageRef = (v: unknown): v is SourceImageRef => shape(v,['importId','itemId','interpretationId']) && Object.values(v).every(token);
export const validNativeImageRef = (v: unknown): v is NativeImageRef => shape(v,['storeId','documentId','versionId','manifestSha256','width','height']) &&
  token(v.storeId) && token(v.documentId) && imageHash(v.versionId) && imageHash(v.manifestSha256) &&
  Number.isSafeInteger(v.width) && Number(v.width)>0 && Number(v.width)<=100_000 && Number.isSafeInteger(v.height) && Number(v.height)>0 && Number(v.height)<=100_000;
export const validImageBinding = (v: unknown): v is ImageBindingV2 =>
  shape(v,['kind','source']) && v.kind==='source' && validSourceImageRef(v.source) ||
  shape(v,['kind','native']) && v.kind==='native' && validNativeImageRef(v.native);
export function validProjectStroke(v:unknown):v is FlowStroke{
  if(!shape(v,['tool','color','size','opacity','softness','points'],['brush','pressures'])||!['brush','eraser'].includes(String(v.tool))||typeof v.color!=='string'||!/^#[a-f0-9]{6}$/i.test(v.color)||typeof v.size!=='number'||!Number.isFinite(v.size)||v.size<=0||v.size>1000||typeof v.opacity!=='number'||!Number.isFinite(v.opacity)||v.opacity<0||v.opacity>1||typeof v.softness!=='number'||!Number.isFinite(v.softness)||v.softness<0||v.softness>1||!Array.isArray(v.points)||v.points.length<2||v.points.length>200_000||v.points.length%2!==0||!Array.from(v.points).every(n=>typeof n==='number'&&Number.isFinite(n)&&Math.abs(n)<=1e7))return false;
  if(v.pressures!==undefined&&(!Array.isArray(v.pressures)||v.pressures.length!==v.points.length/2||!Array.from(v.pressures).every(n=>typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=1)))return false;
  if(v.brush!==undefined&&(!shape(v.brush,['tip','spacing','hardness','grain','seed','pressureSize','pressureOpacity'])||!['hard','soft','pencil','charcoal'].includes(String(v.brush.tip))||Object.entries(v.brush).some(([key,n])=>key!=='tip'&&(typeof n!=='number'||!Number.isFinite(n)))))return false;
  return true;
}

export function validImageProject(v: unknown): v is ProjectV2 {
  if(!shape(v,['schema','version','id','revision','name','shots','parkedShots','dialogues','images'],['naming','presentation']) ||
    v.schema!=='storyboard-flow.project' || v.version!==2 || !id(v.id) || !revision(v.revision) || !text(v.name) || v.name.length>1_048_576 ||
    !Array.isArray(v.shots) || !Array.isArray(v.parkedShots) || v.shots.length+v.parkedShots.length>100_000 ||
    !Array.isArray(v.dialogues) || v.dialogues.length>500_000 || !record(v.images) || Object.keys(v.images).length>100_000) return false;
  if(v.naming!==undefined && (!shape(v.naming,['sceneCode','artistName','version']) || !Object.values(v.naming).every(text))) return false;
  if(v.presentation!==undefined && !validPresentation(v.presentation)) return false;
  const shots=new Set<string>(),owned=new Set<string>(),dialogues=new Set<string>();
  for(const shot of [...v.shots,...v.parkedShots]) {
    if(!shape(shot,['id','imageId','name','scriptText'],['presentation']) || !id(shot.id) || shots.has(shot.id) || !id(shot.imageId) || owned.has(shot.imageId) || !text(shot.name) || !text(shot.scriptText) || shot.name.length>1_048_576 || shot.scriptText.length>1_048_576 || shot.presentation!==undefined&&!validPresentation(shot.presentation))return false;
    shots.add(shot.id);owned.add(shot.imageId);
  }
  for(const [key,image] of Object.entries(v.images)) if(!id(key) || !shape(image,['id','content']) || image.id!==key || !validImageBinding(image.content))return false;
  if([...owned].some(key=>!Object.hasOwn(v.images as object,key)))return false;
  for(const row of v.dialogues) {
    if(!shape(row,['id','shotId','text']) || !id(row.id) || dialogues.has(row.id) || !id(row.shotId) || !shots.has(row.shotId) || !text(row.text) || row.text.length>1_048_576)return false;
    dialogues.add(row.id);
  }
  return true;
}
export function snapshotImageProject(v: unknown): ProjectV2 {
  if(!validImageProject(v))throw Error('Invalid image-project v2');
  return copy(v);
}
export function validNativeDecision(v: unknown): v is NativeDecision {
  return shape(v,['kind','operationId','candidateId','imageId','expected','baseNative','prepared']) && v.kind==='image' &&
    token(v.operationId) && token(v.candidateId) && id(v.imageId) && validImageBinding(v.expected) &&
    (v.baseNative===null || validNativeImageRef(v.baseNative)) && validNativeImageRef(v.prepared);
}

/** Only image bindings change here. Native nodes/pixels are never projected to a
 * writable PNG layer tree. Pure board edits retain images by reference for typing groups. */
export function applyImageProjectEdit(project: ProjectV2, edit: ImageProjectEdit): ResultV1<ImageProjectEditResult> {
  if(!validImageProject(project) || !record(edit))return fail('invalid-input','Invalid image project/edit');
  let after=project;
  const all=[...project.shots,...project.parkedShots];
  switch(edit.kind){
    case 'setScriptText': {
      if(!shape(edit,['kind','shotId','text']) || !id(edit.shotId) || !text(edit.text) || !project.shots.some(s=>s.id===edit.shotId))return fail('invalid-input','Text requires an active shot');
      after={...project,shots:project.shots.map(s=>s.id===edit.shotId?{...s,scriptText:edit.text}:s)};break;
    }
    case 'setDialogues': {
      if(!shape(edit,['kind','shotId','dialogues']) || !id(edit.shotId) || !project.shots.some(s=>s.id===edit.shotId) || !Array.isArray(edit.dialogues) || edit.dialogues.some(d=>!record(d)||d.shotId!==edit.shotId))return fail('invalid-input','Dialogues require an active shot');
      const first=project.dialogues.findIndex(d=>d.shotId===edit.shotId), rows=project.dialogues.filter(d=>d.shotId!==edit.shotId);
      rows.splice(first<0?rows.length:first,0,...copy(edit.dialogues));after={...project,dialogues:rows};break;
    }
    case 'moveShots': {
      if(!shape(edit,['kind','shotIds','destination'],['beforeId']) || !Array.isArray(edit.shotIds) || !edit.shotIds.length || edit.shotIds.some(x=>!id(x)||!all.some(s=>s.id===x)) || new Set(edit.shotIds).size!==edit.shotIds.length || !['active','pending'].includes(edit.destination))return fail('invalid-input','Invalid shot move');
      const selected=new Set(edit.shotIds), active=project.shots.filter(s=>!selected.has(s.id)), pending=project.parkedShots.filter(s=>!selected.has(s.id));
      const dest=edit.destination==='active'?active:pending;
      if(edit.beforeId!==undefined && (!id(edit.beforeId)||!dest.some(s=>s.id===edit.beforeId)))return fail('invalid-input','Invalid move anchor');
      dest.splice(edit.beforeId===undefined?dest.length:dest.findIndex(s=>s.id===edit.beforeId),0,...all.filter(s=>selected.has(s.id)).map(s=>{if(edit.destination!=='active')return s;const {presentation:_old,...rest}=s;return {...rest,...(project.presentation?{presentation:copy(project.presentation)}:{})};}));
      after={...project,shots:active,parkedShots:pending};break;
    }
    case 'installNativeImage': {
      if(!shape(edit,['kind','imageId','expected','next']) || !id(edit.imageId) || !validImageBinding(edit.expected) || !validNativeImageRef(edit.next))return fail('invalid-input','Invalid native image edit');
      const image=project.images[edit.imageId];
      if(!image || !same(image.content,edit.expected) || !project.shots.some(s=>s.imageId===edit.imageId))return fail('conflict','Image baseline or active membership changed');
      after={...project,images:{...project.images,[edit.imageId]:{id:edit.imageId,content:{kind:'native',native:copy(edit.next)}}}};break;
    }
    default:return fail('invalid-input','Unknown image-project edit');
  }
  if(!validImageProject(after))return fail('invalid-input','Edit produced invalid project');
  const changed=!same(project,after);
  if(changed && !revision(project.revision+1))return fail('invalid-input','Project revision overflow');
  if(changed)after={...after,revision:project.revision+1};
  return ok({before:project,after,changed,changes:projectChanges(project,after)});
}

export type HistoryProjectShape = Omit<ProjectV2,'version'|'images'> & {version:number;images:Record<string,unknown>};
/** Shared by both history adapters, including Undo/Redo. */
export function projectChanges(before: HistoryProjectShape, after: HistoryProjectShape) {
  const old=[...before.shots,...before.parkedShots],next=[...after.shots,...after.parkedShots];
  const positions=(p:HistoryProjectShape)=>new Map([...p.shots.map((s,i)=>[s.id,`active:${i}`] as const),...p.parkedShots.map((s,i)=>[s.id,`pending:${i}`] as const)]);
  const a=positions(before),b=positions(after),imageIds=Object.keys({...before.images,...after.images}).filter(k=>!same(before.images[k],after.images[k]));
  return {imageIds,shotIds:[...new Set([...next,...old].map(s=>s.id))].filter(key=>a.get(key)!==b.get(key)||!same(old.find(s=>s.id===key),next.find(s=>s.id===key))||!same(before.dialogues.filter(d=>d.shotId===key),after.dialogues.filter(d=>d.shotId===key))||imageIds.includes(next.find(s=>s.id===key)?.imageId??old.find(s=>s.id===key)?.imageId??'')),
    text:!same(before.dialogues,after.dialogues)||old.some(s=>s.scriptText!==next.find(x=>x.id===s.id)?.scriptText),
    order:!same(before.shots.map(s=>s.id),after.shots.map(s=>s.id))||!same(before.parkedShots.map(s=>s.id),after.parkedShots.map(s=>s.id)),
    membership:!same(old.map(s=>s.id).sort(),next.map(s=>s.id).sort())||old.some(s=>before.shots.includes(s)!==after.shots.some(x=>x.id===s.id))};
}
