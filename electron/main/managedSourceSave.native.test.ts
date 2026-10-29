import { test, expect, onTestFinished } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createHash } from 'node:crypto';
import sharp from 'sharp';
import { copyFolderImagesForImport } from './folderImageBrowserService';
import { prepareManagedSourceSave, writeManagedSourceFile } from './managedSourceSave';

const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
async function fixture() {
 const root = await fs.mkdtemp(path.join(os.tmpdir(), 'source-save-'));
 onTestFinished(() => fs.rm(root, {recursive:true, force:true}));
 const original = await sharp({create:{width:8,height:8,channels:4,background:'red'}}).png().toBuffer();
 const blue = await sharp({create:{width:8,height:8,channels:4,background:'blue'}}).tiff({compression:'deflate'}).toBuffer();
 await fs.writeFile(path.join(root,'one.png'),original,{mode:0o600});
 const {folderPath} = await copyFolderImagesForImport(root,async()=>{});
 const shot = { id:'stable', sourceFileName:'renamed.tiff', flow:{sourcePath:path.join(folderPath,'0001-one.png')}, fileName:'renamed.tiff', imagePath:path.join(folderPath,'renamed.tiff') };
 await fs.writeFile(shot.imagePath,blue,{mode:0o600});
 return {root,folderPath,shot,original,blue,target:path.join(root,'one.png'),backup:path.join(folderPath,'.original-images/one.png')};
}
test('explicit Save updates original encoding and keeps first backup across repeated saves and shot renames', async()=>{
 const f=await fixture();
 const save=await prepareManagedSourceSave(f.folderPath,[f.shot]);
 expect(await fs.readFile(f.target)).toEqual(f.original); // prepare is read-only
 await save!([f.shot]);
 expect((await sharp(f.target).metadata()).format).toBe('png');
 expect(await sharp(f.target).raw().toBuffer()).toEqual(await sharp(f.blue).raw().toBuffer());
 expect(await fs.readFile(f.backup)).toEqual(f.original);
 const renamed={...f.shot,fileName:'again.tiff',imagePath:path.join(f.folderPath,'again.tiff')};
 await fs.rename(f.shot.imagePath,renamed.imagePath);
 await fs.writeFile(renamed.imagePath,await sharp(f.original).tiff({compression:'deflate'}).toBuffer());
 await (await prepareManagedSourceSave(f.folderPath,[renamed]))!([renamed]);
 expect(await fs.readFile(f.backup)).toEqual(f.original);
 expect(await sharp(f.target).raw().toBuffer()).toEqual(await sharp(f.original).raw().toBuffer());
},120000);
test('external edits, aliases, corrupt ledgers and native readonly targets refuse without overwriting',async()=>{
 const f=await fixture();const prepared=await prepareManagedSourceSave(f.folderPath,[f.shot]);
 await fs.writeFile(f.target,'external');await expect(prepared!([f.shot])).rejects.toThrow('更改');expect(await fs.readFile(f.target,'utf8')).toBe('external');
 await fs.writeFile(f.target,f.original);await fs.chmod(f.target,0o400);
 await expect((await prepareManagedSourceSave(f.folderPath,[f.shot]))!([f.shot])).rejects.toThrow('未完成');
 expect(await fs.readFile(f.target)).toEqual(f.original);expect(await fs.readFile(f.backup)).toEqual(f.original);expect((await fs.stat(f.backup)).mode&0o777).toBe(0o400);
 await fs.chmod(f.target,0o600);
 await fs.writeFile(path.join(f.folderPath,'.source-images.json'),'{}');await expect(prepareManagedSourceSave(f.folderPath,[f.shot])).rejects.toThrow('损坏');
 const alias=path.join(f.root,'alias.png');await fs.symlink(f.target,alias);
 await expect(writeManagedSourceFile(f.root,alias,f.blue,{expectedDigest:hash(f.original)})).rejects.toThrow('未完成');expect(await fs.readFile(f.target)).toEqual(f.original);
},120000);
test('count-only older projects bind by archived pixels, and pending replacement receipt permits exact retry',async()=>{
 const f=await fixture();
 const archived=path.join(f.folderPath,'Archive','input.png');await fs.mkdir(path.dirname(archived));await fs.copyFile(path.join(f.folderPath,'0001-one.png'),archived);
 const markerPath=path.join(f.folderPath,'.source-folder.json'),marker=JSON.parse(await fs.readFile(markerPath,'utf8'));delete marker.images;await fs.writeFile(markerPath,JSON.stringify(marker));
 const shot={...f.shot,flow:{...f.shot.flow,archivePath:archived}};
 await (await prepareManagedSourceSave(f.folderPath,[shot]))!([shot]);
 const ledgerPath=path.join(f.folderPath,'.source-images.json'),ledger=JSON.parse(await fs.readFile(ledgerPath,'utf8'));
 ledger.entries[0].pendingHash=ledger.entries[0].currentHash;ledger.entries[0].currentHash=hash(f.original);await fs.writeFile(ledgerPath,JSON.stringify(ledger));
 await (await prepareManagedSourceSave(f.folderPath,[shot]))!([shot]);
 expect(await fs.readFile(f.backup)).toEqual(f.original);
},120000);
