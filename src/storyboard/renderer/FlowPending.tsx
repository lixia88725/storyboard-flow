import { useEffect, useState, type ReactNode } from 'react';
import {PresentationPreview} from '../../drawing/renderer/canvasPresentation';
import { useDroppable } from '@dnd-kit/core';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Shot } from '../../drawing/contracts/types';
import { ShotStaticMedia } from './ShotStaticMedia';
import { prunePendingSelection, togglePendingSelection } from './pendingSelection';

export const pendingDropId = 'flow:pending-drop';
export function FlowPending({ shots, disabled, revision, onRestore, onDelete, renderMedia, stationary=false }: {
  shots: Shot[]; disabled: boolean; revision: number; onRestore: (id: string) => void;
  /** Pending-only removal. Omit it to render a selection-free shelf. */
  stationary?:boolean; onDelete?: (ids: string[]) => void; renderMedia?: (shot: Shot) => ReactNode;
}) {
  const drop = useDroppable({ id: pendingDropId, disabled });
  const order = shots.map(shot => shot.id);
  const [selection, setSelection] = useState<string[]>([]);
  // Restore, drag, Undo and Delete all change membership; never keep a vanished ID.
  const selected = prunePendingSelection(order, selection);
  const orderKey = order.join('\u0000');
  useEffect(() => { setSelection(current => { const next = prunePendingSelection(order, current); return next.length === current.length ? current : next; }); }, [orderKey]);
  return <aside ref={drop.setNodeRef} aria-label="Pending" className={`flow-pending-shelf ${drop.isOver ? 'is-over' : ''}`}>
    <h2>Pending ({shots.length})</h2>
    <p>Drop shots here. TIFF files update on Save.</p>
    {onDelete && <div className="flow-pending-actions">
      <span>已选 {selected.length}</span>
      <button disabled={disabled || !selected.length} aria-label={`删除选中的 Pending (${selected.length})`}
        onClick={() => { if (selected.length) onDelete([...selected]); }}>删除 Pending{selected.length ? ` (${selected.length})` : ''}</button>
    </div>}
    <SortableContext items={order} strategy={verticalListSortingStrategy}>
      {shots.map(shot => <PendingCard key={shot.id} shot={shot} disabled={disabled} revision={revision} onRestore={onRestore}
        stationary={stationary} selectable={!!onDelete} selected={selected.includes(shot.id)}
        onToggle={() => setSelection(current => togglePendingSelection(order, current, shot.id))} renderMedia={renderMedia} />)}
    </SortableContext>
  </aside>;
}
function PendingCard({ shot, disabled, revision, onRestore, selectable, selected, onToggle, renderMedia, stationary }: {
  shot: Shot; disabled: boolean; revision: number; onRestore: (id: string) => void;
  stationary?:boolean; selectable: boolean; selected: boolean; onToggle: () => void; renderMedia?: (shot: Shot) => ReactNode;
}) {
  const drag = useSortable({ id: shot.id, disabled });
  return <div ref={drag.setNodeRef} data-pending-shot-id={shot.id} className="flow-pending"
    style={stationary?undefined:{ transform: CSS.Transform.toString(drag.transform), transition: drag.transition }}>
    {selectable && <label onClick={event => event.stopPropagation()}>
      <input type="checkbox" checked={selected} disabled={disabled} onChange={onToggle} aria-label={`选择 Pending ${shot.id}`} />
    </label>}
    <button disabled={disabled} aria-label={`Move pending ${shot.id}`} {...drag.attributes} {...drag.listeners}>{shot.fileName}</button>
    {renderMedia ? renderMedia(shot) : <PresentationPreview shotId={shot.id} width={shot.flow?.canvasWidth??640} height={shot.flow?.canvasHeight??360}><ShotStaticMedia shot={shot} folderPath="flow" revision={revision} /></PresentationPreview>}
    <button disabled={disabled} aria-label={`Restore ${shot.id}`} onClick={() => onRestore(shot.id)}>Restore</button>
  </div>;
}
