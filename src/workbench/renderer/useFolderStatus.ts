import { useEffect, useRef, useState } from 'react';
import type { FolderStatus, FolderStatusRequest, TrashRecovery } from '../../platform/contracts/flowEditor';
import type { ProjectV1 } from '../../platform/contracts/refactorV1';

const labels: Record<Exclude<FolderStatus, TrashRecovery>, string> = {
  pending: '文件夹中的故事板待更新',
  current: '文件夹中的故事板已更新',
  external: '文件夹中的故事板有改动 · 可刷新查看',
  both: '同一张故事板在两处都有改动 · 可刷新查看',
  missing: '文件夹中缺少故事板 · 请检查文件位置',
  unfinished: '上次文件更新尚未完成',
};

export function useFolderStatus(project: ProjectV1, enabled: boolean, busy: boolean,
  read: (request: FolderStatusRequest) => Promise<FolderStatus>) {
  const [generation, recheck] = useState(0);
  const inspected = useRef(-1);
  const [result, setResult] = useState<{ revision: number; generation: number; label: string; recovery?: TrashRecovery }>();
  useEffect(() => {
    if (!enabled) return;
    const focus = () => recheck(n => n + 1);
    window.addEventListener('focus', focus);
    return () => window.removeEventListener('focus', focus);
  }, [enabled]);
  useEffect(() => {
    if (busy) { inspected.current = -1; setResult(undefined); }
    if (!enabled || busy) return;
    let active = true;
    const timer = window.setTimeout(async () => {
      try {
        const state = await read({ project, inspectDisk: inspected.current !== generation });
        if (active) {
          inspected.current = generation;
          const details = typeof state === 'string' ? { label: labels[state] } :
            { label: '上次移入废纸篓的操作尚待处理', recovery: state };
          setResult({ revision: project.revision, generation, ...details });
        }
      } catch {
        if (active) setResult({ revision: project.revision, generation, label: '未能检查文件夹中的故事板' });
      }
    }, 120);
    return () => { active = false; window.clearTimeout(timer); };
  }, [enabled, busy, project, read, generation]);
  return result?.revision === project.revision && result.generation === generation ? result : { label: '正在检查文件夹', recovery: undefined };
}
