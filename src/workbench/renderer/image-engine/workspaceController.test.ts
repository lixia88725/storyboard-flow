import {describe,it,expect} from 'vitest';
import {createImageWorkspaceController} from './workspaceController';
import type {ImageWorkspaceBootstrap,ImageWorkspaceBridge,ImageWorkspaceEvent,ImageWorkspaceFramePort,ImageWorkspaceOutcome,ImageWorkspaceRequest} from '../../../platform/contracts/imageWorkspace';
const owner={sessionId:'session',incarnation:'incarnation',workspaceEpoch:1};
const displayed={sessionId:'session',incarnation:'incarnation',documentId:'doc',workerEpoch:3,epoch:5};
const boot=():ImageWorkspaceBootstrap=>({snapshot:{owner,stateSeq:1,session:{sessionId:'session',incarnation:'incarnation',eventSeq:1,project:{schema:'storyboard-flow.project',version:2,id:'p',revision:0,name:'Test',shots:[],parkedShots:[],dialogues:[],images:{}},phase:'active',pending:0,undoDepth:0,redoDepth:0},context:{shotId:'shot',imageId:'img',layerId:'1',generation:1,selection:null,floating:null},images:{img:{imageId:'img',content:{kind:'source',source:{importId:'import',itemId:'item',interpretationId:'interpretation'}},availability:'editable',layers:[],activeLayerId:'1',contextGeneration:1,displayDocumentId:'doc',displayNative:null,displayIdentity:displayed}},files:{projectRootLabel:'Test',folderName:'Test',status:'current',savedRevision:0,outputPending:false,outputNames:[]}},capabilities:{commands:[],imageEdits:[],brushTips:['hard']},frames:{owner,nonce:'nonce',streamGeneration:1}});
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
 it('rejects stale and foreign snapshots and sends only intent with Main owner',async()=>{
  const h=setup();h.event({kind:'snapshot',snapshot:{...h.b.snapshot,stateSeq:99,owner:{...owner,incarnation:'other'}}});expect(h.controller.snapshot().stateSeq).toBe(1);
  await h.controller.request({kind:'undo'});expect(h.calls[0]).toEqual({owner,requestId:'ui-1',command:{kind:'undo'}});
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
