type ClosestCapableTarget = EventTarget & {
  closest?: (selector: string) => unknown;
};

const ignoredWorkbenchWheelSelector = [
  "input",
  "textarea",
  "select",
  ".recent-menu",
  ".add-shot-menu",
  ".save-menu",
  ".shortcut-menu",
  ".radial-tool-menu",
  ".layer-panel",
  ".ai-draft-panel"
].join(", ");

export const shouldIgnoreWorkbenchWheelTarget = (target: EventTarget | null): boolean => {
  const closest = (target as ClosestCapableTarget | null)?.closest;
  return typeof closest === "function" && Boolean(closest.call(target, ignoredWorkbenchWheelSelector));
};
