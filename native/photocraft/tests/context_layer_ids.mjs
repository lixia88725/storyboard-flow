// Node child speaks the production bounded framing to a real Rust Host fixture.
import assert from 'node:assert/strict';
import fs from 'node:fs';
function exact(n){const b=Buffer.alloc(n);let p=0;while(p<n){const got=fs.readSync(0,b,p,n-p,null);assert(got>0,'native host EOF');p+=got;}return b;}
function read(){const prefix=exact(8),h=prefix.readUInt32LE(0),p=prefix.readUInt32LE(4);assert(h>0&&h<=65536&&p<=67108864);const header=JSON.parse(exact(h).toString('utf8'));exact(p);return header;}
const hello=read();assert(hello.capabilities.includes('decimalLayerIdsV1'));
let sequence=0;
function call(body){const request={protocol:1,requestId:`node-${++sequence}`,sessionId:'nodeIds',incarnation:'once',workerEpoch:hello.workerEpoch,operationId:`node-${sequence}`,baseVersion:hello.baseVersion,body};const json=Buffer.from(JSON.stringify(request));const prefix=Buffer.alloc(8);prefix.writeUInt32LE(json.length);fs.writeSync(1,Buffer.concat([prefix,json]));return read().body;}
const summary=()=>{const r=call({kind:'summary',maxBytes:49152});assert.equal(r.kind,'contextSummary');return r;};
const a='9007199254740995',b='9007199254740996';assert.equal(Number(a),Number(b),'fixture must expose real JS precision collision');
let s=summary();assert.deepEqual(s.layers.map(l=>l.layerId),[b,a]);assert.equal(s.activeLayerId,b);assert.deepEqual(s.selectedLayerIds,[b]);
const choose=id=>call({kind:'selectLayerContext',layerId:id,expectedContextGeneration:s.contextGeneration});
let result=choose(a);assert.equal(result.kind,'contextUpdated');assert.equal(result.activeLayerId,a);assert.deepEqual(result.selectedLayerIds,[a]);assert.equal(result.imageVersionRef,hello.baseVersion);s=summary();assert.equal(s.activeLayerId,a);
const bad=[Number(a),Number(b),0,-1,null,true,'09007199254740995','+9007199254740995','-1','1e3','18446744073709551616','',[],{}];
for(const id of bad){result=choose(id);assert.equal(result.kind,'failure',JSON.stringify(id));assert.equal(result.error.code,'invalid-input');const after=summary();assert.equal(after.activeLayerId,a,'rounded number must never select neighbouring layer');assert.equal(after.contextGeneration,s.contextGeneration);}
result=choose(b);assert.equal(result.kind,'contextUpdated');assert.equal(result.activeLayerId,b);s=summary();assert.equal(s.activeLayerId,b);
result=choose(a);assert.equal(result.activeLayerId,a);s=summary();
result=call({kind:'floating',previewId:'nodeFloat',expectedContextGeneration:s.contextGeneration,action:{kind:'begin',dx:0,dy:0}});assert.equal(result.kind,'floatingPreview');s=summary();assert.equal(s.floating.sourceLayerId,a);assert.equal(s.activeLayerId,a);assert.deepEqual(s.selectedLayerIds,[a]);
result=call({kind:'floating',previewId:'nodeFloat',expectedContextGeneration:s.contextGeneration,action:{kind:'cancel',throughSeq:1}});assert.equal(result.kind,'floatingCancelled');s=summary();assert.equal(s.activeLayerId,a);assert.equal(s.floating,null);
assert.equal(call({kind:'freeze'}).kind,'frozen');assert.equal(call({kind:'close'}).kind,'closed');
console.error(JSON.stringify({passed:true,node:process.version,requests:sequence,exactLayerIds:[a,b],numericCollision:Number(a),invalidCases:bad.length,sourceLayerId:a}));
