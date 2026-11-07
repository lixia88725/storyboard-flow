const{test}=require('node:test'),assert=require('node:assert/strict'),{createConfirmationTracker}=require('./flow-main-image-pipeline-confirmations.cjs');
const{observeOperationCompletion}=require('./flow-main-image-pipeline-confirmations.cjs');
test('early CAS/nativeAccepted are not final confirmation and shared batch service is stored once',()=>{
 let now=0;const t=createConfirmationTracker({clock:()=>now});
 for(const id of ['a','b']){t.progress({operationId:id,stage:'admitted'},'paced');t.progress({operationId:id,stage:'admitted'},'paced');t.ended(id,'paced',0);}
 now=1;t.progress({operationId:'a',stage:'projectCommitted'},'paced');now=2;t.progress({operationId:'b',stage:'projectCommitted'},'paced');
 assert.equal(t.snapshot('paced').finalConfirmed,0);now=3;t.progress({operationId:'a',stage:'nativeAccepted'},'paced');now=4;t.progress({operationId:'b',stage:'nativeAccepted'},'paced');assert.equal(t.snapshot('paced').awaitingFinalConfirmation,2);
 const batch=t.batchStarted([{operationId:'a'},{operationId:'b'}],'paced');assert.equal(t.snapshot('paced').inFlightBatchOperations,2);assert.equal(t.snapshot('paced').waitingForBatch,0);
 now=10;t.batchCompleted(batch,'fulfilled');assert.equal(t.snapshot('paced').finalConfirmed,0);now=11;t.completed('a','paced',{kind:'settled'});now=12;t.completed('b','paced',{kind:'settled'});
 t.assertDrained('paced',{expected:2,requireBatch:true});const r=t.result('paced');assert.equal(r.operations.length,2);assert.equal(r.batches.length,1);assert.equal(r.batches[0].endedAtMainMs-r.batches[0].startedAtMainMs,6);assert.equal(r.awaitingFinalConfirmation,0);assert.equal(r.peaks.awaitingFinalConfirmation,2);assert.equal(r.peaks.lastDrainedAtMainMs,12);
});
test('immediate observers retain real per-operation completion before a late sequential drain',async()=>{
 let now=0,resolveA,resolveB;const a=new Promise(r=>resolveA=r),b=new Promise(r=>resolveB=r),times={};const record=id=>({fulfilled(){times[id]=now;},rejected:assert.fail,observationError:assert.fail});
 assert.equal(observeOperationCompletion(a,record('a')),a);assert.equal(observeOperationCompletion(b,record('b')),b);
 now=4;resolveA({kind:'settled'});await Promise.resolve();now=19;resolveB({kind:'settled'});await Promise.resolve();now=100;await a;await b;assert.deepEqual(times,{a:4,b:19});
});
test('settlementPending/rejection never drain confirmation and batches retain operation associations',()=>{
 let now=0;const t=createConfirmationTracker({clock:()=>++now});t.progress({operationId:'a',stage:'nativeAccepted'},'paced');const b=t.batchStarted([{operationId:'a'}],'paced');t.batchCompleted(b,'rejected',Error('unknown'));t.completed('a','paced',{kind:'settlementPending'});assert.equal(t.result('paced').awaitingFinalConfirmation,1);assert.equal(t.result('paced').operations[0].batchIds[0],b.batchId);assert.throws(()=>t.batchStarted(Array.from({length:5},(_,i)=>({operationId:String(i)})),'paced'));
});
test('drain oracle rejects a false early settled Promise even if eventual batch IO completes',()=>{
 let now=0;const t=createConfirmationTracker({clock:()=>now});t.progress({operationId:'a',stage:'nativeAccepted'},'paced');const b=t.batchStarted([{operationId:'a'}],'paced');now=2;t.completed('a','paced',{kind:'settled'});now=10;t.batchCompleted(b,'fulfilled');assert.throws(()=>t.assertDrained('paced',{expected:1,requireBatch:true}));
});
