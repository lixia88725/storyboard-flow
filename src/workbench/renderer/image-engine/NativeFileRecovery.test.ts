import {it,expect} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {NativeFileRecovery} from './NativeFileRecovery';
import type {ImageWorkspaceSnapshot} from '../../../platform/contracts/imageWorkspace';
const render=(status:ImageWorkspaceSnapshot['files']['status'],fileOperationActive=false)=>renderToStaticMarkup(createElement(NativeFileRecovery,{snapshot:{session:{phase:'active',project:{shots:[],parkedShots:[]}},images:{},files:{status,backgroundImports:[]}} as unknown as ImageWorkspaceSnapshot,disabled:fileOperationActive,fileOperationActive,onRecover:async()=>{},onRetryImport:async()=>{}}));
it('offers explicit file recovery for a reopened unfinished Save even when the legacy recovery field is absent',()=>{const html=render('unfinished');expect(html).toContain('核对并恢复');expect(html).toContain('有文件操作需要确认');});
it('does not call ordinary unsaved changes or an up-to-date folder a failure',()=>{expect(render('pending')).toBe('');expect(render('current')).toBe('');});
it('does not flash an unfinished-file warning during the live output operation',()=>{expect(render('unfinished',true)).toBe('');});
