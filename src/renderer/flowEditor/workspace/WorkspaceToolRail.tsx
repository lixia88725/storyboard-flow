import type { ReactNode } from 'react';
import './workspaceToolRail.css';

export type WorkspaceTool = 'brush' | 'eraser' | 'select' | 'blur';

type Props = {
  tool: WorkspaceTool;
  disabled: boolean;
  canChangeTool: boolean;
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

const tools: { id: WorkspaceTool; label: string; glyph: string }[] = [
  {id: 'brush', label: '画笔', glyph: '✎'},
  {id: 'eraser', label: '橡皮', glyph: '▱'},
  {id: 'select', label: '选区', glyph: '▣'},
  {id: 'blur', label: '模糊', glyph: '◌'},
];

export function WorkspaceToolRail(p: Props) {
  return <aside className="wb-tool-rail" aria-label="绘制工具">
    <div className="wb-tool-rail-list">{tools.map(({id,label,glyph}) =>
      <button key={id} type="button" aria-label={label} title={label} aria-pressed={p.tool===id}
        disabled={p.disabled || !p.canChangeTool} onClick={() => p.onToolChange(id)}>
        <span className="wb-tool-glyph" aria-hidden="true">{glyph}</span><span>{label}</span>
      </button>)}</div>
    <div className="wb-tool-options">
      {(p.tool==='brush' || p.tool==='eraser') && <>
        {p.tool==='brush' && <label>颜色<input aria-label="画笔颜色" type="color" value={p.color}
          disabled={p.disabled} onChange={e=>p.onColorChange(e.target.value)}/></label>}
        <label>笔径 <output>{p.size}</output><input aria-label="画笔大小" type="range" min="1" max="100"
          value={p.size} disabled={p.disabled} onChange={e=>p.onSizeChange(Number(e.target.value))}/></label>
      </>}
      {p.tool==='blur' && <><label>半径 <output>{p.blurRadius}</output><input aria-label="模糊半径" type="range" min="1" max="50"
        value={p.blurRadius} disabled={p.disabled} onChange={e=>p.onBlurRadiusChange(Number(e.target.value))}/></label>
        <button type="button" className="wb-apply-blur" title="对当前图层或选区应用模糊" disabled={p.disabled} onClick={p.onApplyBlur}>应用模糊</button></>}
    </div>
    {p.footer && <div className="wb-tool-rail-footer">{p.footer}</div>}
  </aside>;
}
