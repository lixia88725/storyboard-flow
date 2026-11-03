import { toolPlan, adoptTool } from './pixelTools';
import type { FlowPixelToolOutput } from '../../platform/contracts/flowWave2';
import type {
  FlowCheckpointState, FlowFailure, FlowResult, FlowSession, FlowSessionOptions,
  FlowSessionOutcome, FlowSessionRequest, FlowSessionSnapshot
} from '../../platform/contracts/flowWave2';
import type { AssetReaderV1, CheckpointReceiptV1, ProjectEditResultV1, ProjectV1, ResultV1 } from '../../platform/contracts/refactorV1';
import { applyImageEdit } from '../../drawing/core';
import { applyStoryboardEdit } from '../../storyboard/core';
import { createProjectHistory, type ProjectHistoryV1 } from './history';
import { dialogueTypingGroupWindowMs, validTypingGroup } from './grouping';
import { codes, copy, failure, id, positive, record, same, snapshotRequest, validFailure } from './validation';

type Task = { request: FlowSessionRequest; finish: (result: FlowResult<boolean>) => void };
type ErrorEntry = { serial: number; error: FlowFailure };
class AssetReadFailure extends Error {
  constructor(readonly failure: FlowFailure) { super(failure.message); }
}
type BoardCommand = Exclude<Extract<FlowSessionRequest, { kind: 'board' }>['command'], { kind: 'insertShot' }>;
/** Undo-grouping metadata never reaches the domain layer or a snapshot. */
const withoutTypingMeta = (command: BoardCommand): BoardCommand => {
  if (command.kind !== 'setDialogues' || !Object.hasOwn(command, 'edit')) return command;
  const { edit: _edit, ...rest } = command;
  return rest;
};

/** Headless wave-two composition only. No production root, IPC, TIFF or Close authority. */
export function createFlowSession(options: FlowSessionOptions): FlowResult<FlowSession> {
  try {
    if (!options || !id(options.sessionId) || !id(options.incarnation) || !positive(options.maxPendingRequests) ||
        !options.assets || typeof options.assets.put !== 'function' || typeof options.assets.read !== 'function' ||
        !options.pixels || typeof options.pixels.produce !== 'function' || !options.clock ||
        typeof options.clock.setTimeout !== 'function' || typeof options.clock.clearTimeout !== 'function' || typeof options.checkpoint !== 'function')
      return failure('invalid-input', 'Invalid session options');
    // A typing run needs a monotonic reading from the injected clock. Without one the history
    // keeps its original behaviour: every committed edit is its own undo step.
    const now = typeof options.clock.now === 'function' ? options.clock.now.bind(options.clock) : undefined;
    const initialized = createProjectHistory(copy(options.project), {
      maxEntries: options.maxHistoryEntries,
      ...(now ? { group: { now, windowMs: dialogueTypingGroupWindowMs } } : {})
    });
    if (!initialized.ok) return { ok: false, error: { ...initialized.error, effect: 'none' } };
    return { ok: true, value: session(options, initialized.value) };
  } catch {
    return failure('invalid-input', 'Session options could not be snapshotted');
  }
}

