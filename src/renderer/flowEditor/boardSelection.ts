/** UI-only selection; project membership/order always comes from Session. */
export function selectShots(order: readonly string[], selected: readonly string[], anchor: string | undefined, id: string,
  modifiers: { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean }): string[] {
  if (!order.includes(id)) return selected.filter(s => order.includes(s));
  if (modifiers.shiftKey && anchor && order.includes(anchor)) {
    const a = order.indexOf(anchor), b = order.indexOf(id);
    return order.slice(Math.min(a, b), Math.max(a, b) + 1);
  }
  if (modifiers.metaKey || modifiers.ctrlKey) {
    const set = new Set(selected); if (set.has(id)) set.delete(id); else set.add(id);
    return order.filter(s => set.has(s));
  }
  return [id];
}
export function draggedShots(order: readonly string[], selected: readonly string[], dragged: string): string[] {
  return selected.includes(dragged) ? order.filter(id => selected.includes(id)) : order.filter(id => id === dragged);
}
