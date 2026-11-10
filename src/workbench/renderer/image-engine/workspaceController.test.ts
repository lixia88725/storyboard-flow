import {describe,it,expect} from 'vitest';
import {createImageWorkspaceController} from './workspaceController';
import type {ImageWorkspaceBootstrap,ImageWorkspaceBridge,ImageWorkspaceEvent,ImageWorkspaceFramePort,ImageWorkspaceOutcome,ImageWorkspaceRequest} from '../../../platform/contracts/imageWorkspace';
const owner={sessionId:'session',incarnation:'incarnation',workspaceEpoch:1};
const displayed={sessionId:'session',incarnation:'incarnation',documentId:'doc',workerEpoch:3,epoch:5};
const boot=():ImageWorkspaceBootstrap=>({snapshot:{owner,stateSeq:1,session:{sessionId:'session',incarnation:'incarnation',eventSeq:1,project:{schema:'storyboard-flow.project',version:2,id:'p',revision:0,name:'Test',shots:[],parkedShots:[],dialogues:[],images:{}},phase:'active',pending:0,undoDepth:0,redoDepth:0},context:{token:'context-1',shotId:'shot',imageId:'img',layerId:'1',generation:1,selection:null,floating:null},images:{img:{imageId:'img',content:{kind:'source',source:{importId:'import',itemId:'item',interpretationId:'interpretation'}},availability:'editable',layers:[{id:'1',parentId:null,name:'Paint',kind:'raster',visible:true,locked:false,opacity:1,blendMode:'normal',editable:true,capabilities:{paint:true,properties:true,structure:true}}],activeLayerId:'1',contextGeneration:1,displayDocumentId:'doc',displayNative:null,displayIdentity:displayed}},files:{projectRootLabel:'Test',folderName:'Test',status:'current',savedRevision:0,outputPending:false,outputNames:[]}},capabilities:{commands:[],imageEdits:[],brushTips:['hard']},frames:{owner,nonce:'nonce',streamGeneration:1}});
function setup(){
 const b=boot();let event!:(e:ImageWorkspaceEvent)=>void,attach!:(p:ImageWorkspaceFramePort)=>void;
 const calls:ImageWorkspaceRequest[]=[];
 const bridge:ImageWorkspaceBridge={bootstrap:async()=>b,request:async r=>{calls.push(r);return{kind:'settled',snapshot:{...b.snapshot,stateSeq:2},operationId:'op'} as ImageWorkspaceOutcome;},input:async()=>({kind:'rejected',error:{code:'test',message:'test',effect:'none'}}),waitOperation:async()=>({kind:'canceled',operationId:'x'}),subscribe:f=>{event=f;return()=>{};},connectFrames:async()=>{},onFramePort:f=>{attach=f;return()=>{};},thumbnail:async()=>({width:1,height:1,rgba:new Uint8Array(4)})};
 const controller=createImageWorkspaceController(bridge,b);
 const messages:unknown[]=[];
 const fake={onmessage:null as null|((e:{data:unknown})=>void),onmessageerror:null,start(){},postMessage(m:unknown){messages.push(m);},closed:false,close(){this.closed=true;}};
 const send=(data:object)=>fake.onmessage?.({data:{...b.frames,id:'message',...data}});
 const identity={sessionId:'session',incarnation:'incarnation',documentId:'doc',workerEpoch:3,epoch:5};
 const frame={...identity,frameSeq:1,baseFrameSeq:null,imageVersionRef:'v1',inputThrough:0,width:1,height:1,encoding:'srgb-rgba8-straight',tiles:[{x:0,y:0,w:1,h:1,offset:0,length:4}]};
 return{b,bridge,controller,calls,event:(e:ImageWorkspaceEvent)=>event(e),attach:()=>attach({...b.frames,port:fake as unknown as MessagePort}),fake,messages,send,identity,frame};
}
describe('readonly native workspace controller',()=>{
 it('shares thumbnail loads across surfaces and exposes exact immutable IDs synchronously',async()=>{
  const h=setup();let calls=0,finish!:(value:{width:number;height:number;rgba:Uint8Array})=>void;
  h.bridge.thumbnail=()=>{calls++;return new Promise(resolve=>{finish=resolve;});};
  const a=h.controller.thumbnail('version-a'),b=h.controller.thumbnail('version-a');
  expect(calls).toBe(1);expect(h.controller.cachedThumbnail('version-a')).toBeUndefined();
  finish({width:1,height:1,rgba:new Uint8Array([255,0,0,255])});await Promise.all([a,b]);
  expect(h.controller.cachedThumbnail('version-a')?.rgba).toEqual(new Uint8Array([255,0,0,255]));
  expect(h.controller.cachedThumbnail('version-b')).toBeUndefined();await h.controller.thumbnail('version-a');expect(calls).toBe(1);
  h.controller.dispose();expect(h.controller.cachedThumbnail('version-a')).toBeUndefined();
 });
 it('bounds thumbnail memory, rejects malformed pixels, and does not cache failed loads',async()=>{
  const h=setup();h.bridge.thumbnail=async()=>({width:512,height:512,rgba:new Uint8Array(512*512*4)});
  for(let i=0;i<33;i++)await h.controller.thumbnail('v'+i);
  expect(h.controller.cachedThumbnail('v0')).toBeUndefined();expect(h.controller.cachedThumbnail('v32')).toBeDefined();
  h.bridge.thumbnail=async()=>({width:2,height:2,rgba:new Uint8Array(1)});
  await expect(h.controller.thumbnail('bad')).rejects.toThrow('Invalid thumbnail');expect(h.controller.cachedThumbnail('bad')).toBeUndefined();
  h.bridge.thumbnail=async()=>({width:1,height:1,rgba:new Uint8Array(4)});
  await h.controller.thumbnail('bad');expect(h.controller.cachedThumbnail('bad')).toBeDefined();h.controller.dispose();
 });
 it('rejects stale and foreign snapshots and sends only intent with Main owner',async()=>{
  const h=setup();h.event({kind:'snapshot',snapshot:{...h.b.snapshot,stateSeq:99,owner:{...owner,incarnation:'other'}}});expect(h.controller.snapshot().stateSeq).toBe(1);
  await h.controller.request({kind:'undo'});expect(h.calls[0]).toEqual({owner,requestId:expect.stringMatching(/^ui-/),command:{kind:'undo'}});
  h.event({kind:'snapshot',snapshot:h.b.snapshot});expect(h.controller.snapshot().stateSeq).toBe(2);expect(h.controller.dispose()).toBe(true);
 });
 it('requires initialize, ACKs installed pixels, and conceals an old frame immediately on context change',()=>{
  const h=setup();h.attach();expect(h.messages[0]).toMatchObject({kind:'ready'});
  h.send({kind:'frame',header:h.frame,pixels:new Uint8Array([255,0,0,255])});expect(h.messages.at(-1)).toMatchObject({result:{ok:false,code:'needs-keyframe'}});
  h.send({kind:'initialize',identity:h.identity});h.send({kind:'frame',header:h.frame,pixels:new Uint8Array([255,0,0,255])});
  expect(h.controller.frames.view().readRegion()).toEqual(new Uint8Array([255,0,0,255]));expect(h.messages.at(-1)).toMatchObject({installed:{frameSeq:1,inputThrough:0}});
  h.event({kind:'snapshot',snapshot:{...h.b.snapshot,stateSeq:2,context:{...h.b.snapshot.context,imageId:'another',generation:6}}});expect(h.controller.frames.view().header).toBeNull();
  h.send({kind:'frame',header:{...h.frame,frameSeq:2},pixels:new Uint8Array(4)});expect(h.messages.at(-1)).toMatchObject({result:{ok:true}});expect(h.controller.frames.view().header).toBeNull();h.controller.dispose();
 });
 it('ignores old port messages after stream replacement and drops foreign nonce',()=>{
  const h=setup();h.attach();const old=h.fake.onmessage!;h.send({kind:'initialize',identity:h.identity,nonce:'foreign'});expect(h.messages.length).toBe(1);
  h.event({kind:'frameStream',identity:{...h.b.frames,nonce:'next',streamGeneration:2}});expect(h.fake.closed).toBe(true);
  old({data:{...h.b.frames,id:'old',kind:'initialize',identity:h.identity}});expect(h.controller.frames.view().header).toBeNull();expect(h.messages.length).toBe(1);h.controller.dispose();
 });
 it.each(['frame-first','snapshot-first'])('matches identity rather than cross-channel ordering: %s',order=>{
  const h=setup();h.attach();h.send({kind:'initialize',identity:h.identity});h.send({kind:'frame',header:h.frame,pixels:new Uint8Array([255,0,0,255])});
  const next={...h.identity,epoch:6};const snapshot={...h.b.snapshot,stateSeq:2,context:{...h.b.snapshot.context,generation:2},images:{...h.b.snapshot.images,img:{...h.b.snapshot.images.img,displayIdentity:next}}};
  const image=()=>{h.send({kind:'reset',identity:next});h.send({kind:'frame',header:{...h.frame,...next},pixels:new Uint8Array([0,0,255,255])});};
  if(order==='frame-first'){image();expect(h.controller.frames.view().header).toBeNull();h.event({kind:'snapshot',snapshot});}
  else{h.event({kind:'snapshot',snapshot});expect(h.controller.frames.view().header).toBeNull();image();}
  expect(h.controller.frames.view().readRegion()).toEqual(new Uint8Array([0,0,255,255]));h.controller.dispose();
 });

 it('clears only the acknowledged fault after recovery and preserves a newer failure',async()=>{
  const h=setup(),old={code:'old',message:'old failure',effect:'retained' as const},newer={code:'new',message:'new failure',effect:'unknown' as const};
  h.event({kind:'fault',owner,error:old});await h.controller.request({kind:'undo'});expect(h.controller.fault()).toBe(old);
  await h.controller.request({kind:'recover'});expect(h.controller.fault()).toBeUndefined();
  h.event({kind:'fault',owner,error:old});
  h.bridge.request=async()=>{h.event({kind:'fault',owner,error:newer});return{kind:'recovered',snapshot:{...h.b.snapshot,stateSeq:3},operationId:'recovery'};};
  await h.controller.request({kind:'recover'});expect(h.controller.fault()).toBe(newer);h.controller.dispose();
 });
 it('does not resume from a foreign bootstrap',async()=>{
  const h=setup();h.bridge.bootstrap=async()=>({...h.b,snapshot:{...h.b.snapshot,owner:{...owner,incarnation:'other'}}});
  await expect(h.controller.refreshSnapshot()).rejects.toThrow('归属');h.controller.dispose();
 });
 it.each(['canceled','short-original','complete'])('retains failed input until the entire original is archived: %s',async mode=>{
  const h=setup();
  h.bridge.input=async()=>{throw Error('lost reply');};
  const started=h.controller.capture.begin({shotId:'shot',layerId:'1',expectedContextGeneration:1},{tool:'brush',color:'#000000',size:4,opacity:1,softness:0},{x:1,y:2,pressure:1});
  if(!started.ok)throw Error('begin');
  h.controller.capture.append(started.id,[{x:2,y:3,pressure:.5}]);h.controller.capture.end(started.id);
  await h.controller.capture.waitTransportIdle();
  const record=h.controller.capture.records()[0];
  h.bridge.request=async request=>{
   expect(request.command.kind).toBe('resolveInput');
   if(request.command.kind!=='resolveInput')throw Error('command');
   expect(request.command.original.stroke.points).toEqual([1,2,2,3]);
   if(mode==='canceled')return{kind:'canceled',operationId:'resolution'};
   return {kind:'inputResolved',operationId:'resolution',captureId:record.captureId,snapshot:h.b.snapshot,
    operation:{operationId:'prefix',decision:'committed',inputThrough:1},original:{recordId:'retained',capturedThrough:mode==='short-original'?1:2}};
  };
  if(mode==='short-original')await expect(h.controller.resolveCaptured(record.captureId,'retainAndDiscard')).rejects.toThrow('整笔');
  else expect(await h.controller.resolveCaptured(record.captureId,'retainAndDiscard')).toBe(mode==='complete');
  expect(h.controller.capture.state().pending).toBe(mode==='complete'?0:1);
  expect(h.controller.dispose()).toBe(mode==='complete');
 });

 it('accepts a full snapshot at the display event sequence without losing project state',()=>{
  const h=setup();h.attach();const identity={...h.identity,epoch:6};
  h.send({kind:'initialize',identity});h.send({kind:'frame',header:{...h.frame,...identity},pixels:new Uint8Array([2,3,4,255])});
  h.event({kind:'display',owner,stateSeq:2,imageId:'img',displayIdentity:identity,displayNative:null});
  expect(h.controller.frames.view().readRegion()).toEqual(new Uint8Array([2,3,4,255]));
  h.event({kind:'snapshot',snapshot:{...h.b.snapshot,stateSeq:2,session:{...h.b.snapshot.session,undoDepth:9},images:{...h.b.snapshot.images,img:{...h.b.snapshot.images.img,displayIdentity:identity}}}});
  expect(h.controller.snapshot().session.undoDepth).toBe(9);expect(h.controller.frames.view().header).not.toBeNull();
  h.event({kind:'display',owner,stateSeq:1,imageId:'img',displayIdentity:h.identity,displayNative:null});
  expect(h.controller.frames.view().header).not.toBeNull();h.controller.dispose();
 });

 it('does not release another ongoing input pause when a transition fails',()=>{
  const h=setup();h.controller.setInputPause('output',true);h.controller.setInputPause('transition',true);
  h.controller.setInputPause('transition',false);expect(h.controller.capture.state().paused).toBe(true);
  h.controller.setInputPause('output',false);expect(h.controller.capture.state().paused).toBe(false);h.controller.dispose();
 });

});

