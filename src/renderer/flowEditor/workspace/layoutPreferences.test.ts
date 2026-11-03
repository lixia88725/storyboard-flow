import {beforeEach, describe, expect, it, vi} from 'vitest';
import {defaultWorkspaceLayout, layoutKey, legacyLayoutKey, parseWorkspaceLayout, readWorkspaceLayout, writeWorkspaceLayout} from './layoutPreferences';

const makeStorage = (): Storage => {
  const map = new Map<string, string>();
  return {
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => [...map.keys()][index] ?? null,
    removeItem: (key: string) => { map.delete(key); },
    setItem: (key: string, value: string) => { map.set(key, value); }
  };
};

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

  it('defaults the canvas to fit', () => {
    expect(defaultWorkspaceLayout().zoom).toBe('fit');
  });

  it('accepts fit and the numeric steps, and rejects other zoom values', () => {
    const defaults = defaultWorkspaceLayout();
    expect(parseWorkspaceLayout(JSON.stringify({...defaults, zoom: 'fit'})).zoom).toBe('fit');
    expect(parseWorkspaceLayout(JSON.stringify({...defaults, zoom: 150})).zoom).toBe(150);
    expect(parseWorkspaceLayout(JSON.stringify({...defaults, zoom: 110}))).toEqual(defaults);
    expect(parseWorkspaceLayout(JSON.stringify({...defaults, zoom: 'wide'}))).toEqual(defaults);
  });
});

describe('layout migration to the fit canvas', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', makeStorage());
  });

  it('adopts fit once for an existing v1 layout and keeps the arranged panels', () => {
    const legacy = {...defaultWorkspaceLayout(), zoom: 100, split: 61, hidden: ['pending'], heights: {board: 260}};
    localStorage.setItem(legacyLayoutKey, JSON.stringify(legacy));

    const restored = readWorkspaceLayout();

    expect(restored.zoom).toBe('fit');
    expect(restored.split).toBe(61);
    expect(restored.hidden).toEqual(['pending']);
    expect(restored.heights).toEqual({board: 260});
    expect(JSON.parse(localStorage.getItem(layoutKey)!).zoom).toBe('fit');
  });

  it('keeps a zoom the user chooses after the migration', () => {
    writeWorkspaceLayout({...defaultWorkspaceLayout(), zoom: 150});
    localStorage.setItem(legacyLayoutKey, JSON.stringify({...defaultWorkspaceLayout(), zoom: 75}));

    expect(readWorkspaceLayout().zoom).toBe(150);
  });

  it('starts from fit when nothing has been stored yet', () => {
    expect(readWorkspaceLayout().zoom).toBe('fit');
  });
});
