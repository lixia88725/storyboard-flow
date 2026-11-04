import { describe, expect, it } from 'vitest';
import { beginBindingRead, canApplyBinding, settleBindingRead, type BindingRead } from './namingBindings';

const first = Symbol(), next = Symbol();
const names = [{ shotId: 'shot', name: 'a.tif' }];

describe('naming binding read', () => {
  it('stops applying as soon as a newer read starts, even if the old one was ready', () => {
    const ready = settleBindingRead(beginBindingRead(first), first, { names });
    expect(canApplyBinding(ready)).toBe(true);
    const rereading = beginBindingRead(next);
    expect(canApplyBinding(rereading)).toBe(false);
    expect(settleBindingRead(rereading, next, { error: '读取失败' })).toEqual({ status: 'error', token: next, message: '读取失败' });
    expect(canApplyBinding(settleBindingRead(rereading, next, { error: '读取失败' }))).toBe(false);
  });

  it('drops a late answer from a superseded read instead of publishing it', () => {
    const rereading = beginBindingRead(next);
    const late: BindingRead = settleBindingRead(rereading, first, { names });
    expect(late).toEqual({ status: 'loading', token: next });
    expect(canApplyBinding(late)).toBe(false);
  });

  it('replaces a failed read with a fresh ready state and clears the old error', () => {
    const failed = settleBindingRead(beginBindingRead(first), first, { error: '读取失败' });
    const retried = settleBindingRead(beginBindingRead(next), next, { names });
    expect(failed).toEqual({ status: 'error', token: first, message: '读取失败' });
    expect(retried).toEqual({ status: 'ready', token: next, names });
    expect(canApplyBinding(retried)).toBe(true);
  });
});
