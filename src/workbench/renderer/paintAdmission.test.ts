import { describe, expect, it } from 'vitest';
import { canContinuePaint, type ContinuationState } from './paintAdmission';

const base: ContinuationState = {
  active: true, tool: 'brush', outputWork: false, savingTiff: false, gesture: false,
  otherRequests: 0, queuedTargets: ['shot/layer'], target: 'shot/layer',
};
const state = (patch: Partial<ContinuationState> = {}) => ({ ...base, ...patch });

describe('paint continuation admission', () => {
  it('lets both brush and eraser continue on the layer that is still painting', () => {
    expect(canContinuePaint(state({ tool: 'brush' }))).toBe(true);
    expect(canContinuePaint(state({ tool: 'eraser' }))).toBe(true);
  });

  it('never lets a structural tool take the shortcut', () => {
    expect(canContinuePaint(state({ tool: 'select' }))).toBe(false);
    expect(canContinuePaint(state({ tool: 'blur' }))).toBe(false);
  });

  it('refuses a different board or layer, so a new stroke cannot land on a stale asset', () => {
    expect(canContinuePaint(state({ target: 'other/layer' }))).toBe(false);
    expect(canContinuePaint(state({ target: 'shot/otherLayer' }))).toBe(false);
    expect(canContinuePaint(state({ queuedTargets: ['shot/layer', 'other/layer'] }))).toBe(false);
  });

  it('refuses while a non-paint request, a save or a layer gesture is pending', () => {
    expect(canContinuePaint(state({ otherRequests: 1 }))).toBe(false);
    expect(canContinuePaint(state({ gesture: true }))).toBe(false);
    expect(canContinuePaint(state({ outputWork: true }))).toBe(false);
    expect(canContinuePaint(state({ outputWork: true, savingTiff: true }))).toBe(true);
    // The save carve-out is the brush's alone: the eraser keeps refusing during output.
    expect(canContinuePaint(state({ tool: 'eraser', outputWork: true, savingTiff: true }))).toBe(false);
    expect(canContinuePaint(state({ active: false }))).toBe(false);
  });

  it('requires an in-flight paint to hand over to', () => {
    expect(canContinuePaint(state({ queuedTargets: [] }))).toBe(false);
  });
});
