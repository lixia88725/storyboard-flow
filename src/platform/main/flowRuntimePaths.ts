import path from 'node:path';
import { macTiffPython } from './macTiffPython.js';
import { fileURLToPath } from 'node:url';
/** Source and unpacked package share app-relative worker paths. */
export const flowAppRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
export function flowPythonPath(): string {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return process.env.FLOW_PYTHON_BIN || process.env.FLOW_PYTHON_PATH ||
    (process.platform === 'win32' && resources && path.basename(flowAppRoot) === 'app'
      ? path.join(resources, 'python', 'python.exe') : 'python3');
}
export function flowCodecOptions() {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const packaged = path.basename(flowAppRoot) === 'app' ? resources : undefined;
  const depsDir = process.env.FLOW_PYTHON_DEPS_DIR || (packaged ? path.join(packaged, 'python-deps/photoshop-tiff') : path.join(flowAppRoot, 'vendor/python/photoshop-tiff'));
  return { scriptPath: path.join(flowAppRoot, 'src/project-files/main/formats/codec.py'), depsDir,
    pythonPath: packaged && process.platform === 'darwin'
      ? () => macTiffPython(depsDir, process.env.FLOW_PYTHON_BIN || process.env.FLOW_PYTHON_PATH)
      : flowPythonPath() };
}
