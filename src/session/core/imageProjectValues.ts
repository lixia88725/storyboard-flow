import type { ResultV1 } from '../../platform/contracts/refactorV1.js';
export const record=(v:unknown):v is Record<string,unknown>=>v!==null&&typeof v==='object'&&!Array.isArray(v);
export const shape=(v:unknown,keys:readonly string[],optional:readonly string[]=[]):v is Record<string,unknown>=>record(v)&&keys.every(k=>Object.hasOwn(v,k))&&Object.keys(v).every(k=>keys.includes(k)||optional.includes(k));
export const id=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_-]{1,80}$/.test(v);
export const revision=(v:unknown):v is number=>Number.isSafeInteger(v)&&Number(v)>=0;
export const text=(v:unknown):v is string=>typeof v==='string';
export const copy=<T>(v:T):T=>structuredClone(v);
export const fail=<T>(code:'invalid-input'|'conflict'|'not-found',message:string):ResultV1<T>=>({ok:false,error:{code,message}});
export const ok=<T>(value:T):ResultV1<T>=>({ok:true,value});
export function same(a:unknown,b:unknown):boolean{
  if(a===b)return true;
  if(Array.isArray(a)||Array.isArray(b))return Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&Array.from(a).every((v,i)=>same(v,b[i]));
  if(!record(a)||!record(b))return false;
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(k=>Object.hasOwn(b,k)&&same(a[k],b[k]));
}
