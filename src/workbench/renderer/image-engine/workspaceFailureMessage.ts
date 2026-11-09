import type {ImageWorkspaceFailure} from '../../../platform/contracts/imageWorkspace';

/** Translate presentation only; callers retain the original failure receipt. */
export function workspaceFailureMessage(error:ImageWorkspaceFailure|undefined):string|undefined {
  if(error?.code==='pipeline-blocked')return '绘画连接需要恢复，本笔输入已保留。请先处理保留的笔迹，再继续绘画。';
  if(error?.message==='Reconcile the pending operation first')return '请先核对绘画状态；已保存画面和保留的输入不会因此被删除。';
  return error?.code==='stale-context'&&error.effect==='none'
    ? '编辑状态已更新，这次操作未执行；你的画稿没有因此被撤销。'
    : error?.message;
}
