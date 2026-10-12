import {test,expect} from 'vitest';
import fs from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {createPreparedWorkspaceSave} from './preparedWorkspaceSave';
import {mkdirObserved} from './workspaceInitialization';
const fixture=async()=>{const root=await fs.mkdtemp(path.join(os.tmpdir(),'ordinary-observation-'));const frame={},sender={mainFrame:frame};const event={sender,senderFrame:frame} as any;const service=createPreparedWorkspaceSave({});return {root,event,service};};
test('fresh observation is pure; actual reader initialization binds parent and subsequent replacement is refused',async()=>{
 const {root,event,service}=await fixture();const observed=await service.observeWorkspace(event,root);
 expect(await fs.readdir(root)).toEqual([]);
 await service.ordinary(event,'workspace:openFolderByPath',root,[root],async()=>{await mkdirObserved(path.join(root,'.storyboard-workbench'));return {};});
 expect(await service.observeWorkspace(event,root)).toEqual(observed);
 await fs.rename(path.join(root,'.storyboard-workbench'),path.join(root,'old-parent'));await fs.mkdir(path.join(root,'.storyboard-workbench'));
 await expect(service.observeWorkspace(event,root)).rejects.toThrow('incarnation changed');
});
test('later parent existence without the actual creator receipt cannot finalize a fresh observation',async()=>{
 const {root,event,service}=await fixture();await service.observeWorkspace(event,root);
 await expect(service.ordinary(event,'workspace:openFolderByPath',root,[root],async()=>{await fs.mkdir(path.join(root,'.storyboard-workbench'));return {};})).rejects.toThrow('incarnation changed');
 await expect(service.observeWorkspace(event,root)).rejects.toThrow('incarnation changed');
});
test('unleased staged failure is Main inventory and cannot be omitted by either close capture',async()=>{
 const {root,event,service}=await fixture();await fs.mkdir(path.join(root,'.storyboard-workbench'));await service.observeWorkspace(event,root);
 await expect(service.ordinary(event,'workspace:openFolderByPath',root,[root],async()=>{await fs.writeFile(path.join(root,'stage-bytes'),'B');throw new Error('actual stage failed');})).rejects.toThrow('actual stage failed');
 for(let i=0;i<2;i++)await expect(service.certifyRetainedSet(event,{slots:[]})).rejects.toThrow();
 expect(await fs.readFile(path.join(root,'stage-bytes'),'utf8')).toBe('B');
});
