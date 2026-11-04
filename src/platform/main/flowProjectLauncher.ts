import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FlowCreateDraftView, FlowCreatePatch, FlowCreateSourceView, FlowRecentProject } from '../contracts/flowEditor.js';
import type { ProjectNamingV1 } from '../contracts/refactorV1.js';
import type { CreateImageProject, CreateImageProjectIssue, CreateImageProjectSource } from '../contracts/flowProjectCreation.js';
import { namingIssue } from '../contracts/flowNaming.js';
import { folderNameIssue, PROJECT_FIELD_LIMIT } from '../contracts/flowProjectFields.js';
import type { FlowWorkspaceTarget } from '../../project-files/main/flowWorkspace.js';

const RECENT_VERSION = 1;
const RECENT_LIMIT = 20;
const FIELD_LIMIT = PROJECT_FIELD_LIMIT;

type RecentRecord = { id: string; root: string; projectId: string; name: string; lastOpenedAt: number };
type StoredRecent = { version: 1; projects: RecentRecord[] };

type Draft = {
  id: string;
  source: CreateImageProjectSource | null;
  destinationParent: string | null;
  folderName: string;
  name: string;
  naming: ProjectNamingV1;
  nameTouched: boolean;
  folderTouched: boolean;
  controller?: AbortController;
};

export type FlowProjectLauncherDeps = {
  userData: string;
  /** Strictly opens an existing Flow project; must reject when there is no checkpoint. */
  prepare: (root: string) => Promise<FlowWorkspaceTarget>;
  /** The file-module implementation is injected; this module never invents a second one. */
  createProject: CreateImageProject;
  /** Forwards progress to the window. */
  onProgress: (draftId: string, progress: { done: number; total: number; phase?: 'read' | 'write' }) => void;
  /** Asks the user whether to continue after batched per-file issues. */
  decideIssues: (draftId: string, issues: CreateImageProjectIssue[]) => Promise<'continue' | 'cancel'>;
  now?: () => number;
  randomId?: () => string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const hasText = (value: unknown): value is string => typeof value === 'string' && !value.includes('\0');
const clean = (value: string) => value.trim() || '未命名项目';
const absolute = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= 4096 && !value.includes('\0') && path.isAbsolute(value);

/** Folder names are one path component: no separators, no traversal, no reserved controls. */

const validNaming = (naming: unknown): naming is ProjectNamingV1 =>
  isRecord(naming) && Object.keys(naming).length === 3 &&
  ['sceneCode', 'artistName', 'version'].every(key => hasText(naming[key]) &&
    (naming[key] as string).length <= FIELD_LIMIT);

const sourceLabel = (source: CreateImageProjectSource): FlowCreateSourceView =>
  source.kind === 'folder'
    ? { kind: 'folder', label: path.basename(source.folder) || source.folder }
    : { kind: 'files', label: `${source.files.length} 张图片`, count: source.files.length };

/** User cancellation is not a failure: Main turns it into a canceled launch so the
 * renderer keeps the original project without displaying an I/O error. */
export class ProjectCreationCanceled extends Error {
  readonly canceled = true;
  constructor() { super('创建已取消'); this.name = 'ProjectCreationCanceled'; }
}
export const isProjectCreationCanceled = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'ProjectCreationCanceled' || error.name === 'AbortError');

/** Owns the recent-target list and in-memory creation drafts. All paths stay here;
 * the renderer only receives labels and opaque IDs. */
