import { lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const output = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist-electron');
try {
  const info = await lstat(output);
  if (!info.isDirectory() || info.isSymbolicLink()) throw Error('Refusing non-directory or symlink build output');
  await rm(output, { recursive: true });
} catch (error) { if (error.code !== 'ENOENT') throw error; }
