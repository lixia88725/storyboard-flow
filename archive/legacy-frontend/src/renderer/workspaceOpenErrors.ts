export const formatWorkspaceOpenError = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error);
  return `Could not open folder: ${message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')}`;
};
