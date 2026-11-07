// Independent in-memory observation of final confirmation; stages never imply settled.
const assert=require('node:assert/strict');
function createConfirmationTracker({clock}){
 const operations=new Map(),batches=[],events=[],peaks=new Map();let batchSeq=0;
 const op=(id,phase)=>{let o=operations.get(id);if(!o){o={operationId:id,phase};operations.set(id,o);}return o;};
 function snapshot(phase){const list=[...operations.values()].filter(o=>o.phase===phase),accepted=list.filter(o=>o.nativeAcceptedAtMainMs!==undefined),pending=accepted.filter(o=>o.finalConfirmedAtMainMs===undefined);
  return{phase,operations:list.length,projectCommitted:list.filter(o=>o.projectCommittedAtMainMs!==undefined).length,nativeAccepted:accepted.length,finalConfirmed:list.filter(o=>o.finalConfirmedAtMainMs!==undefined).length,
   awaitingFinalConfirmation:pending.length,waitingForBatch:pending.filter(o=>!o.batchIds?.length).length,
   inFlightBatchOperations:pending.filter(o=>o.batchIds?.some(id=>batches.find(b=>b.batchId===id)?.endedAtMainMs===undefined)).length};}
 function record(kind,o,detail={}){const at=clock();events.push({kind,operationId:o?.operationId,phase:o?.phase,atMainMs:at,...detail});if(o){const s=snapshot(o.phase),p=peaks.get(o.phase)??{awaitingFinalConfirmation:0,waitingForBatch:0,inFlightBatchOperations:0};for(const k of ['awaitingFinalConfirmation','waitingForBatch','inFlightBatchOperations'])p[k]=Math.max(p[k],s[k]);if(s.nativeAccepted>0&&s.awaitingFinalConfirmation===0)p.lastDrainedAtMainMs=at;peaks.set(o.phase,p);}return at;}
 return{operations,batches,events,snapshot,
  progress(event,phase){const o=op(event.operationId,phase);const key=event.stage==='projectCommitted'?'projectCommittedAtMainMs':event.stage==='nativeAccepted'?'nativeAcceptedAtMainMs':event.stage==='admitted'?'firstAdmittedAtMainMs':undefined;if(key&&o[key]===undefined)o[key]=record(event.stage,o);},
  ended(id,phase,at){op(id,phase).endAtMainMs=at;},
  completed(id,phase,outcome){const o=op(id,phase);o.outcomeKind=outcome.kind;const at=clock();o.waitOperationCompletedAtMainMs=at;if(outcome.kind==='settled')o.finalConfirmedAtMainMs=at;record('waitOperation-completed',o,{outcomeKind:outcome.kind});},
  failed(id,phase,error){const o=op(id,phase);o.error=String(error);o.waitOperationRejectedAtMainMs=record('waitOperation-rejected',o);},
  batchStarted(records,phase){assert.ok(Array.isArray(records)&&records.length>=1&&records.length<=4);const ids=records.map(r=>r.operationId);assert.equal(new Set(ids).size,ids.length);const batch={batchId:'confirmation-'+ ++batchSeq,operationIds:ids,records:structuredClone(records),phase,startedAtMainMs:clock()};batches.push(batch);for(const id of ids){const o=op(id,phase);(o.batchIds??=[]).push(batch.batchId);record('batch-start',o,{batchId:batch.batchId});}return batch;},
  batchCompleted(batch,status,error){batch.endedAtMainMs=clock();batch.status=status;if(error!==undefined)batch.error=String(error);for(const id of batch.operationIds){const o=op(id,batch.phase);if(status==='fulfilled')o.batchDurableReturnedAtMainMs=batch.endedAtMainMs;record('batch-'+status,o,{batchId:batch.batchId});}},
  assertDrained(phase,{expected,requireBatch=false}){const list=[...operations.values()].filter(o=>o.phase===phase),state=snapshot(phase);assert.equal(list.length,expected);assert.equal(state.finalConfirmed,expected);assert.equal(state.awaitingFinalConfirmation,0);for(const o of list){assert.ok(o.finalConfirmedAtMainMs>=o.nativeAcceptedAtMainMs);if(requireBatch){assert.equal(o.batchIds?.length,1,'Every operation needs one durable confirmation batch');const b=batches.find(b=>b.batchId===o.batchIds[0]);assert.equal(b?.status,'fulfilled');assert.ok(o.finalConfirmedAtMainMs>=b.endedAtMainMs,'waitOperation settled before durable batch return');}}},
  result(phase){return{...snapshot(phase),peaks:peaks.get(phase),operations:[...operations.values()].filter(o=>o.phase===phase),batches:batches.filter(b=>b.operationIds.some(id=>operations.get(id)?.phase===phase)),events:events.filter(e=>e.phase===phase),meaning:'Awaiting confirmation = nativeAccepted but waitOperation has not finally returned settled; includes batching and in-flight IO. Batch durable return is observed once per batch; its duration must not be repeated as per-operation IO.'};}
 };
}
function observeOperationCompletion(promise,{fulfilled,rejected,observationError}){void promise.then(fulfilled,rejected).catch(observationError);return promise;}
module.exports={createConfirmationTracker,observeOperationCompletion};
