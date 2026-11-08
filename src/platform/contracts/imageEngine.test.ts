import {expect,it} from 'vitest';
import {validImageEngineEdit,validImageEnginePreviewStamp} from './imageEngine';
const polygon=[{x:0,y:0},{x:12,y:0},{x:12,y:8}],matrix=[1,0,0,1,2,3];
it('validates all product intents without coercing full-width native IDs',()=>{
 const id='18446744073709551615';
 for(const edit of [{kind:'newLayer',name:'层'},{kind:'setLayer',layerId:id,patch:{name:'',visible:false,locked:true,opacity:0,blendMode:'screen'}},{kind:'setLayerOpacities',changes:[{layerId:id,before:.4,opacity:.8}]},{kind:'removeLayer',layerId:id},{kind:'moveLayers',layerIds:[id],targetLayerId:'0',placement:'after'},{kind:'clear',layerId:id},{kind:'merge',layerIds:[id,'0']},{kind:'mergeVisible'},{kind:'blur',layerId:id,radius:50,selection:polygon},{kind:'fill',layerId:id,x:0,y:0,color:[0,0,0,255],tolerance:255},{kind:'transform',layerId:id,selection:polygon,matrix}])expect(validImageEngineEdit(edit),JSON.stringify(edit)).toBe(true);
});
it('rejects malformed, aliased, sparse and unsafe inputs as a whole',()=>{
 const fill={kind:'fill',layerId:'7',x:0,y:0,color:[0,0,0,255],tolerance:0};
 for(const bad of [{...fill,extra:1},{...fill,layerId:7},{...fill,layerId:'07'},{...fill,layerId:'18446744073709551616'},{...fill,x:NaN},{...fill,color:Array(4)},{...fill,tolerance:256},{kind:'setLayer',layerId:'7',patch:{}},{kind:'setLayer',layerId:'7',patch:{opacity:undefined}},{kind:'moveLayers',layerIds:['7'],targetLayerId:'7',placement:'before'},{kind:'merge',layerIds:['7','7']},{kind:'transform',layerId:'7',selection:polygon,matrix:[0,0,0,0,0,0]},{kind:'blur',layerId:'7',radius:0},{kind:'blur',layerId:'7',radius:1,selection:Array(3)}])expect(validImageEngineEdit(bad),JSON.stringify(bad)).toBe(false);
 let read=false;const accessor={kind:'clear',get layerId(){read=true;return '7';}};expect(validImageEngineEdit(accessor)).toBe(false);expect(read).toBe(false);
});
it('binds preview tokens to immutable source and native frame generation',()=>{
 const stamp={documentId:'9007199254740995',workerEpoch:2,epoch:4,previewId:'preview',throughSeq:1,baseVersion:'a'.repeat(64),sourceContextGeneration:9,editDigest:'b'.repeat(64)};
 expect(validImageEnginePreviewStamp(stamp)).toBe(true);expect(validImageEnginePreviewStamp({...stamp,documentId:9007199254740995})).toBe(false);expect(validImageEnginePreviewStamp({...stamp,throughSeq:0})).toBe(false);
});