it('returns the request identity before a lost transport reply, without retrying',async()=>{
 const h=setup();let count=0;h.bridge.request=async request=>{count++;expect(request.requestId).toMatch(/^ui-/);throw Error('lost');};
 const tracked=h.controller.requestTracked({kind:'undo'});expect(tracked.requestId).toMatch(/^ui-/);
 await expect(tracked.result).rejects.toThrow('lost');expect(count).toBe(1);h.controller.dispose();
});

it('does not reuse a request identity when a controller is recreated for the same Main owner',async()=>{const a=setup(),b=setup();const first=a.controller.requestTracked({kind:'undo'}),second=b.controller.requestTracked({kind:'undo'});expect(first.requestId).not.toBe(second.requestId);await Promise.all([first.result,second.result]);a.controller.dispose();b.controller.dispose();});

it('binds navigation to the context at admission rather than a later snapshot',async()=>{
 const h=setup();const first=h.controller.requestTracked({kind:'activateShot',shotId:'next'});
 h.event({kind:'snapshot',snapshot:{...h.b.snapshot,stateSeq:3,context:{...h.b.snapshot.context,token:'context-2'}}});
 await first.result;expect(h.calls[0].contextToken).toBe('context-1');
 await h.controller.request({kind:'activateShot',shotId:'third'});expect(h.calls[1].contextToken).toBe('context-2');
 expect(h.calls[0].requestId).not.toBe(h.calls[1].requestId);h.controller.dispose();
});

