export type AutosaveErrorNotice = {
  message: string;
};

export type AutosaveErrorEvent =
  | { type: "failed"; message: string }
  | { type: "saved" }
  | { type: "dismissed" };

export const autosaveErrorReducer = (
  _current: AutosaveErrorNotice | undefined,
  event: AutosaveErrorEvent
): AutosaveErrorNotice | undefined => {
  if (event.type === "failed") {
    return { message: `Autosave failed: ${event.message}` };
  }

  return undefined;
};
