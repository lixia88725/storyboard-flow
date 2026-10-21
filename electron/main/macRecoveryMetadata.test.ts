import { test,expect } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { createMacRecoveryContentAuthorization } from './macRecoveryContentAuthorization';
const python='python3';
const run=(file:string,args:string[])=>new Promise<string>((resolve,reject)=>execFile(file,args,{env:{...process.env,PYTHONDONTWRITEBYTECODE:'1'}},(error,out)=>error?reject(error):resolve(out)));
const inspect=async(file:string)=>JSON.parse(await run(python,[path.resolve('scripts/layer-file-permissions.py'),file]));
const native=createMacRecoveryContentAuthorization({sourceByteLimit:100000,python,script:path.resolve('scripts/recovery-content-permissions.py')});
test('every opaque source attribute is copied exactly and the source remains unchanged',async()=>{
 const root=await fs.mkdtemp(path.resolve('metadata-'));const dir=path.join(root,'.storyboard-workbench/workspace-recovery-v1');await fs.mkdir(dir,{recursive:true,mode:0o700});
 const source=path.join(root,'source.json');await fs.writeFile(source,'{}',{mode:0o600});
 await run('/usr/bin/xattr',['-w','org.storyboard.synthetic-opaque','must-copy-not-ignore',source]);
 await fs.chmod(source,0o400);
 const before=await inspect(source);const target=path.join(dir,'derived.json.staging-test');await fs.writeFile(target,'',{mode:0o600,flag:'wx'});
 await native({path:target,root,phase:'beforeBytes',sources:[source]});const copied=await inspect(target);
 for(const key of ['uid','gid','mode','flags','xattrs'])expect(copied[key],key).toEqual(before[key]);
 expect(await inspect(source)).toEqual(before);expect(await fs.readFile(source,'utf8')).toBe('{}');
});
test('multi-source incompatible opaque attributes are refused instead of selecting one metadata template',async()=>{
 const root=await fs.mkdtemp(path.resolve('metadata-conflict-'));const dir=path.join(root,'.storyboard-workbench/workspace-recovery-v1');await fs.mkdir(dir,{recursive:true,mode:0o700});
 const a=path.join(root,'a.json'),b=path.join(root,'b.json');await fs.writeFile(a,'{}',{mode:0o600});await fs.writeFile(b,'{}',{mode:0o400});await run('/usr/bin/xattr',['-w','org.storyboard.synthetic-opaque','a-only',a]);
 const beforeA=await inspect(a),beforeB=await inspect(b);const target=path.join(dir,'derived.json.staging-test');await fs.writeFile(target,'',{mode:0o400,flag:'wx'});
 await expect(native({path:target,root,phase:'beforeBytes',sources:[a,b]})).rejects.toThrow('intersection');
 expect((await fs.stat(target)).size).toBe(0);expect(await inspect(a)).toEqual(beforeA);expect(await inspect(b)).toEqual(beforeB);
});
test('executable/link/unknown sources cannot authorize retained content bytes',async()=>{
 const root=await fs.mkdtemp(path.resolve('metadata-refused-'));const dir=path.join(root,'.storyboard-workbench/workspace-recovery-v1');await fs.mkdir(dir,{recursive:true,mode:0o700});
 const executable=path.join(root,'run.json'),unknown=path.join(root,'unknown.bin'),link=path.join(root,'alias.json');await fs.writeFile(executable,'{}',{mode:0o700});await fs.writeFile(unknown,'{}',{mode:0o600});await fs.symlink(executable,link);
 const target=path.join(dir,'derived.json.staging-test');await fs.writeFile(target,'',{mode:0o600,flag:'wx'});
 for(const source of [executable,unknown,link])await expect(native({path:target,root,phase:'beforeBytes',sources:[source]})).rejects.toThrow();
 expect((await fs.stat(target)).size).toBe(0);
});
