import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,it,expect} from 'vitest';
import {NativeRefreshSheet,type RefreshPreviewView} from './NativeRefreshSheet';
const item={shotId:'a',name:'A.tif',location:'active' as const,change:'modified' as const,conflict:false,canUseExternal:true};
const html=(items:RefreshPreviewView['items'])=>renderToStaticMarkup(createElement(NativeRefreshSheet,{preview:{planId:'plan',revision:4,items},onConfirm:async()=>{},onCancel:()=>{}}));
describe('external picture choice',()=>{
 it('requires an explicit decision when both versions changed',()=>{
  const result=html([{...item,conflict:true}]);
  expect(result).toContain('value="" disabled="" selected=""');
  expect(result).toContain('class="primary" disabled=""');
  expect(result).toContain('Flow 和外部软件中都改过');
 });
 it('offers the external version by default only without conflict',()=>{
  const result=html([item]);expect(result).toContain('value="useExternal" selected=""');expect(result).not.toContain('class="primary" disabled=""');
 });
 it('does not offer unavailable external bytes for a missing file',()=>{
  const result=html([{...item,change:'missing',canUseExternal:false}]);
  expect(result).not.toContain('value="useExternal"');expect(result).toContain('value="keepFlow" selected=""');expect(result).toContain('下次保存时重建');
 });
});

import {NativeFileRecovery} from './NativeFileRecovery';
import type {ImageWorkspaceSnapshot} from '../../../platform/contracts/imageWorkspace';
const recoverySnapshot=(phase:'active'|'recovering'):ImageWorkspaceSnapshot=>({
 owner:{sessionId:'s',incarnation:'i',workspaceEpoch:1},stateSeq:1,
 session:{sessionId:'s',incarnation:'i',eventSeq:1,phase,pending:0,undoDepth:0,redoDepth:0,
 project:{schema:'storyboard-flow.project',version:2,id:'p',revision:0,name:'Test',shots:[],parkedShots:[],images:{},dialogues:[]}},
 context:{token:'t',shotId:null,imageId:null,layerId:null,generation:null,selection:null,floating:null},images:{},
 files:{projectRootLabel:'Test',folderName:'Test',status:'pending',savedRevision:null,outputPending:true,outputNames:[]}
});
const recoveryHtml=(snapshot:ImageWorkspaceSnapshot,inputBlocked=false)=>renderToStaticMarkup(createElement(NativeFileRecovery,{snapshot,inputBlocked,disabled:false,onRecover:async()=>{},onRetryImport:async()=>{}}));
it('does not turn routine pending output into a recovery alert',()=>{
 expect(recoveryHtml(recoverySnapshot('active'))).toBe('');
});
it('shows retained stroke recovery once, and preserves session recovery when no stroke control exists',()=>{
 expect(recoveryHtml(recoverySnapshot('recovering'),true)).toBe('');
 const result=recoveryHtml(recoverySnapshot('recovering'));
 expect(result).toContain('绘画状态需要核对');expect(result).not.toContain('有文件操作需要确认');expect(result).toContain('核对并恢复');
});
it('keeps actual source recovery visible while explaining why its action waits for the retained stroke',()=>{
 const snapshot=recoverySnapshot('recovering');snapshot.session.project.shots=[{id:'s',imageId:'im',name:'Board',scriptText:''}];
 snapshot.images={im:{imageId:'im',content:{kind:'source',source:{importId:'import',itemId:'item',interpretationId:'photocraft-v1'}},availability:'recoveryPending',displayDocumentId:null,displayNative:null,displayIdentity:null,layers:[],activeLayerId:null,contextGeneration:null}};
 const result=recoveryHtml(snapshot,true);expect(result).toContain('有文件操作需要确认');expect(result).toContain('disabled=""');expect(result).toContain('先处理上方待确认的笔迹');
});
