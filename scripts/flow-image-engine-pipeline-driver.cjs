// Dedicated native/display protocol fixture. No product entry, project CAS or personal data.
const {app,BrowserWindow,MessageChannelMain,clipboard,shell,session}=require('electron');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{createHash}=require('node:crypto'),{pathToFileURL}=require('node:url');
const {deriveTiming,stats}=require('./flow-image-engine-pipeline-metrics.cjs');
const repo=process.env.FLOW_PIPELINE_REPO,run=process.env.FLOW_PIPELINE_RUN,binary=process.env.FLOW_PIPELINE_HOST;
const temp=fs.realpathSync(require('node:os').tmpdir());
if(!run||path.dirname(run)!==temp||!path.basename(run).startsWith('flow-image-engine-pipeline-')||fs.realpathSync(run)!==run||!path.isAbsolute(repo)||!path.isAbsolute(binary))throw Error('Owned canonical temp paths required');
for(const k of Object.keys(clipboard))if(typeof clipboard[k]==='function')clipboard[k]=()=>{throw Error('Clipboard prohibited');};
shell.trashItem=()=>{throw Error('Trash prohibited');};shell.openExternal=()=>{throw Error('External launch prohibited');};
app.setPath('userData',path.join(run,'profile'));app.setPath('sessionData',path.join(run,'profile'));app.setAppLogsPath(path.join(run,'profile','logs'));
app.commandLine.appendSwitch('disable-background-networking');
const size=Number(process.env.FLOW_PIPELINE_SIZE??2048),ioDelay=Number(process.env.FLOW_PIPELINE_IO_DELAY_MS??0);
if(![2048,4096].includes(size)||!Number.isInteger(ioDelay)||ioDelay<0||ioDelay>20)throw Error('Invalid synthetic pipeline parameters');
process.env.FLOW_IMAGE_ENGINE_TEST_IO_DELAY_MS=String(ioDelay);
const {startImageEngine}=require(path.join(run,'connection.cjs'));
const now=()=>performance.now(),startedAt=now(),elapsed=()=>now()-startedAt;
const report={completed:false,error:null,binary,source:JSON.parse(fs.readFileSync(path.join(run,'connection-source.json'),'utf8')),platform:process.platform,versions:process.versions,
  concurrentLoad:'Chief 97-file/4GB single-worker full suite and native build may overlap this functional acceptance. Timing samples are diagnostic, not a stable latency benchmark.',
  scope:'Real native pipeline → owned Node connection → real MessagePort → two Canvas projections. Native durable acceptance only; no Main Project Session/checkpoint/CAS certification.',
  parameters:{size,strokes:40,ioDelayPerPublicationMs:ioDelay,pendingLimit:4,viewports:['1x clipped to 512 CSS pixels','2x clipped to 512 CSS pixels']},calls:[],frames:[],strokes:[],events:[],acceptDecisions:[],screenshots:[],backpressure:[],
  timingMeaning:{sampleRequestAtMainMs:'Synthetic command dispatch, not hardware input acquisition',nativeFrameReceivedAtMainMs:'Decoded native response received by Main',
    dualCanvasInstalledAtAckMainMs:'Main observed renderer ACK after both synchronous Canvas writes AND independent pixel verification; not compositor/physical presentation',
    displayMs:'Renderer synchronous FrameStore and both Canvas writes, excludes following oracle verificationMs',durableConfirmationAtMainMs:'Main observed native accepted event; not project CAS/Save',
    screenshotMs:'capturePage after selected ACKs; independent compositor capture completion, not physical tip latency'}};
