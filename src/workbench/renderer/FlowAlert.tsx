/** Electron wraps every rejected invoke with the channel name; that prefix is an
 * implementation detail, not something to show the user. */
export function errorText(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw.replace(/^Error invoking remote method '[^']*':\s*(?:Error:\s*)?/, '');
}

/** A blocked action is reported where the user is looking, not only in the
 * corner status line: opening, creating and switching projects all fail here. */
export function FlowAlert({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  if (!message) return null;
  return <div className="flow-alert" role="alert" data-flow-alert="true">
    <strong>没有完成</strong>
    <p>{message}</p>
    <button type="button" onClick={onDismiss} aria-label="关闭这条提示">关闭</button>
  </div>;
}
