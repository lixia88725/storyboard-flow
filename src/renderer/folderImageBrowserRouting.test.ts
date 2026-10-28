import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { expect, it, vi } from 'vitest';
import { formatWorkspaceOpenError } from './workspaceOpenErrors';

// Exercise App's real routing with declared IPC/slot test doubles. Native file
// retention and conversion are tested separately, not certified by these mocks.
const source = await readFile(new URL('./App.tsx', import.meta.url), 'utf8');
const tree = ts.createSourceFile('App.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let declaration = '';
const visit = (node: ts.Node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(tree) === 'handleOpenFolderByPath') declaration = node.getText(tree);
  ts.forEachChild(node, visit);
}; visit(tree);
const inspection = (folderPath = '/old', browse = true) => ({ folderPath, files: ['a.tiff'], browse });
function fixture() {
  const inspectFolderImages = vi.fn(async (p: string) => inspection(p));
  const requestOpen = vi.fn(async (..._args: any[]) => true);
  const setFolderBrowser = vi.fn(), setStatus = vi.fn();
  const bindings = {
    folderOpenRequestRef: { current: 0 }, window: { storyboard: { inspectFolderImages } },
    folderInputValue: '/old', setStatus, setWorkspaceTask: vi.fn(), setFolderBrowser,
    workspaceSlotsRef: { current: { requestOpen } }, formatWorkspaceOpenError,
    blankShotPreset: '16:9', prepareNormalSaveImportMatte: vi.fn(), prepareNormalSaveScriptMatte: vi.fn()
  };
  const open = new Function(...Object.keys(bindings), ts.transpile(`const ${declaration}; return handleOpenFolderByPath;`, { target: ts.ScriptTarget.ES2022 }))(...Object.values(bindings));
  return { ...bindings, open, inspectFolderImages, requestOpen };
}
it('browses old images before workspace observation or replacing the active project', async () => {
  const f = fixture(); expect(await f.open()).toBe(false);
  expect(f.requestOpen).not.toHaveBeenCalled();
  expect(f.setFolderBrowser).toHaveBeenCalledWith(inspection());
  expect(f.setWorkspaceTask).toHaveBeenLastCalledWith(undefined);
});
it('a stale inspection cannot overwrite the newer folder browser', async () => {
  const f = fixture(); let release!: (value: ReturnType<typeof inspection>) => void;
  f.inspectFolderImages.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const first = f.open('/first'); await f.open('/second'); release(inspection('/first')); await first;
  expect(f.setFolderBrowser.mock.calls).toEqual([[inspection('/second')]]);
});
it.each(['false', 'throw'])('refused normal open (%s) still offers readable images', async mode => {
  const f = fixture(); f.inspectFolderImages.mockResolvedValue(inspection('/old', false));
  f.requestOpen.mockImplementation(async () => { if (mode === 'throw') throw Error('Open refused'); return false; });
  await f.open(); expect(f.setFolderBrowser).toHaveBeenCalledWith(inspection());
});
it('earlier normal open completion cannot dismiss a newer browser', async () => {
  const f = fixture(); let release!: (value: boolean) => void;
  f.inspectFolderImages.mockResolvedValueOnce(inspection('/first', false));
  f.requestOpen.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const first = f.open('/first'); await vi.waitFor(() => expect(f.requestOpen).toHaveBeenCalled());
  await f.open('/second'); release(true); await first;
  expect(f.setFolderBrowser.mock.calls).toEqual([[inspection('/second')]]);
});
it('explicit new-folder conversion imports inside the staging slot before publication', async () => {
  const f = fixture(), scan = { project: { name: 'new' } }, events: string[] = [];
  const adapter = {
    load: vi.fn(async (_read: unknown, published: Function) => { events.push('load'); published(scan); return true; }),
    imageImport: vi.fn(async ({ published }: { published: Function }) => { events.push('import'); published(scan); return true; })
  };
  f.requestOpen.mockImplementation(async (path, read) => {
    expect(path).toBe('/new'); expect(await read({ adapter }, { folderPath: path })).toBe(scan);
    events.push('publish'); return true;
  });
  expect(await f.open('/new', true)).toBe(true);
  expect(f.inspectFolderImages).not.toHaveBeenCalled();
  expect(events).toEqual(['load', 'import', 'publish']);
  expect(f.setFolderBrowser).toHaveBeenLastCalledWith(undefined);
});