it('uses Main phase for input readiness and releases only the pause owned by a completed action',()=>{
 const h=setup();h.controller.setInputPause('output',true);
 h.event({kind:'snapshot',snapshot:{...h.b.snapshot,stateSeq:2,session:{...h.b.snapshot.session,phase:'recovering'}}});
 h.controller.setInputPause('output',false);expect(h.controller.capture.state().paused).toBe(true);
 h.controller.setInputPause('transition',true);
 h.event({kind:'snapshot',snapshot:{...h.b.snapshot,stateSeq:3}});expect(h.controller.capture.state().paused).toBe(true);
 h.controller.setInputPause('transition',false);expect(h.controller.capture.state().paused).toBe(false);
 h.event({kind:'snapshot',snapshot:{...h.b.snapshot,stateSeq:4,session:{...h.b.snapshot.session,phase:'frozen'}}});expect(h.controller.capture.state().paused).toBe(true);
 h.event({kind:'snapshot',snapshot:{...h.b.snapshot,stateSeq:5}});expect(h.controller.capture.state().paused).toBe(false);h.controller.dispose();
});

it('refuses a known protected layer before creating any captured input',()=>{
 const h=setup();
 h.event({kind:'snapshot',snapshot:{...h.b.snapshot,stateSeq:2,images:{img:{...h.b.snapshot.images.img,layers:h.b.snapshot.images.img.layers.map(l=>({...l,capabilities:{...l.capabilities,paint:false}}))}}}});
 const result=h.controller.capture.begin({shotId:'shot',layerId:'1',expectedContextGeneration:1},{tool:'brush',color:'#000000',size:4,opacity:1,softness:0},{x:1,y:2,pressure:1});
 expect(result).toMatchObject({ok:false});expect(h.controller.capture.records()).toEqual([]);expect(h.controller.dispose()).toBe(true);
});
it('refuses a stale concrete generation without retaining a new gesture',()=>{
 const h=setup();const result=h.controller.capture.begin({shotId:'shot',layerId:'1',expectedContextGeneration:0},{tool:'brush',color:'#000000',size:4,opacity:1,softness:0},{x:1,y:2,pressure:1});
 expect(result.ok).toBe(false);expect(h.controller.capture.state().pending).toBe(0);h.controller.dispose();
});
it('shares cold activation with the immediate first stroke and resolves its original board once',async()=>{
 const h=setup();h.event({kind:'snapshot',snapshot:{...h.b.snapshot,stateSeq:2,context:{...h.b.snapshot.context,shotId:'previous',layerId:null,generation:null}}});
 let release!:()=>void;const gate=new Promise<void>(r=>release=r);let activations=0;const inputs:unknown[]=[];
 h.bridge.request=async()=>{activations++;await gate;return{kind:'settled',operationId:'activate',snapshot:{...h.b.snapshot,stateSeq:3}};};
 h.bridge.input=async(_owner,input)=>{inputs.push(input);return{kind:'admitted',operationId:'stroke',inputThrough:1,durable:false};};h.bridge.waitOperation=async()=>({kind:'settled',operationId:'stroke',snapshot:{...h.b.snapshot,stateSeq:4}});
 const activation=h.controller.request({kind:'activateShot',shotId:'shot'});
 const b=h.controller.capture.begin({shotId:'shot',layerId:null,expectedContextGeneration:null},{tool:'brush',color:'#000000',size:4,opacity:1,softness:0},{x:1,y:2,pressure:1});if(!b.ok)throw Error();h.controller.capture.end(b.id);
 expect(inputs).toEqual([]);release();await activation;for(let n=0;n<30;n++)await Promise.resolve();
 expect(activations).toBe(1);expect(inputs[0]).toMatchObject({kind:'begin',shotId:'shot',layerId:'1',expectedContextGeneration:1});expect(h.controller.capture.state().pending).toBe(0);h.controller.dispose();
});

