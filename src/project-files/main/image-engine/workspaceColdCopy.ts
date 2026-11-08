import fs from 'node:fs/promises';import path from 'node:path';
import{readBoundFile}from'../persistence/fileOps.js';import{sha256Hex}from'../persistence/canonicalJson.js';
import{readImageWorkspaceProject}from'./workspaceProbe.js';import{inspectWorkspaceOutputColdCopy}from'./workspaceOutput.js';
import{validWorkspaceColdCopyAuthorization,type WorkspaceColdCopyAuthorization}from'./workspaceColdCopyContract.js';
const identity=(s:{dev:bigint;ino:bigint})=>({dev:String(s.dev),ino:String(s.ino)});
const same=(a:{dev:string;ino:string},b:{dev:string;ino:string})=>a.dev===b.dev&&a.ino===b.ino;
const refused=(message:string)=>Object.assign(Error(message),{code:'cold-copy-refused',effect:'retained' as const});
/** Pure read-only preflight. No lease, writes, cleanup, migration or alternate
 * project authority. The guard repeats these physical bindings under its lock. */
export async function prepareWorkspaceColdCopy(root:string):Promise<WorkspaceColdCopyAuthorization|null>{
 if(!path.isAbsolute(root)||path.normalize(root)!==root||root===path.parse(root).root||root.includes('\0'))throw refused('Canonical copied workspace root required');
 const st=await fs.lstat(root,{bigint:true});if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(root)!==root)throw refused('Copied workspace root is aliased');
 const namespace=path.join(root,'.storyboard-flow/image-project-v2'),ownerPath=path.join(namespace,'owner.json'),bytes=await readBoundFile(ownerPath,16384);if(!bytes)return null;
 const parsed=JSON.parse(bytes.toString());if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||Object.keys(parsed).some(k=>!['schema','state','platform','host','mainPid','nonce','directories','lock','copyReceipt'].includes(k)))throw refused('Copied owner marker schema is unknown');const marker=parsed as {schema:number;state:string;platform:string;host:string;mainPid:number;nonce:string;directories:{dev:number;ino:number}[];lock:{dev:number;ino:number}};
 if(marker.schema!==1||!['macos','linux'].includes(marker.platform)||typeof marker.host!=='string'||!marker.host||marker.host.length>256||!['released','held'].includes(marker.state)||!Number.isSafeInteger(marker.mainPid)||marker.mainPid<=1||typeof marker.nonce!=='string'||!/^[A-Za-z0-9-]{1,128}$/.test(marker.nonce)||!Array.isArray(marker.directories)||marker.directories.length<4||marker.directories.some(s=>!s||!Number.isSafeInteger(s.dev)||!Number.isSafeInteger(s.ino)||s.dev<0||s.ino<0)||!marker.lock||!Number.isSafeInteger(marker.lock.dev)||!Number.isSafeInteger(marker.lock.ino))throw refused('Copied owner marker is unknown');
 const currentDirectories:{dev:string;ino:string}[]=[];let at=path.parse(root).root;
 for(const file of[at,...root.slice(at.length).split(path.sep).filter(Boolean),'.storyboard-flow','image-project-v2']){if(file!==path.parse(root).root)at=path.join(at,file);const s=await fs.lstat(at,{bigint:true});if(!s.isDirectory()||s.isSymbolicLink()||await fs.realpath(at)!==at)throw refused('Copied workspace directory alias');currentDirectories.push(identity(s));}
 const lockPath=path.join(namespace,'writer.lock'),lock=await fs.lstat(lockPath,{bigint:true});if(!lock.isFile()||lock.isSymbolicLink()||lock.nlink!==1n||(await fs.lstat(ownerPath,{bigint:true})).nlink!==1n)throw refused('Copied lease marker or lock is aliased');
 const currentLock=identity(lock),previousRoot=marker.directories[marker.directories.length-3];
 if(currentDirectories.length===marker.directories.length&&currentDirectories.every((s,i)=>same(s,{dev:String(marker.directories[i].dev),ino:String(marker.directories[i].ino)}))&&same(currentLock,{dev:String(marker.lock.dev),ino:String(marker.lock.ino)}))return null;
 if(marker.state!=='released')throw refused('Held or unknown copied owner marker cannot be admitted');
 const head=await readImageWorkspaceProject(root);if(!('coldCopySafe'in head)||head.coldCopySafe!==true)throw refused('Main journal has unresolved or unverified cold-copy obligations');
 const previous={dev:String(previousRoot.dev),ino:String(previousRoot.ino)},output=await inspectWorkspaceOutputColdCopy(root,head.plan.identity.id,previous);
 const authorization:WorkspaceColdCopyAuthorization={schema:'flow.workspace-cold-copy',version:1,projectId:head.plan.identity.id,genesisCommitHash:head.genesisCommitHash,commitHash:head.commitHash,currentRoot:{path:root,...identity(st)},currentLock,currentDirectories,previousRoot:previous,previousOwnerSha256:sha256Hex(bytes),...output};
 // One final pass catches changes during the journal and managed-file reads.
 for(let i=0,at=path.parse(root).root;i<currentDirectories.length;i++){if(i){const components=[...root.slice(path.parse(root).root.length).split(path.sep).filter(Boolean),'.storyboard-flow','image-project-v2'];at=path.join(at,components[i-1]);}const now=await fs.lstat(at,{bigint:true});if(!now.isDirectory()||now.isSymbolicLink()||!same(identity(now),currentDirectories[i]))throw refused('Copied workspace namespace changed during preflight');}
 const finalOwner=await readBoundFile(ownerPath,16384),finalLock=await fs.lstat(lockPath,{bigint:true});if(!finalOwner||sha256Hex(finalOwner)!==authorization.previousOwnerSha256||!same(identity(finalLock),currentLock)||!finalLock.isFile()||finalLock.isSymbolicLink()||finalLock.nlink!==1n||!validWorkspaceColdCopyAuthorization(authorization))throw refused('Copied ownership evidence changed during preflight');return authorization;
}
