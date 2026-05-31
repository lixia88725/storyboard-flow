const temporaryRenameConflictPrefix = "Temporary rename file already exists:";

export const formatSaveFailureStatus = (message: string): string => {
  const conflictIndex = message.indexOf(temporaryRenameConflictPrefix);

  if (conflictIndex === -1) {
    return `Save failed: ${message}`;
  }

  const temporaryPath = message.slice(conflictIndex + temporaryRenameConflictPrefix.length).trim();
  return [
    "Save failed: Save stopped because a temporary rename file already exists.",
    "Move or delete the .storyboard-renaming-* file in the folder, then try Save again.",
    `Details: ${temporaryPath}`
  ].join(" ");
};
