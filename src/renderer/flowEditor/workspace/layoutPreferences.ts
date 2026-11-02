export type WorkspacePanel = 'board' | 'canvas' | 'info' | 'layers' | 'pending';

export const panelLabels: Record<WorkspacePanel, string> = {
  board: '故事板', canvas: '画布', info: '动作与对白', layers: '图层', pending: 'Pending',
};

export type WorkspaceLayout = {
  layout: WorkspacePanel[][];
  hidden: WorkspacePanel[];
  split: number;
  tile: number;
  zoom: number;
  japanese: boolean;
  heights: Partial<Record<WorkspacePanel, number>>;
};

export const layoutKey = 'flow.workbench.layout.v1';
export const defaultWorkspaceLayout = (): WorkspaceLayout => ({
  layout: [['board', 'pending'], ['canvas', 'info', 'layers']],
  hidden: [], split: 48, tile: 220, zoom: 100, japanese: false, heights: {},
});

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
        ![50, 75, 100, 150, 200].includes(value.zoom) || typeof value.japanese !== 'boolean') return fallback;
    const heights = Object.fromEntries(Object.entries(value.heights ?? {}).filter(([id, height]) =>
      panels.includes(id as WorkspacePanel) && typeof height === 'number' && Number.isFinite(height) && height >= 100 && height <= 10000));
    return {layout: value.layout, hidden: value.hidden, split: value.split, tile: value.tile,
      zoom: value.zoom, japanese: value.japanese, heights};
  } catch { return fallback; }
}

export function readWorkspaceLayout(): WorkspaceLayout {
  try { return parseWorkspaceLayout(localStorage.getItem(layoutKey)); }
  catch { return defaultWorkspaceLayout(); }
}

export function writeWorkspaceLayout(value: WorkspaceLayout): void {
  try { localStorage.setItem(layoutKey, JSON.stringify(value)); }
  catch { /* Layout remains usable when local profile storage is unavailable. */ }
}