function session(options: FlowSessionOptions, history: ProjectHistoryV1): FlowSession {
  const sessionId = options.sessionId, incarnation = options.incarnation;
  const maxPending = options.maxPendingRequests;
  // Capture methods too: replacing the caller's options after construction changes no dependency.
  const produce = options.pixels.produce.bind(options.pixels), put = options.assets.put.bind(options.assets);
  const blank = options.pixels.blank?.bind(options.pixels);
  const produceTool = options.tools?.produce.bind(options.tools);
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
  let running = false, painting = false, refreshRecovery = false;
  const refresh = options.refresh?.bind(options);
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
    else if (!operationError || operationError.error.effect === 'none' || error.effect !== 'none') operationError = entry;
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
  const installed = (result: ResultV1<ProjectEditResultV1>): FlowResult<boolean> => {
    if (!result.ok) return { ok: false, error: { ...result.error, effect: 'none' } };
    // The stacks are the truth: a folded typing edit shares its undo snapshot with the run it
    // joins, so a local counter would drift and refuse a valid Undo.
    undoDepth = history.undoDepth();
    redoDepth = history.redoDepth();
    if (result.value.changed) { scheduleCheckpoint(); notify(); }
    return { ok: true, value: result.value.changed };
  };
  const board = (request: { command: BoardCommand }): FlowResult<boolean> => {
    const project = current(), command = request.command;
    const typing = command.kind === 'setDialogues' && validTypingGroup(command.edit?.group) ? { group: command.edit!.group } : undefined;
    const domain = withoutTypingMeta(command);
    if (domain.kind === 'moveShots' || domain.kind === 'setProjectNaming' || domain.kind === 'setPresentation') return installed(history.apply(domain));
    // Pending shots may also be deleted; text, dialogue and drawing commands still target active shots only.
    if (domain.kind === 'removeShots') {
      const known = new Set([...project.shots, ...project.parkedShots].map(shot => shot.id));
      if (domain.shotIds.some(shotId => !known.has(shotId))) return failure('not-found', 'Shot not found');
      return installed(history.apply(domain));
    }
    const ids = domain.kind === 'moveDialogues' ? [domain.targetShotId] : [domain.shotId];
    if (ids.some(shotId => !project.shots.some(shot => shot.id === shotId))) return failure('not-found', 'Only active shots may be edited/reordered');
    return installed(history.apply(domain, typing));
  };
  const insert = async (command: Extract<Extract<FlowSessionRequest, { kind: 'board' }>['command'], { kind: 'insertShot' }>): Promise<FlowResult<boolean>> => {
    const baseline = current(), baselineGeneration = generation;
    const validated = applyStoryboardEdit(baseline, command);
    if (!validated.ok) return { ok: false, error: { ...validated.error, effect: 'none' } };
    let admitted = false;
    const account = (error: FlowFailure): FlowResult<never> => ({ ok: false, error: {
      ...error, effect: error.effect === 'unknown' ? 'unknown' : admitted ? 'retained' : error.effect
    } });
    for (const assetId of new Set(command.image.layers.map(layer => layer.assetId))) {
      if (operationSerial >= Number.MAX_SAFE_INTEGER) return account({ code: 'resource-limit', message: 'Operation sequence exhausted', effect: 'none' });
      let bytes;
      try { bytes = dependencyResult(await read(assetId), 'none'); }
      catch (error) { const failed = unexpected(error, 'none'); return failed.ok ? failure('io-failure', 'Unexpected read result') : account(failed.error); }
      if (!bytes.ok) return account(bytes.error);
      if (!(bytes.value instanceof Uint8Array) || !positive(bytes.value.byteLength))
        return account({ code: 'io-failure', message: 'Asset reader returned invalid bytes', effect: 'none' });
      const png = bytes.value.slice(), byteLength = png.byteLength, operationId = `insert_${incarnation}_${++operationSerial}`;
      let stored;
      try { stored = dependencyResult(await put({ operationId, png, width: command.image.width, height: command.image.height }), 'unknown'); }
      catch (error) { const failed = unexpected(error, 'unknown'); return failed.ok ? failure('io-failure', 'Unexpected put result', 'unknown') : account(failed.error); }
      if (!stored.ok) return account(stored.error);
      admitted = true;
      const receipt = stored.value;
      if (!receipt || receipt.sessionId !== sessionId || receipt.operationId !== operationId || receipt.assetId !== assetId ||
          receipt.width !== command.image.width || receipt.height !== command.image.height || receipt.byteLength !== byteLength ||
          !['synced', 'skipped'].includes(receipt.directorySync))
        return failure('conflict', 'Asset receipt does not match inserted asset', 'unknown');
    }
    if (generation !== baselineGeneration || !same(current(), baseline))
      return failure('conflict', 'Insertion baseline or control generation changed', admitted ? 'retained' : 'none');
    const result = installed(history.apply(command));
    return result.ok ? result : account(result.error);
  };
  const blankAsset = async (width:number,height:number,background:'white'|'transparent'='white'):Promise<FlowResult<string>> => {
    if (!blank) return failure('unavailable','Blank canvas producer unavailable');
    if (operationSerial >= Number.MAX_SAFE_INTEGER) return failure('resource-limit', 'Operation sequence exhausted');
    const operationId = `blank_${incarnation}_${++operationSerial}`;
    let output;
    try { output = dependencyResult(await blank(width, height, background), 'none'); }
    catch (error) { return unexpected(error, 'none'); }
    if (!output.ok) return output;
    if (!output.value || !(output.value.png instanceof Uint8Array) || !positive(output.value.png.byteLength) || output.value.width !== width || output.value.height !== height)
      return failure('invalid-input', 'Blank canvas producer returned invalid data');
    const png = output.value.png.slice(), byteLength = png.byteLength;
    let admitted;
    try { admitted = dependencyResult(await put({ operationId, png, width: width, height: height }), 'unknown'); }
    catch (error) { return unexpected(error, 'unknown'); }
    if (!admitted.ok) return admitted;
    const receipt = admitted.value;
    if (!receipt || receipt.sessionId !== sessionId || receipt.operationId !== operationId || typeof receipt.assetId !== 'string' ||
        !/^[a-f0-9]{64}$/.test(receipt.assetId) || receipt.width !== width || receipt.height !== height ||
        receipt.byteLength !== byteLength || !['synced', 'skipped'].includes(receipt.directorySync))
      return failure('conflict', 'Blank asset receipt mismatch', 'unknown');
    return {ok:true,value:receipt.assetId};
  };
  const newLayer = async (request:Extract<FlowSessionRequest,{kind:'newLayer'}>):Promise<FlowResult<boolean>> => {
    const project=current(),shot=project.shots.find(s=>s.id===request.shotId);
    if(!shot)return failure('not-found','Active shot not found');
    const image=project.images[shot.imageId];
    const index=request.afterId===undefined?image.layers.length:image.layers.findIndex(l=>l.id===request.afterId)+1;
    if(request.afterId!==undefined&&index===0)return failure('not-found','Layer insertion anchor no longer exists');
    const edit={kind:'insertLayer' as const,index,layer:{id:request.layerId,name:'Drawing',kind:'paint' as const,visible:true,locked:false,opacity:1,blendMode:'normal' as const,width:image.width,height:image.height,assetId:'0'.repeat(64)}};
    const check=applyImageEdit(image,edit);
    if(!check.ok)return {ok:false,error:{...check.error,effect:'none'}};
    const preflight=applyStoryboardEdit(project,{kind:'applyImageEdit',result:check.value});
    if(!preflight.ok)return {ok:false,error:{...preflight.error,effect:'none'}};
    const asset=await blankAsset(image.width,image.height,'transparent');if(!asset.ok)return asset;
    if(!same(current(),project))return failure('conflict','Layer insertion baseline changed','retained');
    edit.layer.assetId=asset.value;
    const result=applyImageEdit(image,edit);
    if(!result.ok)return {ok:false,error:{...result.error,effect:'retained'}};
    const applied=installed(history.apply({kind:'applyImageEdit',result:result.value}));
    return applied.ok?applied:{ok:false,error:{...applied.error,effect:'retained'}};
  };
  const newShot = async (request: Extract<FlowSessionRequest, { kind: 'newShot' }>): Promise<FlowResult<boolean>> => {
    if (!blank) return failure('unavailable', 'Blank canvas producer unavailable');
    const project = current();
    const index = request.afterId === undefined ? project.shots.length : project.shots.findIndex(s => s.id === request.afterId) + 1;
    if (request.afterId !== undefined && index === 0) return failure('not-found', 'Insertion anchor is no longer active');
    const image = { id: request.imageId, revision: 0, width: request.width, height: request.height,
      layers: [{ id: 'paint', name: 'Drawing', kind: 'paint' as const, visible: true, locked: false, opacity: 1,
        blendMode: 'normal' as const, width: request.width, height: request.height, assetId: '0'.repeat(64) }] };
    const command = { kind: 'insertShot' as const, shot: { id: request.shotId, imageId: image.id, name: 'New shot', scriptText: '' }, image, index };
    const preflight = applyStoryboardEdit(project, command);
    if (!preflight.ok) return { ok: false, error: { ...preflight.error, effect: 'none' } };
    const admitted = await blankAsset(image.width,image.height);
    if (!admitted.ok) return admitted;
    // The queue admits no text shortcut during newShot; Undo/freeze wait until it settles.
    if (!same(current(), project)) return failure('conflict', 'New shot baseline changed', 'retained');
    image.layers[0].assetId = admitted.value;
    const result = installed(history.apply(command));
    return result.ok ? result : { ok: false, error: { ...result.error, effect: 'retained' } };
  };
  const paint = async (request: Extract<FlowSessionRequest, { kind: 'paint' | 'pixelTool' }>): Promise<FlowResult<boolean>> => {
    const project = current(), shot = project.shots.find(shot => shot.id === request.shotId);
    if (!shot) return failure('not-found', 'Active shot not found');
    const before = project.images[shot.imageId];
    let plan: FlowPixelToolOutput['plan'] | undefined;
    if (request.kind === 'pixelTool') {
      if (!produceTool) return failure('unavailable', 'Pixel tools are not connected');
      const planned = toolPlan(before, request.tool);
      if (!planned.ok) return planned;
      plan = planned.value;
    } else {
      const layer = before.layers.find(layer => layer.id === request.layerId);
      if (!layer) return failure('not-found', 'Layer not found');
      if (layer.locked || !layer.visible) return failure('locked', 'Painting requires a visible unlocked layer');
    }
    if (operationSerial >= Number.MAX_SAFE_INTEGER) return failure('resource-limit', 'Operation sequence exhausted');
    const operationId = `paint_${++operationSerial}`, baselineGeneration = generation;
    let readError: FlowFailure | null = null;
    let produced;
    try {
      const reader = assetReader(error => { readError ??= copy(error); });
      produced = dependencyResult(request.kind === 'paint'
        ? await produce({ image: copy(before), layerId: request.layerId, stroke: copy(request.stroke) }, reader)
        : await produceTool!({ ...copy(request.tool), image: copy(before) }, reader), 'none');
    }
    catch (error) { return readError ? { ok: false, error: copy(readError) } : unexpected(error, 'none'); }
    if (readError) return { ok: false, error: readError };
    if (!produced.ok) return produced;
    const output = produced.value;
    if (!output || !(output.png instanceof Uint8Array) || !positive(output.png.byteLength) || output.width !== before.width || output.height !== before.height)
      return failure('invalid-input', 'Pixel producer returned invalid PNG data/dimensions');
    if (request.kind === 'pixelTool' && (!same((output as FlowPixelToolOutput).baseline, before) || !same((output as FlowPixelToolOutput).plan, plan)))
      return failure('conflict', 'Pixel tool baseline or plan does not match the request');
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
    const edit = request.kind === 'pixelTool' ? adoptTool(before, plan!, receipt.assetId) : applyImageEdit(before, { kind: 'replacePixels', layerId: request.layerId, assetId: receipt.assetId });
    if (!edit.ok) return { ok: false, error: { ...edit.error, effect: 'retained' } };
    const result = installed(history.apply({ kind: 'applyImageEdit', result: edit.value }));
    return result.ok ? result : { ok: false, error: { ...result.error, effect: 'retained' } };
  };
  const execute = async (request: FlowSessionRequest): Promise<FlowResult<boolean>> => {
    if(refreshRecovery&&request.kind!=='refresh'){if(request.kind==='freeze')phase='active';return failure('busy','Retry Refresh to finish the retained operation','retained');}
    switch (request.kind) {
      case 'refresh': {
        if (!refresh) return failure('unavailable','External refresh is not connected');
        if (!refreshRecovery) { const flushed=await flush(); if(!flushed.ok)return flushed; }
        const before=current();
        let refreshed;
        try { refreshed=dependencyResult(await refresh(copy(before)), 'unknown'); }
        catch(error){refreshed=unexpected(error,'unknown');}
        if(!refreshed.ok){refreshRecovery=refreshed.error.effect==='unknown';return refreshed;}
        const validated=applyStoryboardEdit(before,{kind:'refreshImages',before,after:refreshed.value});
        if(!validated.ok){refreshRecovery=true;return {ok:false,error:{...validated.error,effect:'unknown'}};}
        const priorAssets=new Set(Object.values(before.images).flatMap(i=>i.layers.map(l=>l.assetId)));
        for(const image of Object.values(refreshed.value.images))for(const layer of image.layers)if(!priorAssets.has(layer.assetId)){
          let asset;try{asset=dependencyResult(await read(layer.assetId),'unknown');}catch(error){refreshRecovery=true;return unexpected(error,'unknown');}
          if(!asset.ok){refreshRecovery=true;return {...asset,error:{...asset.error,effect:'unknown'}};}
          if(!(asset.value instanceof Uint8Array)||!asset.value.byteLength){refreshRecovery=true;return failure('missing-asset','Refreshed image asset unavailable','unknown');}
        }
        const applied=installed(history.apply({kind:'refreshImages',before,after:refreshed.value}));
        if(!applied.ok){refreshRecovery=true;return {...applied,error:{...applied.error,effect:'unknown'}};}
        refreshRecovery=false;
        return applied;
      }
      case 'newLayer': return newLayer(request);
      case 'newShot': return newShot(request);
      case 'board': return request.command.kind === 'insertShot' ? insert(request.command) : board({ command: request.command });
      case 'layer': {
        const project = current(), shot = project.shots.find(shot => shot.id === request.shotId);
        if (!shot) return failure('not-found', 'Active shot not found');
        const edit = applyImageEdit(project.images[shot.imageId], request.edit);
        return edit.ok ? installed(history.apply({ kind: 'applyImageEdit', result: edit.value })) : { ok: false, error: { ...edit.error, effect: 'none' } };
      }
      case 'paint': case 'pixelTool': return paint(request);
      case 'undo': case 'redo':
        if ((request.kind === 'undo' ? undoDepth : redoDepth) === 0) return failure('not-found', 'No history entry');
        if (generation >= Number.MAX_SAFE_INTEGER) return failure('resource-limit', 'Control generation exhausted');
        generation++;
        return installed(history[request.kind]());
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
      painting = task.request.kind === 'paint' || task.request.kind === 'pixelTool';
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
      if(refreshRecovery && request.kind!=='refresh')return Promise.resolve(failure('busy','Retry Refresh to finish the retained operation','retained'));
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
        // A successful edit dismisses a refused operation, never an unresolved effect or checkpoint failure.
        if (result.ok && request.kind !== 'checkpoint' && request.kind !== 'freeze' && request.kind !== 'resume' && operationError?.error.effect === 'none') operationError = null;
        pending--;
        if (request.kind === 'freeze') freezePromise = null;
        const outcome = result.ok ? { ok: true as const, value: { changed: result.value, snapshot: snapshot() } } : copy(result);
        resolve(outcome); notify();
      } };
      if (request.kind === 'freeze') { phase = 'freezing'; freezePromise = promise; cancelTimer(); }
      if (request.kind === 'board' && (request.command.kind === 'setScriptText' || request.command.kind === 'setDialogues') && painting && queue.every(task => task.request.kind === 'paint' || task.request.kind === 'pixelTool')) {
        try { task.finish(board({ command: request.command })); } catch (error) { task.finish(unexpected(error, 'none')); }
      } else { queue.push(task); void pump(); }
      notify();
      return promise;
    }
  };
}
