import type { ImageWorkspaceLayerView } from '../../../platform/contracts/imageWorkspace';
import { nextRangeSelection } from '../../../storyboard/renderer/rangeSelection';

/** Capability projection only; never a second writable image document. */
export type NativeLayerView = ImageWorkspaceLayerView & {
  readonly capabilities: { readonly paint: boolean; readonly properties: boolean; readonly structure: boolean };
  readonly readOnlyReason?: string;
};
export type NativeLayerRow = { layer: NativeLayerView; depth: number; hasChildren: boolean };
export function nativeLayerRows(layers: readonly NativeLayerView[], collapsed: ReadonlySet<string> = new Set()): NativeLayerRow[] {
  const ids = new Set(layers.map(l => l.id));
  const children = new Map<string | null, NativeLayerView[]>();
  for (const layer of layers) {
    const parent = layer.parentId && ids.has(layer.parentId) ? layer.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), layer]);
  }
  const seen = new Set<string>(); const rows: NativeLayerRow[] = [];
  const visit = (layer: NativeLayerView, depth: number) => {
    if (seen.has(layer.id)) return;
    seen.add(layer.id);
    const nested = children.get(layer.id) ?? [];
    rows.push({ layer, depth, hasChildren: nested.length > 0 });
    if (!collapsed.has(layer.id)) for (const child of [...nested].reverse()) visit(child, depth + 1);
    else { const hide = (id: string) => { if (seen.has(id)) return; seen.add(id); for (const child of children.get(id) ?? []) hide(child.id); }; for (const child of nested) hide(child.id); }
  };
  for (const layer of [...(children.get(null) ?? [])].reverse()) visit(layer, 0);
  // Malformed/cyclic parents remain visible rather than silently dropping content.
  for (const layer of [...layers].reverse()) visit(layer, 0);
  return rows;
}
export function nativeLayerSelection(orderedIds: string[], selectedIds: string[], clickedId: string, anchorId: string | undefined, modifiers: {shiftKey?:boolean;metaKey?:boolean;ctrlKey?:boolean}) {
  const toggle = modifiers.metaKey || modifiers.ctrlKey;
  const next = nextRangeSelection({ orderedIds, selectedIds, clickedId, anchorId, mode: modifiers.shiftKey ? 'range' : toggle ? 'toggle' : 'single' });
  if (modifiers.shiftKey && toggle) next.selectedIds = orderedIds.filter(id => selectedIds.includes(id) || next.selectedIds.includes(id));
  return next;
}
export const nativeBlendLabel = (mode: string) => ({normal:'正常',multiply:'正片叠底',screen:'滤色'}[mode] ?? `原生模式：${mode}`);
export const nativeLayerReason = (layer: NativeLayerView, capability: keyof NativeLayerView['capabilities'], allowLocked = false) =>
  !layer.capabilities[capability] ? layer.readOnlyReason ?? '此图层不支持这项操作' : layer.locked && !allowLocked ? '图层已锁定，请先解锁' : undefined;
/** A keyboard action can never terminate a pointer-owned gesture as a commit. */
export const nativeLayerGestureKey = (key: string) => key === 'Escape' ? 'cancel' : ['Enter',' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(key) ? 'block' : 'pass';

export type NativeOpacityChange = { readonly layerId: string; readonly before: number; readonly opacity: number };
export type NativeOpacityEvent = { changes: readonly NativeOpacityChange[]; phase: 'preview' | 'commit' | 'cancel' };
export type NativeLayerNameDraftEvent={layerId:string;name:string;composing:boolean;action:'change'|'confirmed'|'discard'};
export const nativeOpacityChanges = (layers: readonly NativeLayerView[], ids: readonly string[], opacity: number, delta?: number): NativeOpacityChange[] =>
  layers.filter(l => ids.includes(l.id) && !nativeLayerReason(l, 'properties')).map(l => ({layerId:l.id,before:l.opacity,opacity:Math.round(Math.max(0,Math.min(1,delta === undefined ? opacity : l.opacity + delta))*100)/100}));

/** One in-flight callback and one replaceable preview. Terminal phases are ordered
 * after previews; a rejected callback keeps the exact input for explicit recovery. */
export class NativeOpacityGesture {
  changes: readonly NativeOpacityChange[];
  error: unknown;
  state: 'active'|'finishing'|'failed'|'committed'|'canceled' = 'active';
  private pending?: readonly NativeOpacityChange[];
  private running?: Promise<void>;
  private failed = false;
  constructor(changes: readonly NativeOpacityChange[], private emit: (event: NativeOpacityEvent) => void | Promise<void>, private changed: () => void = () => {}) { this.changes = changes.map(c => ({...c})); }
  preview(changes: readonly NativeOpacityChange[]) {
    if (this.state !== 'active') return;
    this.changes = changes.map(c => ({...c})); this.pending = this.changes; this.changed(); this.pump();
  }
  private pump() {
    if (this.running) return;
    this.running = (async () => {
      while (this.pending) {
        const changes = this.pending; this.pending = undefined;
        try { await this.emit({changes, phase:'preview'}); }
        catch (error) { this.error = error; this.failed = true; this.state = 'failed'; this.pending = undefined; this.changed(); break; }
      }
    })().finally(() => { this.running = undefined; });
  }
  async finish(phase: 'commit'|'cancel', retry = false) {
    if (this.state === 'finishing' || this.state === 'committed' || this.state === 'canceled') return;
    const failed = this.state === 'failed'; this.state = 'finishing'; this.changed();
    await this.running;
    if (this.failed && phase === 'commit' && !retry) { this.state = 'failed'; this.changed(); throw this.error; }
    try {
      // Recovery must reinstall the intended preview before retrying its commit.
      if (failed && phase === 'commit') await this.emit({changes:this.changes,phase:'preview'});
      await this.emit({changes:this.changes,phase});
      this.error = undefined; this.failed = false; this.state = phase === 'commit' ? 'committed' : 'canceled'; this.changed();
    } catch (error) { this.error = error; this.failed = true; this.state = 'failed'; this.changed(); throw error; }
  }
}
