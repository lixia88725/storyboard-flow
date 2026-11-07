// Pure derivation from retained real traces; usable without starting Electron/native.
const assert = require('node:assert/strict');
function stats(values) {
  assert.ok(values.length > 0);
  assert.ok(values.every(v => Number.isFinite(v) && v >= 0), 'Invalid timing sample');
  const a = [...values].sort((a,b) => a-b), q = p => a[Math.ceil(a.length*p)-1];
  return {count:a.length,p50Ms:q(.5),p95Ms:q(.95),p99Ms:q(.99),maxMs:a.at(-1)};
}
function deriveTiming(report) {
  assert.equal(report.strokes.length, report.parameters.strokes);
  const perStroke = report.strokes.map(s => {
    assert.ok(s.samples.length > 0);
    const first=s.samples[0], last=s.samples.at(-1), down=s.firstSampleRequestedAtMainMs;
    return {operationId:s.operationId,
      refusedBeginAttempts:report.backpressure.filter(b => 'stroke-'+b.stroke === s.operationId).length,
      firstDownToBeginDispatchMs:first.requestAtMainMs-down,
      firstDownToBeginFrameMs:first.nativeFrameReceivedAtMainMs-down,
      firstDownToCanvasAckMs:first.dualCanvasInstalledAtAckMainMs-down,
      lastPointToCanvasAckMs:last.dualCanvasInstalledAtAckMainMs-last.requestAtMainMs,
      lastPointToNativeAcceptedMs:s.durableConfirmationAtMainMs-last.requestAtMainMs,
      firstDownToNativeAcceptedMs:s.durableConfirmationAtMainMs-down};
  });
  const metrics={};
  for (const k of Object.keys(perStroke[0]).filter(k => k.endsWith('Ms'))) metrics[k]=stats(perStroke.map(s=>s[k]));
  assert.equal(perStroke.reduce((sum,s)=>sum+s.refusedBeginAttempts,0),report.backpressure.length);
  return {definitions:{
    firstDown:'Main timestamp immediately before first synthetic down attempt; not a hardware event',
    firstDownToBeginDispatchMs:'Per-stroke cumulative admission wait, formerly budgetWaitMs: includes all refusal RTTs, poll/accept servicing and retry yields; excludes successful begin RTT',
    firstDownToBeginFrameMs:'Cumulative first-down admission wait plus successful native begin response; includes every admission retry',
    firstDownToCanvasAckMs:'First down through admission retries and successful begin frame installed on both Canvas; ACK includes independent pixel oracle',
    lastPointToCanvasAckMs:'Last synthetic point request through both Canvas installation and pixel-oracle ACK; earlier admission retries precede this interval',
    lastPointToNativeAcceptedMs:'Last synthetic point request through queued preparation and Main observation of native accepted; not Main Project Session/CAS durability',
    firstDownToNativeAcceptedMs:'Entire synthetic stroke from first down attempt through native accepted observation, including all retries',
    caveat:'Functional run under recorded concurrent load, synchronous command transport and per-frame oracle; not compositor/input-to-photon or stable latency benchmark'},
    refusedBeginAttempts:report.backpressure.length,metrics,perStroke};
}
module.exports={deriveTiming,stats};
if(require.main===module){
  const fs=require('node:fs');
  if(process.argv.length!==3)throw Error('Usage: node flow-image-engine-pipeline-metrics.cjs /absolute/result.json');
  process.stdout.write(JSON.stringify(deriveTiming(JSON.parse(fs.readFileSync(process.argv[2],'utf8'))),null,2)+'\n');
}
