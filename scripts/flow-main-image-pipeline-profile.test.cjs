const{test}=require('node:test'),assert=require('node:assert/strict');const{createProfile}=require('./flow-main-image-pipeline-profile.cjs');
test('preserves original promise identity, receiver, result/error and nesting operation association',async()=>{
 let time=0,resolve;const pending=new Promise(r=>resolve=r),error=new Error('same failure');const fakeFs={open:()=>Promise.reject(error)},originalOpen=fakeFs.open;
 const p=createProfile({clock:()=>++time,phase:()=> 'test',root:'/owned',fs:fakeFs});
 const inner={call(){assert.equal(this,inner);return pending;}},outer={call(op){assert.equal(this,outer);return inner.call();},fail(){throw error;}};
 const originalOuter=outer.call;p.wrap(inner,'call','lease.assertHeld');p.wrap(outer,'call','store.commit',args=>args[0]);p.wrap(outer,'fail','failure');
 assert.equal(outer.call('op-1'),pending);resolve(17);assert.equal(await pending,17);await Promise.resolve();
 assert.equal(p.spans[1].operationId,'op-1');assert.equal(p.spans[1].parentSpanId,p.spans[0].id);assert.equal(p.spans[0].status,'fulfilled');assert.throws(()=>outer.fail(),e=>e===error);
 p.restore();assert.equal(outer.call,originalOuter);assert.equal(fakeFs.open,originalOpen);
});
test('wraps/restores own handle sync without extra FS operations and preserves rejected promise',async()=>{
 let time=0,openCalls=0,syncCalls=0;const error=new Error('same sync failure'),failure=Promise.reject(error);void failure.catch(()=>{});
 const handle={sync(){assert.equal(this,handle);syncCalls++;return failure;}},opened=Promise.resolve(handle),fakeFs={open(){assert.equal(this,fakeFs);openCalls++;return opened;}},originalSync=handle.sync;
 const p=createProfile({clock:()=>++time,phase:()=> 'paced',root:'/owned',fs:fakeFs});assert.equal(fakeFs.open('/owned/.storyboard-flow/image-project-v2/settlements/record.tmp','wx'),opened);await opened;
 assert.equal(handle.sync(),failure);await assert.rejects(failure,e=>e===error);await Promise.resolve();assert.equal(openCalls,1);assert.equal(syncCalls,1);assert.equal(p.spans[0].category,'settlements-file');assert.equal(p.spans[0].status,'rejected');p.restore();assert.equal(handle.sync,originalSync);
});
test('observer failures are consumed and restoring before an open resolves cannot leave a late hook',async()=>{
 let time=0,resolve;const handle={sync(){return Promise.resolve();}},originalSync=handle.sync,opened=new Promise(r=>resolve=r),fs={open:()=>opened};
 const p=createProfile({clock:()=>{if(++time>1)throw Error('observer-only failure');return time;},phase:()=> 'test',root:'/owned',fs});
 const target={run:()=>Promise.resolve(3)};p.wrap(target,'run','store.commit');assert.equal(await target.run(),3);await new Promise(r=>setImmediate(r));
 fs.open('/owned/entry');p.restore();resolve(handle);await opened;await new Promise(r=>setImmediate(r));assert.equal(handle.sync,originalSync);
});
