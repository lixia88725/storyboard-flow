// One absolute timeline for all synthetic batches. Slow consumers retain deadlines.
const assert = require('node:assert/strict');
const {stats}=require('./flow-image-engine-pipeline-metrics.cjs');
function createPacer({intervalMs,total,clock,sleep}) {
  assert.ok(Number.isInteger(intervalMs)&&intervalMs>=0&&intervalMs<=1000);
  assert.ok(Number.isSafeInteger(total)&&total>0);
  const origin=clock(),records=[];
  const overdue=(index,time)=>intervalMs===0?null:Math.max(0,Math.min(total-1,Math.floor((time-origin)/intervalMs))-index);
  const trace=()=>({mode:intervalMs===0?'burst':'absolute-deadline',intervalMs,originAtMainMs:origin,plannedBatches:total,records,
    definition:'Deadline = one origin + global batch index * interval, never rebased after retries, screenshots or oracle. Backlog is following scheduled batches already due; all retained in FIFO. Synthetic dispatch only, not physical input-to-photon.'});
  return {
    trace,
    async before(index) {
      assert.equal(index,records.length,'Every batch must retain FIFO order; no skipped/coalesced input');
      assert.ok(index<total);
      const target=intervalMs===0?null:origin+index*intervalMs;
      // Recheck because real timers may wake early. Never sleep relative to completion.
      while(target!==null&&clock()<target)await sleep(Math.max(1,target-clock()));
      const firstAttempt=clock(),record={index,targetDeadlineAtMainMs:target,firstAttemptAtMainMs:firstAttempt,
        firstAttemptLatenessMs:target===null?null:firstAttempt-target,overdueFollowingBatchesAtFirstAttempt:overdue(index,firstAttempt)};
      records.push(record);return record;
    },
    dispatched(record,{firstRequestAt,successfulRequestAt,refusedAttempts}) {
      assert.equal(records[record.index],record);
      assert.ok(firstRequestAt>=record.firstAttemptAtMainMs&&successfulRequestAt>=firstRequestAt);
      Object.assign(record,{firstRequestAtMainMs:firstRequestAt,successfulDispatchAtMainMs:successfulRequestAt,refusedAttempts,
        firstRequestLatenessMs:record.targetDeadlineAtMainMs===null?null:firstRequestAt-record.targetDeadlineAtMainMs,
        admissionBackpressureWaitMs:successfulRequestAt-firstRequestAt,
        successfulDispatchLatenessMs:record.targetDeadlineAtMainMs===null?null:successfulRequestAt-record.targetDeadlineAtMainMs,
        overdueFollowingBatchesAtDispatch:overdue(record.index,successfulRequestAt)});
    },
    result() {
      assert.equal(records.length,total,'No input may be dropped');
      assert.ok(records.every(r=>Number.isFinite(r.successfulDispatchAtMainMs)));
      const result={...trace(),dispatchedBatches:records.length,droppedBatches:0};
      if(intervalMs>0)Object.assign(result,{
        firstRequestLateness:stats(records.map(r=>r.firstRequestLatenessMs)),successfulDispatchLateness:stats(records.map(r=>r.successfulDispatchLatenessMs)),
        firstRequestLateOver1Ms:records.filter(r=>r.firstRequestLatenessMs>1).length,
        successfulDispatchLateOver1Ms:records.filter(r=>r.successfulDispatchLatenessMs>1).length,
        successfulDispatchMissedWholeInterval:records.filter(r=>r.successfulDispatchLatenessMs>=intervalMs).length,
        maxOverdueFollowingBatches:Math.max(...records.map(r=>r.overdueFollowingBatchesAtDispatch))});
      return result;
    }
  };
}
module.exports={createPacer};
