import { describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NativeLayerPanel, type NativeLayerPanelProps } from './NativeLayerPanel';
import { nativeBlendLabel, nativeLayerGestureKey, nativeLayerReason, nativeLayerRows, nativeLayerSelection, nativeOpacityChanges, NativeOpacityGesture, type NativeLayerView, type NativeOpacityEvent } from './nativeLayerPanelModel';
const layer = (id:string, patch:Partial<NativeLayerView> = {}):NativeLayerView => ({id,parentId:null,name:`Layer ${id}`,kind:'raster',visible:true,locked:false,opacity:1,blendMode:'normal',editable:true,capabilities:{paint:true,properties:true,structure:true},...patch});
const tick=async()=>{await Promise.resolve();await Promise.resolve();await Promise.resolve();};
const deferred=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return{promise,resolve};};
const image=(layers:NativeLayerView[]):NonNullable<NativeLayerPanelProps['image']>=>({imageId:'img',content:{kind:'source',source:{importId:'import',itemId:'item',interpretationId:'interpretation'}},availability:'editable',layers,activeLayerId:layers.at(-1)?.id??null,contextGeneration:1});

describe('native layer projection and selection',()=>{
  it('shows nested groups above reversed children without mutating the bottom-to-top snapshot',()=>{
    const input=[layer('bottom'),layer('child-low',{parentId:'group'}),layer('child-high',{parentId:'group'}),layer('group',{kind:'group'}),layer('top')];
    expect(nativeLayerRows(input).map(r=>[r.layer.id,r.depth])).toEqual([['top',0],['group',0],['child-high',1],['child-low',1],['bottom',0]]);
    expect(input.map(l=>l.id)).toEqual(['bottom','child-low','child-high','group','top']);
    expect(nativeLayerRows(input,new Set(['group'])).map(r=>r.layer.id)).toEqual(['top','group','bottom']);
  });
  it('keeps orphan/cyclic native metadata visible exactly once',()=>{
    expect(nativeLayerRows([layer('a',{parentId:'b'}),layer('b',{parentId:'a'}),layer('orphan',{parentId:'missing'})]).map(r=>r.layer.id).sort()).toEqual(['a','b','orphan']);
  });
  it('supports single, toggle, shift range and additive modifier range in display order',()=>{
    const ids=['top','mid','low','bottom'];
    expect(nativeLayerSelection(ids,[],'mid',undefined,{})).toEqual({selectedIds:['mid'],anchorId:'mid'});
    expect(nativeLayerSelection(ids,['mid'],'top','mid',{metaKey:true}).selectedIds).toEqual(['top','mid']);
    expect(nativeLayerSelection(ids,['mid'],'mid','mid',{ctrlKey:true}).selectedIds).toEqual([]);
    expect(nativeLayerSelection(ids,['top'],'bottom','mid',{shiftKey:true}).selectedIds).toEqual(['mid','low','bottom']);
    expect(nativeLayerSelection(ids,['top'],'bottom','mid',{shiftKey:true,ctrlKey:true}).selectedIds).toEqual(ids);
  });
  it('uses capabilities for groups and reference content rather than guessing from kind/editable',()=>{
    const group=layer('g',{kind:'group',editable:false,capabilities:{paint:false,properties:true,structure:false},readOnlyReason:'保留复杂组结构'});
    expect(nativeLayerReason(group,'properties')).toBeUndefined();
    expect(nativeLayerReason(group,'structure')).toBe('保留复杂组结构');
    expect(nativeLayerReason(group,'paint')).toBe('保留复杂组结构');
    expect(nativeLayerReason(layer('locked',{locked:true}),'properties')).toContain('锁定');
    expect(nativeLayerReason(layer('locked',{locked:true}),'properties',true)).toBeUndefined();
  });
  it('keeps opaque native blend values visible and never labels them normal',()=>{
    expect(nativeBlendLabel('opaque:passThrough')).toBe('原生模式：opaque:passThrough');
    const html=renderToStaticMarkup(createElement(NativeLayerPanel,{image:image([layer('g',{kind:'group',blendMode:'opaque:passThrough',editable:false,capabilities:{paint:false,properties:true,structure:false}})]),onSelect:vi.fn(),onEdit:vi.fn(),onOpacityGesture:vi.fn(),allowedEdits:['setLayer']}));
    expect(html).toContain('value="opaque:passThrough" selected=""');
    expect(html).toContain('原生模式：opaque:passThrough');
    expect(html).toContain('native-blend-unknown');
    expect(html).not.toContain('<img');
    expect(html).toContain('尚无单层缩略图');
  });
  it('fails closed when Main does not provide edit capabilities and explains readonly rows',()=>{
    const html=renderToStaticMarkup(createElement(NativeLayerPanel,{image:image([layer('ref',{kind:'reference',capabilities:{paint:false,properties:false,structure:false},readOnlyReason:'仅供参考'})]),onSelect:vi.fn(),onEdit:vi.fn(),onOpacityGesture:vi.fn()}));
    expect(html).toMatch(/aria-label="新增图层"[^>]*disabled=""/);
    expect(html).toMatch(/aria-label="Layer name"[^>]*disabled=""/);
    expect(html).toContain('仅供参考');
  });
});

