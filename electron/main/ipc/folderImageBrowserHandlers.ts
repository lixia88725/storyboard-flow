import type { IpcMain, IpcMainInvokeEvent } from 'electron';
import { inspectFolderImages, readFolderImagePreview, copyFolderImagesForImport } from '../folderImageBrowserService.js';
import { withLayerFileOperation } from '../layerFileOperationQueue.js';
import { assertPhysicalWorkspaceWriterTargets } from '../workspacePhysicalWriterGate.js';
import type { FolderImageRequest } from '../../shared/folderImages.js';

export const registerFolderImageBrowserHandlers = (ipc: Pick<IpcMain, 'handle'>) => {
  const assertCaller = (event: IpcMainInvokeEvent) => {
    if (!event.sender || event.senderFrame !== event.sender.mainFrame) throw new Error('Folder browsing requires the current window');
  };
  ipc.handle('folderImages:inspect', (event, folderPath: string) => { assertCaller(event); return inspectFolderImages(folderPath); });
  ipc.handle('folderImages:preview', (event, request: FolderImageRequest) => { assertCaller(event); return readFolderImagePreview(request); });
  ipc.handle('folderImages:importCopy', async (event, folderPath: string) => {
    assertCaller(event);
    // Explicit Import prepares the default child; no destination picker.
    return withLayerFileOperation(() => copyFolderImagesForImport(folderPath, assertPhysicalWorkspaceWriterTargets));
  });
};
