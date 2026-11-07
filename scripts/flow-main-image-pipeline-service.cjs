// Offline bounds from the original functional/pass, paced/performance-fail trace.
const assert=require('node:assert/strict'),{stats}=require('./flow-main-image-pipeline-metrics.cjs');
function serviceBounds(r){
 const ops=r.operations.filter(o=>o.phase==='paced'),stages=r.progress.filter(e=>e.phase==='paced');
 const stage=(op,s)=>{const e=stages.find(e=>e.operationId===op&&e.stage===s);assert.ok(e);return e.atMainMs;};
 const rows=ops.map((o,i)=>{const prepared=stage(o.operationId,'prepared'),committed=stage(o.operationId,'projectCommitted'),accepted=stage(o.operationId,'nativeAccepted'),previousAccepted=i?stage(ops[i-1].operationId,'nativeAccepted'):null,w=r.intentWrites.find(w=>w.operationId===o.operationId);
  const earliestCommitWork=Math.max(prepared,previousAccepted??prepared);assert.ok(committed>=earliestCommitWork&&accepted>=committed);
  return{operationId:o.operationId,preparedAtMainMs:prepared,projectCommittedAtMainMs:committed,nativeAcceptedAtMainMs:accepted,previousNativeAcceptedAtMainMs:previousAccepted,
   beginOperationCallMs:w.durableReturnAtMainMs-w.startedAtMainMs,
   preparedToProjectCommittedMs:committed-prepared,
   fifoWaitAfterPreparedLowerBoundMs:earliestCommitWork-prepared,
   decisionResidualUpperBoundMs:committed-earliestCommitWork,
   projectCommittedToNativeAcceptedMs:accepted-committed};
 });
 const metrics={};for(const k of Object.keys(rows[0]).filter(k=>k.endsWith('Ms')&&!k.endsWith('AtMainMs')))metrics[k]=stats(rows.map(r=>r[k]));
 const inputFrames=r.frames.filter(f=>f.phase==='paced'),firstKeyframe=inputFrames.find(f=>f.baseFrameSeq===null);
 const lateProgression=ops.filter((o,i)=>[0,9,19,29,39].includes(i)).map(o=>{const sample=o.samples[0],p=r.pacing.records[sample.pacingIndex];return{stroke:o.index,firstAttemptLatenessMs:p.firstRequestLatenessMs,successfulAdmissionLatenessMs:p.successfulDispatchLatenessMs};});
 return{classification:'FUNCTIONAL PASS; 10ms PACED PERFORMANCE FAIL',metrics,rows,firstKeyframe,
  oracleAfterFirstKeyframeMs:inputFrames.filter(f=>f!==firstKeyframe).reduce((n,f)=>n+f.oracleMs,0),lateProgression,
  limits:[
   'beginOperationCallMs is measured real API entry to durable return; includes its internal queue, budget/lease/path checks and file publication. It is not a single fsync syscall measurement.',
   'Decision tail includes previous native accept, store.settle and resolveOperation before the next decision. The observed previous nativeAccepted is only a lower bound for next commit work start.',
   'fifoWaitAfterPreparedLowerBoundMs is guaranteed FIFO waiting until previous accepted. decisionResidualUpperBoundMs includes unknown previous post-accept settlement, own resolve/history/CAS work, and observer scheduling. It is NOT pure CAS service time.',
   'projectCommittedToNativeAcceptedMs includes actual accept command, native publication, wire scheduling and progress-poll observation; native IO and observation delay cannot be split here.',
   'The first paced keyframe synchronous oracle is retained and affects initial ACKs. Later >1s deadline backlog with small subsequent oracle cannot all be attributed to that first oracle.',
   'No GUI rerun. A later coordinated run may wrap actual commit/settle/resolve/accept API entry and exit without changing product behavior.'
  ]};
}
module.exports={serviceBounds};
if(require.main===module){const fs=require('node:fs'),zlib=require('node:zlib'),p=process.argv[2];if(!p)throw Error('Expected retained result.json[.gz]');const raw=fs.readFileSync(p);console.log(JSON.stringify(serviceBounds(JSON.parse(p.endsWith('.gz')?zlib.gunzipSync(raw):raw)),null,2));}
