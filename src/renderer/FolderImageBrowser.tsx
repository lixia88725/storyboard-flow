import { useEffect, useRef, useState } from 'react';
import type { FolderImages } from '../../electron/shared/folderImages';

export const FolderImageBrowser = ({ folder, onClose, onImport }: {
  folder: FolderImages; onClose: () => void; onImport: (folderPath: string) => Promise<boolean>;
}) => {
  const dialog = useRef<HTMLDialogElement>(null);
  const [previews, setPreviews] = useState<Record<string, { dataUrl?: string; error?: string }>>({});
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('');
  const importing = useRef(false);
  const prepared = useRef<string | undefined>(undefined);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    let cancelled = false, next = 0;
    const worker = async () => {
      while (!cancelled && next < folder.files.length) {
        const fileName = folder.files[next++];
        try {
          const preview = await window.storyboard.readFolderImagePreview({ folderPath: folder.folderPath, fileName });
          if (!cancelled) setPreviews(old => ({ ...old, [fileName]: { dataUrl: preview.dataUrl } }));
        } catch (error) {
          if (!cancelled) setPreviews(old => ({ ...old, [fileName]: { error: error instanceof Error ? error.message : String(error) } }));
        }
      }
    };
    void worker(); void worker();
    return () => { cancelled = true; };
  }, [folder]);
  const importImages = async () => {
    if (importing.current) return;
    importing.current = true; setBusy(true); setMessage('Preparing image copies…');
    try {
      if (!prepared.current) {
        const result = await window.storyboard.copyFolderImagesForImport(folder.folderPath);
        if (!result) { setMessage('Import cancelled. Originals are unchanged.'); return; }
        prepared.current = result.folderPath;
      }
      setMessage('Creating editable Storyboard Flow images…');
      if (!await onImport(prepared.current)) throw new Error(`Could not finish opening the new project. Prepared images are retained at ${prepared.current}`);
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)); }
    finally { importing.current = false; setBusy(false); }
  };
  return <dialog ref={dialog} className="folder-image-browser" aria-label="Folder images"
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onKeyDown={event => { event.stopPropagation(); if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') event.preventDefault(); }}>
    <header>
      <div><h2>Folder images · {folder.files.length}</h2><p>{folder.folderPath}</p></div>
      <button onClick={onClose} disabled={busy}>Back to workspace</button>
      <button className="primary" disabled={busy || !folder.files.length} onClick={() => void importImages()}>{busy ? 'Importing…' : 'Import to new project…'}</button>
    </header>
    <p>先浏览图片。Import 会在新文件夹创建可编辑项目，原文件和旧项目记录保持不变。</p>
    <p>按图片当前可见画面导入；不迁移旧图层、对白或分镜文字。动画图片仅导入首帧。</p>
    <p role="status">{message || 'PNG · JPEG · TIFF · WebP · GIF · AVIF'}</p>
    <section className="folder-image-grid" aria-label="Image previews">
      {folder.files.map(fileName => <figure key={fileName}>
        {previews[fileName]?.dataUrl ? <img src={previews[fileName].dataUrl} alt={fileName} />
          : <div className="folder-image-placeholder">{previews[fileName]?.error ? 'Preview unavailable' : 'Loading…'}</div>}
        <figcaption>{fileName}</figcaption>
        {previews[fileName]?.error && <details><summary>Image error</summary>{previews[fileName].error}</details>}
      </figure>)}
      {!folder.files.length && <p>No supported images in this folder.</p>}
    </section>
  </dialog>;
};
