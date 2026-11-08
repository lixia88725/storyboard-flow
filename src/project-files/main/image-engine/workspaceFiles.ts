import{randomUUID}from'node:crypto';
import type{ProjectStoreV2}from'./projectStore.js';
import type{WorkspaceRecoveryRecord}from'./workspaceRecords.js';
import type{WorkspaceOutput,WorkspaceOutputReceipt,WorkspaceOutputFrozen}from'./workspaceOutputContract.js';
import type{ImageWorkspaceOwner}from'../../../platform/contracts/imageWorkspace.js';
import{same}from'../../../session/core/imageProjectValues.js';
/** One journal owns the freeze binding and terminal file fact. Output owns only
 * its physical transaction; a receipt never changes project history. */
export function createWorkspaceFiles(store:ProjectStoreV2,output:WorkspaceOutput,fault?:(point:string)=>Promise<void>,drainReadonly?:()=>Promise<void>){
 const requests=new Map<string,Extract<WorkspaceRecoveryRecord,{kind:'request'}>>();
 const intents=new Map<string,Extract<WorkspaceRecoveryRecord,{kind:'fileIntent'}>>(),results=new Map<string,Extract<WorkspaceRecoveryRecord,{kind:'fileResult'}>>();let last:WorkspaceOutputReceipt|null=null;
 const refresh=async()=>{intents.clear();results.clear();requests.clear();last=null;let afterId:string|undefined;do{const page=await store.workspaceRecordPage!({kinds:['request','fileIntent','fileResult'],...(afterId?{afterId}:{}),maxRecords:16});for(const r of page.records){if(r.kind==='request'&&r.command.kind==='save')requests.set(r.operationId,r);else if(r.kind==='fileIntent')intents.set(r.operationId,r);else if(r.kind==='fileResult'){results.set(r.operationId,r);if(r.receipt&&intents.get(r.operationId)?.mode==='save')last=r.receipt;}}afterId=page.nextAfterId??undefined;}while(afterId);};
 const finish=async(intent:Extract<WorkspaceRecoveryRecord,{kind:'fileIntent'}>,receipt:WorkspaceOutputReceipt)=>{const r:Extract<WorkspaceRecoveryRecord,{kind:'fileResult'}>={kind:'fileResult',id:`file-result-${intent.operationId}`,owner:intent.owner,requestId:intent.requestId,operationId:intent.operationId,decision:'completed',receipt};await store.recordWorkspace!(r);results.set(r.operationId,r);if(intent.mode==='save')last=receipt;};
 const frozen=async(intent:Extract<WorkspaceRecoveryRecord,{kind:'fileIntent'}>):Promise<WorkspaceOutputFrozen>=>{const c=(await store.committed()).find(c=>c.commitHash===intent.commitHash);if(!c)throw Error('Saved project binding is not reachable');return{owner:intent.owner,commitHash:intent.commitHash,project:c.commit.after,resolvedImages:intent.resolvedImages};};
 return{
  refresh,
  pending:()=>[...requests.keys(),...intents.keys()].some(id=>!results.has(id))||output.hasObligations(),
  status(operationId:string){const r=results.get(operationId);return r?r.decision==='completed'?'completed' as const:'notCommitted' as const:intents.has(operationId)||requests.has(operationId)?'unknown' as const:null;},
  blocksInput:()=>[...intents.values()].some(i=>i.mode==='save'&&!results.has(i.operationId)),
  pendingBatch:(batchId:string)=>[...intents.values()].some(i=>i.mode==='append'&&i.batchId===batchId&&!results.has(i.operationId)),
  published(batchId:string){return new Set([...results.values()].flatMap(r=>r.receipt&&intents.get(r.operationId)?.mode==='append'&&intents.get(r.operationId)?.batchId===batchId?r.receipt.files.map(f=>f.shotId):[]));},
  saved:()=>last?structuredClone(last):null,
  async notStarted(owner:ImageWorkspaceOwner,requestId:string,operationId:string){if(intents.has(operationId))return;const r:Extract<WorkspaceRecoveryRecord,{kind:'fileResult'}>={kind:'fileResult',id:`file-result-${operationId}`,owner,requestId,operationId,decision:'notStarted'};await store.recordWorkspace!(r);results.set(operationId,r);},
  async save(owner:ImageWorkspaceOwner,requestId:string,operationId:string,value:WorkspaceOutputFrozen){
   if(this.pending())throw Object.assign(Error('Recover the previous file transaction before saving'),{code:'busy',effect:'retained'});
   const intent:Extract<WorkspaceRecoveryRecord,{kind:'fileIntent'}>={kind:'fileIntent',id:`file-intent-${operationId}`,owner,requestId,operationId,outputOperationId:randomUUID(),mode:'save',commitHash:value.commitHash,resolvedImages:value.resolvedImages};
   // Keep the obligation even when the durable append acknowledgement is lost.
   intents.set(operationId,intent);await store.recordWorkspace!(intent);await fault?.('after-file-intent');const receipt=await output.save(value,{operationId:intent.outputOperationId});const checked=await output.queryOperation(intent.outputOperationId);if(checked.state!=='completed'||!same(receipt,checked.receipt))throw Error('Output completion receipt is not durable');await fault?.('after-output-completed');await finish(intent,receipt);return receipt;
  },
  async append(batch:import('./workspaceRecords.js').WorkspaceImportBatch,operationId:string,value:WorkspaceOutputFrozen,shotIds:readonly string[],sourceNames:Readonly<Record<string,string>>){
   const prior=intents.get(operationId);if(prior){if(results.has(operationId))return;throw Object.assign(Error('Original append requires recovery'),{code:'busy',effect:'retained'});}const intent:Extract<WorkspaceRecoveryRecord,{kind:'fileIntent'}>={kind:'fileIntent',id:`file-intent-${operationId}`,owner:batch.owner,requestId:batch.requestId,operationId,outputOperationId:randomUUID(),mode:'append',batchId:batch.operationId,shotIds:[...shotIds],sourceNames:{...sourceNames},commitHash:value.commitHash,resolvedImages:value.resolvedImages};intents.set(operationId,intent);try{await store.recordWorkspace!(intent);}catch(e){if((e as {effect?:string}).effect==='none')intents.delete(operationId);throw e;}await fault?.('after-file-intent');const receipt=await output.appendPendingBatch(value,{shotIds,sourceNames},{operationId:intent.outputOperationId});const checked=await output.queryOperation(intent.outputOperationId);if(checked.state!=='completed'||!same(checked.receipt,receipt))throw Error('Append receipt is not durable');await fault?.('after-output-completed');await finish(intent,receipt);
  },
  async recover(){await refresh();await output.recover();for(const request of requests.values())if(!intents.has(request.operationId)&&!results.has(request.operationId))await this.notStarted(request.owner,request.requestId,request.operationId);for(const intent of intents.values()){if(results.has(intent.operationId))continue;const status=await output.queryOperation(intent.outputOperationId);if(status.state==='completed')await finish(intent,status.receipt);else if(status.state==='absent'){// Exact original freeze binding; an absent output ID proves no capture/publish began.
    const value=await frozen(intent),receipt=intent.mode==='append'?await output.appendPendingBatch(value,{shotIds:intent.shotIds!,sourceNames:intent.sourceNames},{operationId:intent.outputOperationId}):await output.save(value,{operationId:intent.outputOperationId});await finish(intent,receipt);
   }else if(status.state==='retained'){if(!drainReadonly)throw Error('Readonly capture recovery is unavailable');await drainReadonly();const receipt=await output.retryRetainedCapture(await frozen(intent),intent.mode==='append'?{shotIds:intent.shotIds!,sourceNames:intent.sourceNames}:undefined,{operationId:intent.outputOperationId,readonlyCaptureSettled:true});await finish(intent,receipt);}else throw Object.assign(Error('Output retains an incomplete capture; original save binding is preserved'),{code:'file-recovery-required',effect:'retained'});}},
  async names(project:WorkspaceOutputFrozen['project']){return output.names(project);},
  close:()=>output.close(),
 };
}
