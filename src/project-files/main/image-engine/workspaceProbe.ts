import{workspaceRecoveryRecord}from'./workspaceRecords.js';
import{operationIntent,hydrationRecord}from'./projectStoreRecords.js';
import {inspectProjectFolder,type ProjectFolderEntry} from '../projectFolderEntry.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import {constants} from 'node:fs';
import {createHash} from 'node:crypto';
import {openRecoveryJournal} from './recoveryJournal.js';
import {commitRecord} from './projectStoreRecords.js';
import {canonicalJson} from '../persistence/canonicalJson.js';
import {shape} from '../../../session/core/imageProjectValues.js';
import type {ImageWorkspaceProjectPlan} from './workspaceRuntimeContract.js';
export class LegacyImageWorkspaceProjectError extends Error{readonly code='copy-upgrade-required';constructor(readonly root:string){super('This existing project requires an explicit new copy');}}
/** Routing metadata only. This never acquires a writer, creates a directory,
 * repairs a tail, decodes sources or installs versions. Runtime opening still
 * performs full fact/reference validation under the real project lease. */
export async function readImageWorkspaceProject(root:string){
 if(!path.isAbsolute(root)||path.normalize(root)!==root||root.includes('\0'))throw Error('Canonical project root required');
 const st=await fs.lstat(root,{bigint:true});if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(root)!==root)throw Error('Unsafe project root');
 const check=async()=>{const s=await fs.lstat(root,{bigint:true});if(s.dev!==st.dev||s.ino!==st.ino||!s.isDirectory()||s.isSymbolicLink())throw Error('Project root changed');};
 const gateFile=path.join(root,'.storyboard-flow/image-project-v2/head.json');let gateBytes:Buffer;
 try{const entry=await fs.lstat(gateFile,{bigint:true});if(!entry.isFile()||entry.isSymbolicLink()||entry.size>4096n)throw Error('Unsafe project format gate');const h=await fs.open(gateFile,constants.O_RDONLY|constants.O_NOFOLLOW);try{const before=await h.stat({bigint:true});if(before.dev!==entry.dev||before.ino!==entry.ino)throw Error('Project gate changed');gateBytes=await h.readFile();const after=await h.stat({bigint:true});if(after.size!==before.size||after.mtimeNs!==before.mtimeNs||after.ctimeNs!==before.ctimeNs||gateBytes.length>4096)throw Error('Project gate changed');}finally{await h.close();}}
 catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;const legacy=path.join(root,'.storyboard-flow/checkpoints/project.json');try{const s=await fs.lstat(legacy);if(!s.isFile()||s.isSymbolicLink())throw Error('Unsafe legacy project');}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')throw Error('No recognized Flow project');throw error;}throw new LegacyImageWorkspaceProjectError(root);}
 const gate:unknown=JSON.parse(gateBytes.toString('utf8'));if(!shape(gate,['schema','version','writer','formatId'])||gate.schema!=='flow.project-head'||gate.version!==2147483647||gate.writer!=='flow.recovery-journal'||typeof gate.formatId!=='string'||!(/^[a-f0-9]{32}$/).test(gate.formatId))throw Error('Unsupported or damaged project format');
 const journal=await openRecoveryJournal({directory:path.join(root,'.storyboard-flow/image-project-journal-v1'),formatId:gate.formatId,assertHeld:check,reserve:async()=>{throw Error('Read-only probe cannot reserve writes');},onGrowth:()=>{throw Error('Read-only probe cannot write');},createInitial:false,readOnly:true});
 try{let formatted=false,head:string|null=null,genesisCommitHash:string|null=null,genesisProject:ReturnType<typeof commitRecord>['after']|undefined,project:ReturnType<typeof commitRecord>['after']|undefined;const ids=new Set<string>(),pendingInputs=new Set<string>(),pendingHydrations=new Map<string,string>(),pendingCreations=new Set<string>(),pendingSourceJobs=new Set<string>(),copyIssues:string[]=[];for(const sequence of journal.sequences()){
  const fact=await journal.read(sequence);if(!fact||typeof fact!=='object'||!('kind'in fact))throw Error('Malformed journal fact');const f=fact as Record<string,unknown>;
  if(sequence===1){if(!shape(f,['kind','formatId'])||f.kind!=='format'||f.formatId!==gate.formatId)throw Error('Missing durable project format');formatted=true;continue;}
  if(f.kind==='format')throw Error('Duplicate journal format');
  if(f.kind==='commit'){if(!shape(f,['kind','expectedHead','record']))throw Error('Malformed project commit');const c=commitRecord(f.record);if(ids.has(c.commitId)||f.expectedHead!==head||c.previousCommitHash!==head)throw Error('Project commit chain changed');if(project?(c.after.id!==project.id||c.beforeRevision!==project.revision||c.after.revision!==project.revision+1):(c.beforeRevision!==null||c.after.revision!==0||c.nativeDecision!==undefined||c.creationDecision!==undefined))throw Error('Project revision changed');ids.add(c.commitId);head=createHash('sha256').update(canonicalJson(c)+'\n').digest('hex');genesisCommitHash??=head;genesisProject??=c.after;project=c.after;}
  else if(f.kind==='input'){const intent=operationIntent(f.intent);pendingInputs.add(intent.operationId);}
  else if(f.kind==='resolution'){const r=f.resolution as{operationId?:unknown;decision?:unknown};if(typeof r?.operationId!=='string'||!['committed','discarded'].includes(String(r.decision)))copyIssues.push('Malformed input resolution');else pendingInputs.delete(r.operationId);}
  else if(f.kind==='confirmation'){if(f.resolve===true&&Array.isArray(f.records))for(const r of f.records)if(typeof r?.operationId==='string')pendingInputs.delete(r.operationId);}
  else if(f.kind==='hydration'){const h=hydrationRecord(f.record);pendingHydrations.set(canonicalJson({importId:h.source.importId,itemId:h.source.itemId,interpretationId:h.source.interpretationId}),h.operationId);}
  else if(f.kind==='hydrationAccepted'){if(f.source&&typeof f.source==='object'){const key=canonicalJson(f.source);if(pendingHydrations.get(key)===f.operationId)pendingHydrations.delete(key);else copyIssues.push('Hydration confirmation does not match its Main decision');}else copyIssues.push('Malformed hydration confirmation');}
  else if(f.kind==='workspace'){try{const r=workspaceRecoveryRecord(f.record) as {kind:string;operationId?:string;intent?:{operationId:string};requestId?:string;command?:{kind:string}};if(r.kind==='creationBatch')pendingCreations.add(r.intent!.operationId);else if(r.kind==='sourceHydration')pendingSourceJobs.add(r.operationId!);else if(r.kind==='sourceHydrationResolution')pendingSourceJobs.delete(r.operationId!);else if(r.kind==='requestResolution')pendingCreations.delete(r.operationId!);else if(r.kind==='request'&&['save','append','addImages','refresh','export'].includes(r.command!.kind))copyIssues.push(`File request ${r.requestId} has no dedicated terminal file evidence`);}catch{copyIssues.push('Unknown or malformed Main workspace recovery fact');}}
  else if(!['unchanged'].includes(String(f.kind)))throw Error('Unknown project journal fact');
 }
 if(!formatted||!project)throw Error('Project creation incomplete: no durable genesis');if(pendingInputs.size)copyIssues.push('Main image inputs have unresolved decisions');if(pendingHydrations.size||pendingSourceJobs.size)copyIssues.push('Main source hydration is unresolved');if(pendingCreations.size)copyIssues.push('Main detached creation is unresolved');await check();return{coldCopySafe:copyIssues.length===0,coldCopyIssues:[...new Set(copyIssues)],plan:{kind:'native' as const,root,identity:{id:project.id,name:project.name},format:'journal' as const},genesisCommitHash:genesisCommitHash!,genesisProject:genesisProject!,commitHash:head!,project};
 }finally{await journal.close();}
}

