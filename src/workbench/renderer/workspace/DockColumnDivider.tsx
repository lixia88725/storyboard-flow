import {useEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject} from 'react';
import {
  dividerValue, dividerValueText, dragDivider, keyboardDivider, startDividerDrag,
  type DividerState,
} from './dockDivider';

/** One divider between the two dock columns: drag to resize, drag past the edge to fold,
 * and keep dragging back to unfold in the same gesture. A folded column keeps this
 * separator reachable, so it is never disabled and never loses pointer capture. */
export function DockColumnDivider({state, dockRef, canResize, onPreview, onFinish}:{
  state: DividerState;
  dockRef: RefObject<HTMLElement | null>;
  canResize: () => boolean;
  /** Live layout while the pointer is down; does not persist. */
  onPreview: (next: DividerState) => void;
  /** Final layout; `commit` is false when the gesture was cancelled. */
  onFinish: (next: DividerState, commit: boolean) => void;
}) {
  const live = useRef({state, dockRef, canResize, onPreview, onFinish});
  live.current = {state, dockRef, canResize, onPreview, onFinish};
  const [resizing, setResizing] = useState(false);
  const cancelDrag = useRef<(() => void) | undefined>(undefined);
  // A surface that retires mid-gesture must not leave window listeners behind.
  useEffect(() => () => cancelDrag.current?.(), []);

  const begin = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || !live.current.canResize()) return;
    const dock = live.current.dockRef.current;
    if (!dock) return;
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    try { handle.setPointerCapture(event.pointerId); } catch { /* Synthetic drivers may lack a native pointer. */ }
    handle.focus({preventScroll: true});
    const drag = startDividerDrag(live.current.state, dock.getBoundingClientRect().width);
    let latest = drag.state;
    let ended = false;
    const cursor = document.body.style.cursor;
    const select = document.body.style.userSelect;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    handle.dataset.resizing = 'true';
    setResizing(true);
    live.current.onPreview(latest);

    const move = (sample: PointerEvent) => {
      if (sample.pointerId !== event.pointerId) return;
      sample.preventDefault();
      latest = dragDivider(drag, sample.clientX - event.clientX, latest);
      live.current.onPreview(latest);
    };
    const finish = (commit: boolean) => {
      if (ended) return;
      ended = true;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', abortPointer);
      window.removeEventListener('blur', abort);
      window.removeEventListener('resize', abort);
      window.removeEventListener('keydown', key);
      handle.removeEventListener('lostpointercapture', abort);
      // Release after `ended` is set: the resulting lostpointercapture must not roll back
      // the layout the user just committed with pointerup.
      if (handle.hasPointerCapture(event.pointerId)) handle.releasePointerCapture(event.pointerId);
      delete handle.dataset.resizing;
      document.body.style.cursor = cursor;
      document.body.style.userSelect = select;
      setResizing(false);
      cancelDrag.current = undefined;
      live.current.onFinish(commit ? latest : drag.state, commit);
    };
    const up = (sample: PointerEvent) => { if (sample.pointerId === event.pointerId) finish(true); };
    const abortPointer = (sample: PointerEvent) => { if (sample.pointerId === event.pointerId) finish(false); };
    const abort = () => finish(false);
    const key = (sample: KeyboardEvent) => {
      if (sample.key !== 'Escape') return;
      sample.preventDefault();
      sample.stopPropagation();
      finish(false);
    };
    cancelDrag.current = abort;
    window.addEventListener('pointermove', move, {passive: false});
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', abortPointer);
    window.addEventListener('blur', abort);
    window.addEventListener('resize', abort);
    window.addEventListener('keydown', key);
    handle.addEventListener('lostpointercapture', abort);
  };

  const keyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!live.current.canResize()) return;
    const dock = live.current.dockRef.current;
    const next = keyboardDivider(live.current.state, event.key, event.shiftKey, dock?.getBoundingClientRect().width ?? 0);
    if (!next) return;
    event.preventDefault();
    event.stopPropagation();
    live.current.onFinish(next, true);
  };

  const [leftCollapsed, rightCollapsed] = state.collapsed;
  return <div className="wb-divider" role="separator" aria-orientation="vertical"
    aria-label="调整左右栏宽度"
    aria-valuenow={dividerValue(state)} aria-valuemin={0} aria-valuemax={100}
    aria-valuetext={dividerValueText(state)}
    aria-keyshortcuts="ArrowLeft ArrowRight Home End"
    data-collapsed={leftCollapsed ? rightCollapsed ? 'both' : 'left' : rightCollapsed ? 'right' : 'none'}
    data-resizing={resizing ? 'true' : undefined}
    tabIndex={0}
    title="左右拖动调整两栏宽度，拖到边缘折叠；同一手势拖回可恢复。方向键微调，Home 折叠左栏，End 折叠右栏"
    onPointerDown={begin} onKeyDown={keyDown}/>;
}
