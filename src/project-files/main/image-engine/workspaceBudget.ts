import fs from 'node:fs/promises';
import path from 'node:path';
import type {WorkspaceOutputBudget} from './workspaceOutputContract.js';
const MAX=8*1024**3;
const failure=(message:string,code='resource-limit')=>Object.assign(Error(message),{code,effect:'retained' as const});
/** Shared actual+reserved ledger. The caller holds project/stage writer authority.
 * All writers must reserve before effects; native fixed quotas can be held as
 * lifetime grants. This module does not make unreported external IO disappear.
 * measureActual/audit require stopped admission and fully drained IO. */
export async function createWorkspaceRecoveryBudget(options:{root:string;maxRecoveryBytes?:number}){
 const {root}=options,max=options.maxRecoveryBytes??MAX;if(!path.isAbsolute(root)||path.normalize(root)!==root||!Number.isSafeInteger(max)||max<1||max>MAX)throw failure('Invalid recovery budget','invalid-input');
 const identity=await fs.lstat(root,{bigint:true});if(!identity.isDirectory()||identity.isSymbolicLink()||await fs.realpath(root)!==root)throw failure('Unsafe recovery budget root','conflict');
 const measure=async()=>{
  const current=await fs.lstat(root,{bigint:true});if(current.dev!==identity.dev||current.ino!==identity.ino||!current.isDirectory()||current.isSymbolicLink())throw failure('Recovery budget root changed','conflict');let bytes=0,count=0;
  const walk=async(dir:string,depth:number):Promise<void>=>{if(depth>32)throw failure('Recovery inventory depth exceeded');let names:string[];try{names=await fs.readdir(dir);}catch(e){if(depth===0&&(e as NodeJS.ErrnoException).code==='ENOENT')return;throw e;}for(const name of names){if(++count>1_000_000)throw failure('Recovery inventory item budget exceeded');const at=path.join(dir,name),st=await fs.lstat(at,{bigint:true});if(st.isSymbolicLink())throw failure('Recovery symlink retained; accounting refused','conflict');if(st.isDirectory())await walk(at,depth+1);else if(st.isFile()){bytes+=Number(st.size);if(!Number.isSafeInteger(bytes))throw failure('Recovery inventory overflow');}else throw failure('Unknown recovery entry retained','conflict');}};
  await walk(path.join(root,'.storyboard-flow'),0);return bytes;
 };
 let actual=await measure(),reserved=0,blocked=false,auditing=false,tail=Promise.resolve();
 type Entry={bytes:number;purpose:string;state:'reserved'|'unknown'|'settled';delta?:number;grant:{settleActual(n:number):Promise<void>;retainUnknown():Promise<void>}};
 const entries=new Map<string,Entry>();
 const serialize=<T>(f:()=>T|Promise<T>):Promise<T>=>{const next=tail.then(f);tail=next.then(()=>undefined,()=>undefined);return next;};
 const budget:WorkspaceOutputBudget={reserve:input=>serialize(()=>{
  if(auditing||blocked)throw failure('Recovery budget requires a drained audit','busy');if(!input||typeof input.operationId!=='string'||!input.operationId||input.operationId.length>256||typeof input.purpose!=='string'||input.purpose.length>256||!Number.isSafeInteger(input.bytes)||input.bytes<0)throw failure('Invalid recovery reservation','invalid-input');
  const old=entries.get(input.operationId);if(old){if(old.bytes!==input.bytes||old.purpose!==input.purpose)throw failure('Recovery reservation identity reused','conflict');return old.grant;}
  if(entries.size>=1_000_000||actual+reserved+input.bytes>max)throw failure('Recovery actual plus reserved quota exceeded');
  const entry:Entry={bytes:input.bytes,purpose:input.purpose,state:'reserved',grant:{
   settleActual:n=>serialize(()=>{if(entry.state==='settled'){if(entry.delta!==n)throw failure('Recovery settlement identity conflict','conflict');return;}if(!Number.isSafeInteger(n)||actual+n<0||n>entry.bytes){blocked=true;throw failure('Recovery expenditure exceeds its reserved proof','conflict');}actual+=n;reserved-=entry.bytes;entry.state='settled';entry.delta=n;}),
   retainUnknown:()=>serialize(()=>{if(entry.state!=='settled')entry.state='unknown';})
  }};reserved+=entry.bytes;entries.set(input.operationId,entry);return entry.grant;
 })};
 return{
  ...budget,
  get reservedBytes(){return reserved;},get actualBytes(){return actual;},get limitBytes(){return max;},
  /** Does not mutate the ledger. A sole stage writer can measure after its IO
   * drains, settle the held batch grant with the observed delta, then audit. */
  measureActual:()=>serialize(measure),
  async audit(){if(auditing)throw failure('Recovery audit already running','busy');auditing=true;try{await tail;if(reserved)throw failure('Settle drained grants before replacing actual inventory','busy');actual=await measure();blocked=false;}finally{auditing=false;}},
  snapshot:()=>({actual,reserved,max,blocked,unknown:[...entries].filter(([,e])=>e.state==='unknown').map(([id])=>id)})
 };
}
