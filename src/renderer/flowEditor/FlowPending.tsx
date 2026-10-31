import type {ReactNode} from 'react';
import {PresentationPreview} from '../canvasPresentation';
import { useDroppable } from '@dnd-kit/core';
import { useSortable, SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Shot } from '../../shared/types';
import { ShotStaticMedia } from '../ShotStaticMedia';

export const pendingDropId = 'flow:pending-drop';
export function FlowPending({ shots, disabled, revision, onRestore, renderMedia }: {
  shots: Shot[]; disabled: boolean; revision: number; onRestore: (id: string) => void; renderMedia?: (shot: Shot) => ReactNode;
}) {
  const drop = useDroppable({ id: pendingDropId, disabled });
  return <aside ref={drop.setNodeRef} aria-label="Pending" className={`flow-pending-shelf ${drop.isOver ? 'is-over' : ''}`}>
    <h2>Pending ({shots.length})</h2>
    <p>Drop shots here. TIFF files update on Save.</p>
    <SortableContext items={shots.map(s => s.id)} strategy={verticalListSortingStrategy}>
      {shots.map(shot => <PendingCard key={shot.id} shot={shot} disabled={disabled} revision={revision} onRestore={onRestore} renderMedia={renderMedia} />)}
    </SortableContext>
  </aside>;
}
function PendingCard({ shot, disabled, revision, onRestore, renderMedia }: {
  shot: Shot; disabled: boolean; revision: number; onRestore: (id: string) => void; renderMedia?: (shot: Shot) => ReactNode;
}) {
  const drag = useSortable({ id: shot.id, disabled });
  return <div ref={drag.setNodeRef} data-pending-shot-id={shot.id} className="flow-pending"
    style={{ transform: CSS.Transform.toString(drag.transform), transition: drag.transition }}>
    <button disabled={disabled} aria-label={`Move pending ${shot.id}`} {...drag.attributes} {...drag.listeners}>{shot.fileName}</button>
    {renderMedia ? renderMedia(shot) : <PresentationPreview shotId={shot.id} width={shot.flow?.canvasWidth??640} height={shot.flow?.canvasHeight??360}><ShotStaticMedia shot={shot} folderPath="flow" revision={revision} /></PresentationPreview>}
    <button disabled={disabled} aria-label={`Restore ${shot.id}`} onClick={() => onRestore(shot.id)}>Restore</button>
  </div>;
}
