import path from 'node:path';
import { realpath, readdir } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const imports = "import sys; sys.path.insert(0,sys.argv[1]); import numpy,imagecodecs,tifffile,psdtags";
const cache = new Map<string, Promise<string>>();

/** Validate against the shipped native modules, not just the interpreter's version string.
 * Finder normally has system-only PATH. Only search absolute PATH entries and known Python installations. */
export function macTiffPython(deps: string, override?: string, envPath = process.env.PATH ?? ''): Promise<string> {
  const key = JSON.stringify([deps, override, envPath]);
  const saved = cache.get(key);
  if (saved) return saved;
  const result = discover(deps, override, envPath);
  cache.set(key, result);
  result.catch(() => cache.delete(key)); // A corrected environment/install can retry.
  return result;
}

async function discover(deps: string, override: string | undefined, envPath: string): Promise<string> {
  // NumPy is required by the worker. Its compiled extension declares CPython major/minor.
  const ext = (await readdir(path.join(deps, 'numpy', '_core')).catch(() => [] as string[]))
    .map(f => /^_multiarray_umath\.cpython-(3)(\d+)[a-z]*-darwin\.so$/.exec(f)).find(Boolean);
  const version = ext ? `${ext[1]}.${ext[2]}` : '';
  const names = version ? [`python${version}`, 'python3'] : ['python3'];
  const dirs = envPath.split(':').filter(dir => path.isAbsolute(dir));
  const candidates = override ? [override] : [...dirs, '/opt/homebrew/bin', '/usr/local/bin',
    ...(version ? [`/Library/Frameworks/Python.framework/Versions/${version}/bin`] : [])]
    .flatMap(dir => names.map(name => path.join(dir, name)));
  const seen = new Set<string>();
  for (const file of candidates) {
    const actual = path.isAbsolute(file) ? await realpath(file).catch(() => '') : file;
    if (!actual || seen.has(actual)) continue;
    seen.add(actual);
    try {
      await exec(actual, ['-I', '-B', '-S', '-c', imports, deps], { timeout: 5000, killSignal: 'SIGKILL', maxBuffer: 65536 });
      return actual;
    } catch { /* wrong ABI, architecture, missing package or non-executable */ }
  }
  throw Error(`无法载入随软件附带的 TIFF 组件，需要兼容的 Python${version ? ' '+version : ' 3'}。${override ? '请检查指定的解释器 '+override+'。' : '请确认已安装兼容解释器，或用 FLOW_PYTHON_BIN 指定其路径。'}`);
}
