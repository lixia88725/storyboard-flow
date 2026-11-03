import { describe, expect, it, vi } from "vitest";
import { startupRecoveryMode, startupResumeTarget } from "./workspaceAutoRestore";

describe("workspace auto restore", () => {
  it("resumes the most recent workspace on startup and after a reload", () => {
    expect(startupResumeTarget(["/work/a", "/work/b"])).toBe("/work/a");
  });

  it("resumes nothing when no workspace was opened before", () => {
    expect(startupResumeTarget([])).toBeUndefined();
  });
});

it('never probes or materializes anything in a browse-only startup source', async () => {
  const probe = vi.fn(async () => { throw new Error('would write a preview or script'); });
  const inspect = vi.fn(async () => ({ browse: true }));
  expect(await startupRecoveryMode('/old', { inspect, probe, isCurrent: () => true })).toBe('normal');
  expect(inspect).toHaveBeenCalledExactlyOnceWith('/old');
  expect(probe).not.toHaveBeenCalled();
});

it.each([
  [undefined, 'normal'],
  [new Error('Workspace protected by a recovery inventory'), 'recovery'],
  [new Error('Folder unavailable'), 'normal']
])('preserves current-project recovery routing: %s', async (error, mode) => {
  const probe = vi.fn(async () => { if (error) throw error; });
  expect(await startupRecoveryMode('/current', { inspect: async () => ({ browse: false }), probe, isCurrent: () => true })).toBe(mode);
  expect(probe).toHaveBeenCalledExactlyOnceWith('/current');
});

it('does not probe after the startup entry has been replaced', async () => {
  let current = true;
  const probe = vi.fn();
  expect(await startupRecoveryMode('/old', { inspect: async () => { current = false; return { browse: false }; }, probe, isCurrent: () => current })).toBe('superseded');
  expect(probe).not.toHaveBeenCalled();
});

it('does not publish a late protected result into a replacement entry', async () => {
  let current = true;
  expect(await startupRecoveryMode('/current', { inspect: async () => ({ browse: false }), probe: async () => { current = false; throw new Error('protected by a recovery inventory'); }, isCurrent: () => current })).toBe('superseded');
});

it('checks recovery on the actual managed project, never the original source', async () => {
  const probe = vi.fn(async () => { throw Error('protected by a recovery inventory'); });
  expect(await startupRecoveryMode('/old', { inspect: async () => ({ browse: false, editableFolderPath: '/old/.storyboard-flow-project' }), probe, isCurrent: () => true })).toBe('recovery');
  expect(probe).toHaveBeenCalledExactlyOnceWith('/old/.storyboard-flow-project');
});
