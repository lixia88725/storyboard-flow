import type{WorkspaceOutputBudget}from'./workspaceOutputContract.js';
/** A fixed partition funded by Main's one actual+reserved project account before
 * exposing this port. It counts NEW retained growth and pending/unknown spends;
 * existing bytes are already in the project's initial physical inventory. */
export function createWorkspaceAllowance(limit:number):WorkspaceOutputBudget&{snapshot():{growth:number;reserved:number;unknown:number}}{
 if(!Number.isSafeInteger(limit)||limit<0)throw Error('Invalid funded allowance');let growth=0,reserved=0,unknown=0;
 return{snapshot:()=>({growth,reserved,unknown}),async reserve(input){if(!Number.isSafeInteger(input.bytes)||input.bytes<0||growth+reserved+input.bytes>limit)throw Object.assign(Error('The funded recovery allowance is full; originals remain retained or queued'),{code:'resource-limit',effect:'none'});reserved+=input.bytes;let state:'pending'|'unknown'|'settled'='pending',delta:number|undefined;return{
  async settleActual(value:number){if(state==='settled'){if(value!==delta)throw Error('Allowance settlement changed');return;}if(!Number.isSafeInteger(value)||value>input.bytes)throw Object.assign(Error('Recovery growth exceeded its funded reservation'),{code:'conflict',effect:'unknown'});growth=Math.max(0,growth+value);reserved-=input.bytes;if(state==='unknown')unknown--;state='settled';delta=value;},
  async retainUnknown(){if(state==='pending'){state='unknown';unknown++;}}
 };}};
}
