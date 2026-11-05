import type { SketchStroke } from '../contracts/types';

export type PaintTarget = { shotId: string; imageId: string; layerId: string; assetId: string; width: number; height: number };
export type PaintReceipt = { assetId: string; revision: number };
export type PaintFailure = { message: string; effect?: string };
export interface PaintRaster<R> {
  create(width: number, height: number): R;
  copy(to: R, from: R): void;
  stroke(to: R, stroke: SketchStroke): void;
  decode(target: PaintTarget): Promise<R>;
  release(raster: R): void;
}
type Entry = { seq: number; stroke: SketchStroke; state: 'drawing' | 'queued' | 'submitted' | 'acked' | 'failed'; done?: Promise<void>; failure?: PaintFailure };
type Candidate = { target: PaintTarget; through: number; epoch: number };
export type PaintFrame<R> = { target?: PaintTarget; status: 'idle' | 'preparing' | 'ready' | 'error'; canvas?: R; error?: string; retryDecode?: boolean };
const clone = (s: SketchStroke): SketchStroke => ({ ...s, points: [...s.points], pressures: s.pressures && [...s.pressures], brush: s.brush && { ...s.brush } });
const sameTarget = (a: PaintTarget, b: PaintTarget) => a.shotId === b.shotId && a.imageId === b.imageId && a.layerId === b.layerId && a.width === b.width && a.height === b.height;

/** Session-scoped *presentation*, never a second writable Project. A receipt binds a
 * successful prefix to its immutable asset. Records retire only when that asset is
 * decoded and installed, not when a component unmounts or a request promise resolves. */