it('clears only its ordinary cold-layer refusal after paint becomes available',async()=>{
 const h=setup();
 h.event({kind:'snapshot',snapshot:{...h.b.snapshot,stateSeq:2,context:{...h.b.snapshot.context,shotId:'previous',layerId:null,generation:null}}});
 h.bridge.request=async()=>({kind:'settled',operationId:'activate',snapshot:{...h.b.snapshot,stateSeq:3,images:{img:{...h.b.snapshot.images.img,layers:h.b.snapshot.images.img.layers.map(l=>({...l,capabilities:{...l.capabilities,paint:false}}))}}}});
 const b=h.controller.capture.begin({shotId:'shot',layerId:null,expectedContextGeneration:null},{tool:'brush',color:'#000000',size:4,opacity:1,softness:0},{x:1,y:2,pressure:1});if(!b.ok)throw Error('Missing cold candidate');h.controller.capture.end(b.id);
 for(let n=0;n<40;n++)await Promise.resolve();expect(h.controller.fault()?.code).toBe('paint-layer-unavailable');expect(h.controller.capture.state().pending).toBe(0);
 h.event({kind:'snapshot',snapshot:{...h.b.snapshot,stateSeq:4}});expect(h.controller.fault()).toBeUndefined();
 const genuine={code:'write-failed',message:'retain',effect:'unknown' as const};h.event({kind:'fault',owner,error:genuine});h.event({kind:'snapshot',snapshot:{...h.b.snapshot,stateSeq:5}});expect(h.controller.fault()).toBe(genuine);h.controller.dispose();
});

