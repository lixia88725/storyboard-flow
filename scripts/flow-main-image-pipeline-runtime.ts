// Dedicated Electron Main fixture entry: all project/native behavior is production code.
export { startImageEngine } from '../src/platform/main/imageEngineConnection';
export { acquireImageProjectLease } from '../src/platform/main/imageProjectLease';
export { createSourceBackedImport, openSourceBackedImport } from '../src/project-files/main/image-engine/sourceStore';
export { openImageProjectStore } from '../src/project-files/main/image-engine/projectStore';
export { createNativeSessionAdapter } from '../src/project-files/main/image-engine/nativeSessionAdapter';
export { openNativeProjectSession } from '../src/session/core/nativeSession';
