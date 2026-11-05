import { describe, expect, it } from 'vitest';
import { createPaintPresentation, createPaintInputGate, type PaintTarget, type PaintReceipt, type PaintRaster } from './paintPresentation';
import type { SketchStroke } from '../contracts/types';
const deferred = <T,>() => { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((a,b) => { resolve=a; reject=b; }); return {promise,resolve,reject}; };
const tick = async () => { for(let i=0;i<8;i++) await Promise.resolve(); };
const stroke = (id: string): SketchStroke => ({ id, tool:'brush', color:'#123456',size:10,opacity:.3,points:[2,3] });
type Raster = { pixels: string[]; released?: boolean };
function harness(limits: {maxStrokes?:number;maxPoints?:number;maxPixels?:number} = {}) {
  let current: PaintTarget | undefined = {shotId:'shot',imageId:'image',layerId:'ink',width:32,height:32,assetId:'initial'};
  const decodes: { target:PaintTarget; work:ReturnType<typeof deferred<Raster>> }[] = [];
  const writes: {stroke:SketchStroke;work:ReturnType<typeof deferred<PaintReceipt>>}[] = [];
  const reports:string[] = [];
  const raster: PaintRaster<Raster> = {
    create:()=>({pixels:[]}),copy:(to,from)=>{to.pixels=[...from.pixels];},stroke:(to,s)=>{to.pixels.push(s.id);},release:r=>{r.released=true;},
    decode:target=>{const work=deferred<Raster>();decodes.push({target,work});return work.promise;},
  };
  const inputGate=createPaintInputGate();
  const owner=createPaintPresentation({inputGate,raster,current:()=>current,commit:async(_target,s)=>{const work=deferred<PaintReceipt>();writes.push({stroke:s,work});return work.promise;},report:m=>reports.push(m),...limits});
  const begin=(id:string)=>owner.begin('shot','ink',stroke(id));
  const end=(id:string)=>owner.end(id);
  const decode=async(index:number,pixels:string[])=>{decodes[index].work.resolve({pixels});await tick();};
  const ack=async(index:number,assetId:string)=>{current={...current!,assetId};writes[index].work.resolve({assetId,revision:index+1});await tick();};
  inputGate.connect(owner.assertSettled);
  return {owner,inputGate,begin,end,decode,ack,decodes,writes,reports,setCurrent:(next:PaintTarget|undefined)=>{current=next;},current:()=>current!};
}
describe('Session-owned paint presentation',()=>{
  it('retains full cold down/up and multiple strokes; never paints an unknown base',async()=>{
    const h=harness();h.begin('A');h.end('A');h.begin('B');h.end('B');h.begin('C');h.end('C');
    expect(h.owner.frame()).toMatchObject({status:'preparing',canvas:undefined});expect(h.writes.map(x=>x.stroke.id)).toEqual(['A','B','C']);
    await h.decode(0,['base']);expect(h.owner.frame().canvas?.pixels).toEqual(['base','A','B','C']);
  });
  it('binds decoded asset to its prefix, retains acked inputs until installation, never double draws',async()=>{
    const h=harness();h.begin('A');h.end('A');await h.decode(0,['base']);h.begin('B');h.end('B');
    await h.ack(0,'assetA');expect(h.owner.stats().records).toBe(2);expect(h.owner.frame().canvas?.pixels).toEqual(['base','A','B']);
    await h.decode(1,['base','A']);expect(h.owner.stats().records).toBe(1);expect(h.owner.frame().canvas?.pixels).toEqual(['base','A','B']);
    await h.ack(1,'assetAB');await h.decode(2,['base','A','B']);expect(h.owner.stats().records).toBe(0);
  });
  it('late ack/decode cannot tear down a newer draft or change the stroke start base',async()=>{
    const h=harness();h.begin('A');h.end('A');await h.decode(0,['base']);h.begin('B');
    await h.ack(0,'assetA');await h.decode(1,['base','A']);h.owner.update({...stroke('B'),points:[2,3,8,9]});
    expect(h.owner.hasDrawing()).toBe(true);expect(h.owner.frame().canvas?.pixels).toEqual(['base','A','B']);
    h.end('B');h.end('B');expect(h.writes).toHaveLength(2);
  });
  it('repeated frame reads / observe / begin after ack do not reset unacknowledged pixels',async()=>{
    const h=harness();h.begin('A');h.end('A');await h.decode(0,['base']);
    for(let i=0;i<30;i++){h.owner.observe();h.owner.frame();}
    h.begin('B');h.end('B');expect(h.decodes).toHaveLength(1);expect(h.owner.frame().canvas?.pixels).toEqual(['base','A','B']);
  });
  it('conceals Undo immediately, accepts next epoch input and submits it only after restored target known',async()=>{
    const h=harness();h.begin('A');h.end('A');await h.decode(0,['base']);await h.ack(0,'A');await h.decode(1,['base','A']);
    const undo=deferred<void>();const barrier=h.owner.barrier(async()=>{await undo.promise;h.setCurrent({...h.current(),assetId:'initial'});});
    expect(h.owner.frame().canvas).toBeUndefined();expect(h.owner.frame().status).toBe('preparing');
    h.begin('B');h.end('B');expect(h.writes).toHaveLength(1);
    undo.resolve();await barrier;await tick();expect(h.writes).toHaveLength(2);expect(h.owner.frame().canvas).toBeUndefined();
    await h.decode(2,['base']);expect(h.owner.frame().canvas?.pixels).toEqual(['base','B']);
  });
  it('settles old writes before Undo, old late decode cannot resurrect the old epoch',async()=>{
    const h=harness();h.begin('A');h.end('A');let ran=false;
    const barrier=h.owner.barrier(async()=>{ran=true;h.setCurrent({...h.current(),assetId:'undo'});});
    h.begin('B');h.end('B');expect(ran).toBe(false);await h.ack(0,'A');await barrier;
    expect(ran).toBe(true);await h.decode(0,['obsolete']);expect(h.owner.frame().canvas).toBeUndefined();
    expect(h.decodes[1].target.assetId).toBe('undo');await h.decode(1,['restored']);expect(h.owner.frame().canvas?.pixels).toEqual(['restored','B']);
  });
  it('failed Undo restores the actual authoritative target and keeps new accepted input',async()=>{
    const h=harness();h.begin('A');h.end('A');await h.decode(0,['base']);await h.ack(0,'A');await h.decode(1,['base','A']);
    const work=deferred<void>(), barrier=h.owner.barrier(()=>work.promise);h.begin('B');h.end('B');
    const rejected=expect(barrier).rejects.toThrow('no history');work.reject(Error('no history'));await rejected;
    await h.decode(2,['base','A']);expect(h.owner.frame().canvas?.pixels).toEqual(['base','A','B']);
  });
  it.each(['none','unknown','retained'])('retains failed %s input; no retry or successful close',async(effect)=>{
    const h=harness();h.begin('A');h.end('A');h.writes[0].work.reject({message:'write failed',effect});await tick();
    expect(h.owner.frame().status).toBe('error');expect(h.owner.stats().records).toBe(1);await expect(h.owner.settle()).rejects.toThrow('write failed');
    h.owner.retryDecode();expect(h.writes).toHaveLength(1);expect(h.begin('B')).toBe(false);
    await h.decode(0,['base']);expect(h.owner.stats().records).toBe(1);expect(h.owner.frame().canvas).toBeUndefined();
  });
  it('decode failure retains inputs and explicit retry reinstates the correct prefix',async()=>{
    const h=harness();h.begin('A');h.end('A');h.decodes[0].work.reject(Error('decode'));await tick();
    expect(h.owner.frame().status).toBe('error');expect(h.owner.stats().records).toBe(1);h.owner.retryDecode();await h.decode(1,['base']);
    expect(h.owner.frame().canvas?.pixels).toEqual(['base','A']);
  });
  it('out-of-order promise observation cannot regress the asset or prefix',async()=>{
    const h=harness();h.begin('A');h.end('A');h.begin('B');h.end('B');await h.decode(0,['base']);
    await h.ack(1,'AB');await h.ack(0,'A');await h.decode(1,['base','A','B']);
    expect(h.owner.frame().target?.assetId).toBe('AB');expect(h.owner.frame().canvas?.pixels).toEqual(['base','A','B']);expect(h.decodes).toHaveLength(2);
  });
  it('same asset ack settles a no-op without drawing twice',async()=>{
    const h=harness();h.begin('A');h.end('A');await h.decode(0,['base']);await h.ack(0,'initial');await h.decode(1,['base']);
    expect(h.owner.stats().records).toBe(0);expect(h.owner.frame().canvas?.pixels).toEqual(['base']);
  });
  it('surface unsubscribe does not release pending work; another surface sees identical pixels',async()=>{
    const h=harness();let a=0,b=0;const off=h.owner.subscribe(()=>a++);h.owner.subscribe(()=>b++);h.begin('A');h.end('A');off();
    const before=a;await h.decode(0,['base']);expect(a).toBe(before);expect(b).toBeGreaterThan(a);expect(h.owner.stats().records).toBe(1);
  });
  it('dispose ignores old callbacks and releases late decoded rasters without affecting another session',async()=>{
    const h=harness(),next=harness();h.begin('A');h.end('A');h.owner.dispose();const pixels={pixels:['old'],released:false};
    h.decodes[0].work.resolve(pixels);await h.ack(0,'A');expect(pixels.released).toBe(true);expect(h.owner.stats().rasters).toBe(0);expect(next.owner.frame().status).toBe('idle');
  });
  it('requires an explicit whole-stroke decision after overflow; up never submits a prefix',async()=>{
    const h=harness({maxStrokes:2,maxPoints:3});h.begin('A');h.end('A');h.begin('B');
    expect(h.owner.update({...stroke('B'),points:[1,2,3,4,5,6]})).toBe(false);h.end('B');
    expect(h.writes.map(w=>w.stroke.id)).toEqual(['A']);expect(h.begin('C')).toBe(false);
    expect(h.owner.frame().decision).toBe(true);expect(h.owner.stats().points).toBe(2);
    await expect(h.owner.settle()).rejects.toThrow();
    h.owner.resolveBudget('commit');expect(h.writes.map(w=>w.stroke.points)).toEqual([[2,3],[2,3]]);
    expect(h.begin('C')).toBe(false); // Stroke-count cap still applies after the decision.
    await h.decode(0,['base']);expect(h.owner.stats().rasters).toBe(3);await h.ack(0,'A');await h.ack(1,'AB');await h.decode(1,['base','A']);await h.decode(2,['base','A','B']);
    expect(h.owner.stats().records).toBe(0);expect(h.begin('C')).toBe(true);
  });
  it('discards only the explicitly refused budget stroke',()=>{
    const h=harness({maxPoints:1});h.begin('A');h.owner.update({...stroke('A'),points:[1,2,3,4]});h.end('A');
    h.owner.resolveBudget('discard');expect(h.writes).toHaveLength(0);expect(h.owner.hasInput()).toBe(false);expect(h.begin('B')).toBe(true);
  });
  it('synchronous transition latch closes settle-to-freeze admission and resumes after refusal',async()=>{
    const h=harness();h.begin('A');h.end('A');h.inputGate.pause();
    const settled=h.owner.settle();await h.ack(0,'A');await settled;
    expect(h.begin('gap')).toBe(false);h.inputGate.assertSettled();
    h.inputGate.resume();expect(h.begin('after refusal')).toBe(true);
    expect(()=>h.inputGate.assertSettled()).toThrow();
  });
  it('post-freeze certification checks newly registered owner obligations',()=>{
    const h=harness();h.inputGate.pause();h.inputGate.assertSettled();
    h.inputGate.connect(()=>{throw Error('unsubmitted input');});expect(()=>h.inputGate.assertSettled()).toThrow('unsubmitted input');
  });
  it('explicit none retry drains successes and reapplies only failed input to current authority',async()=>{
    const h=harness();h.begin('A');h.end('A');h.begin('B');h.end('B');await h.decode(0,['base']);
    h.writes[0].work.reject({message:'temporary',effect:'none'});await tick();
    const retry=h.owner.resolveFailure('retry');expect(h.writes).toHaveLength(2);
    await h.ack(1,'B');expect(await retry).toBe(true);expect(h.writes.map(w=>w.stroke.id)).toEqual(['A','B','A']);
    expect(h.owner.frame().canvas).toBeUndefined();await h.decode(1,['base','B']);expect(h.owner.frame().canvas?.pixels).toEqual(['base','B','A']);
    await h.ack(2,'BA');await h.decode(2,['base','B','A']);await h.owner.settle();expect(h.owner.stats().records).toBe(0);
  });
  it('unknown never retries, requires explicit recovery export before discard, then restores authority',async()=>{
    const h=harness();h.begin('A');h.end('A');await h.decode(0,['base']);h.writes[0].work.reject({message:'ambiguous',effect:'unknown'});await tick();
    expect(await h.owner.resolveFailure('retry')).toBe(false);expect(await h.owner.resolveFailure('discard')).toBe(false);
    const evidence=h.owner.recoveryRecord();expect(evidence.entries[0]).toMatchObject({stroke:stroke('A'),failure:{effect:'unknown'}});
    h.owner.markRecoveryExportRequested();expect(await h.owner.resolveFailure('discard')).toBe(true);
    await h.decode(1,['base']);expect(h.owner.frame().canvas?.pixels).toEqual(['base']);expect(h.begin('B')).toBe(true);
  });
  it('budget cannot be resolved while the pointer is still held; further points remain bounded',()=>{
    const h=harness({maxPoints:1});h.begin('A');const tooLong={...stroke('A'),points:[1,2,3,4]};h.owner.update(tooLong);
    h.owner.resolveBudget('commit');expect(h.writes).toHaveLength(0);expect(h.owner.frame().decisionReady).toBe(false);
    for(let n=0;n<10;n++)expect(h.owner.update(tooLong)).toBe(false);expect(h.owner.stats().points).toBe(1);
    h.owner.cancel('A');h.owner.resolveBudget('discard');expect(h.owner.hasInput()).toBe(false);
  });
  it('none discard drains later success and preserves its pixels without replay',async()=>{
    const h=harness();h.begin('A');h.end('A');h.begin('B');h.end('B');await h.decode(0,['base']);
    h.writes[0].work.reject({message:'temporary',effect:'none'});await tick();const discard=h.owner.resolveFailure('discard');
    await h.ack(1,'B');expect(await discard).toBe(true);await h.decode(1,['base','B']);expect(h.owner.frame().canvas?.pixels).toEqual(['base','B']);expect(h.writes).toHaveLength(2);
  });
  it('unknown discard preserves an actually installed asset instead of assuming no effect',async()=>{
    const h=harness();h.begin('A');h.end('A');await h.decode(0,['base']);h.setCurrent({...h.current(),assetId:'installed-A'});
    h.writes[0].work.reject({message:'post-install exception',effect:'unknown'});await tick();
    h.owner.markRecoveryExportRequested();expect(await h.owner.resolveFailure('discard')).toBe(true);
    expect(h.decodes[1].target.assetId).toBe('installed-A');await h.decode(1,['base','A']);expect(h.owner.frame().canvas?.pixels).toEqual(['base','A']);
  });
  it('a later failure invalidates earlier export evidence and cannot be discarded unseen',async()=>{
    const h=harness();h.begin('A');h.end('A');h.begin('B');h.end('B');
    h.writes[0].work.reject({message:'unknown A',effect:'unknown'});await tick();h.owner.markRecoveryExportRequested();
    const discard=h.owner.resolveFailure('discard');h.writes[1].work.reject({message:'unknown B',effect:'unknown'});await tick();
    expect(await discard).toBe(false);expect(h.owner.recoveryRecord().entries).toHaveLength(2);expect(h.owner.stats().records).toBe(2);
  });
  it('failure during a history barrier retains both draining failure and new queued input for recovery',async()=>{
    const h=harness();h.begin('A');h.end('A');await h.decode(0,['base']);let ran=false;
    const barrier=h.owner.barrier(async()=>{ran=true;});h.begin('B');h.end('B');const refused=expect(barrier).rejects.toThrow('temporary');
    h.writes[0].work.reject({message:'temporary',effect:'none'});await refused;expect(ran).toBe(false);
    expect(await h.owner.resolveFailure('retry')).toBe(true);expect(h.writes.map(w=>w.stroke.id)).toEqual(['A','A','B']);
    await h.decode(1,['base']);expect(h.owner.frame().canvas?.pixels).toEqual(['base','A','B']);
  });
  it('dispose during recovery drain prevents retry or allocation in the next session',async()=>{
    const h=harness();h.begin('A');h.end('A');h.begin('B');h.end('B');h.writes[0].work.reject({message:'temporary',effect:'none'});await tick();
    const retry=h.owner.resolveFailure('retry');h.owner.dispose();await h.ack(1,'B');expect(await retry).toBe(false);expect(h.writes).toHaveLength(2);expect(h.owner.stats().rasters).toBe(0);
  });
  it('bounds pixels before allocation and rejects simultaneous drafts explicitly',()=>{
    const h=harness({maxPixels:1});expect(h.begin('A')).toBe(false);expect(h.decodes).toHaveLength(0);
    const j=harness();j.begin('A');expect(j.begin('B')).toBe(false);expect(j.reports).toHaveLength(1);
  });
  it('snapshots accepted input; cancellation discards only the active gesture',async()=>{
    const h=harness();const s=stroke('A');h.owner.begin('shot','ink',s);s.points[0]=900;h.end('A');h.begin('B');h.owner.cancel('B');await h.decode(0,['base']);
    expect(h.writes[0].stroke.points).toEqual([2,3]);expect(h.owner.frame().canvas?.pixels).toEqual(['base','A']);
  });
  it('coalesces ACK decode targets while initial decode is outstanding; inputs retire only on coverage',async()=>{
    const h=harness();for(const id of ['A','B','C']){h.begin(id);h.end(id);}
    await h.ack(0,'A');await h.ack(1,'AB');await h.ack(2,'ABC');
    expect(h.decodes).toHaveLength(1);expect(h.owner.stats().records).toBe(3);
    await h.decode(0,['base']);expect(h.decodes[1].target.assetId).toBe('ABC');
    expect(h.owner.frame().canvas?.pixels).toEqual(['base','A','B','C']);
    await h.decode(1,['base','A','B','C']);expect(h.owner.stats().records).toBe(0);
  });
  it('counts draining inputs against the same point budget during a history barrier',async()=>{
    const h=harness({maxPoints:2});h.begin('A');h.owner.update({...stroke('A'),points:[1,2,3,4]});h.end('A');
    const barrier=h.owner.barrier(async()=>{});expect(h.begin('B')).toBe(false);
    expect(h.owner.stats().points).toBe(2);await h.ack(0,'A');await barrier;
    expect(h.begin('B')).toBe(true);
  });
  it('a failed write is not erased by later successful in-flight receipt/decode',async()=>{
    const h=harness();h.begin('A');h.end('A');h.begin('B');h.end('B');await h.decode(0,['base']);
    h.writes[0].work.reject({message:'failed A',effect:'unknown'});await tick();await h.ack(1,'B');
    expect(h.owner.stats().records).toBe(2);expect(h.owner.frame().status).toBe('error');
    await expect(h.owner.settle()).rejects.toThrow('failed A');expect(h.decodes).toHaveLength(1);
  });

});
