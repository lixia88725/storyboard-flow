import type { ReactNode } from 'react';
import './workspaceToolRail.css';

export type WorkspaceTool = 'brush' | 'eraser' | 'select' | 'blur';

type Props = {
  tool: WorkspaceTool;
  disabled: boolean;
  canChangeTool: boolean;
  /** Preserve appearance while a paint acknowledgement temporarily locks switching. */
  paintInFlight?: boolean;
  onToolChange: (tool: WorkspaceTool) => void;
  color: string;
  onColorChange: (color: string) => void;
  size: number;
  onSizeChange: (size: number) => void;
  blurRadius: number;
  onBlurRadiusChange: (radius: number) => void;
  onApplyBlur: () => void;
  footer?: ReactNode;
};

const tools: { id: WorkspaceTool; label: string; glyph: string; keys: string }[] = [
  {id: 'brush', label: '画笔', glyph: 'M14.5 4.5a2.1 2.1 0 0 1 3 3L9 16l-4 1 1-4z M13 6l3 3', keys: 'B'},
  {id: 'eraser', label: '橡皮', glyph: 'm4 12 8-8a1.5 1.5 0 0 1 2 0l4 4a1.5 1.5 0 0 1 0 2l-7 7H8z M8 8l6 6 M11 17h8', keys: 'E'},
  {id: 'select', label: '选区', glyph: 'M4 8V5h3 M10 5h3 M16 5h2v3 M18 11v3 M18 16v2h-3 M12 18H9 M6 18H4v-3 M4 12v-1', keys: 'L'},
  {id: 'blur', label: '模糊', glyph: 'M11 3c-2 4-6 7-6 10a6 6 0 1 0 12 0c0-3-4-6-6-10z M8 13a3 3 0 0 0 3 3', keys: 'K'},
];

export function WorkspaceToolRail(p: Props) {
  return <aside className="wb-tool-rail" aria-label="绘制工具">
    <div className="wb-tool-rail-list" data-waiting={!p.disabled && !p.canChangeTool && p.paintInFlight}>{tools.map(({id,label,glyph,keys}) =>
      <button key={id} type="button" aria-label={label} title={`${label} (${keys})`} aria-keyshortcuts={keys.toLowerCase()} aria-pressed={p.tool===id}
        disabled={p.disabled || !p.canChangeTool} onClick={() => p.onToolChange(id)}>
        <svg className="wb-tool-glyph" viewBox="0 0 22 22" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={glyph}/></svg><span>{label}</span>
      </button>)}</div>
    <div className="wb-tool-options">
      {(p.tool==='brush' || p.tool==='eraser') && <>
        {p.tool==='brush' && <label>颜色<input aria-label="画笔颜色" type="color" value={p.color}
          disabled={p.disabled} onChange={e=>p.onColorChange(e.target.value)}/></label>}
        <label>笔径 <output>{p.size}</output><input aria-label="画笔大小" aria-orientation="vertical" type="range" min="1" max="100"
          value={p.size} disabled={p.disabled} onChange={e=>p.onSizeChange(Number(e.target.value))}/></label>
      </>}
      {p.tool==='blur' && <><label>半径 <output>{p.blurRadius}</output><input aria-label="模糊半径" aria-orientation="vertical" type="range" min="1" max="50"
        value={p.blurRadius} disabled={p.disabled} onChange={e=>p.onBlurRadiusChange(Number(e.target.value))}/></label>
        <button type="button" className="wb-apply-blur" title="对当前图层或选区应用模糊" disabled={p.disabled} onClick={p.onApplyBlur}>应用模糊</button></>}
    </div>
    {p.footer && <div className="wb-tool-rail-footer">{p.footer}</div>}
  </aside>;
}
