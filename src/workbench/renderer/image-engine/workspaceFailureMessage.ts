import type {ImageWorkspaceFailure} from '../../../platform/contracts/imageWorkspace';

/** Translate presentation only; callers retain the original failure receipt. */
export function workspaceFailureMessage(error:ImageWorkspaceFailure|undefined):string|undefined {
  return error?.code==='stale-context'&&error.effect==='none'
    ? '编辑状态已更新，这次操作未执行；你的画稿没有因此被撤销。'
    : error?.message;
}