export function createFlowProjectLauncher(deps: FlowProjectLauncherDeps) {
  const now = deps.now ?? (() => Date.now());
  const randomId = deps.randomId ?? randomUUID;
  const recentFile = path.join(deps.userData, 'recent-projects.json');
  let recent: RecentRecord[] | null = null;
  let writeChain: Promise<void> = Promise.resolve();
  const drafts = new Map<string, Draft>();

  const loadRecent = async (): Promise<RecentRecord[]> => {
    if (recent) return recent;
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(recentFile, 'utf8'));
      if (!isRecord(parsed) || parsed.version !== RECENT_VERSION || !Array.isArray(parsed.projects)) throw Error('Unsupported recent-project file');
      const seen = new Set<string>();
      recent = parsed.projects.flatMap(value => {
        if (!isRecord(value) || typeof value.id !== 'string' || !value.id || !absolute(value.root) ||
            typeof value.projectId !== 'string' || !value.projectId ||
            typeof value.name !== 'string' || typeof value.lastOpenedAt !== 'number' || !Number.isFinite(value.lastOpenedAt)) return [];
        const root = path.resolve(value.root);
        if (seen.has(root)) return [];
        seen.add(root);
        return [{ id: value.id, root, projectId: value.projectId, name: clean(value.name), lastOpenedAt: value.lastOpenedAt }];
      }).slice(0, RECENT_LIMIT);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') recent = [];
      else recent = [];
    }
    return recent;
  };

  const persist = async () => {
    const projects = (await loadRecent()).slice(0, RECENT_LIMIT);
    const body: StoredRecent = { version: RECENT_VERSION, projects };
    const temporary = path.join(deps.userData, `.recent-projects-${randomUUID()}.tmp`);
    await fs.mkdir(deps.userData, { recursive: true });
    try {
      await fs.writeFile(temporary, JSON.stringify(body, null, 2) + '\n', { mode: 0o600 });
      await fs.rename(temporary, recentFile);
    } catch (error) {
      await fs.rm(temporary, { force: true }).catch(() => {});
      throw error;
    }
  };

  /** Recent storage is a convenience, never a reason to fail an otherwise valid open. */
  const saveRecent = async () => {
    const work = writeChain.then(persist);
    writeChain = work.catch(() => {});
    await work.catch(() => {});
  };

  const available = async (root: string) => {
    try {
      const meta = await fs.lstat(path.join(root, '.storyboard-flow'));
      return meta.isDirectory() && !meta.isSymbolicLink();
    } catch { return false; }
  };

  const remember = async (root: string, projectId: string, projectName: string) => {
    const list = await loadRecent();
    const name = clean(projectName);
    const existing = list.find(entry => entry.root === root);
    const record: RecentRecord = existing
      ? { ...existing, projectId, name, lastOpenedAt: now() }
      : { id: randomId(), root, projectId, name, lastOpenedAt: now() };
    recent = [record, ...list.filter(entry => entry.root !== root)].slice(0, RECENT_LIMIT);
    await saveRecent();
  };

  const prepareFlow = async (root: string): Promise<FlowWorkspaceTarget> => {
    const canonical = await fs.realpath(root).catch(error => {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT') throw Error('项目文件夹已不存在');
      throw Error('无法访问项目文件夹');
    });
    let meta;
    try { meta = await fs.lstat(path.join(canonical, '.storyboard-flow')); }
    catch (error) {
      if ((error as NodeJS.ErrnoException)?.code === 'ENOENT')
        throw Error('该文件夹不是 Storyboard Flow 项目；如需从图片开始，请使用“新建项目”。');
      throw error;
    }
    if (!meta.isDirectory() || meta.isSymbolicLink())
      throw Error('该文件夹的 Storyboard Flow 项目数据不是可用的目录');
    return deps.prepare(canonical);
  };

  const openRoot = async (root: string) => {
    const target = await prepareFlow(root);
    const project = target.runtime.open().project;
    await remember(target.root, project.id, project.name);
    return target;
  };

  const openRecent = async (id: string) => {
    const entry = (await loadRecent()).find(candidate => candidate.id === id);
    if (!entry) throw Error('这条最近项目记录已不存在');
    const target = await prepareFlow(entry.root);
    const project = target.runtime.open().project;
    // A folder that now holds a different project is not the recorded target.
    if (project.id !== entry.projectId)
      throw Error('这个位置的项目与最近记录不一致；请用“打开项目”重新确认。');
    await remember(target.root, project.id, project.name);
    return target;
  };

  const view = (draft: Draft): FlowCreateDraftView => ({
    id: draft.id,
    source: draft.source ? sourceLabel(draft.source) : { kind: 'none' },
    destination: draft.destinationParent ? { label: path.basename(draft.destinationParent) || draft.destinationParent } : null,
    folderName: draft.folderName,
    name: draft.name,
    naming: { ...draft.naming }
  });

  const requireDraft = (id: string) => {
    const draft = drafts.get(id);
    if (!draft) throw Error('这次创建已经结束，请重新开始');
    return draft;
  };

  const begin = (): FlowCreateDraftView => {
    const draft: Draft = {
      id: randomId(), source: null, destinationParent: null,
      folderName: '未命名项目', name: '未命名项目',
      naming: { sceneCode: 'scene', artistName: 'artist', version: 'v001' },
      nameTouched: false, folderTouched: false
    };
    drafts.set(draft.id, draft);
    return view(draft);
  };

  const setSource = (id: string, source: CreateImageProjectSource): FlowCreateDraftView => {
    const draft = requireDraft(id);
    if (draft.controller) throw Error('正在创建，不能更换来源');
    if (source.kind === 'folder') {
      if (!absolute(source.folder)) throw Error('图片来源文件夹无效');
      if (!draft.nameTouched) draft.name = path.basename(source.folder) || draft.name;
      if (!draft.folderTouched) draft.folderName = path.basename(source.folder) || draft.folderName;
    } else {
      if (!Array.isArray(source.files) || !source.files.length || source.files.length > 10_000 || !source.files.every(absolute))
        throw Error('图片来源文件无效');
      if (!draft.nameTouched) draft.name = '未命名项目';
      if (!draft.folderTouched) draft.folderName = '未命名项目';
    }
    draft.source = source;
    return view(draft);
  };

  const setDestination = (id: string, destinationParent: string): FlowCreateDraftView => {
    const draft = requireDraft(id);
    if (draft.controller) throw Error('正在创建，不能更换保存位置');
    if (!absolute(destinationParent)) throw Error('保存位置无效');
    draft.destinationParent = destinationParent;
    return view(draft);
  };

  const update = (id: string, patch: FlowCreatePatch): FlowCreateDraftView => {
    const draft = requireDraft(id);
    if (draft.controller) throw Error('正在创建，不能修改设置');
    if (!isRecord(patch)) throw Error('创建设置无效');
    if (Object.hasOwn(patch, 'folderName')) {
      if (folderNameIssue(patch.folderName as string)) throw Error(folderNameIssue(patch.folderName as string)!);
      draft.folderName = patch.folderName as string;
      draft.folderTouched = true;
    }
    if (Object.hasOwn(patch, 'name')) {
      if (!hasText(patch.name) || (patch.name as string).length > FIELD_LIMIT) throw Error('项目名称无效或过长');
      draft.name = patch.name as string;
      draft.nameTouched = true;
    }
    if (Object.hasOwn(patch, 'naming')) {
      if (!validNaming(patch.naming)) throw Error('场次、作者或版本无效');
      draft.naming = { ...patch.naming };
    }
    return view(draft);
  };

  /** Publication-boundary check: drafts may hold invalid text while other work
   * continues, but creating a project refuses until the values can be published. */
  const problem = (draft: Draft): string | null => {
    if (!draft.source) return '请先选择图片或文件夹';
    if (!draft.destinationParent) return '请先选择保存位置';
    const folder = folderNameIssue(draft.folderName);
    if (folder) return folder;
    return namingIssue(draft.name, draft.naming);
  };

  const createAndPrepare = async (id: string): Promise<FlowWorkspaceTarget> => {
    const draft = requireDraft(id);
    if (draft.controller) throw Error('这个项目正在创建');
    const issue = problem(draft);
    if (issue) throw Error(issue);
    const destinationParent = draft.destinationParent!;
    const parent = await fs.realpath(destinationParent);
    const parentMeta = await fs.lstat(parent);
    if (!parentMeta.isDirectory() || parentMeta.isSymbolicLink() || parent !== destinationParent)
      throw Error('保存位置必须是真实目录，不能是链接');
    const targetRoot = path.join(parent, draft.folderName);
    if (path.dirname(targetRoot) !== parent) throw Error('文件夹名称不能包含路径分隔符');
    try {
      await fs.lstat(targetRoot);
      throw Error('保存位置中已经有同名文件夹，请换一个文件夹名称');
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== 'ENOENT') throw error;
    }
    const controller = new AbortController();
    draft.controller = controller;
    let canceled = false;
    try {
      const created = await deps.createProject({
        source: draft.source!, destinationParent: parent,
        folderName: draft.folderName, name: draft.name, naming: { ...draft.naming }
      }, {
        signal: controller.signal,
        onProgress: progress => deps.onProgress(id, progress),
        decideIssues: async issues => {
          if (controller.signal.aborted) { canceled = true; return 'cancel'; }
          const decision = await deps.decideIssues(id, issues);
          if (decision === 'cancel') canceled = true;
          return decision;
        }
      });
      if (canceled || controller.signal.aborted) throw new ProjectCreationCanceled();
      if (!created || !absolute(created.root)) throw Error('创建结果没有返回项目位置');
      const expected = path.join(parent, draft.folderName);
      const canonical = await fs.realpath(created.root);
      // Compare the actual published path with the requested leaf after resolving the
      // filesystem's own normalization, rather than with the raw typed name.
      const expectedCanonical = await fs.realpath(expected).catch(() => null);
      if (canonical !== created.root || expectedCanonical !== canonical || path.dirname(canonical) !== parent)
        throw Error('创建结果位置与请求的保存位置不一致');
      const target = await deps.prepare(canonical);
      const project = target.runtime.open().project;
      await remember(target.root, project.id, project.name);
      drafts.delete(id);
      return target;
    } catch (error) {
      if (canceled || controller.signal.aborted) {
        // The file module may retain its private staging directory on cancellation.
        // Keep that location in the Main log; the UI only needs the neutral notice.
        const detail = error instanceof Error ? error.message : String(error);
        if (detail && detail !== '创建已取消') console.warn('Project creation canceled:', detail);
        throw new ProjectCreationCanceled();
      }
      throw error;
    } finally {
      draft.controller = undefined;
    }
  };

  const abort = (id: string) => {
    const draft = drafts.get(id);
    draft?.controller?.abort();
  };
  const discard = async (id: string) => {
    const draft = drafts.get(id);
    if (!draft) return;
    if (draft.controller) throw Error('正在创建，请先取消');
    drafts.delete(id);
  };
  const abortAll = () => {
    for (const draft of drafts.values()) draft.controller?.abort();
  };

  const state = async (): Promise<{ recent: FlowRecentProject[] }> => ({
    recent: await Promise.all((await loadRecent()).map(async entry => ({
      id: entry.id, name: entry.name, available: await available(entry.root)
    })))
  });
  const idFor = async (root: string) => (await loadRecent()).find(entry => entry.root === root)?.id ?? null;

  /** Renaming the project changes the display label, never the folder. */
  const updateName = async (root: string, projectName: string) => {
    const list = await loadRecent();
    const existing = list.find(entry => entry.root === root);
    if (!existing) return;
    const name = clean(projectName);
    if (existing.name === name) return;
    recent = list.map(entry => entry.root === root ? { ...entry, name } : entry);
    await saveRecent();
  };

  return {
    state, idFor, updateName, openRoot, openRecent, begin, setSource, setDestination, update,
    problem: (id: string) => problem(requireDraft(id)),
    createAndPrepare, abort, discard, abortAll,
    view: (id: string) => view(requireDraft(id)),
    isCreating: (id: string) => Boolean(drafts.get(id)?.controller)
  };
}

export type FlowProjectLauncher = ReturnType<typeof createFlowProjectLauncher>;
