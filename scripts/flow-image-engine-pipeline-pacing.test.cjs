const {test}=require('node:test'),assert=require('node:assert/strict');
const {createPacer}=require('./flow-image-engine-pipeline-pacing.cjs');
test('absolute deadlines survive slow ACKs, admission retry and screenshot pauses without dropping batches',async()=>{
 let time=100;const waits=[];
 const p=createPacer({intervalMs:10,total:4,clock:()=>time,sleep:async ms=>{waits.push(ms);time+=ms;}});
 const a=await p.before(0);p.dispatched(a,{firstRequestAt:100,successfulRequestAt:125,refusedAttempts:3});time=126;
 const b=await p.before(1);p.dispatched(b,{firstRequestAt:126,successfulRequestAt:126,refusedAttempts:0});time=129;
 const c=await p.before(2);p.dispatched(c,{firstRequestAt:129,successfulRequestAt:129,refusedAttempts:0});time=175;
 const d=await p.before(3);p.dispatched(d,{firstRequestAt:175,successfulRequestAt:175,refusedAttempts:0});
 const r=p.result();assert.deepEqual(r.records.map(r=>r.targetDeadlineAtMainMs),[100,110,120,130]);
 assert.deepEqual(r.records.map(r=>r.successfulDispatchLatenessMs),[25,16,9,45]);
 assert.equal(a.admissionBackpressureWaitMs,25);assert.equal(b.admissionBackpressureWaitMs,0);assert.equal(r.maxOverdueFollowingBatches,2);
 assert.equal(r.successfulDispatchMissedWholeInterval,3);assert.equal(r.dispatchedBatches,4);assert.equal(r.droppedBatches,0);assert.deepEqual(waits,[]);
});
test('waits until absolute target, rechecking early timer wakeup rather than completion plus interval',async()=>{
 let time=0,early=true;const waits=[];
 const p=createPacer({intervalMs:10,total:2,clock:()=>time,sleep:async ms=>{waits.push(ms);time+=early?ms-1:ms;early=false;}});
 const a=await p.before(0);p.dispatched(a,{firstRequestAt:0,successfulRequestAt:0,refusedAttempts:0});time=3;
 const b=await p.before(1);p.dispatched(b,{firstRequestAt:time,successfulRequestAt:time,refusedAttempts:0});
 assert.deepEqual(waits,[7,1]);assert.equal(b.successfulDispatchAtMainMs,10);assert.equal(p.result().successfulDispatchLateness.maxMs,0);
});
test('burst stays unpaced and rejects skipped or missing input',async()=>{
 let time=0;const p=createPacer({intervalMs:0,total:2,clock:()=>time,sleep:async()=>assert.fail('burst must not sleep')});
 await assert.rejects(p.before(1));const a=await p.before(0);p.dispatched(a,{firstRequestAt:0,successfulRequestAt:0,refusedAttempts:0});
 assert.throws(()=>p.result());time=2;const b=await p.before(1);p.dispatched(b,{firstRequestAt:2,successfulRequestAt:2,refusedAttempts:0});
 const r=p.result();assert.equal(r.mode,'burst');assert.equal(r.records[0].targetDeadlineAtMainMs,null);assert.equal(r.successfulDispatchLateness,undefined);
});
