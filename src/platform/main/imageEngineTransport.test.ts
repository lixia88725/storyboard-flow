import { expect, it } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { temporaryWorkspace } from '../../../test/temporaryWorkspace';
import { startImageEngine } from './imageEngineConnection';

// Deliberately hostile transport peers, not evidence of native rendering correctness.
async function peer(program: string) {
  const root = await temporaryWorkspace('engine-transport-');
  const binary = path.join(root, 'peer.cjs');
  await fs.writeFile(binary, `#!${process.execPath}\n` + `
function send(h,p=Buffer.alloc(0)){const j=Buffer.from(JSON.stringify(h));const b=Buffer.alloc(8+j.length+p.length);b.writeUInt32LE(j.length);b.writeUInt32LE(p.length,4);j.copy(b,8);p.copy(b,8+j.length);process.stdout.write(b);}
function hello(){send({protocol:1,kind:'hello',workerEpoch:1});}
let input=Buffer.alloc(0);process.stdin.on('data',b=>{input=Buffer.concat([input,b]);if(input.length<8)return;const a=input.readUInt32LE(),n=input.readUInt32LE(4);if(input.length<8+a+n)return;const h=JSON.parse(input.subarray(8,8+a));const p=input.subarray(8+a,8+a+n);input=input.subarray(8+a+n);receive(h,p);});
` + program, { mode: 0o700 });
  return startImageEngine({ binary, store: path.join(root, 'store'), sessionId: 's', incarnation: 'i', budgetBytes: 1024 });
}
it('snapshots input before a delayed startup handshake', async () => {
  const client = await peer(`setTimeout(hello,80);function receive(h,p){send(h,p);}`);
  try {
    const body = { kind: 'capture', nested: { value: 3 } }, payload = new Uint8Array([1,2]);
    const result = client.request('op', body, null, payload);
    body.nested.value = 99; payload.fill(9);
    const reply = await result;
    expect(reply.header.body).toEqual({ kind: 'capture', nested: { value: 3 } });
    expect([...reply.payload]).toEqual([1,2]);
  } finally { client.terminateOwnedProcess(); await client.exited; }
});
it('rejects wrong-incarnation replies as unknown and never retries an operation', async () => {
  const client = await peer(`hello();function receive(h,p){send({...h,incarnation:'other'},p);}`);
  try {
    await expect(client.request('op', { kind: 'edit' })).rejects.toMatchObject({ effect: 'unknown' });
    await expect(client.request('next', { kind: 'capture' })).rejects.toMatchObject({ effect: 'unknown' });
  } finally { client.terminateOwnedProcess(); await client.exited; }
});
it('reports an interrupted frame as unknown instead of successful completion', async () => {
  const client = await peer(`hello();function receive(){process.stdout.write(Buffer.from([2,0,0]),()=>process.exit(0));}`);
  try {
    await expect(client.request('op', { kind: 'edit' })).rejects.toMatchObject({ effect: 'unknown' });
    expect((await client.exited).code).toBe(0);
  } finally { client.terminateOwnedProcess(); await client.exited; }
});
it('refuses concurrent writes rather than silently reordering them', async () => {
  const client = await peer(`hello();function receive(h,p){setTimeout(()=>send(h,p),80);}`);
  try {
    await client.ready;
    const first = client.request('first', { kind: 'edit' });
    await expect(client.request('second', { kind: 'edit' })).rejects.toMatchObject({ effect: 'none' });
    expect((await first).header.operationId).toBe('first');
  } finally { client.terminateOwnedProcess(); await client.exited; }
});

it('reserves its single request slot before startup and before reading another request body', async () => {
  const client = await peer(`setTimeout(hello,80);function receive(h,p){send(h,p);}`);
  try {
    const first = client.request('first', { kind: 'capture' });
    let touched = false;
    const body = Object.defineProperty({}, 'kind', { enumerable: true, get() { touched = true; return 'edit'; } });
    await expect(client.request('second', body)).rejects.toMatchObject({ effect: 'none' });
    expect(touched).toBe(false);
    expect((await first).header.operationId).toBe('first');
  } finally { client.terminateOwnedProcess(); await client.exited; }
});
