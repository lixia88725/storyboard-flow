import type { ProjectV1 } from './refactorV1.js';
const same = (a: unknown, b: unknown): boolean => {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((v,i)=>same(v,b[i]));
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const x=a as Record<string,unknown>,y=b as Record<string,unknown>;
  return Object.keys(x).length===Object.keys(y).length&&Object.keys(x).every(k=>Object.hasOwn(y,k)&&same(x[k],y[k]));
};
/** Both inputs must first pass the caller's complete Project validator. Refresh may
 * replace owned images and append alternatives; document text/order remain owned. */
export function validRefreshTransition(before: ProjectV1, after: ProjectV1): boolean {
  if (same(before,after)) return true;
  if (after.revision!==before.revision+1 || !Number.isSafeInteger(after.revision)) return false;
  for(const key of ['schema','version','id','name','naming','presentation','shots','dialogues'] as const) if(!same(before[key],after[key]))return false;
  if(after.parkedShots.length<before.parkedShots.length||!same(after.parkedShots.slice(0,before.parkedShots.length),before.parkedShots))return false;
  const owners=new Set([...before.shots,...before.parkedShots].map(s=>s.imageId));
  const added=after.parkedShots.slice(before.parkedShots.length);
  if(added.some(s=>Object.hasOwn(before.images,s.imageId)))return false;
  for(const [id,image] of Object.entries(before.images)){
    if(image.layers.some(layer=>layer.sourceReference && !same(layer,after.images[id]?.layers.find(other=>other.id===layer.id))))return false;
    if(!Object.hasOwn(after.images,id)||(!owners.has(id)&&!same(image,after.images[id])))return false;
  }
  // Newly retained, unowned images preserve external assets across accepted merges.
  return true;
}
