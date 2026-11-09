// Shared GUI acceptance only: real pointer selection/painting with synthetic projects.
const assert=require('node:assert/strict');
module.exports=async function admissionCases({win,js,boot,wait,pause,report,inputEvents,setActivationDelay}){
 const initial=await boot(),first=initial.session.project.shots[0];
 const mouse=(type,x,y)=>win.webContents.sendInputEvent({type,x:Math.round(x),y:Math.round(y),button:'left',clickCount:1});
 const click=label=>js(`(()=>{const b=document.querySelector('[aria-label='+CSS.escape(${JSON.stringify(label)})+']');if(!b||b.disabled)throw Error('Unavailable: '+${JSON.stringify(label)});b.click()})()`);
 const current=async()=>{const s=await boot();return s.images[s.context.imageId];};
 const noRecovery=async()=>assert.equal(await js('!!document.querySelector("[aria-label=待处理笔迹]")'),false,'ordinary selection must not create retained-input recovery');
 const rect=async selector=>{
  await js(`document.querySelector(${JSON.stringify(selector)}).scrollIntoView({block:'center',inline:'nearest'})`);
  await wait(()=>js(`(()=>{const n=document.querySelector(${JSON.stringify(selector)});if(!n)return false;const r=n.getBoundingClientRect();const hit=document.elementFromPoint(r.x+r.width*.3,r.y+r.height*.5);return r.width>10&&r.height>10&&n.contains(hit)&&(!n.classList.contains('wb-card-picture')||!!n.querySelector('[data-surface]'))})()`),'visible real pointer target');
  return js(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
 };
 const draw=async r=>{mouse('mouseDown',r.x+r.w*.3,r.y+r.h*.5);await pause(16);mouse('mouseMove',r.x+r.w*.55,r.y+r.h*.5);await pause(16);mouse('mouseUp',r.x+r.w*.55,r.y+r.h*.5);};
 report.admissionCases=[];report.stage='locked-layer-no-capture';
 await wait(()=>js('!document.querySelector("[aria-label=锁定当前图层]").disabled'),'layer lock available');await click('锁定当前图层');
 await wait(async()=>{const s=await boot();return s.images[s.context.imageId].layers.find(l=>l.id===s.context.layerId)?.locked;},'locked layer confirmed');
 const locked=await boot(),begins=inputEvents.filter(e=>e.kind==='begin').length;
 await draw(await rect(`[data-surface="viewer:${first.id}"] [data-canvas-input]`));await pause(300);
 assert.equal(inputEvents.filter(e=>e.kind==='begin').length,begins,'locked-layer click must be refused before capture IPC');
 assert.equal((await boot()).session.project.revision,locked.session.project.revision);await noRecovery();
 // Resolve an inactive locked board through the provisional target path.
 const other=locked.session.project.shots[1];
 await js(`document.querySelector('[data-board-id="${other.id}"] .wb-card-handle').click()`);
 await wait(async()=>(await boot()).context.shotId===other.id,'leave locked board');
 setActivationDelay(250);
 await draw(await rect(`[data-board-id="${first.id}"] .wb-card-picture`));
 await wait(async()=>(await boot()).context.shotId===first.id,'inactive locked board activated');await pause(400);
 assert.equal(inputEvents.filter(e=>e.kind==='begin').length,begins,'inactive locked target must not send begin');
 assert.equal((await boot()).session.project.revision,locked.session.project.revision);await noRecovery();setActivationDelay(0);
 await click('解锁当前图层');await wait(async()=>{const s=await boot();return s.images[s.context.imageId].layers.find(l=>l.id===s.context.layerId)?.capabilities.paint;},'unlocked paint capability');
 await wait(()=>js('!document.body.innerText.includes("当前图层不能绘画，请选择可绘画图层或新建图层。")'),'ordinary refusal clears after unlocking');
 report.admissionCases.push('locked-layer real pointer gesture creates no input, recovery or project edit; unlock remains available');
 report.stage='cold-static-card-first-stroke';setActivationDelay(250);
 for(const index of [80,160,240]){
  const before=await boot(),shot=before.session.project.shots[index],image=before.images[shot.imageId],seen=inputEvents.length;
  const selector=`[data-board-id="${shot.id}"] .wb-card-picture`;
  const r=await rect(selector);
  // Real down is delivered to a static card; no preceding header selection,
  // navigation button or direct activate request may conceal the handoff race.
  const started=Date.now();await draw(r);
  await wait(async()=>{await noRecovery();const s=await boot();return s.context.shotId===shot.id&&s.session.project.revision===before.session.project.revision+1;},'cold static-card stroke committed',30000);
  const after=await boot(),sent=inputEvents.slice(seen).filter(e=>e.kind==='begin');assert.equal(sent.length,1,'one down creates exactly one begin');assert.equal(sent[0].shotId,shot.id,'input must remain bound to clicked board');
  assert.notDeepEqual(after.session.project.images[shot.imageId].content,before.session.project.images[shot.imageId].content,'clicked image gains the stroke');
  for(const other of before.session.project.shots.filter(s=>s.id!==shot.id))assert.deepEqual(after.session.project.images[other.imageId].content,before.session.project.images[other.imageId].content,'no stroke redirected to another image');
  report.admissionCases.push({kind:'static-card-first-stroke',index,beforeAvailability:image.availability,commitMs:Date.now()-started});
 }
 setActivationDelay(0);await noRecovery();
 const revision=(await boot()).session.project.revision;
 await js(`document.querySelector('[data-board-id="${first.id}"] .wb-card-handle').click()`);
 await wait(async()=>{const s=await boot();return s.context.shotId===first.id;},'return to original board');
 await wait(()=>js(`!!document.querySelector('[data-surface="viewer:${first.id}"] canvas[data-frame-status=ready]')`),'original board ready');
 assert.equal((await boot()).session.project.revision,revision,'selection-only header must not paint');
 return revision-initial.session.project.revision;
};
