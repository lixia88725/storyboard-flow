import fs from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { managedProjectDirectory, readManagedProject, type ManagedSourceImage } from './managedFolderProject.js';
import { assertPhysicalWorkspaceWriterTargets } from './workspacePhysicalWriterGate.js';
import { recordLayerFileCommit } from './layerFileOperationQueue.js';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const safeName = (v: unknown): v is string => typeof v === 'string' && !!v && v !== '.' && v !== '..' && path.basename(v) === v && !/[\\\0]/.test(v);
const hashString = (v: unknown): v is string => typeof v === 'string' && /^[a-f0-9]{64}$/.test(v);
const byteLimit = 512 * 1024 * 1024;
const read = async (file: string, limit = byteLimit) => {
  if (await fs.realpath(file) !== file) throw Error('原图路径包含别名，未覆盖。');
  const handle = await fs.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const st = await handle.stat();
    if (!st.isFile() || st.nlink !== 1 || st.size > limit) throw Error('文件不是受支持的普通文件或超过大小限制。');
    const data = await handle.readFile();
    if (data.length > limit) throw Error('文件超过大小限制。');
    return data;
  } finally { await handle.close(); }
};

/** Explicit Save only, inside Main's authenticated serialized Save callback.
 * This uses the native staged writer, with original-byte CAS and policy-preserving
 * backups. It is separate from the child PNG producer/custody protocol. */
export const writeManagedSourceFile = async (root: string, filePath: string, bytes: Buffer,
  options: { expectedDigest?: string; policySource?: string; createOnly?: boolean } = {}) => {
  if (bytes.length > byteLimit) throw Error('图片超过单次保存大小限制。');
  const script = fileURLToPath(new URL('../../scripts/layer-file-permissions.py', import.meta.url));
  const request = { root, filePath, bytes: bytes.toString('base64'), mode: options.createOnly ? 'create-only' : 'upsert', expectedDigest: options.expectedDigest, policySource: options.policySource };
  const result = await new Promise<any>((resolve, reject) => {
    // No timeout retry: the actual child must exit before effects can be settled.
    const child = execFile(process.env.SWB_PYTHON_PATH || 'python3', ['-I', '-B', script, '--write-stdin'],
      { maxBuffer: 65536 }, (error, stdout, stderr) => {
        if (error) return reject(Error(`原图写入结果未确认，保留现场：${error.message}; ${stderr}`));
        try { resolve(JSON.parse(stdout)); } catch { reject(Error('原图写入回执无效，保留现场。')); }
      });
    child.stdin?.on('error', () => undefined);
    child.stdin?.end(JSON.stringify(request));
  });
  if (result.effect === 'committed') recordLayerFileCommit();
  if (result.effect !== 'committed' || result.filePath !== filePath || !result.identity || result.retainedTemporary || result.warnings?.length)
    throw Error(`原图保存未完成，已保留备份及现场：${result.message || result.retainedTemporary || result.warnings || result.effect}`);
  if (!(await read(filePath)).equals(bytes)) throw Error('原图保存后校验不一致，未确认保存成功。');
};

type Shot = { id: string; sourceFileName?: string; fileName: string; imagePath: string; swb?: { archivePath?: string; sourcePath?: string } };
type Entry = { shotId: string; sourceName: string; originalHash: string | null; currentHash: string | null; pendingHash?: string };
type Ledger = { version: 1; entries: Entry[] };
const ledgerName = '.source-images.json';
const backupDirectory = '.original-images';

// Upgrade the earlier count-only marker using the immutable imported PNG,
// not current shot order or a guessed filename after Save has renamed it.
const legacyMapping = async (source: string, folder: string, shots: Shot[]): Promise<ManagedSourceImage[]> => {
  const names = (await fs.readdir(source, { withFileTypes: true })).filter(e => e.isFile() && /\.(png|jpe?g|tiff?|webp|gif|avif)$/i.test(e.name)).map(e => e.name);
  const result: ManagedSourceImage[] = [];
  for (const shot of shots) {
    const inputName = [shot.sourceFileName, shot.swb?.sourcePath && path.basename(shot.swb.sourcePath)].find(name => name && /^\d{4,}-.*\.png$/i.test(name));
    if (!inputName) continue;
    const stem = path.parse(inputName.replace(/^\d+-/, '')).name;
    const candidates = names.filter(name => path.parse(name).name === stem);
    const archived = shot.swb?.archivePath;
    if (candidates.length !== 1 || !archived || !archived.startsWith(folder + path.sep)) throw Error('旧导入记录无法唯一对应原图，未覆盖任何原图。');
    const bytes = await read(path.join(source, candidates[0]));
    if (!(await sharp(bytes).rotate().png().toBuffer()).equals(await read(archived))) throw Error('原图在导入后已改变，未覆盖。');
    result.push({ inputName, sourceName: candidates[0], sourceHash: digest(bytes) });
  }
  return result;
};

