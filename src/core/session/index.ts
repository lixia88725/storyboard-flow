import type {
  FlowCheckpointState, FlowFailure, FlowResult, FlowSession, FlowSessionOptions,
  FlowSessionOutcome, FlowSessionRequest, FlowSessionSnapshot
} from '../../../electron/shared/flowWave2';
import type { AssetReaderV1, CheckpointReceiptV1, ProjectEditResultV1, ProjectV1, ResultV1 } from '../../../electron/shared/refactorV1';
import { applyImageEdit } from '../drawing';
import { createProjectHistory, type ProjectHistoryV1 } from '../storyboard';
import { codes, copy, failure, id, positive, record, same, snapshotRequest, validFailure } from './validation';

type Task = { request: FlowSessionRequest; finish: (result: FlowResult<boolean>) => void };
type ErrorEntry = { serial: number; error: FlowFailure };
class AssetReadFailure extends Error {
  constructor(readonly failure: FlowFailure) { super(failure.message); }
}

/** Headless wave-two composition only. No production root, IPC, TIFF or Close authority. */
export function createFlowSession(options: FlowSessionOptions): FlowResult<FlowSession> {
  try {
    if (!options || !id(options.sessionId) || !id(options.incarnation) || !positive(options.maxPendingRequests) ||
        !options.assets || typeof options.assets.put !== 'function' || typeof options.assets.read !== 'function' ||
        !options.pixels || typeof options.pixels.produce !== 'function' || !options.clock ||
        typeof options.clock.setTimeout !== 'function' || typeof options.clock.clearTimeout !== 'function' || typeof options.checkpoint !== 'function')
      return failure('invalid-input', 'Invalid session options');
    const initialized = createProjectHistory(copy(options.project), { maxEntries: options.maxHistoryEntries });
    if (!initialized.ok) return { ok: false, error: { ...initialized.error, effect: 'none' } };
    return { ok: true, value: session(options, initialized.value) };
  } catch {
    return failure('invalid-input', 'Session options could not be snapshotted');
  }
}

