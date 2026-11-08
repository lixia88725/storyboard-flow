import type { ImageWorkspaceUpgradeDraft, ImageWorkspaceUpgradePatch } from '../contracts/imageWorkspace.js';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FlowCreateDraftView, FlowCreateMode, FlowCreatePatch, FlowCreateSourceView, FlowRecentProject } from '../contracts/flowEditor.js';
import type { ProjectNamingV1 } from '../contracts/refactorV1.js';
import type { CreateBlankProject, CreateImageProject, CreateImageProjectIssue, CreateImageProjectSource } from '../contracts/flowProjectCreation.js';
import { namingIssue } from '../contracts/flowNaming.js';
import { folderNameIssue, projectFolderNameFor, PROJECT_FIELD_LIMIT } from '../contracts/flowProjectFields.js';
import type { FlowWorkspaceTarget } from '../../project-files/main/flowWorkspace.js';

const RECENT_VERSION = 1;
const RECENT_LIMIT = 20;
const FIELD_LIMIT = PROJECT_FIELD_LIMIT;

type RecentRecord = { id: string; root: string; projectId: string; name: string; lastOpenedAt: number };
type StoredRecent = { version: 1; projects: RecentRecord[] };

type Draft = {
  id: string;
  mode: FlowCreateMode;
  legacy: boolean;
  imageCount: number;
  source: CreateImageProjectSource | null;
  destinationParent: string | null;
  folderName: string;
  name: string;
  naming: ProjectNamingV1;
  nameTouched: boolean;
  folderTouched: boolean;
  controller?: AbortController;
};

