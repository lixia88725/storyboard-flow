import {describe, expect, it} from 'vitest';
import {defaultWorkspaceLayout, parseWorkspaceLayout} from './layoutPreferences';

describe('workbench layout preferences', () => {
  it('restores a valid hidden Pending panel and its dock position', () => {
    const saved = {...defaultWorkspaceLayout(), hidden: ['pending'], split: 62, heights: {pending: 180}};
    expect(parseWorkspaceLayout(JSON.stringify(saved))).toEqual(saved);
  });

  it('rejects duplicated, unknown, and invalid panel arrangements', () => {
    const defaults = defaultWorkspaceLayout();
    expect(parseWorkspaceLayout(JSON.stringify({...defaults, layout: [['board', 'board'], ['canvas', 'info', 'layers']]}))).toEqual(defaults);
    expect(parseWorkspaceLayout(JSON.stringify({...defaults, hidden: ['pending', 'pending']}))).toEqual(defaults);
    expect(parseWorkspaceLayout(JSON.stringify({...defaults, split: 110}))).toEqual(defaults);
    expect(parseWorkspaceLayout('{')).toEqual(defaults);
  });

  it('discards invalid heights without losing an otherwise valid layout', () => {
    const saved = {...defaultWorkspaceLayout(), heights: {board: -4, canvas: 300, wrong: 500}};
    expect(parseWorkspaceLayout(JSON.stringify(saved)).heights).toEqual({canvas: 300});
  });
});