export async function probeImageWorkspaceProject(root:string):Promise<ImageWorkspaceProjectPlan>{return(await readImageWorkspaceProject(root)).plan;}
export type ImageWorkspaceFolderInspection=
 |{kind:'native';plan:ImageWorkspaceProjectPlan}|{kind:'legacy'}
 |{kind:'images';entry:Extract<ProjectFolderEntry,{kind:'images'}>}
 |{kind:'empty';entry:Extract<ProjectFolderEntry,{kind:'empty'}>}
 |{kind:'damaged';reason:string};
/** One classification for chooser/recent/CLI/relocation. A Flow marker never
 * falls back to ordinary import after any format/read failure. */
export async function inspectImageWorkspaceFolder(root:string):Promise<ImageWorkspaceFolderInspection>{
 try{const entry=await inspectProjectFolder(root);if(entry.kind==='images'||entry.kind==='empty')return{kind:entry.kind,entry} as ImageWorkspaceFolderInspection;if(entry.kind==='damaged')return entry;try{return{kind:'native',plan:await probeImageWorkspaceProject(root)};}catch(e){if(e instanceof LegacyImageWorkspaceProjectError)return{kind:'legacy'};throw e;}}
 catch(e){return{kind:'damaged',reason:e instanceof Error?e.message:String(e)};}
}
/** Main-record readiness only; the copy Adapter separately binds marker, root,
 * output files and physical lock identities. Never infer this from a released PID. */
export async function readImageWorkspaceColdCopyState(root:string){const value=await readImageWorkspaceProject(root);if(!value.coldCopySafe)throw Error('Unsettled Main recovery records prevent cold copy: '+value.coldCopyIssues.join('; '));return{projectId:value.plan.identity.id,genesisCommitHash:value.genesisCommitHash,commitHash:value.commitHash};}
