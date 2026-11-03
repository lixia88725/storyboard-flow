export type BoardRect={id:string;left:number;top:number;width:number;height:number};
export type Point={x:number;y:number};
export type Box={left:number;top:number;width:number;height:number};
export const selectionBox=(a:Point,b:Point):Box=>({left:Math.min(a.x,b.x),top:Math.min(a.y,b.y),width:Math.abs(a.x-b.x),height:Math.abs(a.y-b.y)});
export function marqueeIds(rects:BoardRect[],box:Box,initial:string[],mode:'replace'|'add'|'toggle'):string[]{
 const before=new Set(initial);
 return rects.filter(r=>{
  const hit=box.width>0&&box.height>0&&r.left<box.left+box.width&&r.left+r.width>box.left&&r.top<box.top+box.height&&r.top+r.height>box.top;
  return mode==='add'?before.has(r.id)||hit:mode==='toggle'?before.has(r.id)!==hit:hit;
 }).map(r=>r.id);
}
export type Insertion={index:number;line:Box};
/** Static card rectangles: no sorting transforms participate in hit testing. */
export function boardInsertion(rects:BoardRect[],point:Point):Insertion|undefined {
 if(!rects.length)return undefined;
 const rows:BoardRect[][]=[];
 for(const r of rects){const row=rows.at(-1);if(row&&Math.abs(row[0].top-r.top)<2)row.push(r);else rows.push([r]);}
 const distance=(row:BoardRect[])=>Math.max(row[0].top-point.y,point.y-Math.max(...row.map(r=>r.top+r.height)),0);
 const row=rows.reduce((a,b)=>distance(b)<distance(a)?b:a);
 if(rows.every(r=>r.length===1)){
  const r=row[0],after=point.y>=r.top+r.height/2;
  return {index:rects.indexOf(r)+(after?1:0),line:{left:r.left,top:(after?r.top+r.height:r.top)-2,width:r.width,height:3}};
 }
 let r=row.find(r=>point.x<r.left+r.width/2),after=false;
 if(!r){r=row[row.length-1];after=true;}
 if(point.y<rects[0].top){r=rects[0];after=false;}
 if(point.y>Math.max(...rows.at(-1)!.map(r=>r.top+r.height))){r=rects.at(-1)!;after=true;}
 return {index:rects.indexOf(r)+(after?1:0),line:{left:(after?r.left+r.width+5:r.left-8),top:r.top,width:3,height:r.height}};
}
/** Resolve an original-order slot to a surviving anchor; selected IDs are never anchors. */
export function boardMovePlan(order:string[],moving:string[],slot:number):{beforeId?:string;changed:boolean;order:string[]} {
 const selected=new Set(moving),beforeId=order.slice(Math.max(0,Math.min(order.length,slot))).find(id=>!selected.has(id));
 const rest=order.filter(id=>!selected.has(id)),at=beforeId===undefined?rest.length:rest.indexOf(beforeId);
 const next=[...rest.slice(0,at),...moving,...rest.slice(at)];
 return {beforeId,changed:next.length!==order.length||next.some((id,i)=>id!==order[i]),order:next};
}
