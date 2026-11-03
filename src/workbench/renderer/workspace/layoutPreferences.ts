export type WorkspacePanel = 'board' | 'canvas' | 'info' | 'layers' | 'pending';

export const panelLabels: Record<WorkspacePanel, string> = {
  board: '故事板', canvas: '画布', info: '动作与对白', layers: '图层', pending: 'Pending',
};

export type WorkspaceZoom = number | "fit";

export type WorkspaceLayout = {
  layout: WorkspacePanel[][];
  hidden: WorkspacePanel[];
  split: number;
  tile: number;
  zoom: WorkspaceZoom;
  japanese: boolean;
  collapsed: [boolean, boolean];
  heights: Partial<Record<WorkspacePanel, number>>;
};

/** Zoom steps offered in the canvas panel; "fit" shows the whole canvas. */
export const workspaceZoomSteps = [50, 75, 100, 150, 200] as const;

export const layoutKey = 'flow.workbench.layout.v2';
export const legacyLayoutKey = 'flow.workbench.layout.v1';
export const defaultWorkspaceLayout = (): WorkspaceLayout => ({
  layout: [['board', 'pending'], ['canvas', 'info', 'layers']],
  hidden: [], split: 48, tile: 220, zoom: 'fit', japanese: false, collapsed: [false,false], heights: {},
});

const validZoom = (zoom: unknown): zoom is WorkspaceZoom =>
  zoom === 'fit' || (typeof zoom === 'number' && (workspaceZoomSteps as readonly number[]).includes(zoom));

export function parseWorkspaceLayout(raw: string | null): WorkspaceLayout {
  const fallback = defaultWorkspaceLayout();
  try {
    const value = JSON.parse(raw || 'null');
    const panels = Object.keys(panelLabels) as WorkspacePanel[];
    if (!Array.isArray(value?.layout) || value.layout.length !== 2 ||
        !value.layout.every((column: unknown) => Array.isArray(column) && column.every((id: unknown) => typeof id === 'string' && panels.includes(id as WorkspacePanel))) ||
        value.layout.flat().slice().sort().join() !== panels.slice().sort().join() ||
        !Array.isArray(value.hidden) || !value.hidden.every((id: unknown) => typeof id === 'string' && panels.includes(id as WorkspacePanel)) ||
        new Set(value.hidden).size !== value.hidden.length ||
        !Number.isFinite(value.split) || value.split < 25 || value.split > 75 ||
        !Number.isFinite(value.tile) || value.tile < 150 || value.tile > 460 ||
        !validZoom(value.zoom) || typeof value.japanese !== 'boolean') return fallback;
    const heights = Object.fromEntries(Object.entries(value.heights ?? {}).filter(([id, height]) =>
      panels.includes(id as WorkspacePanel) && typeof height === 'number' && Number.isFinite(height) && height >= 36 && height <= 10000));
    return {layout: value.layout, hidden: value.hidden, split: value.split, tile: value.tile,
      zoom: value.zoom, japanese: value.japanese, heights,
      collapsed: Array.isArray(value.collapsed)&&value.collapsed.length===2&&value.collapsed.every((v:unknown)=>typeof v==='boolean') ? value.collapsed : [false,false]};
  } catch { return fallback; }
}

export function readWorkspaceLayout(): WorkspaceLayout {
  try {
    const current = localStorage.getItem(layoutKey);
    if (current !== null) return parseWorkspaceLayout(current);
    const legacy = localStorage.getItem(legacyLayoutKey);
    if (legacy === null) return defaultWorkspaceLayout();
    // One-time upgrade: keep the arranged panels, adopt the new fit default for the canvas.
    const migrated: WorkspaceLayout = { ...parseWorkspaceLayout(legacy), zoom: 'fit' };
    writeWorkspaceLayout(migrated);
    return migrated;
  } catch { return defaultWorkspaceLayout(); }
}

export function writeWorkspaceLayout(value: WorkspaceLayout): void {
  try { localStorage.setItem(layoutKey, JSON.stringify(value)); }
  catch { /* Layout remains usable when local profile storage is unavailable. */ }
}
