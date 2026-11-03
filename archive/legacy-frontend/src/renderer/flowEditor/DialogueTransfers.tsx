import type { DialogueV1 } from '../../../electron/shared/refactorV1';
const mime = 'application/x-flow-dialogue';
/** Transfer controls reuse the same Board command in both presentations. */
export function DialogueTransfers({ shotId, dialogues, disabled, onMove }: {
  shotId: string; dialogues: DialogueV1[]; disabled: boolean; onMove: (id: string, target: string, beforeId?: string) => void;
}) {
  const drop = (event: React.DragEvent, beforeId?: string) => {
    event.preventDefault(); event.stopPropagation(); if (disabled) return;
    const id = event.dataTransfer.getData(mime); if (id && id !== beforeId) onMove(id, shotId, beforeId);
  };
  return <div className="flow-dialogue-transfers" aria-label={`Move dialogues ${shotId}`}
    onDragOver={e => { if (!disabled && e.dataTransfer.types.includes(mime)) { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; } }}
    onDrop={e => drop(e)}>
    {dialogues.filter(d => d.shotId === shotId).map(d => <button key={d.id} type="button" disabled={disabled} draggable={!disabled}
      aria-label={`Move dialogue ${d.id}`} onDragStart={e => { e.stopPropagation(); e.dataTransfer.setData(mime, d.id); e.dataTransfer.effectAllowed = 'move'; }}
      onDrop={e => drop(e, d.id)}>{d.text || '(empty dialogue)'}</button>)}
    <span>Drop dialogue here</span>
  </div>;
}