let win,port,client,envelope=null,acceptedVersion=null,pipelineId,identity=null,nativeClosed=false,portSeq=0,pollSeq=0;
const acks=new Map(),entries=new Map(),order=[],preparedOrder=[],acceptedOrder=[];
const evaluate=(name,...args)=>win.webContents.executeJavaScript(`PipelineHarness.${name}(...${JSON.stringify(args)})`);
const identityOf=h=>Object.fromEntries(['sessionId','incarnation','documentId','workerEpoch','epoch'].map(k=>[k,h[k]]));
function post(message){const id='display-'+ ++portSeq,start=elapsed();return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{acks.delete(id);reject(Error('Display timeout '+id));},10000);acks.set(id,data=>{clearTimeout(timer);resolve({...data,sentAtMainMs:start,ackAtMainMs:elapsed()});});port.postMessage({...message,id});});}
async function display(operationId,h,payload,receivedAt){
 const next=identityOf(h);if(!identity)assert.equal((await post({kind:'initialize',identity:next})).result.ok,true);else if(JSON.stringify(identity)!==JSON.stringify(next))assert.equal((await post({kind:'reset',identity:next})).result.ok,true);identity=next;
 const ack=await post({kind:'frame',header:h,pixels:Uint8Array.from(payload)});assert.equal(ack.result.ok,true,JSON.stringify(ack));
 const f={operationId,frameSeq:h.frameSeq,baseFrameSeq:h.baseFrameSeq,epoch:h.epoch,pipelineId:h.pipelineId,imageVersionRef:h.imageVersionRef,pendingOperationIds:h.pendingOperationIds,
  workingHeadOperationId:h.workingHeadOperationId,inputThrough:h.inputThrough,payloadBytes:payload.length,nativeFrameReceivedAtMainMs:receivedAt,
  dualCanvasInstalledAtAckMainMs:ack.ackAtMainMs,portRoundTripWithVerificationMs:ack.ackAtMainMs-ack.sentAtMainMs,displayMs:ack.displayMs,verificationMs:ack.verificationMs,
  rendererFrameReceivedUnixMs:ack.rendererFrameReceivedUnixMs,rendererCanvasInstalledUnixMs:ack.rendererCanvasInstalledUnixMs};
 report.frames.push(f);return f;
}
async function call(operationId,body,{base=envelope,allowFailure=false,sample=false}={}){
 const requestAt=elapsed();const wire=await client.request(operationId,body,base);const receivedAt=elapsed(),reply=wire.header.body;
 report.calls.push({operationId,command:body.kind,sampleRequest:sample,requestAtMainMs:requestAt,nativeResponseReceivedAtMainMs:receivedAt,nativeRoundTripMs:receivedAt-requestAt,reply:reply.kind});
 if(!allowFailure)assert.notEqual(reply.kind,'failure',JSON.stringify(reply));
 let frame;if(reply.kind==='frame')frame=await display(operationId,reply.frame,wire.payload,receivedAt);
 return{reply,payload:wire.payload,requestAt,receivedAt,frame};
}
async function pump({acceptLast=true}={}){
 const {reply:s}=await call('poll-'+ ++pollSeq,{kind:'pipelinePoll',pipelineId});assert.equal(s.kind,'pipelineState');assert.equal(s.blocked,null,JSON.stringify(s));assert.ok(s.queueDepth<=4);
 report.queuePeak=Math.max(report.queuePeak??0,s.queueDepth);
 for(const event of s.events){const t=elapsed(),e=entries.get(event.operationId),r=event.result;assert.ok(e,'unknown pipeline completion '+event.operationId);report.events.push({operationId:event.operationId,kind:r.kind,observedAtMainMs:t});
  if(r.kind==='prepared'){assert.ok(!e.prepared);assert.equal(event.operationId,order[preparedOrder.length],'prepare FIFO');preparedOrder.push(event.operationId);e.prepared=r;e.preparedObservedAtMainMs=t;}
  else if(r.kind==='accepted'){assert.ok(e.acceptRequestedAtMainMs!==undefined&&!e.accepted);assert.equal(event.operationId,order[acceptedOrder.length],'accept FIFO');assert.equal(r.receipt.versionId,e.prepared.receipt.versionId);acceptedOrder.push(event.operationId);e.accepted=r;e.durableConfirmationAtMainMs=t;acceptedVersion=r.receipt.versionId;}
  else throw Error('Native pipeline failed '+JSON.stringify(event));
 }
 for(const op of order){const e=entries.get(op);if(e.accepted)continue;
  if(e.prepared&&e.acceptRequestedAtMainMs===undefined&&(acceptLast||op!=='stroke-39')){
   assert.equal(e.prepared.baseVersion,acceptedVersion,'native candidate must extend accepted prefix');
   e.acceptRequestedAtMainMs=elapsed();
   // Test-only native acceptance decision. No project CAS record or fake project durability.
   report.acceptDecisions.push({operationId:op,baseVersion:acceptedVersion,atMainMs:e.acceptRequestedAtMainMs,scope:'native protocol acceptance only'});
   const {reply}=await call('accept-'+op,{kind:'accept',candidateId:op},{base:acceptedVersion});assert.equal(reply.kind,'acceptQueued');assert.equal(reply.durable,false);
  }break;
 }
 return s;
}
async function summary(){const s=await evaluate('summary',[{x:220,y:200},{x:260,y:200}]);for(const r of s.rasters)assert.equal(r.hash,s.referenceHash,'full Canvas must match native patch reference');return s;}
async function screenshot(label,point){const s=await summary(),p=s.probes.find(p=>p.x===point.x&&p.y===point.y);await evaluate('swatch',p.rgba);
 await Promise.race([win.webContents.executeJavaScript('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))'),new Promise((_,reject)=>setTimeout(()=>reject(Error('CSS reference paint opportunity timeout')),3000))]);
 const referenceStyle=await win.webContents.executeJavaScript("getComputedStyle(document.getElementById('reference')).backgroundColor");const start=elapsed();const png=(await win.webContents.capturePage(undefined,{stayHidden:true})).toPNG(),screenshotMs=elapsed()-start;fs.writeFileSync(path.join(run,label+'.png'),png);
 const sharp=(await import(pathToFileURL(path.join(repo,'node_modules/sharp/lib/index.js')).href)).default,{data,info}=await sharp(png).ensureAlpha().raw().toBuffer({resolveWithObject:true}),scale=info.width/await win.webContents.executeJavaScript('innerWidth');
 const css=Array.from(data.subarray((Math.floor(340*scale)*info.width+Math.floor(580*scale))*4,(Math.floor(340*scale)*info.width+Math.floor(580*scale))*4+3)),samples=[];
 for(const r of s.rasters){const x=Math.floor((r.rect.x+(p.x+.5)*r.rect.width/size)*scale),y=Math.floor((r.rect.y+(p.y+.5)*r.rect.height/size)*scale),actual=Array.from(data.subarray((y*info.width+x)*4,(y*info.width+x)*4+3));actual.forEach((v,c)=>assert.ok(Math.abs(v-css[c])<=1,label+' screen differs from independent same-RGBA CSS reference: '+actual+'/'+css));samples.push({surface:r.id,actual});}
 report.screenshots.push({label,screenshotMs,sourceRgba:p.rgba,cssReference:css,referenceStyle,samples,scope:'same RGBA/background compositor comparison; not opaque sRGB premix equivalence'});return s;}
