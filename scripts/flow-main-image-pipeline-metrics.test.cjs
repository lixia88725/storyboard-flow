const {test}=require('node:test'),assert=require('node:assert/strict');const{summarize}=require('./flow-main-image-pipeline-metrics.cjs');
function fixture(){
 const r={operations:[],frames:[],progress:[],intentWrites:[],pacing:{records:[]}};
 for(let i=0;i<2;i++){const start=i*70,id='op-'+i,delay=i?35:20;const samples=Array.from({length:7},(_,n)=>({requestAtMainMs:start+n*10}));r.operations.push({phase:'paced',operationId:id,endAtMainMs:start+65,samples});
  for(let n=0;n<7;n++){r.frames.push({previewId:id,nativeFrameReceivedAtMainMs:start+n*10+delay,dualCanvasInstalledAtAckMainMs:start+n*10+delay+5});r.pacing.records.push({targetDeadlineAtMainMs:start+n*10-2});}
  for(const[stage,offset]of Object.entries({intentDurable:90,prepared:100,projectCommitted:110,nativeAccepted:120}))r.progress.push({phase:'paced',operationId:id,stage,atMainMs:offset+i*90});
  r.intentWrites.push({operationId:id,startedAtMainMs:start+66,durableReturnAtMainMs:90+i*90});
 }return r;
}
test('separates local capture, real store return, project CAS, native acceptance and Canvas ACK',()=>{
 const f=fixture();f.operations[1].samples[0].firstAttemptAtMainMs=65;
 const s=summarize(f);assert.equal(s.rows[0].admittedDownToNativePreviewMs,20);assert.equal(s.rows[0].admittedDownToCanvasAckMs,25);assert.equal(s.rows[1].downAdmissionWaitMs,5);assert.equal(s.rows[1].firstAttemptDownToCanvasAckMs,45);
 assert.equal(s.rows[0].endToIntentDurableMs,25);assert.equal(s.rows[0].endToProjectCommittedMs,45);assert.equal(s.rows[0].endToNativeAcceptedMs,55);
 assert.equal(s.rows[0].endToNextNativePreviewMs,40);assert.equal(s.rows[0].intentDurableToNextNativePreviewMs,15);assert.equal(s.rows[0].intentWriteDurationMs,24);
 assert.equal(s.deadlineToCanvasAck.count,14);assert.equal(s.deadlineToCanvasAck.maxMs,42);assert.equal(s.metrics.endToNextNativePreviewMs.count,1);
});
test('missing display frames or contradictory durable stage order fails the oracle',()=>{
 const r=fixture();r.frames.pop();assert.throws(()=>summarize(r));const another=fixture();another.progress.find(e=>e.stage==='projectCommitted').atMainMs=50;assert.throws(()=>summarize(another));
});
