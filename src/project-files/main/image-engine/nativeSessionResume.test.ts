import {expect,it} from 'vitest';
import {temporaryWorkspace} from '../../../../test/temporaryWorkspace';
import {openImageProjectStore} from './projectStore';
import {openNativeProjectSession,type NativeSessionDriver} from '../../../session/core/nativeSession';
import type {ProjectV2} from '../../../platform/contracts/imageProject';
async function fixture(resume?:()=>Promise<void>){
 const root=await temporaryWorkspace('native-resume-'),store=await openImageProjectStore({root,writerAuthority:{assertHeld:async()=>{}},verifySource:async()=>{},verifyNative:async()=>{}}),project:ProjectV2={schema:'storyboard-flow.project',version:2,id:'p',revision:0,name:'Synthetic',shots:[],parkedShots:[],dialogues:[],images:{}};
 await store.commit(null,{schema:'flow.project-commit',version:1,commitId:'genesis',previousCommitHash:null,beforeRevision:null,after:project});let n=0;
 const driver:NativeSessionDriver={preparePaint:async()=>{throw Error('not used');},accept:async()=>{throw Error('not used');},status:async()=>({state:'absent'}),recoverAccept:async()=>{},discard:async()=>{},cancelPreview:async()=>{},install:async()=>{},freeze:async()=>{},close:async()=>{},...(resume?{resume}: {})};
 const session=await openNativeProjectSession({sessionId:'s',incarnation:'i',store,native:driver,mintId:()=>`op${++n}`,now:()=>0});return{session,store,driver};
}
it('keeps a frozen Main Session protected until the explicit native resume ACK, then accepts metadata without a new Undo step for resume',async()=>{
 let release!:()=>void,entered=false;const gate=new Promise<void>(r=>release=r),f=await fixture(async()=>{entered=true;await gate;});await f.session.request({kind:'freeze'});const resuming=f.session.request({kind:'resume'});for(let n=0;!entered&&n<100;n++)await new Promise(r=>setTimeout(r,1));expect(f.session.snapshot().phase).toBe('frozen');expect(f.session.snapshot().project.revision).toBe(0);release();expect((await resuming).kind).toBe('settled');expect(f.session.snapshot().phase).toBe('active');expect((await f.session.request({kind:'board',edit:{kind:'setProjectNaming',name:'renamed',naming:{sceneCode:'S',artistName:'A',version:'1'}}})).kind).toBe('settled');expect(f.session.snapshot().undoDepth).toBe(1);await f.session.request({kind:'freeze'});await f.session.close();
});
it('refuses missing resume capability and preserves frozen state',async()=>{
 const f=await fixture();await f.session.request({kind:'freeze'});expect(await f.session.request({kind:'resume'})).toMatchObject({kind:'rejected',error:{code:'unsupported',effect:'none'}});expect(f.session.snapshot().phase).toBe('frozen');await f.session.close();
});
it('unknown native resume remains recovering and rejects edits until explicit reconciliation, without changing the committed project',async()=>{
 const f=await fixture(async()=>{throw Object.assign(Error('native resume acknowledgement lost'),{effect:'unknown'});});await f.session.request({kind:'freeze'});expect((await f.session.request({kind:'resume'})).kind).toBe('rejected');expect(f.session.snapshot().phase).toBe('recovering');expect((await f.session.request({kind:'board',edit:{kind:'setProjectNaming',name:'must not commit',naming:{sceneCode:'S',artistName:'A',version:'1'}}})).kind).toBe('rejected');expect((await f.store.load())?.commit.after.revision).toBe(0);expect((await f.session.request({kind:'recover'})).kind).toBe('settled');expect(f.session.snapshot().phase).toBe('frozen');await f.session.close();
});
