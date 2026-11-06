import fs from 'node:fs/promises';
import path from 'node:path';
import {syncDirectory} from '../../platform/main/platform/index.js';
import {randomUUID} from 'node:crypto';
import {assertPhysicalWorkspaceWriterTargets} from './workspacePhysicalWriterGate.js';
/** Exclusive publication only. Existing files, directories and aliases are never
 * replaced, even if the OS save dialog offered its own overwrite confirmation. */
export async function publishPsdExclusive(target:string,bytes:Uint8Array):Promise<void>{
 if(!(bytes instanceof Uint8Array)||bytes.length<1||bytes.length>128*1024*1024)throw Error('PSD导出字节超出限制');
 const capturedBytes=Buffer.from(bytes);
 if(!path.isAbsolute(target)||path.resolve(target)!==target||!target.toLowerCase().endsWith('.psd')||target.includes('\0'))throw Error('PSD导出目标必须是新的绝对PSD路径');
 const parent=path.dirname(target);
 if(target.split(path.sep).some(p=>p==='.storyboard-flow'||p==='.storyboard-workbench'))throw Error('不能导出到项目的内部保管目录');
 const identity=await fs.lstat(parent,{bigint:true});
 if(!identity.isDirectory()||identity.isSymbolicLink()||await fs.realpath(parent)!==parent)throw Error('PSD导出目录不能是路径别名');
 await assertPhysicalWorkspaceWriterTargets([target]);
 if((await fs.readdir(parent)).some(n=>n.toLowerCase()===path.basename(target).toLowerCase()))throw Error('PSD目标已存在；请选择新文件名，现有文件未改动');
 const stage=path.join(parent,`.flow-psd-${randomUUID()}.tmp`),handle=await fs.open(stage,'wx',0o600);
 let linked=false,linkAttempted=false;
 try{
  await handle.writeFile(capturedBytes);await handle.sync();
  const sourceIdentity=await handle.stat({bigint:true}),stageIdentity=await fs.lstat(stage,{bigint:true}),now=await fs.lstat(parent,{bigint:true});
  if(sourceIdentity.ino!==stageIdentity.ino||sourceIdentity.dev!==stageIdentity.dev||now.ino!==identity.ino||now.dev!==identity.dev||await fs.realpath(parent)!==parent)throw Error('PSD导出目录或临时文件身份改变');
  await assertPhysicalWorkspaceWriterTargets([target]);
  // Same-directory hard link publishes fully synced bytes without replacement.
  linkAttempted=true;await fs.link(stage,target);linked=true;
  const published=await fs.lstat(target,{bigint:true});
  if(published.ino!==sourceIdentity.ino||published.dev!==sourceIdentity.dev)throw Error('PSD导出目标身份改变');
  // Windows skips directory fsync by the shared platform contract. File bytes
  // were synced before publication; no directory-entry crash durability claim.
  await syncDirectory(parent);
  const currentStage=await fs.lstat(stage,{bigint:true});
  if(currentStage.ino!==sourceIdentity.ino||currentStage.dev!==sourceIdentity.dev)throw Error('PSD临时文件身份改变');
  await fs.unlink(stage);
 }catch(error){const unknown=linked||linkAttempted&&(error as NodeJS.ErrnoException)?.code!=='EEXIST';throw Object.assign(Error(`${error instanceof Error?error.message:String(error)}; ${unknown?'PSD输出结果未知，请核对 '+target:'未覆盖目标'}；保留现场 ${stage}`),{effect:unknown?'unknown':'none'});}
 finally{await handle.close();}
}