export type FlowProjectIdentity={id:string;name:string};
export type FlowUpgradeInspection={projectId:string;projectName:string;activeBoards:number;pendingBoards:number;sourceDigest:string;issues:readonly {code:string;message:string}[]};
export type FlowCopyUpgradeInput={operationId:string;sourceRoot:string;projectId:string;sourceDigest:string;destinationParent:string;folderName:string;projectName:string};
export type FlowProjectLauncherDeps<T extends {root:string}=FlowWorkspaceTarget> = {
  userData: string;
  /** Strictly opens an existing Flow project; must reject when there is no checkpoint. */
  prepare: (root: string) => Promise<T>;
  /** Native plans expose identity without acquiring a writable Session. Legacy
   * callers omit this and retain their existing bootstrap metadata reader. */
  describe?: (target:T) => FlowProjectIdentity;
  /** The file-module implementation is injected; this module never invents a second one. */
  createProject: CreateImageProject;
  /** Empty project creation; the same transaction without a source. */
  createBlankProject: CreateBlankProject;
  inspectUpgrade?:(root:string)=>Promise<FlowUpgradeInspection>;
  copyUpgrade?:(input:FlowCopyUpgradeInput,options:{signal:AbortSignal;onProgress(progress:{done:number;total:number;phase?:'read'|'write'}):void})=>Promise<{root:string}>;
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
export function createFlowProjectLauncher<T extends {root:string}=FlowWorkspaceTarget>(deps: FlowProjectLauncherDeps<T>) {
  const identityOf=(target:T):FlowProjectIdentity=>{
    let identity:unknown;
    if(deps.describe)identity=deps.describe(target);
    else{
      const legacyTarget:unknown=target;if(!isRecord(legacyTarget)||!isRecord(legacyTarget.runtime)||typeof legacyTarget.runtime.open!=='function')throw Error('Launcher target needs an explicit identity reader');
      const bootstrap:unknown=legacyTarget.runtime.open();if(!isRecord(bootstrap))throw Error('Invalid launcher bootstrap');identity=bootstrap.project;
    }
    if(!isRecord(identity)||!hasText(identity.id)||!identity.id||!hasText(identity.name))throw Error('Invalid launcher project identity');
    return{id:identity.id,name:identity.name};
  };
  const now = deps.now ?? (() => Date.now());
  const randomId = deps.randomId ?? randomUUID;
  const recentFile = path.join(deps.userData, 'recent-projects.json');
  let recent: RecentRecord[] | null = null;
  let writeChain: Promise<void> = Promise.resolve();
  const drafts = new Map<string, Draft>();
  type Upgrade={id:string;sourceRoot:string;inspection:FlowUpgradeInspection;destinationParent:string|null;folderName:string;projectName:string;state:ImageWorkspaceUpgradeDraft['state'];controller?:AbortController};
  const upgrades=new Map<string,Upgrade>();
  const upgrade=(id:string)=>{const d=upgrades.get(id);if(!d)throw Error('这次复制已经结束，请重新选择项目');return d;};
  const upgradeView=(id:string):ImageWorkspaceUpgradeDraft=>{const d=upgrade(id);return{id:d.id,kind:'copy-upgrade',sourceLabel:path.basename(d.sourceRoot),destinationLabel:d.destinationParent?path.basename(d.destinationParent):null,folderName:d.folderName,projectName:d.projectName,activeBoards:d.inspection.activeBoards,pendingBoards:d.inspection.pendingBoards,originalPreserved:true,state:d.state,issues:structuredClone(d.inspection.issues)};};
  const upgradeDraft=async(root:string)=>{
    if(!deps.inspectUpgrade||!deps.copyUpgrade)throw Error('旧项目复制功能尚未就绪');const sourceRoot=await fs.realpath(root),entry=await fs.lstat(sourceRoot);if(!entry.isDirectory()||entry.isSymbolicLink())throw Error('原项目位置无效');
    const inspection=await deps.inspectUpgrade(sourceRoot);if(!hasText(inspection.projectId)||!inspection.projectId||!hasText(inspection.projectName)||!Number.isSafeInteger(inspection.activeBoards)||inspection.activeBoards<0||!Number.isSafeInteger(inspection.pendingBoards)||inspection.pendingBoards<0||!(/^[a-f0-9]{64}$/).test(inspection.sourceDigest)||!Array.isArray(inspection.issues))throw Error('无法验证原项目');
    const id=randomId(),projectName=(clean(inspection.projectName)+' 副本').slice(0,FIELD_LIMIT);upgrades.set(id,{id,sourceRoot,inspection:structuredClone(inspection),destinationParent:null,folderName:projectFolderNameFor(projectName),projectName,state:'chooseDestination'});return upgradeView(id);
  };
  const setUpgradeDestination=async(id:string,parent:string)=>{
    const d=upgrade(id);if(d.controller)throw Error('正在复制，请等待当前操作结束');const canonical=await fs.realpath(parent),entry=await fs.lstat(canonical);if(!entry.isDirectory()||entry.isSymbolicLink())throw Error('复制位置无效');const relative=path.relative(d.sourceRoot,canonical);if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw Error('请选择原项目之外的位置');d.destinationParent=canonical;d.state='ready';return upgradeView(id);
  };
  const updateUpgrade=(id:string,patch:ImageWorkspaceUpgradePatch)=>{
    const d=upgrade(id);if(d.controller)throw Error('正在复制，请等待当前操作结束');if(!isRecord(patch)||Object.keys(patch).some(k=>k!=='projectName'&&k!=='folderName'))throw Error('复制设置无效');
    if(patch.projectName!==undefined){if(!hasText(patch.projectName)||!patch.projectName.trim()||patch.projectName.length>FIELD_LIMIT)throw Error('项目名称无效');}
    if(patch.folderName!==undefined){if(!hasText(patch.folderName)||folderNameIssue(patch.folderName))throw Error('文件夹名称无效');}if(patch.projectName!==undefined){d.projectName=patch.projectName;d.folderName=projectFolderNameFor(patch.projectName);}if(patch.folderName!==undefined)d.folderName=patch.folderName;return upgradeView(id);
  };
  const discardUpgrade=async(id:string)=>{const d=upgrades.get(id);if(!d)return;if(d.controller){d.controller.abort();return;}upgrades.delete(id);};
  const createAndPrepareUpgrade=async(id:string):Promise<T>=>{
    const d=upgrade(id);if(!deps.copyUpgrade||!deps.inspectUpgrade)throw Error('旧项目复制功能尚未就绪');if(d.controller||!d.destinationParent)throw Error('请选择新副本的位置');if(folderNameIssue(d.folderName))throw Error('文件夹名称无效');
    if(d.state!=='retained'){const current=await deps.inspectUpgrade(d.sourceRoot);if(current.projectId!==d.inspection.projectId||current.sourceDigest!==d.inspection.sourceDigest)throw Error('原项目已变化，请重新选择后复制');}const controller=new AbortController();d.controller=controller;d.state='running';
    try{const created=await deps.copyUpgrade({operationId:d.id,sourceRoot:d.sourceRoot,projectId:d.inspection.projectId,sourceDigest:d.inspection.sourceDigest,destinationParent:d.destinationParent,folderName:d.folderName,projectName:d.projectName},{signal:controller.signal,onProgress:p=>{try{deps.onProgress(id,p);}catch{/* advisory */}}});
      const canonical=await fs.realpath(created.root),expected=await fs.realpath(path.join(d.destinationParent,d.folderName));if(canonical!==created.root||canonical!==expected||path.dirname(canonical)!==d.destinationParent||canonical===d.sourceRoot)throw Error('新副本位置与选择的位置不一致');const target=await deps.prepare(canonical),project=identityOf(target);await remember(target.root,project.id,project.name);upgrades.delete(id);return target;
    }catch(e){d.state='retained';throw e;}finally{delete d.controller;}
  };


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

  const prepareFlow = async (root: string): Promise<T> => {
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
    const project = identityOf(target);
    await remember(target.root, project.id, project.name);
    return target;
  };

  const openRecent = async (id: string) => {
    const entry = (await loadRecent()).find(candidate => candidate.id === id);
    if (!entry) throw Error('这条最近项目记录已不存在');
    const target = await prepareFlow(entry.root);
    const project = identityOf(target);
    // A folder that now holds a different project is not the recorded target.
    if (project.id !== entry.projectId)
      throw Error('这个位置的项目与最近记录不一致；请用“打开项目”重新确认。');
    await remember(target.root, project.id, project.name);
    return target;
  };

  const view = (draft: Draft): FlowCreateDraftView => ({
    id: draft.id,
    mode: draft.mode,
    legacy: draft.legacy,
    imageCount: draft.imageCount,
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

  /** The sheet asks for a name, not a folder name: the folder follows the name.
   * A folder beside its own source keeps a distinct name so the location the
   * user just opened is never the target. */
  const sourceFolderName = (draft: Draft) =>
    draft.source?.kind === 'folder' ? path.basename(draft.source.folder) : undefined;
  const syncFolderName = (draft: Draft) => {
    if (draft.folderTouched) return;
    draft.folderName = projectFolderNameFor(draft.name, sourceFolderName(draft));
  };

  const begin = (mode: FlowCreateMode = 'images'): FlowCreateDraftView => {
    const draft: Draft = {
      id: randomId(), mode, legacy: false, imageCount: 0, source: null, destinationParent: null,
      folderName: '未命名项目', name: '未命名项目',
      naming: { sceneCode: 'scene', artistName: 'artist', version: 'v001' },
      nameTouched: false, folderTouched: false
    };
    drafts.set(draft.id, draft);
    return view(draft);
  };

  /** A folder the entry classified as images (or a retired workbook) becomes a
   * draft that only needs a location: the project name already defaults to the
   * folder's name. */
  const draftFromFolder = (folder: string, entry: { imageCount: number; legacy: boolean }): FlowCreateDraftView => {
    if (!absolute(folder)) throw Error('图片来源文件夹无效');
    if (!Number.isSafeInteger(entry?.imageCount) || entry.imageCount < 1) throw Error('这个文件夹里没有可导入的图片');
    const base = path.basename(folder) || '未命名项目';
    const draft: Draft = {
      id: randomId(), mode: 'images', legacy: Boolean(entry.legacy), imageCount: entry.imageCount,
      source: { kind: 'folder', folder }, destinationParent: null,
      folderName: base, name: base,
      naming: { sceneCode: 'scene', artistName: 'artist', version: 'v001' },
      nameTouched: false, folderTouched: false
    };
    syncFolderName(draft);
    drafts.set(draft.id, draft);
    return view(draft);
  };

  const setSource = (id: string, source: CreateImageProjectSource): FlowCreateDraftView => {
    const draft = requireDraft(id);
    if (draft.mode !== 'images') throw Error('空白项目不需要图片来源');
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
    draft.legacy = false;
    draft.imageCount = source.kind === 'folder' ? draft.imageCount : source.files.length;
    syncFolderName(draft);
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
      syncFolderName(draft);
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
    if (draft.mode === 'images' && !draft.source) return '请先选择图片或文件夹';
    if (!draft.destinationParent) return '请先选择保存位置';
    const folder = folderNameIssue(draft.folderName);
    if (folder) return folder;
    return namingIssue(draft.name, draft.naming);
  };

  const createAndPrepare = async (id: string): Promise<T> => {
    const draft = requireDraft(id);
    if (draft.controller) throw Error('这个项目正在创建');
    const issue = problem(draft);
    if (issue) throw Error(issue);
    // The controller exists before the first await so a cancel click during the
    // destination checks is not lost.
    const controller = new AbortController();
    draft.controller = controller;
    let canceled = false;
    try {
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
      if (controller.signal.aborted || canceled) throw new ProjectCreationCanceled();
      syncFolderName(draft);
      const folderProblem = folderNameIssue(draft.folderName);
      if (folderProblem) throw Error(folderProblem);
      const created = draft.mode === 'blank'
        ? await deps.createBlankProject({
            destinationParent: parent, folderName: draft.folderName, name: draft.name, naming: { ...draft.naming }
          }, {
            signal: controller.signal,
            onProgress: progress => deps.onProgress(id, progress)
          })
        : await deps.createProject({
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
      // A successful return means the file module published a complete project;
      // a late cancel click must not hide it.
      if (!created || !absolute(created.root)) throw Error('创建结果没有返回项目位置');
      const expected = path.join(parent, draft.folderName);
      const canonical = await fs.realpath(created.root);
      // Compare the actual published path with the requested leaf after resolving the
      // filesystem's own normalization, rather than with the raw typed name.
      const expectedCanonical = await fs.realpath(expected).catch(() => null);
      if (canonical !== created.root || expectedCanonical !== canonical || path.dirname(canonical) !== parent)
        throw Error('创建结果位置与请求的保存位置不一致');
      const target = await deps.prepare(canonical);
      const project = identityOf(target);
      await remember(target.root, project.id, project.name);
      drafts.delete(id);
      return target;
    } catch (error) {
      const name = (error as { name?: string })?.name;
      if (canceled || name === 'AbortError' || error instanceof ProjectCreationCanceled) {
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
    for (const draft of upgrades.values()) draft.controller?.abort();
  };

  const state = async (): Promise<{ recent: FlowRecentProject[] }> => {
    const list = await loadRecent();
    const parts = list.map(entry => {
      const root = path.parse(entry.root).root;
      return entry.root.slice(root.length).split(path.sep).filter(Boolean);
    });
    const target = (index: number) => {
      const own = parts[index];
      if (!own.length) return path.basename(list[index].root) || list[index].root;
      for (let length = 1; length <= own.length; length++) {
        const suffix = own.slice(-length).join('/');
        if (parts.every((other, otherIndex) => otherIndex === index || other.slice(-length).join('/') !== suffix)) return suffix;
      }
      return own.join('/');
    };
    return {
      recent: await Promise.all(list.map(async (entry, index) => ({
        id: entry.id, name: entry.name, available: await available(entry.root), target: target(index)
      })))
    };
  };
  const idFor = async (root: string) => (await loadRecent()).find(entry => entry.root === root)?.id ?? null;

  const recentProject = async (id: string) => {
    const entry = (await loadRecent()).find(candidate => candidate.id === id);
    return entry ? { projectId: entry.projectId, name: entry.name } : null;
  };
  const forget = async (id: string) => {
    const list = await loadRecent();
    if (!list.some(entry => entry.id === id)) return;
    recent = list.filter(entry => entry.id !== id);
    await saveRecent();
  };
  /** Rebind a missing target only after the caller verified the same project id. */
  const relocate = async (id: string, root: string, projectId: string, projectName: string) => {
    const list = await loadRecent();
    const entry = list.find(candidate => candidate.id === id);
    if (!entry) throw Error('这条最近项目记录已不存在');
    if (entry.projectId !== projectId) throw Error('这个文件夹里的项目与最近记录不一致');
    if (list.some(candidate => candidate.id !== id && candidate.root === root)) throw Error('这个位置已经在最近项目中');
    const canonical = await fs.realpath(root);
    recent = list.map(candidate => candidate.id === id
      ? { ...candidate, root: canonical, name: clean(projectName), lastOpenedAt: now() }
      : candidate);
    await saveRecent();
  };

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
    upgradeDraft,upgradeView,setUpgradeDestination,updateUpgrade,discardUpgrade,createAndPrepareUpgrade,
    state, idFor, recentProject, forget, relocate, updateName, openRoot, openRecent, begin, draftFromFolder, setSource, setDestination, update,
    problem: (id: string) => problem(requireDraft(id)),
    createAndPrepare, abort, discard, abortAll,
    view: (id: string) => view(requireDraft(id)),
    isCreating: (id: string) => Boolean(drafts.get(id)?.controller)
  };
}

export type FlowProjectLauncher = ReturnType<typeof createFlowProjectLauncher<FlowWorkspaceTarget>>;