it('pauses before capture for unfinished file output and resumes for ordinary unsaved changes',()=>{
 const h=setup();let inputs=0;h.bridge.input=async()=>{inputs++;throw Error('Must refuse before IPC');};
 h.event({kind:'snapshot',snapshot:{...h.b.snapshot,stateSeq:2,files:{...h.b.snapshot.files,status:'unfinished',outputPending:true}}});
 expect(h.controller.capture.state().paused).toBe(true);
 expect(h.controller.capture.begin({shotId:'shot',layerId:'1',expectedContextGeneration:1},{tool:'brush',color:'#000000',size:4,opacity:1,softness:0},{x:1,y:2,pressure:1}).ok).toBe(false);
 expect(inputs).toBe(0);expect(h.controller.capture.state().blocked).toBe(false);
 h.event({kind:'snapshot',snapshot:{...h.b.snapshot,stateSeq:3,files:{...h.b.snapshot.files,status:'pending',outputPending:true}}});
 expect(h.controller.capture.state().paused).toBe(false);expect(h.controller.dispose()).toBe(true);
});


it('coalesces rapid browsing to the latest target after the in-flight activation settles',async()=>{
 const h=setup();let release!:()=>void;const gate=new Promise<void>(r=>release=r);const sent:any[]=[];
 h.bridge.request=async req=>{sent.push(req);if(sent.length===1)await gate;return{kind:'settled',operationId:req.requestId,snapshot:{...h.b.snapshot,stateSeq:sent.length+2,context:{...h.b.snapshot.context,token:'navigation-'+sent.length}}};};
 const a=h.controller.request({kind:'activateShot',shotId:'one'});await Promise.resolve();
 const b=h.controller.request({kind:'activateShot',shotId:'two'}),c=h.controller.request({kind:'activateShot',shotId:'three'});
 release();await a;expect((await b).kind).toBe('canceled');await c;
 expect(sent.map(r=>r.command.shotId)).toEqual(['one','three']);expect(sent[1].contextToken).toBe('navigation-1');h.controller.dispose();
});
