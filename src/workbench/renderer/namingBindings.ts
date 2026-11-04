export type BoundOutputName = { shotId: string; name: string };

/** One read of the project's bound filenames. `token` identifies the read this state
 * belongs to, so a late answer for an older read can never be mistaken for current. */
export type BindingRead =
  | { status: 'loading'; token: symbol }
  | { status: 'ready'; token: symbol; names: BoundOutputName[] }
  | { status: 'error'; token: symbol; message: string };

export const beginBindingRead = (token: symbol): BindingRead => ({ status: 'loading', token });

/** Only the read that owns the current token may publish; a superseded or late answer
 * leaves the state untouched, so stale names never become applicable. */
export function settleBindingRead(state: BindingRead, token: symbol,
  outcome: { names: BoundOutputName[] } | { error: string }): BindingRead {
  if (state.token !== token) return state;
  return 'names' in outcome
    ? { status: 'ready', token, names: outcome.names }
    : { status: 'error', token, message: outcome.error };
}

/** Apply is allowed only for a ready read of the current token; loading, error and
 * stale states all refuse. */
export const canApplyBinding = (state: BindingRead): boolean => state.status === 'ready';
