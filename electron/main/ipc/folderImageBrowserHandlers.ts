import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { inspectFolderImages, readFolderImagePreview, copyFolderImagesForImport } from '../folderImageBrowserService.js';
import { withLayerFileOperation } from '../layerFileOperationQueue.js';
import { assertPhysicalWorkspaceWriterTargets } from '../workspacePhysicalWriterGate.js';
import type { FolderImageRequest } from '../../shared/folderImages.js';

export const registerFolderImageBrowserHandlers = (ipc: Pick<IpcMain, 'handle'>,
  chooseParent: (event: IpcMainInvokeEvent) => Promise<string | undefined>) => {
  const assertCaller = (event: IpcMainInvokeEvent) => {
    if (!event.sender || event.senderFrame !== event.sender.mainFrame) throw new Error('Folder browsing requires the current window');
  };
  ipc.handle('folderImages:inspect', (event, folderPath: string) => { assertCaller(event); return inspectFolderImages(folderPath); });
  ipc.handle('folderImages:preview', (event, request: FolderImageRequest) => { assertCaller(event); return readFolderImagePreview(request); });
  ipc.handle('folderImages:importCopy', async (event, folderPath: string) => {
    assertCaller(event);
    const parent = await chooseParent(event);
    if (!parent) return undefined;
    assertCaller(event);
    // This is deliberately new-destination preparation, not an ordinary writer
    // on the browsed source. All source paths remain read-only.
    return withLayerFileOperation(() => copyFolderImagesForImport(folderPath, parent, assertPhysicalWorkspaceWriterTargets));
  });
};
