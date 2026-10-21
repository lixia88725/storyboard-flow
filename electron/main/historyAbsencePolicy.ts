import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import fs from 'node:fs/promises';import path from 'node:path';
/** Readonly native absence inventory. The regular-file memory policy deliberately
 * rejects directories; never relax it to certify a missing History PNG. */
export const inspectHistoryAbsenceParents=async(python:string,root:string,file:string,maxDepth:number)=>{
 const relative=path.relative(root,path.dirname(file));
 if(relative.startsWith('..')||path.isAbsolute(relative)||!relative.startsWith('.storyboard-workbench/layers/'))throw new Error('History absence parent outside layer inventory');
 const segments=relative.split(path.sep);if(segments.length>maxDepth)throw new Error('History absence parent depth budget');
 const observed:any[]=[];let cursor=root;
 const script=fileURLToPath(new URL('../../scripts/layer-file-permissions.py',import.meta.url));
 for(const segment of ['',...segments]){
  if(segment)cursor=path.join(cursor,segment);
  const before=await fs.lstat(cursor);if(!before.isDirectory()||before.isSymbolicLink()||await fs.realpath(cursor)!==cursor)throw new Error('History absence directory identity');
  const raw=await new Promise<string>((resolve,reject)=>execFile(python,['-I','-B',script,cursor],{timeout:30000,maxBuffer:16*1024*1024,env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}},(error,stdout)=>error?reject(error):resolve(stdout)));
  const info=JSON.parse(raw),after=await fs.lstat(cursor);
  if(info.kind!=='ordinary'||info.reason!==null||info.flags!==0||info.uid!==process.getuid?.()||info.dev!==before.dev||info.ino!==before.ino||after.dev!==before.dev||after.ino!==before.ino)throw new Error('History absence native parent policy');
  observed.push([cursor,info]);
 }
 try{await fs.lstat(file);throw new Error('History absence is not ENOENT');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
 return {schema:'swb.history-absence-native.v1',observed};
};
