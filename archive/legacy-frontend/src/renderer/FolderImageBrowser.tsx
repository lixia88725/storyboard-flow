import { useEffect, useState } from 'react';
import type { FolderImages } from '../../electron/shared/folderImages';

export const FolderImageBrowser = ({ folder, onClose, busy, message }: {
  folder: FolderImages; onClose: () => void; busy: boolean; message: string;
}) => {
  const [previews, setPreviews] = useState<Record<string, { dataUrl?: string; error?: string }>>({});
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
  return <section className="folder-image-browser" aria-label="Folder images" aria-busy={busy}>
    <header className="folder-import-notice">
      <div>
        <strong>{folder.issue ? "项目暂时无法编辑" : "点击左上角 Import 后即可编辑"}</strong>
        <span> · {folder.files.length} 张图片</span>
        <p>{folder.issue ? "当前仅浏览原图。已有项目和原文件均保留，不会重复导入。" : "在当前文件夹内建立可编辑项目。绘画自动保留，Save 更新原图并保留首次备份。仅导入图片画面，旧图层和文字不迁移；动画仅取首帧。"}</p>
      </div>
      <button onClick={onClose} disabled={busy}>返回工作区</button>
    </header>
    {message && <p className="folder-import-status" role="status">{message}</p>}
    <section className="folder-image-grid" aria-label="Image previews">
      {folder.files.map(fileName => <figure key={fileName}>
        {previews[fileName]?.dataUrl ? <img src={previews[fileName].dataUrl} alt={fileName} draggable={false} />
          : <div className="folder-image-placeholder">{previews[fileName]?.error ? 'Preview unavailable' : 'Loading…'}</div>}
        <figcaption>{fileName}</figcaption>
        {previews[fileName]?.error && <details><summary>Image error</summary>{previews[fileName].error}</details>}
      </figure>)}
      {!folder.files.length && <p>No supported images in this folder.</p>}
    </section>
  </section>;
};
