// Runs inside the isolated Electron fixture created by flow-workbench-layout-smoke.mjs --layers.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
module.exports = async ({phase,js,win,mouse,rect,button,wait,delay,read,run}) => {
  const saved = path.join(run,'expected-layers.json');
  const layers = () => read().images.image0.layers;
  const dock = '.wb-panel-layers';
  const row = id => dock+' .layer-row[data-layer-id="'+id+'"]';
  const named = label => dock+' [aria-label="'+label+'"]';
  const checkDisabled = sel => js('document.querySelector('+JSON.stringify(sel)+').disabled');
  const click = async sel => {
    await js('document.querySelector('+JSON.stringify(sel)+').scrollIntoView({block:"nearest"})');
    const r=await rect(sel), x=r.x+r.width/2,y=r.y+r.height/2;
    assert.ok(await js('document.querySelector('+JSON.stringify(sel)+').contains(document.elementFromPoint('+x+','+y+'))'),'click target visible: '+sel);
    await mouse('mouseDown',x,y);await mouse('mouseUp',x,y);
  };
  if(phase==='reopen'){
    const expected=JSON.parse(fs.readFileSync(saved));
    assert.deepEqual(layers(),expected);
    assert.equal(await js('document.querySelectorAll(".wb-panel-layers .layer-row").length'),expected.length);
    return;
  }
  const menu = dock+' .dock-layer-menu:popover-open';
  const openMenu=async id=>{
    const r=await rect(row(id));const x=Math.round(r.x+r.width*.28),y=Math.round(r.y+r.height*.5);
    for(const type of ['mouseDown','mouseUp']) {win.webContents.sendInputEvent({type,x,y,button:'right',clickCount:1});await delay(70);}
    await wait(()=>js('!!document.querySelector('+JSON.stringify(menu)+')'),'right-click menu');
  };
  const dismiss=async()=>{for(const type of ['keyDown','keyUp'])win.webContents.sendInputEvent({type,keyCode:'Escape'});await wait(()=>js('!document.querySelector('+JSON.stringify(menu)+')'),'dismiss menu');};
  const undo=async predicate=>{await button('撤销');await wait(predicate,'Undo');};
  await openMenu('ink');
  assert.equal(await checkDisabled(menu+' button:last-child'),true,'locked background must not be merged');
  await dismiss();
  await click(named('Add layer'));
  await wait(()=>layers().length===3,'add');const id=layers()[2].id;
  await wait(()=>js('document.querySelector('+JSON.stringify(row(id))+').classList.contains("is-active")'),'new layer active');
  const panel=await rect(dock);fs.writeFileSync(path.join(run,'layer-dock.png'),(await win.webContents.capturePage({x:Math.floor(panel.x),y:Math.floor(panel.y),width:Math.floor(panel.width),height:Math.floor(panel.height)})).toPNG());
  const name=row(id)+' input[aria-label="Layer name"]';
  await js('(()=>{const e=document.querySelector('+JSON.stringify(name)+');e.focus();e.select();})()');
  await win.webContents.insertText('审查图层');await js('document.activeElement.blur()');
  await wait(()=>layers()[2].name==='审查图层','rename');
  await js('(()=>{const e=document.querySelector(".dock-layer-properties select");e.value="screen";e.dispatchEvent(new Event("change",{bubbles:true}));})()');
  await wait(()=>layers()[2].blendMode==='screen','blend option reachable');
  await openMenu(id);
  assert.equal(await checkDisabled(menu+' button:first-child'),true,'blended pair above background cannot merge');
  await dismiss();
  await undo(()=>layers()[2].blendMode==='normal');
  const paint=async()=>{
    const b=await rect('.wb-viewer .image-stage');const x=b.x+b.width*.4,y=b.y+b.height*.5;
    await mouse('mouseDown',x,y);await mouse('mouseMove',x+20,y+3);await mouse('mouseUp',x+20,y+3);
  };
  const rasterMatches=()=>js('(()=>{const r=document.querySelector('+JSON.stringify(row(id)+' .layer-thumb img')+');return !!r?.naturalWidth && [...document.querySelectorAll(".wb-viewer .image-stage > img")].some(i=>i.src===r.src&&i.naturalWidth>0)})()');
  const blank=layers()[2].assetId;
  await paint();await wait(()=>layers()[2].assetId!==blank,'paint new layer');await wait(rasterMatches,'viewer and thumbnail resolve painted raster');
  const painted=layers();
  await click(dock+' .dock-layer-properties button');await wait(()=>layers()[2].locked,'lock');const locked=read().revision;
  await paint();await delay(600);assert.equal(read().revision,locked,'locked layer must not redirect paint');
  await click(dock+' .dock-layer-properties button');await wait(()=>!layers()[2].locked,'unlock');
  await click(row(id)+' [aria-label="Hide layer"]');await wait(()=>!layers()[2].visible,'hide');const hidden=read().revision;
  assert.ok(await js('document.querySelector('+JSON.stringify(row(id))+').classList.contains("is-active")'),'hidden layer remains selected');
  await paint();await delay(600);assert.equal(read().revision,hidden,'hidden layer must not redirect paint');
  await click(named('Delete current layer'));await wait(()=>!layers().some(l=>l.id===id),'delete hidden selection');
  await undo(()=>layers().some(l=>l.id===id&&!l.visible));
  await click(row(id)+' [aria-label="Show layer"]');await wait(()=>layers()[2].visible,'show');
  const r=await rect(row(id));const x=r.x+r.width*.28,y=r.y+r.height*.5;
  const start=async()=>{await mouse('mouseDown',x,y);await mouse('mouseMove',x+45,y);await wait(()=>js('!!document.querySelector(".is-opacity-dragging")'),'opacity preview');};
  const before=read().revision;
  await start();await js('window.dispatchEvent(new PointerEvent("pointercancel",{pointerId:1}))');await mouse('mouseUp',x+45,y);await delay(500);
  assert.equal(read().revision,before,'cancel must leave checkpoint and Undo unchanged');
  await start();await js('window.dispatchEvent(new Event("blur"))');await mouse('mouseUp',x+45,y);await delay(450);
  assert.equal(read().revision,before,'window deactivation must cancel single-layer opacity');
  const other=await rect(row('ink'));
  await mouse('mouseDown',x,y);await mouse('mouseMove',x,other.y+other.height*.8);
  await wait(()=>js('!!document.querySelector(".is-reorder-dragging")'),'reorder preview');
  await js('window.dispatchEvent(new PointerEvent("pointercancel",{pointerId:1}))');
  await mouse('mouseUp',x,other.y+other.height*.8);await delay(450);
  assert.deepEqual(layers(),painted,'interrupted reorder must leave order unchanged');
  await start();await mouse('mouseUp',x+45,y);await wait(()=>layers()[2].opacity<1,'commit opacity');
  await undo(()=>layers()[2].opacity===1);
  await openMenu(id);await click(menu+' button:first-child');await wait(()=>layers().length===2,'merge down');
  await undo(()=>layers().length===3);assert.deepEqual(layers(),painted);
  await click(row('base')+' [aria-label="Hide layer"]');await wait(()=>!layers()[0].visible,'hide background');
  await openMenu('ink');
  assert.equal(await checkDisabled(menu+' button:last-child'),false,'merge visible enabled after hiding locked background');
  await click(menu+' button:last-child');await wait(()=>layers().length===2,'merge visible');
  await undo(()=>layers().length===3);await undo(()=>layers()[0].visible);assert.deepEqual(layers(),painted);
  fs.writeFileSync(saved,JSON.stringify(layers()));console.log('Workbench layer operations passed');
};