function session(options: FlowSessionOptions, history: ProjectHistoryV1): FlowSession {
  const sessionId = options.sessionId, incarnation = options.incarnation;
  const maxPending = options.maxPendingRequests, maxHistory = options.maxHistoryEntries;
  // Capture methods too: replacing the caller's options after construction changes no dependency.
  const produce = options.pixels.produce.bind(options.pixels), put = options.assets.put.bind(options.assets);
  const read = options.assets.read.bind(options.assets), checkpoint = options.checkpoint.bind(options);
  const setTimeout = options.clock.setTimeout.bind(options.clock), clearTimeout = options.clock.clearTimeout.bind(options.clock);
  let phase: FlowSessionSnapshot['phase'] = 'active', pending = 0;
  let checkpointState: FlowCheckpointState | null = null;
  let errorSerial = 0, checkpointError: ErrorEntry | null = null, operationError: ErrorEntry | null = null;
  let undoDepth = 0, redoDepth = 0, generation = 0, operationSerial = 0;
  let timer: { handle: unknown } | null = null, timerGeneration = 0;
  let wanted: ProjectV1 | null = null, ready = false;
  let flight: { revision: number; promise: Promise<FlowResult<boolean>> } | null = null;
  const listeners = new Set<() => void>(), queue: Task[] = [];
  const detached = new Set<Promise<void>>();
  let running = false, painting = false;
  let freezePromise: Promise<FlowResult<FlowSessionOutcome>> | null = null;
  const current = (): ProjectV1 => {
    const result = history.current();
    if (!result.ok) throw new Error('Installed history became unavailable');
    return result.value;
  };
  const snapshot = (): FlowSessionSnapshot => {
    const latestError = !checkpointError ? operationError : !operationError ? checkpointError :
      checkpointError.serial > operationError.serial ? checkpointError : operationError;
    return { sessionId, incarnation, project: current(), phase, pending,
      checkpoint: copy(checkpointState), lastError: latestError ? copy(latestError.error) : null };
  };
  const notify = () => {
    for (const listener of [...listeners]) {
      try { void Promise.resolve(listener()).catch(() => undefined); } catch { /* Observers cannot fail a committed edit. */ }
    }
  };
  const remember = (error: FlowFailure, source: 'checkpoint' | 'operation') => {
    const entry = { serial: ++errorSerial, error: copy(error) };
    if (source === 'checkpoint') checkpointError = entry;
    else operationError = entry;
  };
  const unexpected = (error: unknown, effect: FlowFailure['effect']): FlowResult<never> =>
    error instanceof AssetReadFailure ? { ok: false, error: copy(error.failure) } :
      failure('io-failure', error instanceof Error ? error.message : 'Dependency threw an exception', effect);
  const dependencyResult = <T>(value: FlowResult<T>, effect: FlowFailure['effect']): FlowResult<T> => {
    if (!record(value) || typeof value.ok !== 'boolean') return failure('io-failure', 'Malformed dependency result', effect);
    if (!value.ok) return validFailure(value.error) ? { ok: false, error: copy(value.error) } : failure('io-failure', 'Malformed dependency failure', effect);
    return value;
  };
  const assetReader = (onFailure: (error: FlowFailure) => void): AssetReaderV1 => async assetId => {
    let result;
    try { result = dependencyResult(await read(assetId), 'none'); }
    catch (error) { result = unexpected(error, 'none'); }
    if (!result.ok) { onFailure(result.error); throw new AssetReadFailure(result.error); }
    if (!(result.value instanceof Uint8Array)) {
      const error: FlowFailure = { code: 'io-failure', message: 'Asset reader returned invalid bytes', effect: 'none' };
      onFailure(error); throw new AssetReadFailure(error);
    }
    return result.value.slice();
  };
  const cancelTimer = (): FlowResult<boolean> => {
    timerGeneration++;
    if (timer) { try { clearTimeout(timer.handle); timer = null; } catch (error) {
      const result = unexpected(error, 'none');
      if (!result.ok) remember(result.error, 'operation');
      return result;
    } }
    return { ok: true, value: false };
  };
  const startCheckpoint = (captured: ProjectV1): Promise<FlowResult<boolean>> => {
    const owned = { revision: captured.revision, promise: undefined as unknown as Promise<FlowResult<boolean>> };
    flight = owned; ready = false;
    owned.promise = Promise.resolve().then(async (): Promise<FlowResult<boolean>> => {
      let readError: FlowFailure | null = null;
      try {
        const result = await checkpoint(copy(captured), assetReader(error => { readError ??= copy(error); }));
        if (readError) return { ok: false, error: { ...(readError as FlowFailure), effect: 'unknown' } };
        if (!record(result) || typeof result.ok !== 'boolean') return failure('io-failure', 'Malformed checkpoint result', 'unknown');
        if (!result.ok) {
          if (!record(result.error) || typeof result.error.code !== 'string' || !codes.slice(0, 8).includes(result.error.code) || typeof result.error.message !== 'string')
            return failure('io-failure', 'Malformed checkpoint failure', 'unknown');
          return { ok: false, error: { ...result.error, effect: 'unknown' } };
        }
        const receipt = copy(result.value);
        if (!receipt || receipt.projectId !== captured.id || receipt.revision !== captured.revision || typeof receipt.manifestPath !== 'string' || !receipt.manifestPath)
          return failure('conflict', 'Checkpoint receipt does not match captured project/revision', 'unknown');
        checkpointState = { sessionId, incarnation, revision: captured.revision, receipt };
        checkpointError = null;
        return { ok: true, value: false };
      } catch (error) {
        return readError ? { ok: false, error: { ...(readError as FlowFailure), effect: 'unknown' } } : unexpected(error, 'unknown');
      }
    }).then(result => {
      if (!result.ok) remember(result.error, 'checkpoint');
      if (result.ok && wanted && wanted.revision <= captured.revision) wanted = null;
      flight = null;
      notify();
      // Retry only a newer edit whose debounce has elapsed, never the failed same target.
      if (phase === 'active' && ready && wanted && wanted.revision > captured.revision) autoCheckpoint();
      return copy(result);
    });
    return owned.promise;
  };
  const autoCheckpoint = () => {
    if (phase === 'active' && ready && wanted && !flight) {
      if (checkpointState && checkpointState.revision >= wanted.revision) { wanted = null; ready = false; return; }
      void startCheckpoint(copy(wanted));
    }
  };
  const scheduleCheckpoint = () => {
    wanted = current(); ready = false;
    if (!cancelTimer().ok) return;
    if (phase !== 'active') return;
    const token = timerGeneration;
    try {
      timer = { handle: setTimeout(() => {
        if (token !== timerGeneration || phase !== 'active') return;
        timer = null; ready = true; autoCheckpoint();
      }, 600) };
    } catch (error) {
      const result = unexpected(error, 'none'); if (!result.ok) remember(result.error, 'checkpoint');
    }
  };
  const flush = async (): Promise<FlowResult<boolean>> => {
    const cancelled = cancelTimer();
    if (!cancelled.ok) return cancelled;
    const target = current();
    if (!wanted || wanted.revision < target.revision) wanted = target;
    while (!checkpointState || checkpointState.revision < target.revision) {
      const attempt = flight ?? { revision: wanted.revision, promise: startCheckpoint(copy(wanted)) };
      const result = await attempt.promise;
      if (!result.ok && attempt.revision >= target.revision) return result;
      if (!wanted || wanted.revision < target.revision) wanted = target;
    }
    return { ok: true, value: false };
  };
  const installed = (result: ResultV1<ProjectEditResultV1>, navigation?: 'undo' | 'redo'): FlowResult<boolean> => {
    if (!result.ok) return { ok: false, error: { ...result.error, effect: 'none' } };
    if (result.value.changed) {
      if (navigation === 'undo') { undoDepth--; redoDepth = Math.min(maxHistory, redoDepth + 1); }
      else if (navigation === 'redo') { redoDepth--; undoDepth = Math.min(maxHistory, undoDepth + 1); }
      else { undoDepth = Math.min(maxHistory, undoDepth + 1); redoDepth = 0; }
      scheduleCheckpoint(); notify();
    }
    return { ok: true, value: result.value.changed };
  };
  const board = (request: Extract<FlowSessionRequest, { kind: 'board' }>): FlowResult<boolean> => {
    const project = current(), command = request.command;
    const ids = command.kind === 'setScriptText' ? [command.shotId] : [...command.shotIds, ...(command.beforeId ? [command.beforeId] : [])];
    if (ids.some(shotId => !project.shots.some(shot => shot.id === shotId))) return failure('not-found', 'Only active shots may be edited/reordered');
    return installed(history.apply(command));
  };
  const paint = async (request: Extract<FlowSessionRequest, { kind: 'paint' }>): Promise<FlowResult<boolean>> => {
    const project = current(), shot = project.shots.find(shot => shot.id === request.shotId);
    if (!shot) return failure('not-found', 'Active shot not found');
    const before = project.images[shot.imageId], layer = before.layers.find(layer => layer.id === request.layerId);
    if (!layer) return failure('not-found', 'Layer not found');
    if (layer.locked || !layer.visible) return failure('locked', 'Painting requires a visible unlocked layer');
    if (operationSerial >= Number.MAX_SAFE_INTEGER) return failure('resource-limit', 'Operation sequence exhausted');
    const operationId = `paint_${++operationSerial}`, baselineGeneration = generation;
    let readError: FlowFailure | null = null;
    let produced;
    try { produced = dependencyResult(await produce({ image: copy(before), layerId: request.layerId, stroke: copy(request.stroke) }, assetReader(error => { readError ??= copy(error); })), 'none'); }
    catch (error) { return readError ? { ok: false, error: copy(readError) } : unexpected(error, 'none'); }
    if (readError) return { ok: false, error: readError };
    if (!produced.ok) return produced;
    const output = produced.value;
    if (!output || !(output.png instanceof Uint8Array) || !positive(output.png.byteLength) || output.width !== before.width || output.height !== before.height)
      return failure('invalid-input', 'Pixel producer returned invalid PNG data/dimensions');
    const png = output.png.slice(), byteLength = png.byteLength;
    let stored;
    try { stored = dependencyResult(await put({ operationId, png, width: before.width, height: before.height }), 'unknown'); }
    catch (error) { return unexpected(error, 'unknown'); }
    if (!stored.ok) return stored;
    const receipt = stored.value;
    if (!receipt || receipt.sessionId !== sessionId || receipt.operationId !== operationId ||
        typeof receipt.assetId !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.assetId) || receipt.width !== before.width || receipt.height !== before.height ||
        receipt.byteLength !== byteLength || !['synced', 'skipped'].includes(receipt.directorySync))
      return failure('conflict', 'Asset receipt does not match the original paint', 'unknown');
    const latest = current(), owner = latest.shots.find(candidate => candidate.id === request.shotId);
    if (generation !== baselineGeneration || owner?.imageId !== before.id || !same(latest.images[before.id], before))
      return failure('conflict', 'Paint baseline or control generation changed', 'retained');
    const edit = applyImageEdit(before, { kind: 'replacePixels', layerId: request.layerId, assetId: receipt.assetId });
    if (!edit.ok) return { ok: false, error: { ...edit.error, effect: 'retained' } };
    const result = installed(history.apply({ kind: 'applyImageEdit', result: edit.value }));
    return result.ok ? result : { ok: false, error: { ...result.error, effect: 'retained' } };
  };
  const execute = async (request: FlowSessionRequest): Promise<FlowResult<boolean>> => {
    switch (request.kind) {
      case 'board': return board(request);
      case 'layer': {
        const project = current(), shot = project.shots.find(shot => shot.id === request.shotId);
        if (!shot) return failure('not-found', 'Active shot not found');
        const edit = applyImageEdit(project.images[shot.imageId], request.edit);
        return edit.ok ? installed(history.apply({ kind: 'applyImageEdit', result: edit.value })) : { ok: false, error: { ...edit.error, effect: 'none' } };
      }
      case 'paint': return paint(request);
      case 'undo': case 'redo':
        if ((request.kind === 'undo' ? undoDepth : redoDepth) === 0) return failure('not-found', 'No history entry');
        if (generation >= Number.MAX_SAFE_INTEGER) return failure('resource-limit', 'Control generation exhausted');
        generation++;
        return installed(history[request.kind](), request.kind);
      case 'checkpoint': return flush();
      case 'freeze': {
        await Promise.all([...detached]);
        const result = await flush();
        if (result.ok) {
          const cancelled = cancelTimer();
          if (!cancelled.ok) return cancelled;
          phase = 'frozen';
        }
        return result;
      }
      case 'resume': phase = 'active'; return { ok: true, value: false };
    }
  };
  const pump = async () => {
    if (running) return;
    running = true;
    while (queue.length) {
      const task = queue.shift()!;
      if (task.request.kind === 'checkpoint') {
        // Persistence does not occupy the history queue: newer edits may continue.
        const settlement = execute(task.request).catch(error => unexpected(error, 'unknown')).then(task.finish);
        detached.add(settlement);
        void settlement.then(() => detached.delete(settlement));
        continue;
      }
      painting = task.request.kind === 'paint';
      try { task.finish(await execute(task.request)); }
      catch (error) { task.finish(unexpected(error, painting ? 'unknown' : 'none')); }
      painting = false;
    }
    running = false;
  };
  return {
    snapshot,
    subscribe(listener) {
      if (typeof listener !== 'function') return () => undefined;
      listeners.add(listener); return () => { listeners.delete(listener); };
    },
    request(input) {
      const parsed = snapshotRequest(input);
      if (!parsed.ok) return Promise.resolve(parsed);
      const request = parsed.value;
      if (request.kind === 'freeze' && freezePromise) return freezePromise;
      if (request.kind === 'freeze' && phase === 'frozen') return Promise.resolve({ ok: true, value: { snapshot: snapshot(), changed: false } });
      if (request.kind === 'resume' ? phase !== 'frozen' : request.kind !== 'freeze' && phase !== 'active')
        return Promise.resolve(failure('busy', 'Session admission is frozen; failed freeze must be retried'));
      if (pending >= maxPending) return Promise.resolve(failure('resource-limit', 'Session request queue is full'));
      pending++;
      let resolve!: (result: FlowResult<FlowSessionOutcome>) => void;
      const promise = new Promise<FlowResult<FlowSessionOutcome>>(complete => { resolve = complete; });
      const task: Task = { request, finish: result => {
        if (!result.ok && request.kind !== 'checkpoint' && request.kind !== 'freeze') remember(result.error, 'operation');
        pending--;
        if (request.kind === 'freeze') freezePromise = null;
        const outcome = result.ok ? { ok: true as const, value: { changed: result.value, snapshot: snapshot() } } : copy(result);
        resolve(outcome); notify();
      } };
      if (request.kind === 'freeze') { phase = 'freezing'; freezePromise = promise; cancelTimer(); }
      if (request.kind === 'board' && request.command.kind === 'setScriptText' && painting && queue.every(task => task.request.kind === 'paint')) {
        try { task.finish(board(request)); } catch (error) { task.finish(unexpected(error, 'none')); }
      } else { queue.push(task); void pump(); }
      notify();
      return promise;
    }
  };
}