export function createPaintPresentation<R>(options: {
  raster: PaintRaster<R>;
  current(shotId: string, layerId: string): PaintTarget | undefined;
  commit(target: PaintTarget, stroke: SketchStroke): Promise<PaintReceipt>;
  report(message: string): void;
  maxStrokes?: number;
  maxPoints?: number;
  maxPixels?: number;
}) {
  const raster = options.raster;
  const maxStrokes = options.maxStrokes ?? 32, maxPoints = options.maxPoints ?? 200_000;
  const listeners = new Set<() => void>();
  let target: PaintTarget | undefined, entries: Entry[] = [], retired: Entry[] = [];
  let epoch = 0, serial = 0, disposed = false, barrierPending = false;
  let base: R | undefined, completed: R | undefined, view: R | undefined;
  let latestAck = 0;
  let through = 0, candidate: Candidate | undefined, decoding = false;
  let decodeError: string | undefined, failure: string | undefined;
  let completeDirty = true;
  const emit = () => { for (const listener of listeners) listener(); };
  const release = () => {
    for (const item of [base, completed, view]) if (item !== undefined) raster.release(item);
    base = completed = view = undefined;
  };
  const drawing = () => entries.find(entry => entry.state === 'drawing');
  const unsettled = () => [...retired, ...entries].some(entry => entry.state !== 'acked');
  const frame = (): PaintFrame<R> => ({ target, status: !target ? 'idle' : failure || decodeError ? 'error' : barrierPending || base === undefined ? 'preparing' : 'ready',
    canvas: !barrierPending && !failure && !decodeError ? view : undefined, error: failure ?? decodeError, retryDecode: !!decodeError && !failure });
  const render = () => {
    if (disposed) return;
    if (base !== undefined && target && !barrierPending && !failure && !decodeError) {
      completed ??= raster.create(target.width, target.height);
      view ??= raster.create(target.width, target.height);
      if (completeDirty) {
        raster.copy(completed, base);
        for (const entry of entries) if (entry.state !== 'drawing' && entry.state !== 'failed') raster.stroke(completed, entry.stroke);
        completeDirty = false;
      }
      // Re-render a whole stroke over its fixed start pixels. Its opacity caps within
      // the stroke; the next stroke starts from the previous stroke's composite.
      raster.copy(view, completed);
      const active = drawing();
      if (active) raster.stroke(view, active.stroke);
    }
    emit();
  };
  const decode = () => {
    if (disposed || decoding || barrierPending || !candidate || failure) return;
    const job = candidate; candidate = undefined; decoding = true;
    void raster.decode(job.target).then(pixels => {
      if (disposed || failure || job.epoch !== epoch || !target || !sameTarget(job.target, target) || job.through < through) {
        raster.release(pixels); return;
      }
      // All <= through records have succeeded in this epoch; failed writes can never
      // supply a candidate. Same asset IDs are allowed (no-op pixels still settle).
      if (base !== undefined) raster.release(base);
      base = pixels; through = job.through; decodeError = undefined;
      entries = entries.filter(entry => entry.seq > through);
      completeDirty = true; render();
    }, error => {
      if (!disposed && job.epoch === epoch) {
        decodeError = String(error); candidate ??= job;
        options.report('画面准备失败；已接受的笔迹仍保留。' + decodeError); emit();
      }
    }).finally(() => {
      decoding = false;
      if (!disposed && !decodeError) decode();
    });
  };
  const schedule = (assetId: string, covered: number) => {
    if (!target) return;
    candidate = { target: { ...target, assetId }, through: covered, epoch };
    decode();
  };
  const submit = (entry: Entry) => {
    if (entry.state !== 'queued' || barrierPending || !target || failure || disposed) return;
    entry.state = 'submitted';
    const ownEpoch = epoch, ownTarget = { ...target };
    entry.done = options.commit(ownTarget, clone(entry.stroke)).then(receipt => {
      entry.state = 'acked';
      if (disposed || ownEpoch !== epoch || entry.seq < latestAck) return;
      latestAck = entry.seq;
      // The Session captures this snapshot before starting the next queued edit.
      target = { ...target!, assetId: receipt.assetId };
      schedule(receipt.assetId, entry.seq);
    }, (error: PaintFailure) => {
      entry.state = 'failed'; entry.failure = { message: error.message ?? String(error), effect: error.effect };
      if (disposed) return;
      failure = '笔迹提交失败，输入已保留：' + entry.failure.message;
      options.report(failure); emit();
    });
  };
  const pump = () => { for (const entry of entries) submit(entry); };
  const report = (message: string) => { options.report(message); return false; };
  const adopt = (next: PaintTarget) => {
    epoch++; release(); target = { ...next }; through = serial;
    entries = []; candidate = undefined; decodeError = undefined; completeDirty = true;
    schedule(next.assetId, through); emit();
  };
  const api = {
    frame,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    hasInput: () => unsettled() || barrierPending,
    hasDrawing: () => !!drawing(),
    awaitingAuthority: () => barrierPending,
    owns(shotId: string, layerId: string) { return target?.shotId === shotId && target.layerId === layerId; },
    canContinue(shotId: string, layerId: string) { return !disposed && !failure && !drawing() && target?.shotId === shotId && target.layerId === layerId; },
    begin(shotId: string, layerId: string, stroke: SketchStroke) {
      if (disposed || failure) return report(failure ?? '绘画会话已结束');
      if (drawing()) return report('请先结束当前笔画');
      const next = options.current(shotId, layerId);
      if (!next) return report('当前图层不可绘制');
      if (next.width * next.height > (options.maxPixels ?? 32_000_000)) return report('图层超出绘画像素预算');
      if (!target || !sameTarget(target, next)) {
        if (unsettled() || barrierPending) return report('请等待当前图层的笔迹结算');
        adopt(next);
      } else if (!barrierPending && !entries.length && next.assetId !== target.assetId) adopt(next);
      if (stroke.points.length / 2 > 100_000 || entries.length + retired.length >= maxStrokes || [...entries, ...retired].reduce((n, e) => n + e.stroke.points.length / 2, 0) + stroke.points.length / 2 > maxPoints)
        return report('绘画缓冲已满，请等待画面准备完成后继续');
      entries.push({ seq: ++serial, stroke: clone(stroke), state: 'drawing' }); render(); return true;
    },
    update(stroke: SketchStroke) {
      const entry = drawing(); if (!entry || entry.stroke.id !== stroke.id || disposed) return false;
      if (stroke.points.length / 2 > 100_000 || [...entries, ...retired].reduce((n, e) => n + (e === entry ? 0 : e.stroke.points.length / 2), 0) + stroke.points.length / 2 > maxPoints)
        return report('当前笔画达到点数预算；已接受部分仍保留，请抬笔后继续');
      entry.stroke = clone(stroke); render(); return true;
    },
    end(strokeId: string) {
      const entry = drawing(); if (!entry || entry.stroke.id !== strokeId || disposed) return;
      entry.state = 'queued'; completeDirty = true; render(); submit(entry);
    },
    cancel(strokeId: string) {
      const entry = drawing(); if (!entry || entry.stroke.id !== strokeId) return;
      entries = entries.filter(e => e !== entry); render();
    },
    /** Before Undo/Redo/another pixel operation: conceal the old epoch synchronously,
     * drain accepted writes, then resolve the new target. New input is retained but
     * cannot paint or submit against the old/unknown target. */
    async barrier<T>(operation: () => Promise<T>): Promise<T> {
      if (disposed || barrierPending || drawing() || failure) throw Error(failure ?? '请先结束当前编辑');
      barrierPending = true; epoch++; retired = entries; entries = []; candidate = undefined;
      release(); decodeError = undefined; emit();
      try {
        await Promise.all(retired.map(entry => entry.done));
        if (failure) throw Error(failure);
        return await operation();
      } finally {
        if (!disposed) {
          // Keep failed obligations. Successful old inputs are represented by the
          // authoritative target after the operation, including a failed Undo.
          retired = retired.filter(entry => entry.state === 'failed');
          barrierPending = false; through = entries[0]?.seq ? entries[0].seq - 1 : serial;
          const next = target && options.current(target.shotId, target.layerId);
          if (next) { target = next; completeDirty = true; schedule(next.assetId, through); pump(); }
          else if (entries.length) { failure = '目标图层已不存在；已接受的输入仍保留'; options.report(failure); }
          else { target = undefined; }
          emit();
        }
      }
    },
    /** Non-pixel notifications (checkpoint, text) don't invalidate a live base. */
    observe() {
      if (!target || disposed || barrierPending || entries.length || retired.length) return;
      const next = options.current(target.shotId, target.layerId);
      if (!next) { epoch++; release(); target = undefined; candidate = undefined; emit(); }
      else if (!sameTarget(next, target) || next.assetId !== target.assetId) adopt(next);
    },
    retryDecode() { if (disposed || failure) return; decodeError = undefined; decode(); emit(); },
    async settle() {
      if (drawing() || barrierPending || failure) throw Error(failure ?? '请先结束当前绘画');
      await Promise.all(entries.map(entry => entry.done));
      if (failure || entries.some(entry => entry.state !== 'acked')) throw Error(failure ?? '仍有未提交笔迹');
    },
    stats: () => ({ epoch, records: entries.length + retired.length, points: [...entries, ...retired].reduce((n, e) => n + e.stroke.points.length / 2, 0), through, decoding, candidate: !!candidate, rasters: Number(base !== undefined) + Number(completed !== undefined) + Number(view !== undefined) }),
    dispose() { disposed = true; epoch++; candidate = undefined; release(); listeners.clear(); },
  };
  return api;
}
export type PaintPresentation<R = HTMLCanvasElement> = ReturnType<typeof createPaintPresentation<R>>;
