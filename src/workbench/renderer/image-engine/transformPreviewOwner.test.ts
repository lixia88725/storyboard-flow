import {expect,it} from 'vitest';
import {createTransformPreviewOwner} from './transformPreviewOwner';
import type {ImageWorkspaceController} from './workspaceController';
import type {ImageWorkspaceCommand,ImageWorkspaceOutcome,ImageWorkspaceSnapshot} from '../../../platform/contracts/imageWorkspace';
const tick=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function fixture(){
 const native={storeId:'store',documentId:'10',versionId:'a'.repeat(64),manifestSha256:'b'.repeat(64),width:100,height:100};
 const owner={sessionId:'s',incarnation:'i',workspaceEpoch:1};
 const image={imageId:'img',displayNative:native,contextGeneration:1,layers:[{id:'1',visible:true,locked:false,capabilities:{paint:true,properties:true,structure:true}}]};
 const snapshot={owner,context:{shotId:'shot',imageId:'img',layerId:'1',generation:1},images:{img:image},session:{phase:'active',project:{shots:[{id:'shot',imageId:'img'}],parkedShots:[]}}} as unknown as ImageWorkspaceSnapshot;
 const calls:ImageWorkspaceCommand[]=[],pauses=new Set<string>();let callback:(command:ImageWorkspaceCommand)=>Promise<ImageWorkspaceOutcome>=async command=>{
  if(command.kind==='previewImageEdit')return{kind:'previewed',operationId:'op',displayIdentity:{sessionId:'s',incarnation:'i',documentId:'10',workerEpoch:1,epoch:2},stamp:{previewId:command.previewId,throughSeq:command.fromSeq,documentId:'10',workerEpoch:1,epoch:2,baseVersion:native.versionId,sourceContextGeneration:1,editDigest:'c'.repeat(64)}};
  if(command.kind==='cancelImagePreview')return{kind:'previewCanceled',operationId:'op',displayIdentity:{sessionId:'s',incarnation:'i',documentId:'10',workerEpoch:1,epoch:3}};
  return{kind:'settled',operationId:'op',snapshot};
 };
 const c={owner,snapshot:()=>snapshot,capabilities:{commands:['previewImageEdit','imageEdit','cancelImagePreview'],imageEdits:['transform']},capture:{state:()=>({pending:0,paused:pauses.size>0})},setInputPause:(reason:string,value:boolean)=>{value?pauses.add(reason):pauses.delete(reason);},request:async(command:ImageWorkspaceCommand)=>{calls.push(structuredClone(command));return callback(command);}} as unknown as ImageWorkspaceController;
 const edit=(x:number)=>({kind:'transform' as const,layerId:'1',selection:[{x:0,y:0},{x:10,y:0},{x:10,y:10}],matrix:[1,0,0,1,x,0] as const});
 return{c,image:snapshot.images.img,calls,pauses,edit,respond:(f:typeof callback)=>{callback=f;},owner:createTransformPreviewOwner(c)};
}
it('coalesces absolute moves and commits exactly once with the last preview stamp',async()=>{
 const h=fixture();h.owner.begin(h.image,h.edit(0));h.owner.update(h.edit(10));h.owner.update(h.edit(20));h.owner.finish();await h.owner.flush();
 expect(h.calls.filter(c=>c.kind==='previewImageEdit').length).toBe(2);
 const edits=h.calls.filter(c=>c.kind==='imageEdit');expect(edits).toHaveLength(1);expect(edits[0]).toMatchObject({edit:{matrix:[1,0,0,1,20,0]},preview:{throughSeq:2}});
 expect(h.pauses.size).toBe(0);expect(h.owner.busy()).toBe(false);
});
it('cancels an in-flight preview after its receipt without creating a history edit',async()=>{
 const h=fixture();h.owner.begin(h.image,h.edit(0));h.owner.cancel();await h.owner.flush();
 expect(h.calls.map(c=>c.kind)).toEqual(['previewImageEdit','cancelImagePreview']);expect(h.owner.busy()).toBe(false);
});
it('retains unknown preview and the complete last input until a matching original receipt',async()=>{
 const h=fixture();h.respond(async()=>{throw Error('reply lost');});h.owner.begin(h.image,h.edit(0));h.owner.update(h.edit(20));h.owner.finish();await tick();
 await expect(h.owner.flush()).rejects.toThrow('reply lost');expect(h.pauses.has('transform')).toBe(true);expect(h.calls).toHaveLength(1);
 h.respond(async command=>{if(command.kind!=='resolveImagePreview')throw Error('unexpected');return{kind:'previewStatus',operationId:'resolution',previewId:command.previewId,status:{state:'resolved',decision:'notCommitted',recordId:'saved-original',edit:command.original.edit,expectedNative:command.original.expectedNative,expectedContextGeneration:command.original.expectedContextGeneration}};});
 await h.owner.resolve('retainAndDiscard');expect(h.calls.at(-1)).toMatchObject({original:{edit:{matrix:[1,0,0,1,20,0]}}});expect(h.owner.busy()).toBe(false);
});
