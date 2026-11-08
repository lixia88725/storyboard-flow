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
