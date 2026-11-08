// Test-only, memory-only observation. Product modules and real effects are unchanged.
const {AsyncLocalStorage}=require('node:async_hooks');const path=require('node:path');
function createProfile({clock,phase,root,fs}){
 const context=new AsyncLocalStorage(),spans=[],restore=[],handles=new WeakSet();let sequence=0,enabled=true;
 function invoke(original,self,args,label,operationId,detail={}){
  if(!enabled)return Reflect.apply(original,self,args);
  const parent=context.getStore(),span={id:++sequence,label,phase:phase(),operationId:operationId??parent?.operationId??null,operationIds:operationId?[operationId]:parent?.operationIds,batchId:parent?.batchId,parentSpanId:parent?.id??null,startedAtMainMs:clock(),...detail};spans.push(span);
  const finish=(status,error)=>{span.endedAtMainMs=clock();span.durationMs=span.endedAtMainMs-span.startedAtMainMs;span.status=status;if(error!==undefined)span.error=String(error);};
  try{const result=context.run({id:span.id,operationId:span.operationId,operationIds:span.operationIds,batchId:span.batchId},()=>Reflect.apply(original,self,args));
   if(result&&typeof result.then==='function')void result.then(()=>finish('fulfilled'),e=>finish('rejected',e)).catch(()=>{});else finish('returned');
   return result;
  }catch(error){finish('threw',error);throw error;}
 }
 function wrap(object,key,label,operation){
  const original=object[key],descriptor=Object.getOwnPropertyDescriptor(object,key);
  const replacement=function(...args){const identity=operation?.(args);return invoke(original,this,args,label,typeof identity==='string'?identity:undefined,identity&&typeof identity==='object'?identity:{});};object[key]=replacement;
  restore.push(()=>{if(object[key]===replacement){if(descriptor)Object.defineProperty(object,key,descriptor);else delete object[key];}});
 }
 const classify=p=>{
  const rel=path.relative(root,p);if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))return;
  const journal='.storyboard-flow/image-project-journal-v1';
  if(rel===journal)return{path:rel,category:'journal-directory'};
  if(rel.startsWith(journal+'/'))return{path:rel,category:/\/segment-[^/]+\.log$/.test(rel)?'journal-segment-file':/\/continuation-[^/]+\.json$/.test(rel)?'journal-continuation-file':'journal-other-entry'};
  if(rel==='.storyboard-flow/image-project-v2')return{path:rel,category:'project-store-directory'};
  for(const category of ['commits','settlements','hydrations']){const base='.storyboard-flow/image-project-v2/'+category;if(rel===base)return{path:rel,category:category+'-directory'};if(rel.startsWith(base+'/'))return{path:rel,category:category+'-file'};}
  if(rel.startsWith('.storyboard-flow/image-project-v2/head.'))return{path:rel,category:'head-temporary-file'};
  return{path:rel,category:'other-project-entry'};
 };
 const originalOpen=fs.open,openDescriptor=Object.getOwnPropertyDescriptor(fs,'open');
 const open=function(...args){const result=Reflect.apply(originalOpen,this,args),p=typeof args[0]==='string'?args[0]:undefined,detail=p&&classify(p);
  if(enabled&&detail)void result.then(handle=>{if(!enabled||handles.has(handle))return;handles.add(handle);const original=handle.sync,descriptor=Object.getOwnPropertyDescriptor(handle,'sync');
   const replacement=function(...syncArgs){return invoke(original,this,syncArgs,'fs.handle.sync',undefined,detail);};handle.sync=replacement;
   restore.push(()=>{if(handle.sync===replacement){if(descriptor)Object.defineProperty(handle,'sync',descriptor);else delete handle.sync;}});
  },()=>{}).catch(()=>{});return result;
 };fs.open=open;
 restore.push(()=>{if(fs.open===open){if(openDescriptor)Object.defineProperty(fs,'open',openDescriptor);else fs.open=originalOpen;}});
 return{spans,wrap,restore(){enabled=false;for(const f of restore.reverse())f();},
  meaning:'API spans are entry→original Promise settlement, including internal queue/await work; nested spans overlap and must not be summed. fs.handle.sync spans measure Node FileHandle.sync calls, including OS scheduling; Rust host/guard IO is excluded. Only memory writes during input; hooks restored before fixture report files.'};
}
module.exports={createProfile};