export const prepareManagedSourceSave = async (folder: string, shots: Shot[]) => {
  if (path.basename(folder) !== managedProjectDirectory) return undefined;
  const source = path.dirname(folder), managed = await readManagedProject(source);
  if (!managed || managed.folderPath !== folder) throw Error('原图与可编辑项目关联无效。');
  const ledgerPath = path.join(folder, ledgerName);
  let ledger: Ledger = { version: 1, entries: [] }, previous: Buffer | undefined;
  try { previous = await read(ledgerPath, 1024 * 1024); ledger = JSON.parse(previous.toString()); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  if (ledger.version !== 1 || !Array.isArray(ledger.entries) || ledger.entries.length > 10000 || ledger.entries.some(e => !e || typeof e.shotId !== 'string' || !safeName(e.sourceName) || e.originalHash !== null && !hashString(e.originalHash) || e.currentHash !== null && !hashString(e.currentHash) || e.pendingHash !== undefined && !hashString(e.pendingHash)) || new Set(ledger.entries.map(e => e.shotId)).size !== ledger.entries.length || new Set(ledger.entries.map(e => e.sourceName)).size !== ledger.entries.length) throw Error('原图保存记录损坏，未覆盖。');
  const inputs = managed.images ?? await legacyMapping(source, folder, shots.filter(s => !ledger.entries.some(e => e.shotId === s.id)));
  for (const shot of shots) {
    if (ledger.entries.some(e => e.shotId === shot.id)) continue;
    const sourceNames = [shot.sourceFileName, shot.swb?.sourcePath && path.basename(shot.swb.sourcePath)];
    const matches = inputs.filter(i => sourceNames.includes(i.inputName));
    if (matches.length > 1) throw Error('导入来源记录不一致，未覆盖。');
    const input = matches[0];
    if (!input && sourceNames.some(name => name && /^\d{4,}-/.test(name))) throw Error('找不到这张图的原图记录，未覆盖。');
    const name = input?.sourceName ?? shot.fileName;
    if (!safeName(name) || ledger.entries.some(e => e.sourceName === name)) throw Error('原图文件名冲突，未覆盖。');
    ledger.entries.push({ shotId: shot.id, sourceName: name, originalHash: input?.sourceHash ?? null, currentHash: input?.sourceHash ?? null });
  }
  const targets = shots.map(s => path.join(source, ledger.entries.find(e => e.shotId === s.id)!.sourceName));
  await assertPhysicalWorkspaceWriterTargets(targets.length ? targets : [source]);
  // Check ALL mappings before the first original changes.
  const preflight = async () => {
    for (const shot of shots) {
      const e = ledger.entries.find(e => e.shotId === shot.id)!;
      let current: string | null = null;
      try { current = digest(await read(path.join(source, e.sourceName))); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (current !== e.currentHash && current !== e.pendingHash) throw Error(`原图已被其他操作更改：${e.sourceName}。未覆盖。`);
    }
  };
  await preflight();
  const persist = async () => {
    const bytes = Buffer.from(JSON.stringify(ledger, null, 2) + '\n');
    await writeManagedSourceFile(source, ledgerPath, bytes, previous ? { expectedDigest: digest(previous) } : { createOnly: true });
    previous = bytes;
  };
  return async (savedShots: Shot[]) => {
    await assertPhysicalWorkspaceWriterTargets(targets.length ? targets : [source]);
    await preflight();
    await persist(); // Stable shot identities survive all internal renames.
    for (const shot of savedShots) {
      const e = ledger.entries.find(e => e.shotId === shot.id);
      if (!e || !shots.some(s => s.id === shot.id)) throw Error('保存时原图清单改变，保留现场。');
      const target = path.join(source, e.sourceName);
      if (e.originalHash) {
        const backup = path.join(folder, backupDirectory, e.sourceName);
        try { if (digest(await read(backup)) !== e.originalHash) throw Error('原图备份不一致，未覆盖。'); }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
          const original = await read(target);
          if (digest(original) !== e.originalHash) throw Error('缺少原始备份，未覆盖。');
          await writeManagedSourceFile(source, backup, original, { createOnly: true, policySource: target });
        }
      }
      if (path.dirname(shot.imagePath) !== folder) throw Error('工作图片不在当前项目。');
      const working = await read(shot.imagePath), ext = path.extname(e.sourceName).slice(1).toLowerCase();
      const format = ext === 'jpg' ? 'jpeg' : ext === 'tif' ? 'tiff' : ext;
      if (!['png', 'jpeg', 'tiff', 'webp', 'gif', 'avif'].includes(format)) throw Error('不支持原图的文件格式。');
      const output = format === 'tiff' ? working : await sharp(working).toFormat(format as keyof sharp.FormatEnum).toBuffer();
      const outputHash = digest(output);
      let actual: string | null = null;
      try { actual = digest(await read(target)); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      if (actual !== e.currentHash && actual !== e.pendingHash) throw Error('原图在保存过程中改变，保留现场。');
      // The pending receipt makes a crash after replacement distinguishable from
      // an external edit. It never claims that the whole Save succeeded.
      e.pendingHash = outputHash; await persist();
      if (actual !== outputHash) await writeManagedSourceFile(source, target, output, actual === null ? { createOnly: true } : { expectedDigest: actual });
      e.currentHash = outputHash; delete e.pendingHash; await persist();
    }
  };
};
