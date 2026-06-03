export const saveAndCloseButtonIndex = 0;
export const closeWithoutSavingButtonIndex = 1;

export const shouldSaveBeforeClose = (buttonIndex: number): boolean =>
  buttonIndex === saveAndCloseButtonIndex;

export const shouldCloseAfterUnsavedChangesPrompt = (buttonIndex: number): boolean =>
  buttonIndex === closeWithoutSavingButtonIndex;
