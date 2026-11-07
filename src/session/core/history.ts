import { pendingAddEdit } from './pendingAdd';
import type { ProjectEditResultV1, ProjectV1, ResultV1, StoryboardEditV1 } from '../../platform/contracts/refactorV1';
import { applyStoryboardEdit } from '../../storyboard/core';
import { validProject, fail, ok, same } from '../../project-files/contracts/projectModel';
import { createSnapshotHistory, type HistoryOptions, type HistoryPlan } from './snapshotHistory';

export interface ProjectHistoryV1 {
  current():ResultV1<ProjectV1>;
  apply(edit:StoryboardEditV1,typing?:{group:string}):ResultV1<ProjectEditResultV1>;
  insertParkedShots(before:ProjectV1,after:ProjectV1):ResultV1<ProjectEditResultV1>;
  undo():ResultV1<ProjectEditResultV1>;redo():ResultV1<ProjectEditResultV1>;
  undoDepth():number;redoDepth():number;
}
export type ProjectHistoryGrouping = NonNullable<HistoryOptions['group']>;
export type ProjectHistoryOptions = HistoryOptions;
type Command={kind:'edit';edit:StoryboardEditV1}|{kind:'pending';before:ProjectV1;after:ProjectV1};

/** V1 adapter only; stacks, grouping and restore live once in snapshotHistory. */
export function createProjectHistory(project:ProjectV1,options:ProjectHistoryOptions):ResultV1<ProjectHistoryV1>{
  const created=createSnapshotHistory<ProjectV1,Command>(project,options,{valid:validProject,reduce:(state,command)=>{
    if(command.kind==='edit')return applyStoryboardEdit(state,command.edit);
    return same(state,command.before)?pendingAddEdit(state,command.after):fail('conflict','Pending append baseline changed');
  }});
  if(!created.ok)return created;
  const history=created.value;
  const commit=(plan:ResultV1<HistoryPlan<ProjectV1>>)=>plan.ok?history.commit(plan.value):plan;
  return ok({current:history.current,undoDepth:history.undoDepth,redoDepth:history.redoDepth,
    apply:(edit,typing)=>commit(history.prepare({kind:'edit',edit},typing)),
    insertParkedShots:(before,after)=>commit(history.prepare({kind:'pending',before,after})),
    undo:()=>commit(history.prepareUndo()),redo:()=>commit(history.prepareRedo())});
}
