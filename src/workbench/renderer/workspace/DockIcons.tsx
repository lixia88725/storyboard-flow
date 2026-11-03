import type {WorkspacePanel} from './layoutPreferences';
const paths:Record<WorkspacePanel,string>={
 board:'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
 canvas:'M3 5h18v14H3z M3 15l5-5 4 4 3-3 6 6 M15 8h.01',
 info:'M4 4h16v12H9l-5 4z M8 8h8 M8 12h5',
 layers:'M12 3L2 8l10 5 10-5z M2 12l10 5 10-5 M2 16l10 5 10-5',
 pending:'M3 6h18v15H3z M8 6V3h8v3 M8 11h8',
};
export function DockPanelIcon({panel}:{panel:WorkspacePanel}){return <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true"><path d={paths[panel]}/></svg>;}
export function DockChevron({right}:{right:boolean}){return <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.3" aria-hidden="true" style={{transform:right?'rotate(180deg)':undefined}}><path d="m7 4-4 4 4 4m5-8-4 4 4 4"/></svg>;}