describe('native opacity gestures',()=>{
  it('preserves single absolute opacity and multi-layer relative delta with clamping',()=>{
    const layers=[layer('a',{opacity:.9}),layer('b',{opacity:.3}),layer('readonly',{opacity:.5,capabilities:{paint:false,properties:false,structure:false}})];
    expect(nativeOpacityChanges(layers,['a'],.42)).toEqual([{layerId:'a',before:.9,opacity:.42}]);
    expect(nativeOpacityChanges(layers,['a','b','readonly'],0,.2)).toEqual([{layerId:'a',before:.9,opacity:1},{layerId:'b',before:.3,opacity:.5}]);
    expect(layers[0].opacity).toBe(.9);
  });
  it('coalesces preview pressure into one latest slot and commits once after the preview settles',async()=>{
    const gate=deferred();const events:NativeOpacityEvent[]=[];
    const emit=vi.fn(async(event:NativeOpacityEvent)=>{events.push(event);if(events.length===1)await gate.promise;});
    const initial=[{layerId:'a',before:1,opacity:.8}];
    const gesture=new NativeOpacityGesture(initial,emit);
    gesture.preview(initial);
    for(let i=0;i<100;i++)gesture.preview([{layerId:'a',before:1,opacity:i/100}]);
    const end=gesture.finish('commit');
    expect(events.map(e=>e.phase)).toEqual(['preview']);
    gate.resolve();await end;
    expect(events.map(e=>e.phase)).toEqual(['preview','preview','commit']);
    expect(events.at(-1)?.changes).toEqual([{layerId:'a',before:1,opacity:.99}]);
    await gesture.finish('commit');expect(emit).toHaveBeenCalledTimes(3);
    expect(gesture.state).toBe('committed');
  });
  it.each(['Escape','blur','pointercancel','panel-close','image-switch'])('cancels %s without producing a durable commit',async()=>{
    const events:NativeOpacityEvent[]=[];const changes=[{layerId:'a',before:.6,opacity:.2},{layerId:'b',before:.8,opacity:.4}];
    const gesture=new NativeOpacityGesture(changes,event=>{events.push(event);});gesture.preview(changes);await gesture.finish('cancel');
    expect(events.map(e=>e.phase)).toEqual(['preview','cancel']);expect(events[1].changes).toEqual(changes);expect(gesture.state).toBe('canceled');
  });
  it('keeps rejected commit input and error until explicit retry',async()=>{
    const failure=new Error('native outcome retained');let fail=true;
    const emit=vi.fn(async(e:NativeOpacityEvent)=>{if(e.phase==='commit'&&fail)throw failure;});
    const changes=[{layerId:'a',before:1,opacity:.27}];const gesture=new NativeOpacityGesture(changes,emit);gesture.preview(changes);
    await expect(gesture.finish('commit')).rejects.toBe(failure);
    expect(gesture.state).toBe('failed');expect(gesture.changes).toEqual(changes);expect(gesture.error).toBe(failure);
    await expect(gesture.finish('commit')).rejects.toBe(failure);
    fail=false;await gesture.finish('commit',true);
    expect(emit.mock.calls.map(([e])=>e.phase)).toEqual(['preview','commit','preview','commit']);expect(gesture.state).toBe('committed');
  });
  it('does not turn a failed preview into an automatic commit on pointer-up and permits rollback',async()=>{
    const failure=new Error('preview failed');const events:NativeOpacityEvent[]=[];
    const gesture=new NativeOpacityGesture([],async e=>{events.push(e);if(e.phase==='preview')throw failure;});
    gesture.preview([{layerId:'a',before:.8,opacity:.3}]);await tick();
    await expect(gesture.finish('commit')).rejects.toBe(failure);
    expect(events.map(e=>e.phase)).toEqual(['preview']);
    await gesture.finish('cancel');expect(events.map(e=>e.phase)).toEqual(['preview','cancel']);
  });
  it('retains failed cancellation and blocks further preview while recovery is needed',async()=>{
    const failure=new Error('rollback unknown');const emit=vi.fn(async(e:NativeOpacityEvent)=>{if(e.phase==='cancel')throw failure;});
    const changes=[{layerId:'a',before:1,opacity:.4}];const gesture=new NativeOpacityGesture(changes,emit);gesture.preview(changes);
    await expect(gesture.finish('cancel')).rejects.toBe(failure);gesture.preview([{layerId:'a',before:1,opacity:.9}]);
    expect(gesture.changes).toEqual(changes);expect(gesture.state).toBe('failed');
  });
  it('fails closed for a preview rejection even when its thrown value is undefined',async()=>{
    const phases:string[]=[];
    const gesture=new NativeOpacityGesture([],async e=>{phases.push(e.phase);if(e.phase==='preview')throw undefined;});
    gesture.preview([{layerId:'a',before:1,opacity:.2}]);await tick();
    await expect(gesture.finish('commit')).rejects.toBeUndefined();
    expect(phases).toEqual(['preview']);expect(gesture.state).toBe('failed');
  });
  it('blocks mixed keyboard commits during pointer ownership; only Escape cancels',()=>{
    expect(nativeLayerGestureKey('Escape')).toBe('cancel');
    for(const key of ['Enter',' ','ArrowUp','ArrowDown','ArrowLeft','ArrowRight'])expect(nativeLayerGestureKey(key)).toBe('block');
    expect(nativeLayerGestureKey('Shift')).toBe('pass');
  });
});
