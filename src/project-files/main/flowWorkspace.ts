import type { ProjectV1 } from '../../platform/contracts/refactorV1.js';
import type { openFlowEditorRuntime } from './flowEditorRuntime.js';

type Runtime = Awaited<ReturnType<typeof openFlowEditorRuntime>>;
export type FlowWorkspaceTarget = { root: string; runtime: Runtime };

/** Owns one writable runtime. Tokens belong to an incarnation, not a project ID.
 * prepare must canonicalize the root and finish strict loading before returning. */
export function createFlowWorkspace(initial: FlowWorkspaceTarget) {
  let current = initial, transitioning = false;
  let sessionId = initial.runtime.open().sessionId;
  const requireOwner = (token: string) => {
    if (transitioning || token !== sessionId) throw Error('Stale or transitioning editor session');
    return current.runtime;
  };
  return {
    open: () => current.runtime.open(),
    read: (token: string, id: string) => requireOwner(token).read(id),
    put: (token: string, input: Parameters<Runtime['put']>[0]) => requireOwner(token).put(input),
    checkpoint: (token: string, project: ProjectV1) => requireOwner(token).checkpoint(project),
    refresh: (token:string,project:ProjectV1)=>requireOwner(token).refresh(project),
    folderStatus: (token: string, request: Parameters<Runtime['folderStatus']>[0]) => requireOwner(token).folderStatus(request),
    outputNames: (token: string, project: ProjectV1) => requireOwner(token).outputNames(project),
    saveTiff: (token: string, project: ProjectV1) => requireOwner(token).saveTiff(project),
    certifyClose: (token: string, project: ProjectV1 | null) => requireOwner(token).certifyClose(project),
    async switchProject(token: string, project: ProjectV1, chooseAndPrepare: (currentRoot: string) => Promise<FlowWorkspaceTarget | null>) {
      const previous = requireOwner(token);
      transitioning = true;
      try {
        const candidate = await chooseAndPrepare(current.root);
        if (!candidate || candidate.root === current.root) return null;
        // Failed preparation/certification retains the original writable owner.
        const bootstrap = candidate.runtime.open();
        if (!await previous.certifyClose(project)) throw Error('Checkpoint verification failed; original project retained');
        current = candidate;
        sessionId = bootstrap.sessionId;
        return bootstrap;
      } finally { transitioning = false; }
    }
  };
}
