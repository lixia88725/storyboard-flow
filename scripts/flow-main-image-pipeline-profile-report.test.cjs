const{test}=require('node:test'),assert=require('node:assert/strict');const{summarizeProfile,batchCsv}=require('./flow-main-image-pipeline-profile-report.cjs');
function fixture(){let id=0;const spans=[],add=(operationId,label,a,b,extra={})=>{const s={id:++id,operationId,label,phase:'paced',startedAtMainMs:a,endedAtMainMs:b,durationMs:b-a,status:'fulfilled',parentSpanId:null,...extra};spans.push(s);return s;};
 add('a','store.beginOperation',0,2);add('b','store.beginOperation',1,4);add('a','store.commit',10,20);add('b','store.commit',25,35);add('a','driver.pipeline.accept',21,22);add('b','driver.pipeline.accept',51,52);
 const batch=add(null,'store.confirmOperations',90,120,{batchId:'confirmation-1',operationIds:['a','b']});add(null,'fs.handle.sync',100,110,{parentSpanId:batch.id,batchId:batch.batchId,operationIds:['a','b'],category:'settlements-directory',path:'.storyboard-flow/image-project-v2/settlements'});
 return{confirmOperationsAvailable:true,profile:{enabled:true,spans},operations:[{phase:'paced',operationId:'a',endAtMainMs:0,finalConfirmedAtMainMs:121},{phase:'paced',operationId:'b',endAtMainMs:1,finalConfirmedAtMainMs:122}],progress:[{operationId:'a',stage:'prepared',atMainMs:3},{operationId:'b',stage:'prepared',atMainMs:5},{operationId:'a',stage:'nativeAccepted',atMainMs:50},{operationId:'b',stage:'nativeAccepted',atMainMs:80}],confirmationBatches:[{batchId:batch.batchId,operationIds:['a','b'],status:'fulfilled',startedAtMainMs:90,endedAtMainMs:120}]};
}
test('allows next CAS before previous accepted/confirmation and counts shared batch service once',()=>{
 const s=summarizeProfile(fixture());assert.equal(s.rows.length,2);assert.equal(s.rows[1].api.commit.endedAtMainMs,35);assert.equal(s.rows[0].nativeAcceptedAtMainMs,50);
 assert.equal(s.rows[1].commitCallEndToAcceptCallStartMs,16);assert.equal(s.batches.length,1);const rank=s.apiRanking.find(g=>g.api.startsWith('confirmOperations'));assert.equal(rank.count,1);assert.equal(rank.totalInclusiveMs,30);assert.equal(s.rows[0].confirmationBatchId,s.rows[1].confirmationBatchId);assert.equal(batchCsv(s).trim().split('\n').length,2);
});
test('rejects CAS/accept FIFO violation and refuses final markers earlier than durable batch return',()=>{
 const a=fixture();a.profile.spans.find(s=>s.operationId==='b'&&s.label==='store.commit').startedAtMainMs=15;assert.throws(()=>summarizeProfile(a));
 const b=fixture();b.profile.spans.find(s=>s.operationId==='b'&&s.label==='driver.pipeline.accept').startedAtMainMs=40;assert.throws(()=>summarizeProfile(b));
 const c=fixture();c.operations[0].finalConfirmedAtMainMs=60;assert.throws(()=>summarizeProfile(c));const d=fixture();delete d.operations[0].finalConfirmedAtMainMs;assert.throws(()=>summarizeProfile(d));
});
