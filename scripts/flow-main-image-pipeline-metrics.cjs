const assert=require('node:assert/strict');
function stats(values){assert.ok(values.length);assert.ok(values.every(v=>Number.isFinite(v)&&v>=0));const a=[...values].sort((a,b)=>a-b),q=p=>a[Math.ceil(a.length*p)-1];return{count:a.length,p50Ms:q(.5),p95Ms:q(.95),p99Ms:q(.99),maxMs:a.at(-1)};}
function summarize(report){
 const ops=report.operations.filter(o=>o.phase==='paced'),events=report.progress.filter(p=>p.phase==='paced');
 const stage=(id,s)=>events.find(e=>e.operationId===id&&e.stage===s)?.atMainMs;
 const rows=ops.map((op,i)=>{const frames=report.frames.filter(f=>f.previewId===op.operationId);assert.equal(frames.length,7,'Every captured batch must reach native and both Canvas');
  const first=frames[0],last=frames.at(-1),next=ops[i+1],intentWrite=report.intentWrites?.find(w=>w.operationId===op.operationId);
  const times=Object.fromEntries(['intentDurable','prepared','projectCommitted','nativeAccepted'].map(s=>[s,stage(op.operationId,s)]));
  for(const t of Object.values(times))assert.ok(Number.isFinite(t));
  assert.ok(times.intentDurable<=times.prepared&&times.prepared<=times.projectCommitted&&times.projectCommitted<=times.nativeAccepted);
  return{operationId:op.operationId,endAtMainMs:op.endAtMainMs,...times,
   ...(intentWrite?{intentWriteStartedAtMainMs:intentWrite.startedAtMainMs,intentWriteDurableReturnAtMainMs:intentWrite.durableReturnAtMainMs,intentWriteDurationMs:intentWrite.durableReturnAtMainMs-intentWrite.startedAtMainMs}:{}),
   downAdmissionWaitMs:op.samples[0].requestAtMainMs-(op.samples[0].firstAttemptAtMainMs??op.samples[0].requestAtMainMs),
   admittedDownToNativePreviewMs:first.nativeFrameReceivedAtMainMs-op.samples[0].requestAtMainMs,
   admittedDownToCanvasAckMs:first.dualCanvasInstalledAtAckMainMs-op.samples[0].requestAtMainMs,
   firstAttemptDownToNativePreviewMs:first.nativeFrameReceivedAtMainMs-(op.samples[0].firstAttemptAtMainMs??op.samples[0].requestAtMainMs),
   firstAttemptDownToCanvasAckMs:first.dualCanvasInstalledAtAckMainMs-(op.samples[0].firstAttemptAtMainMs??op.samples[0].requestAtMainMs),
   endToIntentDurableMs:times.intentDurable-op.endAtMainMs,endToPreparedMs:times.prepared-op.endAtMainMs,
   endToProjectCommittedMs:times.projectCommitted-op.endAtMainMs,endToNativeAcceptedMs:times.nativeAccepted-op.endAtMainMs,
   lastPointToCanvasAckMs:last.dualCanvasInstalledAtAckMainMs-op.samples.at(-1).requestAtMainMs,
   ...(next?{endToNextNativePreviewMs:report.frames.find(f=>f.previewId===next.operationId).nativeFrameReceivedAtMainMs-op.endAtMainMs,
    endToNextCanvasAckMs:report.frames.find(f=>f.previewId===next.operationId).dualCanvasInstalledAtAckMainMs-op.endAtMainMs,
    intentDurableToNextNativePreviewMs:report.frames.find(f=>f.previewId===next.operationId).nativeFrameReceivedAtMainMs-times.intentDurable,
    intentDurableToNextCanvasAckMs:report.frames.find(f=>f.previewId===next.operationId).dualCanvasInstalledAtAckMainMs-times.intentDurable,
    nextNativePreviewAfterIntentDurable:report.frames.find(f=>f.previewId===next.operationId).nativeFrameReceivedAtMainMs>=times.intentDurable}:{} )};
 });
 const metrics={};for(const key of Object.keys(rows[0]).filter(k=>k.endsWith('Ms')&&!k.endsWith('AtMainMs')))metrics[key]=stats(rows.filter(r=>r[key]!==undefined).map(r=>r[key]));
 const samples=ops.flatMap(o=>o.samples),frames=ops.flatMap(o=>report.frames.filter(f=>f.previewId===o.operationId));
 return{rows,metrics,deadlineToCanvasAck:stats(samples.map((s,i)=>frames[i].dualCanvasInstalledAtAckMainMs-report.pacing.records[i].targetDeadlineAtMainMs)),
  deadlineToNativePreview:stats(samples.map((s,i)=>frames[i].nativeFrameReceivedAtMainMs-report.pacing.records[i].targetDeadlineAtMainMs)),
  note:'local admitted is volatile capture only. Native preview and Canvas ACK are independent. ACK includes synchronous pixel oracle, not compositor/input-to-photon. projectCommitted follows real ProjectStore CAS; nativeAccepted is progress observed by the real Main pipeline poll.'};
}
module.exports={stats,summarize};
