import { describe, expect, it, vi } from 'vitest';
import { blockFolderPreviewShortcut, createFolderImageImportController } from './folderImageImportController';

const folder = { folderPath: '/old', files: ['one.tiff'], browse: true };
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; };
const fixture = () => {
  const copy = vi.fn(async (_source: string) => ({ folderPath: '/new', count: 1 }));
  const open = vi.fn(async (_target: string) => true);
  const controller = createFolderImageImportController({ copy, open }, vi.fn());
  controller.show(folder);
  return { controller, copy, open };
};

describe('Import from an inline folder preview', () => {
  it('only copies on Import and publishes the converted destination after completion', async () => {
    const { controller, copy, open } = fixture();
    expect(copy).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
    await controller.importImages();
    expect(copy).toHaveBeenCalledExactlyOnceWith('/old');
    expect(open).toHaveBeenCalledExactlyOnceWith('/new', true);
    expect(controller.read()).toEqual({ busy: false, message: '' });
  });
  it('cancelled destination selection keeps the preview and does not open a project', async () => {
    const open = vi.fn(), copy = vi.fn(async () => undefined);
    const controller = createFolderImageImportController({ copy, open }, vi.fn());
    controller.show(folder); await controller.importImages();
    expect(open).not.toHaveBeenCalled();
    expect(controller.read()).toMatchObject({ folder, busy: false });
    expect(controller.read().message).toContain('已取消');
  });
  it('refuses duplicate clicks and switches until copy and staging Import have both settled', async () => {
    const { controller, copy, open } = fixture();
    const copying = deferred<{ folderPath: string; count: number }>();
    const importing = deferred<boolean>();
    copy.mockReturnValueOnce(copying.promise); open.mockReturnValueOnce(importing.promise);
    const pending = controller.importImages();
    await controller.importImages(); expect(copy).toHaveBeenCalledTimes(1);
    expect(controller.show(undefined)).toBe(false);
    expect(controller.show({ ...folder, folderPath: '/other' })).toBe(false);
    copying.resolve({ folderPath: '/new', count: 1 });
    await vi.waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(controller.read()).toMatchObject({ folder, busy: true });
    expect(controller.show(undefined)).toBe(false);
    importing.resolve(true); await pending;
    expect(controller.read().folder).toBeUndefined();
  });
  it('retains the prepared destination for retry after a refused staging Import', async () => {
    const { controller, copy, open } = fixture();
    open.mockResolvedValueOnce(false); await controller.importImages();
    expect(controller.read()).toMatchObject({ folder, busy: false });
    expect(controller.read().message).toContain('/new');
    await controller.importImages();
    expect(copy).toHaveBeenCalledTimes(1); expect(open.mock.calls).toEqual([['/new', true], ['/new', true]]);
  });
  it('keeps partial-copy errors visible and never publishes failed preparation', async () => {
    const { controller, copy, open } = fixture();
    copy.mockRejectedValueOnce(new Error('Partial copies retained at /partial'));
    await controller.importImages(); expect(open).not.toHaveBeenCalled();
    expect(controller.read()).toEqual({ folder, busy: false, message: 'Partial copies retained at /partial' });
  });
  it('never borrows a prepared destination from a previous source', async () => {
    const { controller, copy, open } = fixture();
    open.mockRejectedValueOnce(new Error('failed')); await controller.importImages();
    controller.show({ ...folder, folderPath: '/other' });
    copy.mockResolvedValueOnce({ folderPath: '/other-new', count: 1 });
    await controller.importImages();
    expect(copy.mock.calls).toEqual([['/old'], ['/other']]);
    expect(open).toHaveBeenLastCalledWith('/other-new', true);
  });
  it('disallows Import for an empty preview', async () => {
    const { controller, copy } = fixture(); controller.show({ ...folder, files: [] });
    await controller.importImages(); expect(copy).not.toHaveBeenCalled();
  });
  it.each(['Delete', 'v', 'z', 's', 'Enter', 'Tab'])('isolates %s from hidden editor listeners while preserving native navigation', key => {
    const event = { key, metaKey: ['v', 'z', 's'].includes(key), ctrlKey: false, stopImmediatePropagation: vi.fn(), preventDefault: vi.fn() };
    blockFolderPreviewShortcut(event as unknown as KeyboardEvent);
    expect(event.stopImmediatePropagation).toHaveBeenCalledOnce();
    expect(event.preventDefault).toHaveBeenCalledTimes(key === 's' ? 1 : 0);
  });
});

it('keeps the displayed source folder while opening an existing child without repeating Import', async () => {
  const open = vi.fn(async () => true);
  const controller = createFolderImageImportController({ copy: async () => ({ folderPath: '/old/.storyboard-flow', count: 1, importRequired: false }), open }, vi.fn());
  controller.show(folder); await controller.importImages();
  expect(open).toHaveBeenCalledExactlyOnceWith('/old/.storyboard-flow', false);
  expect(controller.displayPath('/old/.storyboard-flow')).toBe('/old');
  expect(controller.displayPath('/other')).toBe('/other');
});

it('does not re-import or overwrite an existing project that requires attention', async () => {
  const { controller, copy, open } = fixture();
  controller.show({ ...folder, issue: '项目需要恢复' });
  await controller.importImages();
  expect(copy).not.toHaveBeenCalled(); expect(open).not.toHaveBeenCalled();
  expect(controller.read().message).toBe('项目需要恢复');
});
