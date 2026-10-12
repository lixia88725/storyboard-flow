import { test, expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import sharp from 'sharp';
import { createNativeAuthorizationSession } from './nativeAuthorizationSession';

test('one fixed native session executes every real metadata inspection, never reuses changed source authority, and drains its interpreter', async () => {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'native-session-proof-')),source=path.join(root,'source.png'),script=path.join(root,'profile.py'),receipt=path.join(root,'calls.jsonl');
 await fs.writeFile(source,await sharp({create:{width:2,height:2,channels:4,background:'red'}}).png().toBuffer(),{mode:0o600});
 const adapter=path.resolve('scripts/recovery-content-permissions.py');
 // This wrapper profiles the actual immutable adapter, not a fake permission result.
 await fs.writeFile(script,`import importlib.util,json,os\ns=importlib.util.spec_from_file_location('original',${JSON.stringify(adapter)});m=importlib.util.module_from_spec(s);s.loader.exec_module(m)\ndef authorize(request):\n counts={}\n original=m.helper.inspect_mac\n def inspect(p):\n  counts['inspect_mac']=counts.get('inspect_mac',0)+1\n  return original(p)\n m.helper.inspect_mac=inspect\n try: return m.authorize(request)\n finally:\n  m.helper.inspect_mac=original\n  with open(${JSON.stringify(receipt)},'a') as f: f.write(json.dumps({'pid':os.getpid(),'phase':request['phase'],'sources':request['sources'],'counts':counts})+'\\n')\n`);
 const session=createNativeAuthorizationSession('/opt/homebrew/opt/python@3.12/libexec/bin/python3',script,()=>1048576);
 const request={phase:'capturePolicy',sources:[source],sourceByteLimit:1048576};
 await session.run(async()=>{
  expect((await session.request(request)).sourcePolicy.expected.mode).toBe(0o600);
  await fs.chmod(source,0o400);
  expect((await session.request(request)).sourcePolicy.expected.mode).toBe(0o400);
  await fs.chmod(source,0o600);
  expect((await session.request(request)).sourcePolicy.expected.mode).toBe(0o600);
 });
 const records=(await fs.readFile(receipt,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 expect(records).toHaveLength(3);expect(new Set(records.map(r=>r.pid)).size).toBe(1);
 expect(records.map(r=>r.counts.inspect_mac)).toEqual([2,2,2]);
 expect(records.every(r=>r.sources.length===1&&r.sources[0]===source)).toBe(true);
 expect(()=>process.kill(records[0].pid,0)).toThrow();
 await session.run(()=>session.request(request));
 const final=(await fs.readFile(receipt,'utf8')).trim().split('\n').map(line=>JSON.parse(line));
 expect(final).toHaveLength(4);expect(final[3].pid).not.toBe(records[0].pid);expect(()=>process.kill(final[3].pid,0)).toThrow();
},120000);
