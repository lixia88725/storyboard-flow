import{validImageCreationIntent}from'../../../session/core/imageCreation.js';
import type{ImageCreationBatchIntent,SourceImageRef}from'../../../platform/contracts/imageProject.js';
import type {ImageWorkspaceCapturedInput,ImageWorkspaceCommand,ImageWorkspaceOwner} from '../../../platform/contracts/imageWorkspace.js';
import type {ImageEngineEdit} from '../../../platform/contracts/imageEngine.js';
import {validImageEngineEdit} from '../../../platform/contracts/imageEngine.js';
import {validProjectStroke,validNativeImageRef,validSourceImageRef,imageHash} from '../../../session/core/imageProjectModel.js';
import type {NativeImageRef} from '../../../platform/contracts/imageProject.js';
import {shape} from '../../../session/core/imageProjectValues.js';
export type WorkspaceRecoveryRecord=
 |{kind:'sourceHydration';id:string;owner:ImageWorkspaceOwner;operationId:string;imageId:string;source:SourceImageRef&{digest:string;byteLength:number};hostBuildDigest:string;optionsHash:string}
 |{kind:'sourceHydrationResolution';id:string;owner:ImageWorkspaceOwner;operationId:string;source:SourceImageRef;decision:'hydrated'|'notHydrated';native?:NativeImageRef}
 |{kind:'creationBatch';id:string;owner:ImageWorkspaceOwner;intent:ImageCreationBatchIntent}
 |{kind:'request';id:string;owner:ImageWorkspaceOwner;requestId:string;operationId:string;command:ImageWorkspaceCommand}
 |{kind:'requestResolution';id:string;owner:ImageWorkspaceOwner;requestId:string;operationId:string;decision:'committed'|'notCommitted';commitHash:string|null}
 |{kind:'capturedInput';id:string;owner:ImageWorkspaceOwner;captureId:string;original:ImageWorkspaceCapturedInput}
 |{kind:'capturedEdit';id:string;owner:ImageWorkspaceOwner;requestId:string;previewId:string|null;original:{shotId:string;expectedNative:NativeImageRef;expectedContextGeneration:number;edit:ImageEngineEdit}};
const token=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(v);
export const validWorkspaceOwner=(v:unknown):v is ImageWorkspaceOwner=>shape(v,['sessionId','incarnation','workspaceEpoch'])&&token(v.sessionId)&&token(v.incarnation)&&Number.isSafeInteger(v.workspaceEpoch)&&Number(v.workspaceEpoch)>=0;
/** Recovery-only originals are never executable intents or native authority. */
export function workspaceRecoveryRecord(v:unknown):WorkspaceRecoveryRecord{
 const fail=():never=>{throw Error('Invalid workspace recovery record');};if(!v||typeof v!=='object'||!('kind'in v))return fail();const r=v as Record<string,unknown>;
 if(!token(r.id)||!validWorkspaceOwner(r.owner))return fail();
 if(r.kind==='sourceHydration'){const source=r.source;if(!shape(r,['kind','id','owner','operationId','imageId','source','hostBuildDigest','optionsHash'])||!token(r.operationId)||!token(r.imageId)||!shape(source,['importId','itemId','interpretationId','digest','byteLength'])||!validSourceImageRef({importId:source.importId,itemId:source.itemId,interpretationId:source.interpretationId})||!imageHash(source.digest)||!Number.isSafeInteger(source.byteLength)||Number(source.byteLength)<0||!imageHash(r.hostBuildDigest)||!imageHash(r.optionsHash))return fail();}
 else if(r.kind==='sourceHydrationResolution'){if(!shape(r,['kind','id','owner','operationId','source','decision'],['native'])||!token(r.operationId)||!validSourceImageRef(r.source)||!['hydrated','notHydrated'].includes(String(r.decision))||(r.decision==='hydrated'?!validNativeImageRef(r.native):r.native!==undefined))return fail();}
 else if(r.kind==='creationBatch'){if(!shape(r,['kind','id','owner','intent'])||!validImageCreationIntent(r.intent)||r.intent.sessionId!==r.owner.sessionId||r.intent.incarnation!==r.owner.incarnation)return fail();}
 else if(r.kind==='request'){if(!shape(r,['kind','id','owner','requestId','operationId','command'])||!token(r.requestId)||!token(r.operationId)||!r.command||typeof r.command!=='object'||!('kind'in r.command)||typeof r.command.kind!=='string')return fail();}
 else if(r.kind==='requestResolution'){if(!shape(r,['kind','id','owner','requestId','operationId','decision','commitHash'])||!token(r.requestId)||!token(r.operationId)||!['committed','notCommitted'].includes(String(r.decision))||(r.decision==='committed'?!imageHash(r.commitHash):r.commitHash!==null))return fail();}
 else if(r.kind==='capturedInput'){const o=r.original;if(!shape(r,['kind','id','owner','captureId','original'])||!token(r.captureId)||!shape(o,['originOwner','shotId','layerId','stroke','ended','capturedThrough','coordinateSpace'],['resolvedDimensions'])||!validWorkspaceOwner(o.originOwner)||!token(o.shotId)||(o.layerId!==null&&typeof o.layerId!=='string')||!validProjectStroke(o.stroke)||typeof o.ended!=='boolean'||!Number.isSafeInteger(o.capturedThrough)||Number(o.capturedThrough)!==o.stroke.points.length/2||!['pixels','normalized'].includes(String(o.coordinateSpace))||(o.resolvedDimensions!==undefined&&(!shape(o.resolvedDimensions,['width','height'])||![o.resolvedDimensions.width,o.resolvedDimensions.height].every(n=>Number.isSafeInteger(n)&&Number(n)>0))))return fail();}
 else if(r.kind==='capturedEdit'){const o=r.original;if(!shape(r,['kind','id','owner','requestId','previewId','original'])||!token(r.requestId)||(r.previewId!==null&&!token(r.previewId))||!shape(o,['shotId','expectedNative','expectedContextGeneration','edit'])||!token(o.shotId)||!validNativeImageRef(o.expectedNative)||!Number.isSafeInteger(o.expectedContextGeneration)||Number(o.expectedContextGeneration)<0||!validImageEngineEdit(o.edit))return fail();}
 else return fail();return structuredClone(v as WorkspaceRecoveryRecord);
}
