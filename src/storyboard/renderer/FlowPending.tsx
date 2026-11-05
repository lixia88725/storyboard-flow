import type {ReactNode} from 'react';
import {PresentationPreview} from '../../drawing/renderer/canvasPresentation';
import {useDraggable,useDroppable} from '@dnd-kit/core';
import type {Shot} from '../../drawing/contracts/types';
import {ShotStaticMedia} from './ShotStaticMedia';
import {ShotCard,ShotCardHandle} from './workspace/ShotCard';
import {useMarqueeSelection} from './workspace/useMarqueeSelection';

export const pendingDropId = 'flow:pending-drop';
type Modifiers = {shiftKey?:boolean;metaKey?:boolean;ctrlKey?:boolean};

/**
 * Pending is the small table: the same cards as the storyboard grid, read-only. Cards
 * select like boards (click, ⌘/Ctrl, Shift, box select) and drag as a group, but nothing
 * here opens the canvas, draws or edits dialogue — Pending only parks a shot outside the story.
 */
export function FlowPending(p: {
  shots: Shot[]; disabled: boolean; revision: number;
  /** Pending-only selection, in parked order. */
  selected: readonly string[]; onSelect: (id: string, event: Modifiers) => void;
  onSelectMany: (ids: string[]) => void; onSelectAll: () => void; onClear: () => void;
  /** Read-only dialogue, keyed by shot. */
  dialogueText: ReadonlyMap<string, string>;
  /** Move the current selection back to the end of the storyboard. */
  onMove: (ids: string[]) => void;
  onRestore: (id: string) => void;
  stationary?: boolean; onDelete?: (ids: string[]) => void; renderMedia?: (shot: Shot) => ReactNode;
}) {
  const drop = useDroppable({ id: pendingDropId, disabled: p.disabled });
  const order = p.shots.map(shot => shot.id);
  // A local binding keeps the optional delete callable inside the click handler.
  const remove = p.onDelete;
  const marquee = useMarqueeSelection({ idAttribute: 'data-pending-shot-id', selected: [...p.selected], order, disabled: p.disabled,
    canSelect: () => !p.disabled, onSelect: p.onSelectMany, resetKeys: [p.disabled] });
  return <aside ref={drop.setNodeRef} aria-label="Pending" className={`flow-pending-shelf ${drop.isOver ? 'is-over' : ''}`}>
    <div className="wb-pending-tools flow-pending-actions">
      <span>{p.shots.length} 张 · {p.selected.length} 已选</span>
      <button disabled={p.disabled || !p.shots.length} onClick={p.onSelectAll}>全选</button>
      <button disabled={p.disabled || !p.selected.length} onClick={p.onClear}>取消选择</button>
      <button disabled={p.disabled || !p.selected.length} title="把选中的故事板移回故事板末尾，也可以直接拖过去"
        onClick={() => p.onMove([...p.selected])}>移入故事板</button>
      {remove && <button disabled={p.disabled || !p.selected.length} aria-label={`删除选中的 Pending (${p.selected.length})`}
        onClick={() => { if (p.selected.length) remove([...p.selected]); }}>删除 Pending{p.selected.length ? ` (${p.selected.length})` : ''}</button>}
    </div>
    <div className="wb-grid wb-pending-grid" ref={marquee.setElement} onPointerDown={marquee.onPointerDown}>
      {p.shots.map(shot => <PendingCard key={shot.id} shot={shot} disabled={p.disabled} revision={p.revision}
        selected={p.selected.includes(shot.id)} text={p.dialogueText.get(shot.id) ?? ''}
        onRestore={p.onRestore} onSelect={p.onSelect} renderMedia={p.renderMedia} />)}
    </div>
  </aside>;
}

function PendingCard(p: {
  shot: Shot; disabled: boolean; revision: number; selected: boolean; text: string;
  onRestore: (id: string) => void; onSelect: (id: string, event: Modifiers) => void;
  renderMedia?: (shot: Shot) => ReactNode;
}) {
  const drag = useDraggable({ id: p.shot.id, disabled: p.disabled });
  // A plain click selects; only travel past the pointer sensor's distance starts a drag.
  // The card body is the surface (picture, caption, blank space) so a thumbnail is enough
  // to pick it up; the move-back control opts out with data-no-drag.
  const startDrag = (event: React.PointerEvent<HTMLElement>) => {
    if (p.disabled) return;
    if (event.target instanceof Element && event.target.closest('[data-no-drag]')) return;
    drag.listeners?.onPointerDown?.(event as unknown as React.PointerEvent);
  };
  return <ShotCard kind="pending" id={p.shot.id} selected={p.selected} register={drag.setNodeRef}
    aspectRatio={`${p.shot.flow?.canvasWidth ?? 640}/${p.shot.flow?.canvasHeight ?? 360}`}
    className={drag.isDragging ? 'is-dragging' : ''}
    onPointerDown={startDrag}
    onClick={event => { if (!p.disabled) p.onSelect(p.shot.id, { shiftKey: event.shiftKey, metaKey: event.metaKey, ctrlKey: event.ctrlKey }); }}
    handle={<ShotCardHandle label={`选择 Pending ${p.shot.id}`} attributes={drag.attributes} listeners={drag.listeners as never} pointerDrag={false} disabled={p.disabled} />}
    picture={p.renderMedia ? p.renderMedia(p.shot) : <PresentationPreview shotId={p.shot.id} width={p.shot.flow?.canvasWidth ?? 640}
      height={p.shot.flow?.canvasHeight ?? 360}><ShotStaticMedia shot={p.shot} folderPath="flow" revision={p.revision} /></PresentationPreview>}
    corner={<button className="wb-pending-restore" data-no-drag disabled={p.disabled} aria-label={`Restore ${p.shot.id}`}
      title="移回故事板末尾" onClick={event => { event.stopPropagation(); p.onRestore(p.shot.id); }}>移回</button>}
    footer={p.text ? <div className="wb-pending-footer"><p className="wb-pending-dialogue" title={p.text}>{p.text}</p></div> : undefined} />;
}
