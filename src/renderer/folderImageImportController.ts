import { useEffect, useRef, useState } from 'react';
import type { FolderImages, FolderImageCopy } from '../../electron/shared/folderImages';

type State = { folder?: FolderImages; busy: boolean; message: string };
type Options = {
  copy: (source: string) => Promise<FolderImageCopy | undefined>;
  open: (destination: string, importRequired: boolean) => Promise<boolean>;
};

// The source is only a preview. Conversion continues through the existing
// managed child copier and staging Import, never through the active project.
export const createFolderImageImportController = (options: Options, changed: (state: State) => void) => {
  let state: State = { busy: false, message: '' };
  let prepared: FolderImageCopy | undefined;
  const sources = new Map<string, string>();
  const publish = (next: State) => { state = next; changed(state); };
  return {
    read: () => state,
    remember: (workspace: string, source: string) => { sources.set(workspace, source); },
    displayPath: (workspace: string) => sources.get(workspace) ?? workspace,
    show(folder: FolderImages | undefined) {
      if (state.busy) return false;
      prepared = undefined;
      publish({ folder, busy: false, message: folder?.issue ?? '' });
      return true;
    },
    async importImages() {
      const source = state.folder;
      if (!source?.files.length || source.issue || state.busy) return;
      publish({ folder: source, busy: true, message: '正在准备图片…' });
      try {
        if (!prepared) {
          const result = await options.copy(source.folderPath);
          if (!result) { publish({ folder: source, busy: true, message: '已取消导入，原文件保持不变。' }); return; }
          prepared = result;
          sources.set(result.folderPath, source.folderPath);
        }
        publish({ folder: source, busy: true, message: '正在转换为可编辑项目…' });
        if (!await options.open(prepared.folderPath, prepared.importRequired !== false)) throw new Error(`未能完成导入。已准备的图片保留在：${prepared.folderPath}`);
        prepared = undefined;
        publish({ busy: true, message: '' });
      } catch (error) {
        publish({ folder: source, busy: true, message: error instanceof Error ? error.message : String(error) });
      } finally {
        publish({ ...state, busy: false });
      }
    }
  };
};

// Inert hides pointer targets, but window keyboard listeners still run. Keep
// native text editing / tab navigation and prevent hidden-workspace shortcuts.
// Listen after the focused control, before window listeners; capture at window
// would also suppress native Enter activation on the visible Import button.
export const blockFolderPreviewShortcut = (event: KeyboardEvent) => {
  event.stopImmediatePropagation();
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') event.preventDefault();
};

export const useFolderImageImportController = (options: Options) => {
  const latest = useRef(options);
  latest.current = options;
  const [state, setState] = useState<State>({ busy: false, message: '' });
  const [controller] = useState(() => createFolderImageImportController({
    copy: source => latest.current.copy(source), open: (target, required) => latest.current.open(target, required)
  }, setState));
  useEffect(() => {
    const block = (event: KeyboardEvent) => {
      if (controller.read().folder) blockFolderPreviewShortcut(event);
    };
    document.addEventListener('keydown', block);
    document.addEventListener('keyup', block);
    return () => {
      document.removeEventListener('keydown', block);
      document.removeEventListener('keyup', block);
    };
  }, [controller]);
  return { ...state, controller };
};