(async()=>{
 await app.whenReady();session.defaultSession.webRequest.onBeforeRequest({urls:['http://*/*','https://*/*']},(_d,cb)=>cb({cancel:true}));session.defaultSession.setPermissionRequestHandler((_w,_p,cb)=>cb(false));
 win=new BrowserWindow({show:false,width:1100,height:600,webPreferences:{preload:path.join(run,'preload.cjs'),sandbox:true,contextIsolation:true,nodeIntegration:false,backgroundThrottling:false}});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());
 await win.loadFile(path.join(run,'index.html'));await evaluate('ready','owned-pipeline-port');const channel=new MessageChannelMain();port=channel.port1;
 const ready=new Promise(resolve=>port.on('message',({data})=>{if(data.kind==='ready')resolve();const finish=acks.get(data.id);if(finish){acks.delete(data.id);finish(data);}}));port.start();win.webContents.postMessage('pipeline-port',{nonce:'owned-pipeline-port'},[channel.port2]);await Promise.race([ready,new Promise((_,reject)=>setTimeout(()=>reject(Error('Port startup timeout')),8000))]);
 client=startImageEngine({binary,store:path.join(run,'native-store'),sessionId:'pipeline-display-synthetic',incarnation:'pipeline-electron-one',budgetBytes:512*1024*1024});report.nativePid=client.pid;report.workerEpoch=await client.ready;assert.equal(client.supports('strokePipelineV1'),true);
 const sharp=(await import(pathToFileURL(path.join(repo,'node_modules/sharp/lib/index.js')).href)).default,png=await sharp({create:{width:size,height:size,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).png().toBuffer();
 assert.equal((await client.request('open',{kind:'open',source:{digest:createHash('sha256').update(png).digest('hex'),byteLength:png.length,formatHint:'png'}},null,png)).header.body.kind,'prepared');
 const opened=await call('accept-open',{kind:'accept',candidateId:'open'});envelope=opened.reply.receipt.versionId;acceptedVersion=envelope;
 const start=await call('pipeline-start',{kind:'pipelineStart',maxPendingStrokes:4,maxPendingPoints:65536,maxRetainedPixelBytes:256*1024*1024});assert.equal(start.reply.kind,'pipelineReady');pipelineId=start.reply.pipelineId;assert.equal(start.reply.anchorVersion,envelope);
 await call('capture-start',{kind:'capture'});
 for(let i=0;i<40;i++){
  const previewId='preview-'+i,op='stroke-'+i,erase=i%4===3,firstAt=elapsed(),predecessor=i?'stroke-'+(i-1):null;
  const brush={size:24,opacity:erase?1:.5,flow:1,hardness:1,spacing:.1,seed:i+1,erase,color:'#ff0000'},xs=erase?[250,255,260,265,260,255,250]:[200,240,280,320,280,240,200];
  let begin,tries=0;
  for(;;){begin=await call('begin-'+i,{kind:'strokeBegin',previewId,predecessorOperationId:predecessor,brush,points:[{x:xs[0],y:200,pressure:1}]},{allowFailure:true,sample:true});
   if(begin.reply.kind==='frame')break;assert.equal(begin.reply.error.code,'backpressure',JSON.stringify(begin.reply));report.backpressure.push({stroke:i,atMainMs:elapsed(),reply:begin.reply});await pump();if(++tries>1000)throw Error('Admission did not recover');await new Promise(r=>setTimeout(r,1));}
  const trace={operationId:op,erase,firstSampleRequestedAtMainMs:firstAt,admittedSampleAtMainMs:begin.requestAt,budgetWaitMs:begin.requestAt-firstAt,
   previousStrokeStillPendingAtNative:begin.reply.frame.pendingOperationIds.length>0,samples:[{fromSeq:1,requestAtMainMs:begin.requestAt,nativeFrameReceivedAtMainMs:begin.receivedAt,dualCanvasInstalledAtAckMainMs:begin.frame.dualCanvasInstalledAtAckMainMs}]};
  for(let n=1;n<xs.length;n++){const step=await call('append-'+i+'-'+n,{kind:'strokeAppend',previewId,fromSeq:n+1,points:[{x:xs[n],y:200,pressure:1}]},{sample:true});trace.samples.push({fromSeq:n+1,requestAtMainMs:step.requestAt,nativeFrameReceivedAtMainMs:step.receivedAt,dualCanvasInstalledAtAckMainMs:step.frame.dualCanvasInstalledAtAckMainMs});}
  const end=await call(op,{kind:'strokeFinish',previewId,throughSeq:7});assert.equal(end.reply.kind,'queued');assert.equal(end.reply.durable,false);assert.equal(end.reply.pipelineId,pipelineId);assert.equal(end.reply.predecessorOperationId,predecessor);
  const e={...trace,endRequestedAtMainMs:end.requestAt,volatileQueuedAtMainMs:end.receivedAt};entries.set(op,e);order.push(op);
  if(i===0){const s=await screenshot('first-half-opacity',{x:220,y:200});assert.ok(s.probes[0].rgba[3]>=127&&s.probes[0].rgba[3]<=128);}
  if(i===1){const p=await evaluate('probes',[{x:220,y:200}]);e.overlapAlpha=p[0].rgba[3];assert.ok(p[0].rgba[3]>=190&&p[0].rgba[3]<=192,'separate half-opacity strokes compound');}
  if(erase){const p=await evaluate('probes',[{x:260,y:200}]);e.erasedAlpha=p[0].rgba[3];assert.equal(p[0].rgba[3],0,'eraser clears overlapping centre');}
  await pump({acceptLast:false});
 }
 const volatile=await screenshot('volatile-40-strokes',{x:220,y:200});assert.ok(volatile.header.pendingOperationIds.length>0);report.volatileHash=volatile.referenceHash;
 const freeze=await call('freeze-pending',{kind:'freeze'},{allowFailure:true});assert.equal(freeze.reply.kind,'failure');assert.equal(freeze.reply.error.code,'busy');report.freezeBeforeDrain=freeze.reply;
 const refused=await call('after-freeze-begin',{kind:'strokeBegin',previewId:'refused',predecessorOperationId:'stroke-39',brush:{size:24,opacity:.5,seed:99,color:'#ff0000'},points:[{x:200,y:200,pressure:1}]},{allowFailure:true});assert.equal(refused.reply.kind,'failure');assert.equal(refused.reply.error.code,'frozen');
 const deadline=Date.now()+90000;while(acceptedOrder.length<40){await pump();assert.ok(Date.now()<deadline,'native obligations did not drain');await new Promise(r=>setTimeout(r,1));}await pump();
 const durable=await call('capture-durable',{kind:'capture'});assert.deepEqual(durable.reply.frame.pendingOperationIds,[]);assert.equal(durable.reply.frame.imageVersionRef,acceptedVersion);
 assert.equal(createHash('sha256').update(durable.payload).digest('hex'),report.volatileHash,'volatile cumulative pixels equal native durable full capture');const done=await summary();assert.equal(done.referenceHash,report.volatileHash);
 fs.writeFileSync(path.join(run,'final-native.rgba'),durable.payload);fs.writeFileSync(path.join(run,'final-native-frame.json'),JSON.stringify(durable.reply.frame,null,2));
 assert.deepEqual(acceptedOrder,order);assert.deepEqual(preparedOrder,order);report.crossStrokeBeforeDurableConfirmed=order.filter(op=>entries.get(op).previousStrokeStillPendingAtNative).length;assert.ok(report.crossStrokeBeforeDurableConfirmed>0,'test must exercise actual overlapping in-flight strokes');
 const stop=await call('pipeline-stop',{kind:'pipelineStop',pipelineId});assert.equal(stop.reply.kind,'pipelineStopped');envelope=acceptedVersion;
 await call('capture-settled',{kind:'capture'});const settled=await screenshot('settled-40-strokes',{x:220,y:200});assert.equal(settled.referenceHash,report.volatileHash,'pipelineStop epoch change preserves pixels');assert.equal((await call('freeze-settled',{kind:'freeze'})).reply.kind,'frozen');assert.equal((await call('close',{kind:'close'})).reply.kind,'closed');report.nativeExit=await client.exited;assert.equal(report.nativeExit.code,0);nativeClosed=true;
 report.strokes=order.map(op=>entries.get(op));report.preparedOrder=preparedOrder;report.acceptedOrder=acceptedOrder;report.finalVersion=acceptedVersion;report.verification={framesChecked:settled.framesChecked,channelsChecked:settled.channelsChecked,fullReferenceSha256:settled.referenceHash,canvasHashes:settled.rasters.map(r=>r.hash)};
 report.statistics={sampleToNativeFrame:stats(report.calls.filter(c=>c.sampleRequest&&c.reply==='frame').map(c=>c.nativeRoundTripMs)),firstAttemptToCanvasAckIncludingBackpressureAndOracle:stats(report.strokes.map(s=>s.samples[0].dualCanvasInstalledAtAckMainMs-s.firstSampleRequestedAtMainMs)),sampleToCanvasAckIncludingOracle:stats(report.strokes.flatMap(s=>s.samples.map(p=>p.dualCanvasInstalledAtAckMainMs-p.requestAtMainMs))),
  rendererInstall:stats(report.frames.map(f=>f.displayMs)),pixelOracle:stats(report.frames.map(f=>f.verificationMs)),endToVolatileQueued:stats(report.strokes.map(e=>e.volatileQueuedAtMainMs-e.endRequestedAtMainMs)),endToNativeAcceptedConfirmation:stats(report.strokes.map(e=>e.durableConfirmationAtMainMs-e.endRequestedAtMainMs)),budgetWait:stats(report.strokes.map(e=>e.budgetWaitMs))};
 report.cumulativeTiming=deriveTiming(report);
 report.projectDurabilityCertified=false;report.nativeDiagnostics=client.diagnostics();await evaluate('dispose');report.completed=true;
})().catch(error=>{report.error=String(error.stack||error);console.error(report.error);}).finally(async()=>{if(client&&!nativeClosed){client.terminateOwnedProcess();report.nativeExit=await client.exited;report.nativeDiagnostics=client.diagnostics();}fs.writeFileSync(path.join(run,'result.json'),JSON.stringify(report,null,2));port?.close();if(win&&!win.isDestroyed())win.destroy();app.exit(report.error?1:0);});
