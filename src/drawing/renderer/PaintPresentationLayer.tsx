import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { PaintPresentation, PaintFrame } from './paintPresentation';

/** A surface borrows pixels, never the input ledger. Imperative copies avoid a
 * workbench React render per pointer sample. Unmount releases only this copy. */
export function PaintPresentationLayer({ owner, shotId, layerId, style, children }: {
  owner: PaintPresentation; shotId: string; layerId: string; style: CSSProperties; children: React.ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState<string>();
  const [retryDecode, setRetryDecode] = useState(false);
  const [controls, setControls] = useState<Pick<PaintFrame<HTMLCanvasElement>, 'decision' | 'decisionReady' | 'recovery'>>({});
  const exportRecovery = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(owner.recoveryRecord(), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a'); link.href = url; link.download = 'paint-recovery.json'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0); owner.markRecoveryExportRequested();
  };
  useLayoutEffect(() => {
    const update = () => {
      const frame = owner.frame(), node = canvas.current;
      const owned = frame.target?.shotId === shotId && frame.target.layerId === layerId;
      const next = owned ? frame.status : 'idle';
      if (node) {
        if (owned && frame.canvas && next === 'ready') {
          if (node.width !== frame.canvas.width) node.width = frame.canvas.width;
          if (node.height !== frame.canvas.height) node.height = frame.canvas.height;
          const ctx = node.getContext('2d'); ctx?.clearRect(0, 0, node.width, node.height); ctx?.drawImage(frame.canvas, 0, 0);
        } else { node.width = 0; node.height = 0; }
        node.dataset.paintStatus = next;
        // Conceal old pixels immediately, before React publishes a history snapshot.
        const host = node.parentElement!;
        host.dataset.paintStatus = next;
      }
      const nextControls = owned ? { decision: frame.decision, decisionReady: frame.decisionReady, recovery: frame.recovery } : {};
      setControls(old => old.decision === nextControls.decision && old.decisionReady === nextControls.decisionReady
        && old.recovery?.busy === nextControls.recovery?.busy && old.recovery?.retry === nextControls.recovery?.retry
        && old.recovery?.discard === nextControls.recovery?.discard && old.recovery?.exportRequired === nextControls.recovery?.exportRequired
        ? old : nextControls);
      setStatus(next); setError(owned ? frame.error : undefined); setRetryDecode(owned && !!frame.retryDecode);
    };
    update(); const unsubscribe = owner.subscribe(update);
    return () => { unsubscribe(); if (canvas.current) { canvas.current.width = 0; canvas.current.height = 0; } };
  }, [owner, shotId, layerId]);
  return <div className="paint-presentation-layer" data-paint-status={status} data-paint-decision={!!controls.decision}>
    <div className="paint-static-layer">{children}</div>
    <canvas ref={canvas} className="paint-shared-layer" style={style} data-paint-layer={layerId}/>
    {(status === 'preparing' || status === 'error' || controls.decision) && <div className="paint-preparing" role="status">
      <span>{controls.decision ? '笔画达到点数上限，已暂停；抬笔后选择如何处理已接受部分。' : status === 'error' ? error : '正在准备画面，笔迹已保留…'}</span>
      {controls.decision && <div className="paint-decisions" onPointerDown={e => e.stopPropagation()}>
        <button type="button" disabled={!controls.decisionReady} onClick={() => owner.resolveBudget('commit')}>仅提交已接受部分</button>
        <button type="button" disabled={!controls.decisionReady} onClick={() => owner.resolveBudget('discard')}>放弃该笔，重新绘画</button>
      </div>}
      {controls.recovery && <div className="paint-decisions" onPointerDown={e => e.stopPropagation()}>
        {!controls.recovery.retry && <span>结果未知，不会重试。请导出笔迹与错误记录；确认文件已保存后再放弃。取消下载请重新导出。</span>}
        <button type="button" disabled={controls.recovery.busy} onClick={exportRecovery}>导出保留笔迹</button>
        {controls.recovery.retry && <button type="button" disabled={controls.recovery.busy} onClick={() => void owner.resolveFailure('retry')}>在当前图层重试未成功笔迹</button>}
        <button type="button" disabled={controls.recovery.busy || !controls.recovery.discard} onClick={() => void owner.resolveFailure('discard')}>{controls.recovery.retry ? '放弃保留笔迹' : '已保存导出文件，放弃保留笔迹'}</button>
      </div>}
      {status === 'error' && retryDecode && <button type="button" onPointerDown={e => e.stopPropagation()} onClick={() => owner.retryDecode()}>重试准备画面</button>}
    </div>}
  </div>;
}

/** Native <img src=next> can retain its previous decoded pixels while next loads.
 * Mount by immutable asset identity and reveal only after decode; this also covers
 * a history change to a layer that is not the owner's current drawing target. */
export function PaintStaticImage({ src, style }: { src: string; style: CSSProperties }) {
  const node = useRef<HTMLImageElement>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(false);
  useLayoutEffect(() => {
    let retired = false;
    setReady(false); setError(false);
    if (src && node.current) void node.current.decode().then(
      () => { if (!retired) setReady(true); },
      () => { if (!retired) setError(true); },
    );
    return () => { retired = true; };
  }, [src]);
  return <>
    <img ref={node} src={src || undefined} alt="" draggable={false} style={{ ...style, visibility: ready ? 'visible' : 'hidden' }}/>
    {!ready && <div className="paint-preparing" role="status">{error ? '画面读取失败' : '正在准备画面…'}</div>}
  </>;
}
