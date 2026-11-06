import {describe, expect, it} from 'vitest';
import {defaultWorkspaceLayout, parseWorkspaceLayout} from './layoutPreferences';
import {
  COLLAPSED_COLUMN, DIVIDER_WIDTH, FOLD_TRAVEL, MIN_LEFT_COLUMN, MIN_RIGHT_COLUMN,
  columnMinimums, dividerValue, dividerValueText, dragDivider, gridTemplate, keyboardDivider,
  startDividerDrag, type DividerState,
} from './dockDivider';

const open = (split = 48): DividerState => ({split, collapsed: [false, false]});
const DOCK = 1000;
const available = DOCK - DIVIDER_WIDTH;

describe('dock divider model', () => {
  it('splits the dock between both open columns and keeps the CSS minima', () => {
    const template = gridTemplate(open(48));
    expect(template).toContain(`min(240px, 40%)`);
    expect(template).toContain(`min(260px, 40%)`);
    expect(template).toContain(` ${DIVIDER_WIDTH}px `);
    expect(template).toContain('48fr');
    expect(template).toContain('52fr');
  });

  it('folds only after the pointer passes a column minimum by the travel band', () => {
    const start = startDividerDrag(open(), DOCK);
    expect(start.left).toBeCloseTo(available * 0.48, 5);
    const justInside = dragDivider(start, -(start.left - MIN_LEFT_COLUMN + 1));
    expect(justInside.collapsed).toEqual([false, false]);
    const pastBand = dragDivider(start, -(start.left - MIN_LEFT_COLUMN + FOLD_TRAVEL + 1));
    expect(pastBand.collapsed).toEqual([true, false]);
  });

  it('unfolds in the same gesture only after crossing the whole band back', () => {
    const start = startDividerDrag(open(), DOCK);
    // 216px of a 995px dock: 24px past the 240px minimum, so the column folds.
    const folded = dragDivider(start, -(start.left - MIN_LEFT_COLUMN + FOLD_TRAVEL));
    expect(folded.collapsed[0]).toBe(true);
    // 239px: back inside the band, still folded (no flapping at the fold threshold).
    const inside = dragDivider(start, -(start.left - MIN_LEFT_COLUMN + 1), folded);
    expect(inside.collapsed[0]).toBe(true);
    // 241px: back at the full minimum, unfolded inside the same gesture.
    const back = dragDivider(start, -(start.left - MIN_LEFT_COLUMN - 1), inside);
    expect(back.collapsed).toEqual([false, false]);
    // 240px of a 995px dock is 24.1%, below the 25% floor stored by preferences.
    expect(back.split).toBe(25);
  });

  it('folds the right column symmetrically against its own minimum', () => {
    const start = startDividerDrag(open(), DOCK);
    expect(start.right).toBeCloseTo(available * 0.52, 5);
    const justInside = dragDivider(start, start.right - MIN_RIGHT_COLUMN + 1);
    expect(justInside.collapsed).toEqual([false, false]);
    const pastBand = dragDivider(start, start.right - MIN_RIGHT_COLUMN + FOLD_TRAVEL, justInside);
    expect(pastBand.collapsed).toEqual([false, true]);
    const stillFolded = dragDivider(start, start.right - MIN_RIGHT_COLUMN + 1, pastBand);
    expect(stillFolded.collapsed).toEqual([false, true]);
    const back = dragDivider(start, start.right - MIN_RIGHT_COLUMN - 1, stillFolded);
    expect(back.collapsed).toEqual([false, false]);
  });

  it('moves the split with the pointer while both columns stay open', () => {
    const start = startDividerDrag(open(), DOCK);
    const moved = dragDivider(start, -60);
    expect(moved.collapsed).toEqual([false, false]);
    expect(moved.split).toBeCloseTo((start.left - 60) / available * 100, 1);
    expect(moved.split).toBeGreaterThanOrEqual(25);
  });

  it('keeps a folded column as a 40px rail and leaves the divider between the columns', () => {
    expect(gridTemplate({split: 48, collapsed: [true, false]})).toBe(`40px ${DIVIDER_WIDTH}px minmax(0,1fr)`);
    expect(gridTemplate({split: 48, collapsed: [false, true]})).toBe(`minmax(0,1fr) ${DIVIDER_WIDTH}px 40px`);
    expect(gridTemplate({split: 48, collapsed: [true, true]})).toBe('40px minmax(0,1fr) 40px');
  });

  it('shrinks both minima proportionally when the dock is narrower than their sum', () => {
    const narrow = 600;
    const minimum = columnMinimums(narrow);
    expect(minimum.left).toBeLessThan(MIN_LEFT_COLUMN);
    expect(minimum.right).toBeLessThan(MIN_RIGHT_COLUMN);
    expect(minimum.left + minimum.right).toBeLessThan(narrow);
    // A drag that folds at full width still folds at the same relative place.
    const start = startDividerDrag(open(), narrow);
    expect(dragDivider(start, -(start.left + 1)).collapsed[0]).toBe(true);
  });

  it('keeps the persisted split inside the range layout preferences accepts', () => {
    const start = startDividerDrag(open(25), DOCK);
    const pulled = dragDivider(start, -available);
    expect(pulled.split).toBeGreaterThanOrEqual(25);
    expect(pulled.split).toBeLessThanOrEqual(75);
    const saved = {...defaultWorkspaceLayout(), split: pulled.split, collapsed: pulled.collapsed};
    expect(parseWorkspaceLayout(JSON.stringify(saved))).toEqual(saved);
  });

  it('reports the separator value and text for every fold state', () => {
    expect(dividerValue(open(48))).toBe(48);
    expect(dividerValueText(open(48))).toBe('左栏 48%，右栏 52%');
    expect(dividerValue({split: 48, collapsed: [true, false]})).toBe(0);
    expect(dividerValueText({split: 48, collapsed: [true, false]})).toContain('左栏已折叠');
    expect(dividerValue({split: 48, collapsed: [false, true]})).toBe(100);
    expect(dividerValueText({split: 48, collapsed: [false, true]})).toContain('右栏已折叠');
    expect(dividerValueText({split: 48, collapsed: [true, true]})).toBe('两栏已折叠');
  });

  it('resizes with arrows and folds with Home and End', () => {
    expect(keyboardDivider(open(48), 'ArrowRight', false, DOCK)).toEqual({split: 50, collapsed: [false, false]});
    expect(keyboardDivider(open(48), 'ArrowLeft', true, DOCK)).toEqual({split: 40, collapsed: [false, false]});
    expect(keyboardDivider(open(74), 'ArrowRight', true, DOCK)).toEqual({split: 75, collapsed: [false, false]});
    expect(keyboardDivider(open(48), 'Home', false, DOCK)).toEqual({split: 48, collapsed: [true, false]});
    expect(keyboardDivider(open(48), 'End', false, DOCK)).toEqual({split: 48, collapsed: [false, true]});
    expect(keyboardDivider({split: 48, collapsed: [true, false]}, 'Home', false, DOCK)).toBeUndefined();
    expect(keyboardDivider({split: 48, collapsed: [false, true]}, 'End', false, DOCK)).toBeUndefined();
  });

  it('unfolds from the keyboard at the column minimum', () => {
    const unfolded = keyboardDivider({split: 30, collapsed: [true, false]}, 'ArrowRight', false, DOCK);
    expect(unfolded?.collapsed).toEqual([false, false]);
    expect(unfolded!.split).toBe(30);
    const fromBoth = keyboardDivider({split: 48, collapsed: [true, true]}, 'ArrowLeft', false, DOCK);
    expect(fromBoth).toEqual({split: 48, collapsed: [true, false]});
    expect(COLLAPSED_COLUMN).toBe(40);
  });
});
