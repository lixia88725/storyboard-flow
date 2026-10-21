export type RetainedAssetIntent = { workspace: string; assetId: string; desiredBytes: Uint8Array };
export type AssetOperationLease = { readonly identity: object };
// Control-flow exit ONLY after the original effect, private history and bound
// persistence ACK completed. Unlike cancellation, admission consumes this intent.
export const completedWithoutPublication = Object.freeze({ status: 'completed-without-publication' as const });
export const isCompletedWithoutPublication = (value: unknown): value is typeof completedWithoutPublication => value === completedWithoutPublication;
export class CompletedWithoutPublication extends Error {
  constructor() { super('Painting workspace changed; PNG retained without stale publication'); }
}
export const cancelledBeforeEffect = Object.freeze({ status: 'cancelled-before-effect' as const });
export const isCancelledBeforeEffect = (value: unknown): value is typeof cancelledBeforeEffect =>
  !!value && typeof value === 'object' && 'status' in value && value.status === 'cancelled-before-effect';
export type AssetIntentResult<T> = T | typeof cancelledBeforeEffect | typeof completedWithoutPublication;

// A small scheduling seam, not a command log. run must encompass first effect,
// descriptor publication and required persistence ACK. Calling from inside that
// same run/queue to beginOperation is forbidden: freeze occurs outside exclusive.
export const createAssetIntentAdmission = (consumeCompletion?: (signal: unknown, executing: RetainedAssetIntent) => boolean) => {
  type Intent = { retained: RetainedAssetIntent; run: (value: RetainedAssetIntent) => Promise<unknown>; resolve: (value: unknown) => void; reject: (reason: unknown) => void; failure?: unknown; state: 'waiting' | 'started' | 'failed' | 'cancelled-before-effect' };
  const intents = new Set<Intent>();
  const started = new Set<Promise<unknown>>();
  // The descriptor and required ACK belong to the same producer turn. A later
  // Add cannot publish new asset bindings while a paint's persistence is in flight.
  let tail: Promise<unknown> = Promise.resolve();
  let lease: AssetOperationLease | undefined;
  let protectedFailure: unknown;
  let suspended = false;
  const detach = (value: RetainedAssetIntent): RetainedAssetIntent => ({ workspace: value.workspace, assetId: value.assetId, desiredBytes: new Uint8Array(value.desiredBytes) });
  const execute = (intent: Intent) => {
    const action = tail.then(() => {
      if (suspended) return cancelledBeforeEffect;
      if (protectedFailure) throw new Error('Earlier producer failed: desired intent retained without effects');
      intent.state = 'started';
      const executing = detach(intent.retained);
      return intent.run(executing).then(result => {
        // Public display values are never receipts. Only the owner's private
        // one-shot signal can authorize this exact executing object.
        if (isCompletedWithoutPublication(result)) throw new Error('Uncertified intent completion result');
        return result;
      }).catch(error => {
        if (consumeCompletion?.(error, executing)) return completedWithoutPublication;
        throw error;
      });
    });
    tail = action.catch(() => undefined);
    started.add(action);
    void action.then(result => {
      if (isCancelledBeforeEffect(result)) intent.state = 'cancelled-before-effect';
      else intents.delete(intent);
      intent.resolve(result);
    }, error => {
      intent.state = 'failed'; intent.failure = error; protectedFailure = error; intent.reject(error);
    }).finally(() => { started.delete(action); });
  };
  const submit = <T>(value: RetainedAssetIntent, run: (value: RetainedAssetIntent) => Promise<T>): Promise<AssetIntentResult<T>> => {
    if (!value.workspace || !value.assetId || !(value.desiredBytes instanceof Uint8Array)) return Promise.reject(new Error('Incomplete desired asset intent'));
    const retained = detach(value);
    return new Promise<AssetIntentResult<T>>((resolve, reject) => {
      const intent: Intent = { retained, run, resolve: result => resolve(result as AssetIntentResult<T>), reject, state: 'waiting' };
      intents.add(intent);
      if (protectedFailure) { intent.state = 'failed'; reject(new Error('Protected workspace: intent retained without effects')); }
      else if (suspended) { intent.state = 'cancelled-before-effect'; resolve(cancelledBeforeEffect); }
      else if (!lease) execute(intent);
    });
  };
  const beginOperation = async (): Promise<AssetOperationLease> => {
    if (lease || protectedFailure) throw new Error('Asset admission already frozen/protected');
    const own = Object.freeze({ identity: Object.freeze({}) }); lease = own;
    // Snapshot only already-admitted producers. Newly submitted intents remain
    // outside the bitmap queue, so final persistence never waits behind itself.
    const admitted = [...started];
    const results = await Promise.allSettled(admitted);
    if (results.some(result => result.status === 'rejected') || protectedFailure) {
      protectedFailure ||= new Error('Admitted producer did not fully ACK');
      throw new Error('Cannot prepare until admitted producers fully settle and ACK');
    }
    return own;
  };
  const verify = (candidate: AssetOperationLease) => {
    if (!lease || candidate !== lease) throw new Error('Wrong/stale operation lease');
  };
  const completeOperation = (candidate: AssetOperationLease) => {
    verify(candidate);
    if (protectedFailure) throw new Error('Protected producer cannot be cleared by completion');
    lease = undefined;
    // Preserve submission order. Each existing producer still owns its real
    // bitmap queue; this seam does not await any task from inside Save exclusive.
    if (!suspended) for (const intent of intents) if (intent.state === 'waiting') execute(intent);
  };
  const failOperation = (candidate: AssetOperationLease, reason: unknown) => {
    verify(candidate); protectedFailure = reason || new Error('Operation unknown');
    for (const intent of intents) if (intent.state === 'waiting') { intent.state = 'failed'; intent.reject(new Error('Operation failed: desired intent retained, no asset effect started')); }
  };
  const beginIdleOperation = (): AssetOperationLease | undefined => {
    if (started.size || lease || protectedFailure) return undefined;
    const own = Object.freeze({ identity: Object.freeze({}) }); lease = own; return own;
  };
  const matchingFailure = (error: unknown) => {
    const failed = [...intents].filter(i => i.state === 'failed');
    return error !== undefined && protectedFailure === error && failed.length === 1 && failed[0].failure === error ? failed[0] : undefined;
  };
  // This is only a freeze, never permission to replay run or clear failure. The
  // owner still has to prove its exact pre-effect PNG and original bound ACK.
  const beginRecoveryOperation = (error: unknown): AssetOperationLease | undefined => {
    if (started.size || !matchingFailure(error)) return undefined;
    lease ??= Object.freeze({ identity: Object.freeze({}) });
    return lease;
  };
  const completeFailedIntent = (error: unknown) => {
    const intent = matchingFailure(error);
    if (!lease || !intent) return false;
    intents.delete(intent); protectedFailure = undefined;
    return true;
  };
  const suspend = async () => {
    suspended = true;
    for (const intent of intents) if (intent.state === 'waiting') {
      intent.state = 'cancelled-before-effect'; intent.resolve(cancelledBeforeEffect);
    }
    // Failure is preserved, not treated as a successful ACK. Wait for actual
    // handlers; cancellation cannot interrupt an already-started native effect.
    await Promise.allSettled([...started]);
  };
  // Close cancellation reopens only NEW admission. Revoked closures/intents are
  // never replayed and failures remain protected.
  const resume = () => { suspended = false; };
  return { isBusy: () => started.size > 0 || [...intents].some(intent => intent.state === 'waiting'), submit, suspend, resume, beginIdleOperation, beginOperation, beginRecoveryOperation, completeFailedIntent, completeOperation, failOperation,
    retainedIntents: () => [...intents].map(intent => ({ ...detach(intent.retained), state: intent.state })) };
};
