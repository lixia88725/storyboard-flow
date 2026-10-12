import { spawn } from 'node:child_process';
import type { RecoveryAuthorization } from './workspaceRecoveryStore.js';
export const createMacRecoveryContentAuthorization = (options: { python: string; script: string; sourceByteLimit: number }): RecoveryAuthorization => async request => {
  if (!Number.isSafeInteger(options.sourceByteLimit) || options.sourceByteLimit <= 0) throw new Error('Explicit finite source byte limit required');
  if(process.platform !== 'darwin') throw new Error('Windows recovery content permissions unfinished');
  await new Promise<void>((resolve,reject)=>{
    const child=spawn(options.python,[options.script],{stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}});
    let output='';let error='';
    child.stdout.on('data',data=>{output+=data; if(output.length>65536)child.kill();});
    child.stderr.on('data',data=>{error+=data; if(error.length>65536)child.kill();});
    child.on('error',reject);child.on('close',code=>{
      try{const result=JSON.parse(output);if(code!==0||result.authorized!==true)throw new Error(result.reason||error||'Native content policy refused');resolve();}catch(cause){reject(cause);}
    });
    child.stdin.end(JSON.stringify({ ...request, sourceByteLimit: options.sourceByteLimit }));
  });
};
