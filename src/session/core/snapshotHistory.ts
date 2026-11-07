import type { ChangeSetV1, ResultV1 } from '../../platform/contracts/refactorV1.js';
import { copy, fail, ok, revision } from './imageProjectValues.js';
import { projectChanges, type HistoryProjectShape } from './imageProjectModel.js';
import { typingFoldKey, validTypingGroup } from './grouping.js';

export type HistoryResult<P> = { before:P; after:P; changed:boolean; changes:ChangeSetV1 };
export type HistoryOptions = { maxEntries:number; group?:{now():number;windowMs:number} };
export type HistoryPlan<P> = { readonly result:HistoryResult<P> };
export type SnapshotHistory<P,C> = {
  current():ResultV1<P>;
  prepare(command:C,typing?:{group:string}):ResultV1<HistoryPlan<P>>;
  endTyping():void;
  prepareUndo():ResultV1<HistoryPlan<P>>;
  prepareRedo():ResultV1<HistoryPlan<P>>;
  commit(plan:HistoryPlan<P>):ResultV1<HistoryResult<P>>;
  undoDepth():number;redoDepth():number;
};

/** The only history algorithm for V1 and V2. Preparing changes no stack. Main
 * can durably CAS result.after before committing this exact privately held plan. */
export function createSnapshotHistory<P extends HistoryProjectShape,C>(project:P,options:HistoryOptions,adapter:{valid(v:unknown):v is P;reduce(p:P,c:C):ResultV1<HistoryResult<P>>}):ResultV1<SnapshotHistory<P,C>> {
  if(!adapter.valid(project)||!options||!Number.isSafeInteger(options.maxEntries)||options.maxEntries<1)return fail('invalid-input','Invalid initial project or history capacity');
  const grouping=options.group;
  if(grouping!==undefined&&(!grouping||typeof grouping.now!=='function'||!Number.isFinite(grouping.windowMs)||grouping.windowMs<=0))return fail('invalid-input','Invalid history grouping option');
  type Group={key:string;token:string;at:number}|null;
  type State={project:P;undo:P[];redo:P[];group:Group};
  let state:State={project:copy(project),undo:[],redo:[],group:null},generation=0;
  const plans=new WeakMap<HistoryPlan<P>,{generation:number;next:State;result:HistoryResult<P>}>();
  const push=(stack:P[],p:P)=>[...stack,p].slice(-options.maxEntries);
  const freeze=<T>(value:T):T=>{if(value&&typeof value==='object'){for(const child of Object.values(value))freeze(child);Object.freeze(value);}return value;};
  const plan=(result:HistoryResult<P>,next:State):ResultV1<HistoryPlan<P>>=>{
    const publicPlan:HistoryPlan<P>=Object.freeze({result:freeze(copy(result))});
    plans.set(publicPlan,{generation,next,result:copy(result)});return ok(publicPlan);
  };
  const endTyping=()=>{if(state.group){state={...state,group:null};generation++;}};
  const restore=(kind:'undo'|'redo')=>{
    // Even a refused Undo/Redo ends typing. This changes grouping context only,
    // never the project revision or either stack. Invalidate pre-existing plans.
    endTyping();
    const from=state[kind],to=kind==='undo'?'redo':'undo';
    if(!from.length)return fail<HistoryPlan<P>>('not-found','No history entry');
    if(!revision(state.project.revision+1))return fail<HistoryPlan<P>>('invalid-input','Project revision overflow');
    const after={...from.at(-1)!,revision:state.project.revision+1};
    return plan({before:state.project,after,changed:true,changes:projectChanges(state.project,after)},
      {...state,project:after,[kind]:from.slice(0,-1),[to]:push(state[to],state.project),group:null});
  };
  return ok({
    current:()=>ok(copy(state.project)),undoDepth:()=>state.undo.length,redoDepth:()=>state.redo.length,
    prepare(command,typing){
      const result=adapter.reduce(state.project,copy(command));if(!result.ok)return result;
      if(!result.value.changed)return plan(result.value,state);
      const target=typing&&validTypingGroup(typing.group)?typingFoldKey(result.value.before,result.value.after):null;
      let at:number|null=null;
      if(target&&grouping)try{const n=grouping.now();if(Number.isFinite(n))at=n;}catch{/* no group */}
      const key=target?`${target.shotId}/${target.dialogueId}`:null,token=target?typing!.group:null;
      const backwards=at!==null&&state.group!==null&&at<state.group.at;
      const fold=!backwards&&key!==null&&at!==null&&token!==null&&state.group!==null&&state.group.key===key&&state.group.token===token&&at-state.group.at<grouping!.windowMs&&state.undo.length>0;
      const group=!backwards&&key!==null&&at!==null&&token!==null?{key,token,at}:null;
      return plan(result.value,{project:copy(result.value.after),undo:fold?state.undo:push(state.undo,state.project),redo:[],group});
    },
    endTyping,prepareUndo:()=>restore('undo'),prepareRedo:()=>restore('redo'),
    commit(publicPlan){
      const owned=plans.get(publicPlan);
      if(!owned||owned.generation!==generation)return fail('conflict','Foreign, used or stale history plan');
      plans.delete(publicPlan);state=owned.next;generation++;
      return ok(copy(owned.result));
    }
  });
}
