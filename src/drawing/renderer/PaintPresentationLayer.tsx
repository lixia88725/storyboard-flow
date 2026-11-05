import { useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { PaintPresentation } from './paintPresentation';

/** A surface borrows pixels, never the input ledger. Imperative copies avoid a
 * workbench React render per pointer sample. Unmount releases only this copy. */
export function PaintPresentationLayer({ owner, shotId, layerId, style, children }: {
  owner: PaintPresentation; shotId: string; layerId: string; style: CSSProperties; children: React.ReactNode;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [status, setStatus] = useState('idle');
  const [error, setError] = useState<string>();
  const [retryDecode, setRetryDecode] = useState(false);
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
      setStatus(next); setError(owned ? frame.error : undefined); setRetryDecode(owned && !!frame.retryDecode);
    };
    update(); const unsubscribe = owner.subscribe(update);
    return () => { unsubscribe(); if (canvas.current) { canvas.current.width = 0; canvas.current.height = 0; } };
  }, [owner, shotId, layerId]);
  return <div className="paint-presentation-layer" data-paint-status={status}>
    <div className="paint-static-layer">{children}</div>
    <canvas ref={canvas} className="paint-shared-layer" style={style} data-paint-layer={layerId}/>
    {(status === 'preparing' || status === 'error') && <div className="paint-preparing" role="status">
      {status === 'error' ? error : '正在准备画面，笔迹已保留…'}
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
